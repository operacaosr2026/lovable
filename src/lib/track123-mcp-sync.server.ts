import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildTrackingUrl } from "@/lib/tracking-url";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { selectAll, selectAllIn } from "@/lib/select-all";

import { fetchWithRetry } from "@/lib/http";
import { isoTodayUS } from "@/lib/timezone";
import { eventDateUS, track123EventUtc } from "@/lib/track123-sync.server";
const MCP_URL = "https://shp.track123.com/shopify/mcp";
// Sem limite de quantidade — processa todos os pedidos em aberto dentro dos
// últimos 30 dias. Vercel function tem maxDuration de 60s e cada pedido custa
// ~1-1.5s (uma chamada por pedido, sem endpoint de lote no MCP), então corta
// por tempo (não por contagem) antes do limite, sempre gravando o status
// final — o que não coube nessa rodada pega na próxima do cron. Processa os
// mais "parados" (sem sync/evento recente) primeiro, pra rotacionar de forma
// justa quando a loja tem mais pedidos abertos do que dá pra checar em 60s.
const SYNC_TIME_BUDGET_MS = 50_000;
// Chamadas em voo ao mesmo tempo (só pra esconder a latência de ~1s de cada
// uma); quem manda no ritmo é o limitador abaixo.
const MCP_CONCURRENCY = 2;
// Uma chamada travada não pode consumir sozinha o orçamento da rodada inteira.
const MCP_REQUEST_TIMEOUT_MS = 15_000;
// O Track123 aceita 4 chamadas/s por API key, mas cada consulta de pedido pelo
// MCP gasta várias dessas por dentro. Acima do limite ele responde 200 com
// {"error":"Exceeded 4 calls per second..."} no lugar do pedido — com 8 em
// paralelo, ~metade voltava assim e era pulada em silêncio ("40/89
// sincronizados" sem erro). Medido em 28/09/2026: 1 chamada/s ainda perde ~40%;
// 1 a cada 1,5s não perde nenhuma. Lojas com a mesma chave dividem o ritmo.
const MCP_MIN_INTERVAL_MS = 1_600;
const nextSlotByKey = new Map<string, number>();
async function paceMcp(apiKey: string) {
  const now = Date.now();
  const slot = Math.max(now, nextSlotByKey.get(apiKey) ?? 0);
  nextSlotByKey.set(apiKey, slot + MCP_MIN_INTERVAL_MS);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}
const isRateLimited = (msg: unknown) => /calls per second|rate limit|too many requests/i.test(String(msg ?? ""));

async function mcpCallOrderByNumber(apiKey: string, storeUuid: string, orderNumber: string) {
  try {
    return await mcpCallOrderByNumberOnce(apiKey, storeUuid, orderNumber);
  } catch (e: any) {
    // Passou do limite mesmo com o ritmo (ex.: outra rodada usando a mesma
    // chave): espera 2s e tenta uma vez de novo.
    if (!isRateLimited(e?.message)) throw e;
    await new Promise((r) => setTimeout(r, 2_000));
    return mcpCallOrderByNumberOnce(apiKey, storeUuid, orderNumber);
  }
}

async function mcpCallOrderByNumberOnce(apiKey: string, storeUuid: string, orderNumber: string) {
  await paceMcp(apiKey);
  const r = await fetchWithRetry(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "X-Api-Key": apiKey,
      "X-Store-Uuid": storeUuid,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_order_details_by_number", arguments: { order_number: orderNumber } },
    }),
  }, { timeoutMs: MCP_REQUEST_TIMEOUT_MS, retries: 1 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json: any = await r.json();
  if (json?.error) throw new Error(json.error.message ?? "Erro MCP");
  const text = json?.result?.content?.[0]?.text;
  if (!text) throw new Error("Resposta MCP sem conteúdo");
  const parsed = JSON.parse(text);
  // Erro do Track123 vem dentro do conteúdo (HTTP 200) — antes passava como
  // "pedido sem envio" e o pedido era pulado sem aparecer como erro.
  if (parsed?.error) throw new Error(String(parsed.error));
  return parsed;
}

// Mesma lógica de mapeamento de evento -> status usada no sync/webhook via Open
// API, pra manter o comportamento (e os status na tela) consistentes entre os
// dois métodos de sincronização.
function buildRuleMatcher(rules: { event_key: string; event_label: string; target_status: string }[]) {
  const ruleMap = new Map<string, string>();
  for (const r of rules) {
    ruleMap.set(r.event_key.toLowerCase(), r.target_status);
    ruleMap.set(r.event_label.toLowerCase(), r.target_status);
  }
  return (text: string | null | undefined): string | null => {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    if (ruleMap.has(t)) return ruleMap.get(t)!;
    for (const [k, v] of ruleMap.entries()) {
      if (t.includes(k) || k.includes(t)) return v;
    }
    return null;
  };
}

// Sem regra configurada pro evento, cai numa inferência simples a partir do
// transit_status que o próprio Track123 já normaliza.
function inferStatus(transitStatus: string | null | undefined, hasTrackingNumber: boolean): string | null {
  // Sem espaço/case pra pegar tanto "InfoReceived" quanto "Info received" (o
  // Track123 já mandou os dois formatos pra esse mesmo status).
  const ts = (transitStatus ?? "").toLowerCase().replace(/\s+/g, "");
  if (ts.includes("delivered")) return "delivered";
  if (ts.includes("exception") || ts.includes("failed") || ts.includes("problem") || ts.includes("undelivered")) return "problem";
  // "Pending"/"InfoReceived" = etiqueta criada e a transportadora só recebeu a
  // info eletrônica do envio, mas ainda não pegou o pacote de verdade — não é
  // "shipped" de verdade ainda, mesmo já tendo tracking_number.
  if (ts.includes("pending") || ts.includes("inforeceived")) return "pending_shipment";
  if (hasTrackingNumber) return "shipped";
  return null;
}

export async function runTrack123McpSync(
  shopId: string,
  apiKey: string,
  storeUuid: string,
  supabase: typeof supabaseAdmin,
  // Prazo absoluto (Date.now()) compartilhado quando várias lojas rodam na mesma
  // chamada (cron / botão "Atualizar") — antes cada loja tinha 50s próprios e a
  // função (limite de 60s na Vercel) morria na 2ª loja, deixando as demais sem
  // sync por horas.
  opts: { deadline?: number } = {},
) {
  const deadline = opts.deadline ?? Date.now() + SYNC_TIME_BUDGET_MS;
  // Só últimos 30 dias — pedido mais antigo que isso não interessa mais pro
  // usuário, e sem esse corte a fila de pedidos "em aberto" nunca esvazia
  // (pedido antigo que nunca foi marcado como entregue fica preso pra sempre).
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  // O tracking_url que a Shopify manda no fulfillment pode estar errado (app
  // Track123 configurado com o domínio de outra loja) — quando a loja tem um
  // template próprio configurado, ele manda em vez de confiar nesse valor.
  const { data: integRow } = await supabase
    .from("track123_integrations")
    .select("tracking_link_template")
    .eq("shop_id", shopId)
    .maybeSingle();
  const trackingLinkTemplate = integRow?.tracking_link_template ?? null;

  // Todos os pedidos em aberto dentro da janela de 30 dias — sem limite de
  // quantidade (só o corte por tempo lá no loop, se a loja tiver muitos).
  const { data: candidates, error: ordersError } = await selectAll(supabase
    .from("shop_orders")
    .select("id,user_id,order_number,delivery_status,tracking_code,shipped_at,delivered_at,problem_at")
    .eq("shop_id", shopId)
    .not("order_number", "is", null)
    // NULL NOT IN (...) é NULL em SQL (não TRUE) — .not("in") sozinho excluiria
    // silenciosamente todo pedido com delivery_status nulo (nunca chegou a ser
    // marcado como "pending_shipment"/etc).
    .or("delivery_status.is.null,delivery_status.not.in.(delivered,returned)")
    // Entregue = fim da linha. Sem isso o pedido seguia na fila por 30 dias,
    // gastando chamada ao MCP (e orçamento de tempo) a cada rodada.
    .is("delivered_at", null)
    .gte("order_date", since)
    .order("order_date", { ascending: true }));
  if (ordersError) throw new Error(ordersError.message);

  // Prioriza quem faz mais tempo que não é reconferido (em vez de sempre os
  // "mais antigos por data do pedido"). Só importa de verdade quando o corte
  // por tempo abaixo não dá conta de todos numa rodada só — senão um pedido
  // genuinamente parado ocupa sempre as primeiras posições e os outros nunca
  // rotacionam pra serem checados de novo (foi o que aconteceu com um pedido
  // já entregue no Track123 há dias que continuou "pendente" aqui).
  let orders = candidates ?? [];
  if (orders.length) {
    const ids = orders.map((o: any) => o.id);
    const { data: trackingRows } = await selectAllIn<any>(ids, (c) => supabase
      .from("shop_order_tracking")
      .select("order_id,updated_at")
      .in("order_id", c));
    const lastCheckedAt = new Map((trackingRows ?? []).map((t: any) => [t.order_id, t.updated_at as string]));
    orders = [...orders].sort((a: any, b: any) => {
      const ta = lastCheckedAt.get(a.id);
      const tb = lastCheckedAt.get(b.id);
      if (!ta && !tb) return 0;
      if (!ta) return -1;
      if (!tb) return 1;
      return ta.localeCompare(tb);
    });
  }

  const { data: rules } = await supabase
    .from("track123_event_rules")
    .select("event_key,event_label,target_status")
    .eq("shop_id", shopId)
    .eq("enabled", true);
  const matchRule = buildRuleMatcher(rules ?? []);

  let updated = 0;
  let attempted = 0;
  let lastError: string | null = null;
  const total = orders?.length ?? 0;

  async function processOrder(o: any) {
    // O ritmo pode segurar a chamada; passou do prazo, fica pra próxima rodada.
    if (Date.now() > deadline) return;
    attempted++;
    const num = String(o.order_number).replace(/^#/, "");
    try {
      const data = await mcpCallOrderByNumber(apiKey, storeUuid, num);
      const fulfillment = data?.order?.fulfillments?.[0];
      if (!fulfillment) return;

      const lastLabel: string | null = fulfillment.last_event ?? null;
      const lastAt = track123EventUtc(fulfillment.tracking_details?.[0]?.event_time_utc, fulfillment.last_event_time);

      const trackingUpdate = {
        user_id: o.user_id,
        shop_id: shopId,
        order_id: o.id,
        tracking_number: fulfillment.tracking_number ?? null,
        carrier: fulfillment.tracking_company ?? fulfillment.courier?.name ?? null,
        tracking_status: fulfillment.transit_status ?? null,
        last_event_at: lastAt,
        last_event_label: lastLabel,
        timeline: fulfillment.tracking_details ?? [],
      };

      // "pending_shipment" (etiqueta criada, rastreio só com "info recebida")
      // não seta shipped_at aqui — quem decide se isso já conta como "enviado"
      // pro usuário é o Shopify (fulfillment criado) ou o próprio usuário na
      // tela; o status exibido é recalculado na leitura a partir do rastreio
      // real (ver lg-logistics.functions.ts), sem precisar reescrever nada aqui.
      const target = matchRule(lastLabel) ?? matchRule(fulfillment.transit_status)
        ?? inferStatus(fulfillment.transit_status, Boolean(fulfillment.tracking_number));
      const nowDate = isoTodayUS();
      // Data do evento real do Track123 (não a data desta rodada), no dia de
      // Nova York — e só na primeira vez: regravar a cada rodada empurrava
      // delivered_at pra "hoje" todo dia e inflava o KPI "Tempo de entrega".
      const eventDate = eventDateUS(lastAt) ?? nowDate;
      const orderUpdate: TablesUpdate<"shop_orders"> = {};
      if (target === "shipped" && o.delivery_status !== "shipped" && !o.shipped_at) orderUpdate.shipped_at = nowDate;
      else if (target === "delivered") {
        orderUpdate.delivered_at = eventDate;
        orderUpdate.delivery_status = "delivered";
      }
      else if (target === "problem" && !o.problem_at) orderUpdate.problem_at = eventDate;
      const builtUrl = buildTrackingUrl(trackingLinkTemplate, fulfillment.tracking_number);
      if (builtUrl) orderUpdate.tracking_url = builtUrl;
      // Espelha o código pra shop_orders (é o que a aba Rastreamento lê) — sem
      // sobrescrever um valor já salvo (ex: ajuste manual).
      if (fulfillment.tracking_number && !o.tracking_code) orderUpdate.tracking_code = String(fulfillment.tracking_number);

      // As duas escritas não dependem uma da outra (tabelas diferentes, sem
      // ler o resultado uma da outra) — rodam em paralelo pra não somar as
      // duas latências de rede em série dentro de cada pedido.
      await Promise.all([
        supabase.from("shop_order_tracking").upsert(trackingUpdate, { onConflict: "order_id" }),
        Object.keys(orderUpdate).length
          ? supabase.from("shop_orders").update(orderUpdate).eq("id", o.id)
          : Promise.resolve(),
      ]);
      updated++;
    } catch (e: any) {
      lastError = `#${num}: ${String(e?.message ?? e).slice(0, 150)}`;
    }
  }

  // O MCP não tem endpoint de lote: uma chamada por pedido, várias em voo.
  // Pool contínuo (não lotes): cada "trabalhador" pega o próximo assim que
  // termina, então o ritmo fica no limite do paceMcp em vez de esperar o mais
  // lento de cada lote.
  const queue = [...(orders ?? [])];
  await Promise.all(Array.from({ length: MCP_CONCURRENCY }, async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      if (Date.now() > deadline) break;
      await processOrder(o);
    }
  }));

  const status = total === 0 ? "ok" : updated === 0 && attempted > 0 ? "error" : "ok";
  const cutShort = attempted < total ? ` (parou por tempo, resto pega na próxima rodada)` : "";
  const errorMsg = total === 0
    ? "Nenhum pedido em aberto pra sincronizar."
    : lastError
      ? `${updated}/${attempted} de ${total} sincronizados via MCP${cutShort}. Último erro: ${lastError}`
      : `${updated}/${attempted} de ${total} sincronizados via MCP${cutShort}.`;

  await supabaseAdmin.from("track123_integrations")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: status, last_sync_error: errorMsg })
    .eq("shop_id", shopId);

  return { updated, total, status, errorMsg };
}

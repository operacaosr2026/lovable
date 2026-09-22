import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildTrackingUrl } from "@/lib/tracking-url";

const MCP_URL = "https://shp.track123.com/shopify/mcp";
// Vercel function tem maxDuration de 60s — a cada pedido custa ~1-1.5s (uma
// chamada por pedido, sem endpoint de lote no MCP), então limitamos por rodada.
// Pedidos mais "parados" (sem sync/evento recente) entram primeiro; o resto
// pega na próxima rodada do cron.
const MAX_ORDERS_PER_RUN = 35;

async function mcpCallOrderByNumber(apiKey: string, storeUuid: string, orderNumber: string) {
  const r = await fetch(MCP_URL, {
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
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json: any = await r.json();
  if (json?.error) throw new Error(json.error.message ?? "Erro MCP");
  const text = json?.result?.content?.[0]?.text;
  if (!text) throw new Error("Resposta MCP sem conteúdo");
  return JSON.parse(text);
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
  const ts = (transitStatus ?? "").toLowerCase();
  if (ts.includes("delivered")) return "delivered";
  if (ts.includes("exception") || ts.includes("failed") || ts.includes("problem") || ts.includes("undelivered")) return "problem";
  // "Pending" = etiqueta criada mas ainda não saiu do CD — não é "shipped" de
  // verdade ainda, mesmo já tendo tracking_number.
  if (ts.includes("pending")) return null;
  if (hasTrackingNumber) return "shipped";
  return null;
}

export async function runTrack123McpSync(
  shopId: string,
  apiKey: string,
  storeUuid: string,
  supabase: typeof supabaseAdmin,
) {
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

  // Mais antigo primeiro dentro da janela: são esses que importam pro sync
  // (candidatos a "+7 dias sem atualização" / "+28 dias sem entrega") — pedido
  // recente já está fresco por definição, pode esperar a próxima rodada.
  const { data: orders, error: ordersError } = await supabase
    .from("shop_orders")
    .select("id,user_id,order_number,delivery_status")
    .eq("shop_id", shopId)
    .not("order_number", "is", null)
    .not("delivery_status", "in", "(delivered,returned)")
    .gte("order_date", since)
    .order("order_date", { ascending: true })
    .limit(MAX_ORDERS_PER_RUN);
  if (ordersError) throw new Error(ordersError.message);

  const { data: rules } = await supabase
    .from("track123_event_rules")
    .select("event_key,event_label,target_status")
    .eq("shop_id", shopId)
    .eq("enabled", true);
  const matchRule = buildRuleMatcher(rules ?? []);

  let updated = 0;
  let lastError: string | null = null;
  const total = orders?.length ?? 0;

  for (const o of orders ?? []) {
    const num = String(o.order_number).replace(/^#/, "");
    try {
      const data = await mcpCallOrderByNumber(apiKey, storeUuid, num);
      const fulfillment = data?.order?.fulfillments?.[0];
      if (!fulfillment) continue;

      const lastLabel: string | null = fulfillment.last_event ?? null;
      const lastAt: string | null = fulfillment.last_event_time ?? null;

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
      await supabase.from("shop_order_tracking").upsert(trackingUpdate, { onConflict: "order_id" });

      const target = matchRule(lastLabel) ?? matchRule(fulfillment.transit_status)
        ?? inferStatus(fulfillment.transit_status, Boolean(fulfillment.tracking_number));
      const nowDate = new Date().toISOString().slice(0, 10);
      const orderUpdate: Record<string, string> = {};
      if (target === "shipped" && o.delivery_status !== "shipped") orderUpdate.shipped_at = nowDate;
      else if (target === "delivered") orderUpdate.delivered_at = nowDate;
      else if (target === "problem") orderUpdate.problem_at = nowDate;
      const builtUrl = buildTrackingUrl(trackingLinkTemplate, fulfillment.tracking_number);
      if (builtUrl) orderUpdate.tracking_url = builtUrl;
      if (Object.keys(orderUpdate).length) {
        await supabase.from("shop_orders").update(orderUpdate).eq("id", o.id);
      }
      updated++;
    } catch (e: any) {
      lastError = `#${num}: ${String(e?.message ?? e).slice(0, 150)}`;
    }
  }

  const status = total === 0 ? "ok" : updated === 0 ? "error" : "ok";
  const errorMsg = total === 0
    ? "Nenhum pedido em aberto pra sincronizar."
    : lastError
      ? `${updated}/${total} sincronizados via MCP. Último erro: ${lastError}`
      : `${updated}/${total} sincronizados via MCP.`;

  await supabaseAdmin.from("track123_integrations")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: status, last_sync_error: errorMsg })
    .eq("shop_id", shopId);

  return { updated, total, status, errorMsg };
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { needsAttention } from "@/lib/logistics-kpis";
import { eventTextKey } from "@/lib/tracking-display";
import { carrierLabel, carrierOf, parseEvents } from "@/lib/carrier-stats";
import { phaseResolver, type Phase } from "@/lib/tracking-phases";
import { localLegOf } from "@/lib/local-carriers";

// Situações de rastreio que viram alerta no Gerencial (e a lista de pedidos da
// gaveta "Ver rastreio"). Olha TODO pedido em aberto das lojas (até 180 dias),
// não só os do mês — pedido de setembro travado continua aparecendo em novembro.
//  - entrega: precisa de atenção (sem envio 3+ dias úteis, parado 5+ dias,
//    problema, sem entrega depois de 20 dias) — mesma regra da aba Rastreamento;
//  - nao_postado:<transportadora>: código gerado mas só tem aviso de etiqueta
//    há NOT_POSTED_DAYS+ (o fornecedor não despachou);
//  - cliente: endereço errado, devolvido, falha na entrega — precisa falar com
//    o cliente ou reenviar;
//  - repassado: "Delivered to local carrier" há HANDOFF_DAYS+ e parou (o pacote
//    está com a transportadora local dos EUA, que o rastreio chinês não mostra);
//  - reenvio_entregue: o pacote antigo de um reenvio foi entregue e o novo ainda
//    não — dá pra cancelar o reenvio;
//  - sem_fase: texto de rastreio que nenhuma regra reconhece.

const DAY = 86_400_000;
const WINDOW_DAYS = 180;
export const NOT_POSTED_DAYS = 5;
export const HANDOFF_DAYS = 4;
const CUSTOMER_ISSUE = /incorrect address|insufficient address|bad address|address (issue|problem|incomplete)|return(ed)? to sender|returning to sender|to original sender|refused|unclaimed|undeliverable|no access|delivery (attempt|failed|exception)|attempted|退回|投递失败|无法投递|地址不详|拒收/i;
const HANDOFF = /^delivered to (local )?carrier|handed over to (the )?(local|last[- ]mile)/i;

export type SituationOrder = any & { _track?: any; _events: { ts: number; d: string }[] };
export type Situations = {
  entrega: SituationOrder[];
  naoPostado: Map<string, SituationOrder[]>; // chave = transportadora (carrierOf)
  cliente: SituationOrder[];
  repassado: SituationOrder[];
  reenvioEntregue: SituationOrder[];
  semFase: { key: string; example: string; count: number }[];
  // Fora do combinado (o sistema caiu num padrão — precisa de alguém acertar):
  transportadoraNova: Map<string, SituationOrder[]>; // prefixo do código → pedidos
  semEvento: SituationOrder[];        // cadastrado no 17track há 3+ dias e nenhum evento
  statusDiverge: SituationOrder[];    // rastreio diz entregue e o pedido não (1+ dia)
  localNova: SituationOrder[];        // repassado à transportadora local e os eventos não batem com nenhuma conhecida
};

const isDelivered = (o: any) => o.delivery_status === "delivered";

export async function trackingSituations(ownerId: string, shopIds: string[], nowMs = Date.now()): Promise<Situations> {
  const empty: Situations = { entrega: [], naoPostado: new Map(), cliente: [], repassado: [], reenvioEntregue: [], semFase: [], transportadoraNova: new Map(), semEvento: [], statusDiverge: [], localNova: [] };
  if (!shopIds.length) return empty;
  const since = new Date(nowMs - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const sel = "id,shop_id,order_number,order_date,delivery_status,shipped_at,delivered_at,tracking_code,tracking_url,customer_notified_at,tracking_code_history,tracking_code_manual_at,cancelled:raw->>cancelled_at";
  const [openRes, phaseRows, notices] = await Promise.all([
    selectAll<any>(supabaseAdmin.from("shop_orders").select(sel).eq("user_id", ownerId).in("shop_id", shopIds)
      .gte("order_date", since).or("delivery_status.is.null,delivery_status.not.in.(delivered,waiting_customer)")),
    supabaseAdmin.from("tracking_phase_overrides").select("text_key,phase").eq("user_id", ownerId),
    // Avisos abertos de alfândega / lote parado (já viram alerta próprio).
    supabaseAdmin.from("app_notifications").select("body").eq("user_id", ownerId).is("resolved_at", null)
      .or("key.like.track123:alfandega:%,key.like.track123:lote:%"),
  ]);
  const noticeNums = new Set(((notices.data ?? []) as any[]).flatMap((n) => String(n.body ?? "").match(/#[A-Za-z0-9-]+/g) ?? []));
  if (openRes.error) throw new Error(openRes.error.message);
  const open = openRes.data.filter((o) => !o.cancelled);
  const phaseOf = phaseResolver(new Map(((phaseRows.data ?? []) as any[]).map((r) => [r.text_key as string, r.phase as Phase])));

  const tracks = await selectAllIn<any>(open.map((o) => o.id as string), (c) => supabaseAdmin.from("shop_order_tracking")
    .select("order_id,tracking_number,tracking_status,last_event_at,last_event_label,timeline,replaced_packages,registered_17track_at,local_tracking_number").in("order_id", c));
  if (tracks.error) throw new Error(tracks.error.message);
  const trackBy = new Map(tracks.data.map((t) => [String(t.order_id), t]));

  const out: Situations = { ...empty, naoPostado: new Map(), transportadoraNova: new Map() };
  const unknown = new Map<string, { example: string; count: number }>();
  for (const o of open) {
    const t = trackBy.get(String(o.id));
    const evs = parseEvents(t?.timeline).sort((a, b) => b.ts - a.ts);
    // Reenvio: o relógio do "sem entrega" conta da troca (igual à aba Rastreamento).
    const history: any[] = Array.isArray(o.tracking_code_history) ? o.tracking_code_history : [];
    const clockFrom = history[history.length - 1]?.until ?? o.tracking_code_manual_at ?? null;
    const row: SituationOrder = { ...o, clock_from: clockFrom ? String(clockFrom).slice(0, 10) : null, last_event_at: t?.last_event_at ?? null, _track: t, _events: evs };
    if (needsAttention(row, nowMs)) out.entrega.push(row);

    for (const e of evs) {
      if (phaseOf(e.d) != null) continue;
      const k = eventTextKey(e.d);
      if (!k) continue;
      const u = unknown.get(k);
      if (u) u.count++; else unknown.set(k, { example: e.d, count: 1 });
    }
    const last = evs[0];
    const code = String(o.tracking_code ?? "").trim();
    // Só aviso de etiqueta, sem nenhum movimento, há NOT_POSTED_DAYS+.
    if (code && last && nowMs - last.ts >= NOT_POSTED_DAYS * DAY && evs.every((e) => phaseOf(e.d) === "aviso")) {
      const k = carrierOf(code);
      out.naoPostado.set(k, [...(out.naoPostado.get(k) ?? []), row]);
    }
    if (last && (CUSTOMER_ISSUE.test(last.d) || /^(undelivered|exception)/i.test(String(t?.tracking_status ?? "")) && CUSTOMER_ISSUE.test(evs.slice(0, 3).map((e) => e.d).join(" ")))) out.cliente.push(row);
    else if (last && HANDOFF.test(last.d) && nowMs - last.ts >= HANDOFF_DAYS * DAY) out.repassado.push(row);
    // Fora do combinado.
    if (code && carrierOf(code) === "OUTRAS") {
      const pfx = code.toUpperCase().match(/^[A-Z]+/)?.[0] ?? code.slice(0, 4).toUpperCase();
      out.transportadoraNova.set(pfx, [...(out.transportadoraNova.get(pfx) ?? []), row]);
    }
    if (code && !evs.length && t?.registered_17track_at && nowMs - Date.parse(t.registered_17track_at) >= 3 * DAY) out.semEvento.push(row);
    const delivEv = evs.find((e) => phaseOf(e.d) === "entregue");
    if (delivEv && nowMs - delivEv.ts >= DAY) out.statusDiverge.push(row);
    if (localLegOf(evs, t?.local_tracking_number ?? null, (d) => phaseOf(d) === "entregue")?.key === "NAO_RECONHECIDA") out.localNova.push(row);
    // Reenvio: pacote antigo entregue e o novo ainda não.
    const replaced: any[] = Array.isArray(t?.replaced_packages) ? t.replaced_packages : [];
    if (!isDelivered(o) && replaced.some((p) => parseEvents(p?.timeline).some((e) => phaseOf(e.d) === "entregue"))) out.reenvioEntregue.push(row);
  }
  // "Atenção na entrega" fica só com o que não caiu numa situação mais específica
// nem num aviso de alfândega/lote parado.
  const specific = new Set([...out.cliente, ...out.repassado, ...out.reenvioEntregue, ...[...out.naoPostado.values()].flat()].map((o) => o.id));
  out.entrega = out.entrega.filter((o) => !specific.has(o.id) && !noticeNums.has(String(o.order_number)));
  out.semFase = [...unknown.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
  return out;
}

export const situationCarrierLabel = (key: string) => carrierLabel(key);

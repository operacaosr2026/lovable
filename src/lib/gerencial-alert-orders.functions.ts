import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { companyShopIdsForMonth } from "@/lib/company-goals.server";
import { attentionReason } from "@/lib/logistics-kpis";
import { resolutionKindOf, trackingSituations } from "@/lib/tracking-situations.server";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { carrierLabel, carrierOf, parseEvents } from "@/lib/carrier-stats";
import { autoPhase, phaseLabel } from "@/lib/tracking-phases";
import { rawEvents, sanitizeEvents } from "@/lib/tracking-display";

// Gerencial › Alertas › "Ver rastreio": os pedidos por trás do alerta de entrega,
// lote parado ou alfândega, com o que foi analisado (transportadora, onde
// parou, há quantos dias, se o cliente já foi avisado) — pra decidir ali mesmo
// em vez de ir caçar na aba Rastreamento.

type Ctx = { ownerId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "gerencial");
const DAY = 86_400_000;

const STATUS: Record<string, string> = {
  pending_shipment: "Aguardando envio", shipped: "Em trânsito", in_transit: "Em trânsito", delivered: "Entregue",
  problem: "Problema", returned: "Devolvido", waiting_customer: "Esperando cliente", shipment_cancelled: "Envio cancelado",
};

export type AlertOrder = {
  id: string; number: string; shop: string; orderDate: string; status: string;
  carrier: string; code: string | null; trackingLink: string | null;
  reason: string;                 // por que está na lista
  lastEvent: string | null; lastEventAt: string | null; daysStopped: number | null; phase: string;
  events: { at: string; text: string }[]; // últimos eventos, mais novo primeiro
  notifiedAt: string | null;      // cliente avisado (Notificações)
  resent: boolean;                // código já trocado antes
  shopDomain: string | null;      // xxx.myshopify.com (mensagem pro fornecedor)
  oldCode: string | null;         // reenvio: código do pacote antigo
  oldDeliveredAt: string | null;  // reenvio: quando o pacote antigo foi entregue
  resolvedAt: string | null;      // marcado como resolvido na gaveta (sai do alerta)
};
// Fase do último evento em palavras de operação (o "aviso" = nunca foi postado).
function phaseText(last: string | null): string {
  if (!last) return "Sem rastreio";
  const p = autoPhase(last);
  if (p === "aviso") return "Ainda não postado (só aviso de etiqueta)";
  if (p === "alfandega_entrada") return "Preso na alfândega dos EUA";
  if (p === "chegada_eua") return "Chegou nos EUA";
  if (p === "voo") return "Voo / aeroporto";
  if (p === "movimento") return "Em movimento (parou)";
  return phaseLabel(p);
}
// Reenvio: quando o pacote antigo (replaced_packages) foi entregue, se foi.
function oldDelivered(replaced: unknown): string | null {
  for (const p of (Array.isArray(replaced) ? replaced : []) as any[]) {
    const d = parseEvents(p?.timeline).filter((e) => autoPhase(e.d) === "entregue").sort((a, b) => a.ts - b.ts)[0];
    if (d) return new Date(d.ts).toISOString();
  }
  return null;
}
export type AlertAnalysis = { label: string; value: string }[];

export const getAlertOrders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    key: z.string().min(1).max(200),
    month: z.string().regex(/^\d{4}-\d{2}$/),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ orders: AlertOrder[]; resolved: AlertOrder[]; analysis: AlertAnalysis; canResolve: boolean }> => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const { ownerId } = ctx;
    const now = Date.now();
    const sel = "id,shop_id,order_number,order_date,delivery_status,shipped_at,delivered_at,tracking_code,tracking_url,customer_notified_at,tracking_code_history,tracking_code_manual_at";

    // Pedidos do alerta: entrega = os do mês que precisam de atenção (mesma
    // conta do alerta); lote/alfândega = os números listados no aviso.
    let orders: any[] = [];
    let resolvedRows: any[] = [];
    const situation = data.key === "entrega" || data.key.startsWith("rastreio:") || data.key.startsWith("fora:");
    if (situation) {
      // Mesma conta dos alertas (tracking-situations.server.ts).
      const sit = await trackingSituations(ownerId, await companyShopIdsForMonth(ownerId, `${data.month}-01`), now);
      orders = data.key === "entrega" ? sit.entrega
        : data.key === "rastreio:cliente" ? sit.cliente
        : data.key === "rastreio:repassado" ? sit.repassado
        : data.key === "rastreio:reenvio_entregue" ? sit.reenvioEntregue
        : data.key === "rastreio:sem_estoque" ? sit.semEstoque
        : data.key === "rastreio:nao_postado" ? [...sit.naoPostado.values()].flat()
        : data.key.startsWith("rastreio:nao_postado:") ? (sit.naoPostado.get(data.key.slice("rastreio:nao_postado:".length)) ?? [])
        : data.key.startsWith("fora:transportadora:") ? (sit.transportadoraNova.get(data.key.slice("fora:transportadora:".length)) ?? [])
        : data.key === "fora:sem_evento" ? sit.semEvento
        : data.key === "fora:status" ? sit.statusDiverge
        : data.key === "fora:local" ? sit.localNova
        : [];
      // Resolvidos do mesmo alerta (por transportadora: só os daquela transportadora).
      const carrierKey = data.key.match(/^(?:rastreio:nao_postado|fora:transportadora):(.+)$/)?.[1];
      resolvedRows = (sit.resolved.get(resolutionKindOf(data.key)) ?? []).filter((o) => {
        if (!carrierKey) return true;
        const code = String(o.tracking_code ?? "").trim();
        return data.key.startsWith("rastreio:") ? carrierOf(code) === carrierKey : (code.toUpperCase().match(/^[A-Z]+/)?.[0] ?? code.slice(0, 4).toUpperCase()) === carrierKey;
      });
    } else if (data.key.startsWith("track123:lote:") || data.key.startsWith("track123:alfandega:")) {
      const { data: n, error } = await supabaseAdmin.from("app_notifications").select("body").eq("user_id", ownerId).eq("key", data.key).maybeSingle();
      if (error) throw new Error(error.message);
      let nums = [...new Set(String(n?.body ?? "").match(/#[A-Za-z0-9-]+/g) ?? [])];
      // Lote parado: sem os pedidos que já estão num alerta mais específico
      // (mesma regra do Gerencial).
      if (data.key.startsWith("track123:lote:") && nums.length) {
        const sit = await trackingSituations(ownerId, await companyShopIdsForMonth(ownerId, `${data.month}-01`), now);
        const specific = new Set([...sit.cliente, ...sit.repassado, ...sit.reenvioEntregue, ...sit.semEstoque, ...[...sit.naoPostado.values()].flat()].map((o) => String(o.order_number)));
        const rest = nums.filter((x) => !specific.has(x));
        if (rest.length) nums = rest;
      }
      if (nums.length) {
        const r = await selectAllIn<any>(nums, (c) => supabaseAdmin.from("shop_orders").select(sel).eq("user_id", ownerId).in("order_number", c));
        if (r.error) throw new Error(r.error.message);
        orders = r.data;
      }
    } else {
      throw new Error("Esse alerta não tem lista de pedidos");
    }
    if (!orders.length && !resolvedRows.length) return { orders: [], resolved: [], analysis: [], canResolve: situation };

    const all = [...orders, ...resolvedRows];
    const ids = all.map((o) => o.id as string);
    const shopIds = [...new Set(all.map((o) => o.shop_id as string))];
    const [tracks, shops, integs] = await Promise.all([
      selectAllIn<any>(ids, (c) => supabaseAdmin.from("shop_order_tracking").select("order_id,tracking_number,last_event_at,last_event_label,timeline,replaced_packages").in("order_id", c)),
      supabaseAdmin.from("shops").select("id,name,shopify_store_id").in("id", shopIds),
      supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds),
    ]);
    const trackBy = new Map(tracks.data.map((t) => [String(t.order_id), t]));
    const shopName = new Map((shops.data ?? []).map((s: any) => [s.id as string, s.name as string]));
    const template = new Map((integs.data ?? []).map((i: any) => [i.shop_id as string, i.tracking_link_template as string | null]));
    const storeIds = (shops.data ?? []).map((s: any) => s.shopify_store_id).filter(Boolean) as string[];
    const { data: stores } = storeIds.length
      ? await supabaseAdmin.from("shopify_stores").select("id,shop_domain").in("id", storeIds)
      : { data: [] as any[] };
    const domainByStore = new Map((stores ?? []).map((s: any) => [s.id as string, s.shop_domain as string | null]));
    const shopDomain = new Map((shops.data ?? []).map((s: any) => [s.id as string, domainByStore.get(s.shopify_store_id) ?? null]));

    const toAlertOrder = (o: any): AlertOrder => {
      const t = trackBy.get(String(o.id));
      const code = String(o.tracking_code ?? "").trim() || null;
      const evs = parseEvents(t?.timeline).sort((a, b) => b.ts - a.ts);
      const last = evs[0];
      const lastAt = last ? new Date(last.ts).toISOString() : (t?.last_event_at ?? null);
      const lastText = last?.d ?? t?.last_event_label ?? null;
      // Texto pra mostrar (e pra mensagem do fornecedor): traduzido como na página
      // do cliente — nada em chinês. A fase continua pelo texto original.
      const shown = sanitizeEvents(rawEvents(t?.timeline));
      const lastShown = shown[0]?.description ?? (lastText && !/[一-鿿]/.test(lastText) ? lastText : null);
      const daysStopped = lastAt ? Math.floor((now - Date.parse(lastAt)) / DAY) : null;
      const history = Array.isArray(o.tracking_code_history) ? o.tracking_code_history : [];
      const reason = data.key === "rastreio:nao_postado" || data.key.startsWith("rastreio:nao_postado:")
        ? `Só aviso de etiqueta há ${daysStopped ?? "?"}d — não postado`
        : data.key === "rastreio:reenvio_entregue" ? "Pacote antigo entregue"
        : data.key === "rastreio:sem_estoque" ? `Sem estoque no fornecedor${o._flaggedAt ? ` (avisado ${new Date(o._flaggedAt).toLocaleDateString("pt-BR", { timeZone: "America/New_York", day: "2-digit", month: "2-digit" })})` : ""}`
        : data.key === "rastreio:repassado" ? `Com a transportadora local há ${daysStopped ?? "?"}d`
        : data.key === "rastreio:cliente" ? "Endereço / devolução / falha na entrega"
        : data.key.startsWith("fora:transportadora:") ? "Código de transportadora não cadastrada"
        : data.key === "fora:sem_evento" ? "Cadastrado no 17track sem nenhum evento"
        : data.key === "fora:local" ? "Transportadora local não reconhecida"
        : data.key === "fora:status" ? `Rastreio entregue, pedido como "${STATUS[o.delivery_status ?? "pending_shipment"] ?? o.delivery_status}"`
        : data.key === "entrega"
        ? (o.delivery_status === "problem" ? "Marcado como problema"
          : (o.delivery_status ?? "pending_shipment") === "pending_shipment" ? "Sem envio há mais de 3 dias úteis"
          : attentionReason({ ...o, last_event_at: t?.last_event_at, clock_from: o.clock_from ?? null }, now) ?? STATUS[o.delivery_status] ?? "")
        : daysStopped != null ? `${daysStopped}d sem movimento` : "Sem movimento";
      return {
        id: o.id, number: String(o.order_number ?? o.id.slice(0, 8)), shop: shopName.get(o.shop_id) ?? "",
        orderDate: String(o.order_date).slice(0, 10), status: STATUS[o.delivery_status ?? "pending_shipment"] ?? String(o.delivery_status),
        carrier: code ? carrierLabel(carrierOf(code)) : "—", code,
        trackingLink: buildTrackingUrl(template.get(o.shop_id), code) ?? o.tracking_url ?? null,
        reason, lastEvent: lastShown, lastEventAt: shown[0]?.at ?? lastAt, daysStopped,
        phase: phaseText(lastText),
        events: shown.slice(0, 6).filter((e) => e.at).map((e) => ({ at: e.at!, text: e.description })),
        notifiedAt: o.customer_notified_at ?? null,
        resent: history.length > 0 || !!o.tracking_code_manual_at,
        shopDomain: shopDomain.get(o.shop_id) ?? null,
        oldCode: history.length ? String(history[history.length - 1]?.code ?? "") || null : null,
        oldDeliveredAt: oldDelivered(t?.replaced_packages),
        resolvedAt: o._resolvedAt ?? null,
      };
    };
    const byStopped = (a: AlertOrder, b: AlertOrder) => (b.daysStopped ?? -1) - (a.daysStopped ?? -1);
    const out = orders.map(toAlertOrder).sort(byStopped);
    const resolved = resolvedRows.map(toAlertOrder).sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt)));

    // Resumo do que foi analisado: o que se repete entre os pedidos.
    const top = (vals: string[]) => {
      const m = new Map<string, number>();
      for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const fmt = (list: [string, number][]) => list.slice(0, 3).map(([k, n]) => `${k} (${n})`).join(" · ");
    const stopped = out.map((o) => o.daysStopped).filter((d): d is number => d != null);
    const analysis: AlertAnalysis = [
      { label: "Transportadora", value: fmt(top(out.map((o) => o.carrier))) },
      { label: "Fase em que pararam", value: fmt(top(out.map((o) => o.phase))) },
      { label: "Último evento", value: fmt(top(out.map((o) => o.lastEvent ?? "").map((s) => s.slice(0, 60)))) },
      ...(stopped.length ? [{ label: "Sem movimento", value: `${Math.min(...stopped)} a ${Math.max(...stopped)} dias` }] : []),
      { label: "Cliente avisado", value: `${out.filter((o) => o.notifiedAt).length} de ${out.length}` },
      ...(out.some((o) => o.resent) ? [{ label: "Já reenviados", value: `${out.filter((o) => o.resent).length}` }] : []),
    ].filter((x) => x.value);
    return { orders: out, resolved, analysis: out.length ? analysis : [], canResolve: situation };
  });

// Aviso do fornecedor "sem estoque" num pedido (ou desfazer): vira o alerta
// "Sem estoque no fornecedor" e sai de "não postado" até o pacote andar.
export const flagOrderOutOfStock = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderId: z.string().uuid(), note: z.string().trim().max(500).nullable().default(null), undo: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx & { userId: string };
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const q = supabaseAdmin.from("order_supplier_flags");
    if (data.undo) {
      const { error } = await q.delete().eq("owner_id", ctx.ownerId).eq("order_id", data.orderId).eq("kind", "sem_estoque");
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { data: o, error: oErr } = await supabaseAdmin.from("shop_orders").select("tracking_code").eq("user_id", ctx.ownerId).eq("id", data.orderId).maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!o) throw new Error("Pedido não encontrado");
    const { error } = await q.upsert({ owner_id: ctx.ownerId, order_id: data.orderId, kind: "sem_estoque", note: data.note ?? "Fornecedor avisou: sem estoque.",
      tracking_code: String(o.tracking_code ?? "").trim(), flagged_by: ctx.userId, flagged_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Marcar (ou desmarcar) um pedido como resolvido num alerta de rastreio: sai
// da lista e da contagem pra toda a equipe, enquanto o código for o mesmo.
export const resolveAlertOrder = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ key: z.string().min(1).max(200), orderId: z.string().uuid(), undo: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx & { userId: string };
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const kind = resolutionKindOf(data.key);
    const q = supabaseAdmin.from("gerencial_order_resolutions");
    if (data.undo) {
      const { error } = await q.delete().eq("owner_id", ctx.ownerId).eq("order_id", data.orderId).eq("alert_kind", kind);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { data: o, error: oErr } = await supabaseAdmin.from("shop_orders").select("tracking_code").eq("user_id", ctx.ownerId).eq("id", data.orderId).maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!o) throw new Error("Pedido não encontrado");
    const { error } = await q.upsert({ owner_id: ctx.ownerId, order_id: data.orderId, alert_kind: kind, tracking_code: String(o.tracking_code ?? "").trim(), resolved_by: ctx.userId, resolved_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

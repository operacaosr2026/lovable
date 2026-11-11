import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAllIn } from "@/lib/select-all";
import { refundedResendIds } from "@/lib/refunded-resends.server";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";
import { phaseResolver, type Phase } from "@/lib/tracking-phases";
import { aggregate, avg, carrierLabel, carrierOf, CARRIERS, median, parseEvents, type CarrierRow, type CarrierTotals } from "@/lib/carrier-stats";
import { rawEvents, sanitizeEvents } from "@/lib/tracking-display";
import { LOCAL_CARRIERS, effectiveLocalNumber, localLegOf, transitStage, localNumberOrZero, localTrackingUrl, type LocalCarrierKey } from "@/lib/local-carriers";

// Gerencial › Transportadoras: busca os pedidos/rastreios das lojas da coluna
// "Ativas" do Banco de Lojas e faz a conta de carrier-stats.ts (regras lá).

type Ctx = { ownerId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "gerencial");

// Lojas ativas = as da coluna "Ativas" do Banco de Lojas (mesma regra de
// product-links). Hold, Cemitério etc. e loja sem Shopify ligada não entram.
async function activeShopIds(ownerId: string): Promise<string[]> {
  const { data: columns, error: colsErr } = await supabaseAdmin.from("store_board_columns").select("id,name").eq("user_id", ownerId);
  if (colsErr) throw new Error(colsErr.message);
  const activeCols = (columns ?? []).filter((c: any) => /^ativ/i.test(String(c.name).trim())).map((c: any) => c.id as string);
  if (!activeCols.length) return [];
  const { data: stores, error: storesErr } = await supabaseAdmin.from("shopify_stores").select("id").eq("user_id", ownerId).in("board_column_id", activeCols);
  if (storesErr) throw new Error(storesErr.message);
  const storeIds = (stores ?? []).map((x: any) => x.id as string);
  if (!storeIds.length) return [];
  const { data: shops, error: shopsErr } = await supabaseAdmin.from("shops").select("id,archived").eq("user_id", ownerId).in("shopify_store_id", storeIds);
  if (shopsErr) throw new Error(shopsErr.message);
  return (shops ?? []).filter((x: any) => !x.archived).map((x: any) => x.id as string);
}

async function phaseOfOwner(ownerId: string) {
  const { data: phaseRows, error: phaseErr } = await supabaseAdmin.from("tracking_phase_overrides").select("text_key,phase").eq("user_id", ownerId);
  if (phaseErr && phaseErr.code !== "42P01" && phaseErr.code !== "PGRST205") throw new Error(phaseErr.message);
  return phaseResolver(new Map((phaseRows ?? []).map((r: any) => [r.text_key as string, r.phase as Phase])));
}

export const getCarrierStats = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ days: z.number().int().positive().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const { ownerId } = ctx;
    const today = isoTodayUS();
    const from = data.days ? addDaysIso(today, -data.days + 1) : null;
    // Período anterior do mesmo tamanho (pras setas dos cards). "Tudo" não compara.
    const prevFrom = data.days && from ? addDaysIso(from, -data.days) : null;
    const empty = { rows: [] as CarrierRow[], months: [] as string[], from, semCodigo: 0, totals: null as CarrierTotals | null, prevTotals: null as CarrierTotals | null, semRegra: 0 };

    const shopIds = await activeShopIds(ownerId);
    if (!shopIds.length) return empty;

    const { data: orders, error: ordersErr } = await selectAllIn<any>(shopIds, (ids) => {
      let q = supabaseAdmin.from("shop_orders").select("id,order_date,tracking_code,tracking_code_history,tracking_code_manual_at").eq("user_id", ownerId).in("shop_id", ids)
        .or("delivery_status.is.null,delivery_status.neq.shipment_cancelled");   // envio cancelado: fora
      if (prevFrom ?? from) q = q.gte("order_date", (prevFrom ?? from)!);
      return q;
    });
    if (ordersErr) throw new Error(ordersErr.message);
    const inPeriod = (o: any) => !from || String(o.order_date).slice(0, 10) >= from;
    const cur = orders.filter(inPeriod);
    const prev = prevFrom ? orders.filter((o) => !inPeriod(o)) : [];
    const hasCode = (o: any) => !!String(o.tracking_code ?? "").trim();
    const withCode = cur.filter(hasCode), prevWithCode = prev.filter(hasCode);
    const semCodigo = cur.length - withCode.length;

    const { data: tracks, error: tracksErr } = await selectAllIn<any>([...withCode, ...prevWithCode].map((o) => o.id as string), (ids) =>
      supabaseAdmin.from("shop_order_tracking").select("id,order_id,tracking_number,tracking_status,timeline,replaced_packages").in("order_id", ids));
    if (tracksErr) throw new Error(tracksErr.message);
    const trackByOrder = new Map<string, any>();
    for (const t of tracks) trackByOrder.set(String(t.order_id), t);

    // Fase escolhida na mão (Configurações › Rastreamento › Textos) por cima das regras.
    const phaseOf = await phaseOfOwner(ownerId);
    const now = Date.now();
    const { acc, monthsSet, totals, unknown } = aggregate(withCode, trackByOrder, now, phaseOf);
    const prevTotals = prevWithCode.length ? aggregate(prevWithCode, trackByOrder, now, phaseOf).totals : null;

    const months = [...monthsSet].sort().slice(-6);
    const order = [...CARRIERS.map((c) => c.key), "OUTRAS"];
    const rows: CarrierRow[] = [...acc.entries()]
      .map(([key, a]) => ({
        key, label: carrierLabel(key),
        pedidos: a.pedidos, comRastreio: a.comRastreio, entregues: a.entregues, emTransito: a.emTransito, atrasados: a.atrasados,
        postagemEua: avg(a.eua), nEua: a.eua.length,
        postagemEntrega: avg(a.entrega), medianaEntrega: median(a.entrega), nEntrega: a.entrega.length,
        alfPassou: a.alfPassou, alfProblema: a.alfProblema, alfParado: a.alfParado, reenviados: a.reenviados, ultimoEnvio: a.ultimoEnvio, envios7d: a.envios7d,
        porMes: months.map((m) => { const l = a.porMes.get(m) ?? []; return { month: m, dias: avg(l), n: l.length }; }),
      }))
      .sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key));
    return { rows, months, from, semCodigo, totals: totals as CarrierTotals | null, prevTotals, semRegra: unknown.size };
  });

export type { CarrierRow, CarrierTotals };

// Gerencial › Transportadoras › Rastreamento local: quem faz a última milha nos
// EUA (local-carriers.ts) e o código dela quando o 17track manda (só USPS).
const LOCAL_STALE_DAYS = 4;   // mesmo prazo do alerta "repassado e parado"
export type LocalOrder = {
  id: string; order_number: string; order_date: string; carrier: string; carrier_label: string; local: LocalCarrierKey;
  tracking_code: string; tracking_url: string | null; local_number: string | null; local_url: string | null;
  status: "entregue" | "andamento" | "parado"; start_at: string; delivered_at: string | null;
  last_at: string | null; last_label: string | null; dias: number;
  etapa: string | null;   // só na linha "Aguardando": onde o pacote está
  reenvio: string | null; // data da troca do código (reenvio) — o pedido aparece pelo código novo
};
export type LocalRow = {
  key: LocalCarrierKey; label: string; hint?: string; pacotes: number; entregues: number; andamento: number; parados: number;
  diasMedia: number | null; diasMediana: number | null; comCodigo: number; origem: { key: string; label: string; n: number }[];
};

export const getLocalTracking = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ days: z.number().int().positive().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const { ownerId } = ctx;
    const from = data.days ? addDaysIso(isoTodayUS(), -data.days + 1) : null;
    const shopIds = await activeShopIds(ownerId);
    if (!shopIds.length) return { rows: [] as LocalRow[], orders: [] as LocalOrder[] };

    const { data: orders, error } = await selectAllIn<any>(shopIds, (ids) => {
      let q = supabaseAdmin.from("shop_orders").select("id,order_number,order_date,tracking_code,tracking_url,delivery_status,tracking_code_history,tracking_code_manual_at,cancelled:raw->>cancelled_at,shopify_financial_status")
        .eq("user_id", ownerId).in("shop_id", ids).not("tracking_code", "is", null)
        .or("delivery_status.is.null,delivery_status.neq.shipment_cancelled");   // envio cancelado: fora
      if (from) q = q.gte("order_date", from);
      return q;
    });
    if (error) throw new Error(error.message);
    const live = orders.filter((o) => !o.cancelled && String(o.tracking_code ?? "").trim());
    const { data: tracks, error: tErr } = await selectAllIn<any>(live.map((o) => o.id as string), (ids) =>
      supabaseAdmin.from("shop_order_tracking").select("order_id,tracking_number,last_event_at,last_event_label,timeline,local_tracking_number").in("order_id", ids));
    if (tErr) throw new Error(tErr.message);
    const trackBy = new Map(tracks.map((t) => [String(t.order_id), t]));
    const phaseOf = await phaseOfOwner(ownerId);
    const now = Date.now();
    const DAY = 86_400_000;
    // Reembolsado por inteiro (ou reenvio de pedido reembolsado): o cliente já tem
    // o dinheiro, então o pacote parado/em trânsito não é mais problema — sai da
    // lista (mesma regra dos alertas de rastreio). Se for entregue, volta a contar
    // e o pedido vai pros alertas de Chargebacks pra cobrar o cliente.
    const refundedResends = await refundedResendIds(ownerId, live.map((o) => o.id as string));
    const isRefunded = (o: any) => ["refunded", "voided"].includes(String(o.shopify_financial_status ?? "")) || refundedResends.has(o.id);

    const out: LocalOrder[] = [];
    for (const o of live) {
      const t = trackBy.get(String(o.id));
      const code = String(o.tracking_code).trim().toUpperCase();
      // Rastreio gravado de outro código (trocado e ainda não buscado): sem eventos.
      const same = !!t && String(t.tracking_number ?? "").toUpperCase() === code;
      const evs = same ? parseEvents(t.timeline) : [];
      const localNumber: string | null = same ? t.local_tracking_number ?? null : null;
      const found = localLegOf(evs, localNumber, phaseOf);
      const deliveredEv = evs.some((e) => phaseOf(e.d) === "entregue");
      // Em trânsito e ainda não está com a transportadora local (na China, no voo,
      // na alfândega…): também entra em "Aguardando" — pedido do usuário em 05/11/2026.
      const waiting = !found && !deliveredEv && o.delivery_status !== "delivered";
      if (!found && !waiting) continue;
      // Reenvio: aparece pelo código novo e o relógio conta da troca (igual ao resto do sistema).
      const hist: any[] = Array.isArray(o.tracking_code_history) ? o.tracking_code_history : [];
      const resentAt: string | null = hist[hist.length - 1]?.until ?? o.tracking_code_manual_at ?? null;
      const clockFrom = resentAt ? Date.parse(resentAt) : Date.parse(`${String(o.order_date).slice(0, 10)}T12:00:00Z`);
      const leg = found ?? { key: "AGUARDANDO" as const, startTs: clockFrom, deliveredTs: null };
      const etapa = leg.key === "AGUARDANDO" ? transitStage(evs, found, phaseOf) : null;
      const delivered = leg.deliveredTs != null || o.delivery_status === "delivered";
      const lastTs = same && t.last_event_at ? Date.parse(t.last_event_at) : null;
      const status = delivered ? "entregue" : lastTs != null && now - lastTs >= LOCAL_STALE_DAYS * DAY ? "parado" : "andamento";
      if (status !== "entregue" && isRefunded(o)) continue;
      const end = leg.deliveredTs ?? (delivered ? lastTs ?? now : now);
      out.push({
        id: o.id, order_number: o.order_number, order_date: String(o.order_date).slice(0, 10), carrier: carrierOf(code), carrier_label: carrierLabel(carrierOf(code)), local: leg.key,
        tracking_code: code, tracking_url: o.tracking_url ?? null, local_number: localNumberOrZero(leg.key, effectiveLocalNumber(leg.key, localNumber, code), delivered), local_url: localTrackingUrl(effectiveLocalNumber(leg.key, localNumber, code)),
        status, start_at: new Date(leg.startTs).toISOString(), delivered_at: leg.deliveredTs != null ? new Date(leg.deliveredTs).toISOString() : null,
        last_at: same ? t.last_event_at ?? null : null, last_label: same ? sanitizeEvents(rawEvents(t.timeline))[0]?.description ?? t.last_event_label ?? null : null,
        dias: Math.max(0, (end - leg.startTs) / DAY), etapa, reenvio: resentAt ? String(resentAt).slice(0, 10) : null,
      });
    }

    const rows: LocalRow[] = LOCAL_CARRIERS.map((c) => {
      const list = out.filter((o) => o.local === c.key);
      const deliv = list.filter((o) => o.status === "entregue" && o.delivered_at).map((o) => o.dias);
      const origem = new Map<string, number>();
      for (const o of list) origem.set(o.carrier, (origem.get(o.carrier) ?? 0) + 1);
      return {
        key: c.key, label: c.label, hint: (c as any).hint, pacotes: list.length,
        entregues: list.filter((o) => o.status === "entregue").length,
        andamento: list.filter((o) => o.status === "andamento").length,
        parados: list.filter((o) => o.status === "parado").length,
        diasMedia: avg(deliv), diasMediana: median(deliv), comCodigo: list.filter((o) => o.local_number).length,
        origem: [...origem.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, label: carrierLabel(key), n })),
      };
    }).filter((r) => r.pacotes > 0);
    out.sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""));
    return { rows, orders: out };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAllIn } from "@/lib/select-all";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";
import { phaseResolver, type Phase } from "@/lib/tracking-phases";
import { aggregate, avg, carrierLabel, CARRIERS, median, type CarrierRow, type CarrierTotals } from "@/lib/carrier-stats";

// Gerencial › Transportadoras: busca os pedidos/rastreios das lojas da coluna
// "Ativas" do Banco de Lojas e faz a conta de carrier-stats.ts (regras lá).

type Ctx = { ownerId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "gerencial");

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

    // Lojas ativas = as da coluna "Ativas" do Banco de Lojas (mesma regra de
    // product-links). Hold, Cemitério etc. e loja sem Shopify ligada não entram.
    const { data: columns, error: colsErr } = await supabaseAdmin.from("store_board_columns").select("id,name").eq("user_id", ownerId);
    if (colsErr) throw new Error(colsErr.message);
    const activeCols = (columns ?? []).filter((c: any) => /^ativ/i.test(String(c.name).trim())).map((c: any) => c.id as string);
    let shopIds: string[] = [];
    if (activeCols.length) {
      const { data: stores, error: storesErr } = await supabaseAdmin.from("shopify_stores").select("id").eq("user_id", ownerId).in("board_column_id", activeCols);
      if (storesErr) throw new Error(storesErr.message);
      const storeIds = (stores ?? []).map((x: any) => x.id as string);
      if (storeIds.length) {
        const { data: shops, error: shopsErr } = await supabaseAdmin.from("shops").select("id,archived").eq("user_id", ownerId).in("shopify_store_id", storeIds);
        if (shopsErr) throw new Error(shopsErr.message);
        shopIds = (shops ?? []).filter((x: any) => !x.archived).map((x: any) => x.id as string);
      }
    }
    if (!shopIds.length) return empty;

    const { data: orders, error: ordersErr } = await selectAllIn<any>(shopIds, (ids) => {
      let q = supabaseAdmin.from("shop_orders").select("id,order_date,tracking_code,tracking_code_history,tracking_code_manual_at").eq("user_id", ownerId).in("shop_id", ids);
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
    const { data: phaseRows, error: phaseErr } = await supabaseAdmin.from("tracking_phase_overrides").select("text_key,phase").eq("user_id", ownerId);
    if (phaseErr && phaseErr.code !== "42P01" && phaseErr.code !== "PGRST205") throw new Error(phaseErr.message);
    const phaseOf = phaseResolver(new Map((phaseRows ?? []).map((r: any) => [r.text_key as string, r.phase as Phase])));
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

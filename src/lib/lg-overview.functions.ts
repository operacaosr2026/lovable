import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { isoTodayUS } from "@/lib/timezone";
import { costProductsFor, getGroupRefundsAndChargebacks } from "@/lib/shop-orders.functions";
import { orderLineItemsCost } from "@/lib/product-cost-match";
import { selectAll } from "@/lib/select-all";

// ─── Date helpers ────────────────────────────────────────────────────────────

const isoToday = isoTodayUS;

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Accumulated lucro for a date range (usado tanto pra meta ativa quanto histórico) ──

async function computeAccumulatedLucro(
  supabase: any, ownerId: string, shop_ids: string[], start_date: string, end_date: string,
) {
  const [ordersRes, adsRes, feesRes, settingsRes, costProducts, refundsAndChargebacks] = await Promise.all([
    // Só os produtos do pedido (raw->line_items), não o pedido inteiro da
    // Shopify (~9 KB cada): 4 MB -> 0,5 MB num mês de 440 pedidos.
    selectAll(supabase.from("shop_orders").select("revenue,items_count,shop_id,order_date,line_items:raw->line_items")
      .eq("user_id", ownerId).in("shop_id", shop_ids)
      .gte("order_date", start_date).lte("order_date", end_date)),
    selectAll(supabase.from("shop_cash_entries").select("amount,date")
      .eq("user_id", ownerId).in("shop_id", shop_ids)
      .eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend")
      .gte("date", start_date).lte("date", end_date)),
    selectAll(supabase.from("shop_cash_entries").select("amount,date")
      .eq("user_id", ownerId).in("shop_id", shop_ids)
      .eq("category", "Taxas Shopify")
      .gte("date", start_date).lte("date", end_date)),
    supabase.from("shop_order_settings").select("shop_id,default_unit_cost")
      .eq("user_id", ownerId).in("shop_id", shop_ids),
    costProductsFor(supabase, ownerId),
    // Reembolsos/chargebacks do banco (getGroupRefundsAndChargebacks) — mesma
    // fonte do Dashboard e do card de Lojas e Grupos, pra "lucro" bater nas telas.
    getGroupRefundsAndChargebacks(ownerId, shop_ids, start_date, end_date),
  ]);

  const costByShop = new Map<string, number>(
    (settingsRes.data ?? []).map((r: any) => [r.shop_id, Number(r.default_unit_cost ?? 0)])
  );
  const configuredCosts = Array.from(costByShop.values()).filter((c) => c > 0);
  const avgCost = configuredCosts.length > 0
    ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length
    : 0;

  const orders = ordersRes.data ?? [];
  // Mesmo cálculo por produto/palavra-chave usado no Dashboard (orderLineItemsCost),
  // em vez de items_count × custo fixo da loja.
  const orderCost = (o: any) => {
    const shopCost = costByShop.get(o.shop_id);
    const fallback = shopCost != null && shopCost > 0 ? shopCost : avgCost;
    return orderLineItemsCost(o.line_items, costProducts, fallback);
  };
  const ordersRevenue = orders.reduce((s: number, o: any) => s + Number(o.revenue ?? 0), 0);
  const reembolsos = refundsAndChargebacks.reduce((s: number, r: any) => s + r.refAmt, 0);
  const chargebacks = refundsAndChargebacks.reduce((s: number, r: any) => s + r.cbAmt, 0);
  const revenue = ordersRevenue - reembolsos - chargebacks;
  const custo = orders.reduce((s: number, o: any) => s + orderCost(o), 0);
  const anuncios = (adsRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const taxas = (feesRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const lucro = revenue - custo - taxas - anuncios;

  // ── Lucro por dia (série acumulada para o gráfico + tendência) ───────────
  const lucroByDate = new Map<string, number>();
  const pedidosByDate = new Map<string, number>();
  for (const o of orders) {
    const d = o.order_date as string;
    lucroByDate.set(d, (lucroByDate.get(d) ?? 0) + Number(o.revenue ?? 0) - orderCost(o));
    pedidosByDate.set(d, (pedidosByDate.get(d) ?? 0) + 1);
  }
  for (const r of adsRes.data ?? []) {
    const d = r.date as string;
    lucroByDate.set(d, (lucroByDate.get(d) ?? 0) - Number(r.amount ?? 0));
  }
  for (const r of feesRes.data ?? []) {
    const d = r.date as string;
    lucroByDate.set(d, (lucroByDate.get(d) ?? 0) - Number(r.amount ?? 0));
  }
  // Reembolso/chargeback também descontados dia a dia (data do reembolso/da
  // disputa) — antes só entravam no agregado do período, nunca no gráfico,
  // então a curva "Real" terminava acima do "Lucro acumulado" mostrado ao lado.
  for (const r of refundsAndChargebacks as any[]) {
    for (const [d, amt] of Object.entries(r.refByDate ?? {})) {
      lucroByDate.set(d, (lucroByDate.get(d) ?? 0) - Number(amt));
    }
    for (const [d, amt] of Object.entries(r.cbByDate ?? {})) {
      lucroByDate.set(d, (lucroByDate.get(d) ?? 0) - Number(amt));
    }
  }

  const days: string[] = [];
  for (let d = start_date; d <= end_date; d = addDays(d, 1)) days.push(d);

  let cum = 0;
  const chartData = days.map((d) => {
    cum += lucroByDate.get(d) ?? 0;
    return { date: `${d.slice(8, 10)}/${d.slice(5, 7)}`, lucroAcumulado: Math.round(cum * 100) / 100 };
  });

  // Hoje ainda está em andamento (pedidos/ads seguem chegando ao longo do dia), então
  // não conta como "dia fechado" pras médias — senão ela cai artificialmente cedo no dia.
  const closedDays = end_date === isoToday() ? days.slice(0, -1) : days;

  const last3 = closedDays.slice(-3);
  const mediaUltimos3 = last3.length > 0
    ? last3.reduce((s, d) => s + (lucroByDate.get(d) ?? 0), 0) / last3.length
    : 0;
  const lucroFechado = closedDays.reduce((s, d) => s + (lucroByDate.get(d) ?? 0), 0);
  const mediaGeral = closedDays.length > 0 ? lucroFechado / closedDays.length : 0;
  const cpa = anuncios > 0 && orders.length > 0 ? anuncios / orders.length : 0;

  // ── Ontem (dia anterior ao fim do período) ────────────────────────────────
  const ontem = addDays(end_date, -1);
  const lucroOntem = Math.round((lucroByDate.get(ontem) ?? 0) * 100) / 100;
  const pedidosOntem = pedidosByDate.get(ontem) ?? 0;

  return { lucro, pedidos: orders.length, chartData, mediaUltimos3, mediaGeral, cpa, lucroOntem, pedidosOntem };
}

export const getLgAccumulatedLucro = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_ids: z.array(z.string().uuid()).min(1),
    start_date: z.string(),
    end_date: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const end_date = data.end_date ?? isoToday();
    return computeAccumulatedLucro(context.supabase, context.ownerId, data.shop_ids, data.start_date, end_date);
  });

// ─── Goal CRUD (com histórico de metas) ────────────────────────────────────────

export const getLgCardGoal = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const today = isoToday();
    const { data: row } = await supabase
      .from("lg_card_goals")
      .select("*")
      .eq("card_id", data.card_id)
      .eq("user_id", ownerId)
      .is("closed_at", null)
      .gte("prazo", today)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { goal: row ?? null };
  });

export const createLgCardGoal = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    card_id: z.string().uuid(),
    meta: z.number().positive(),
    start_date: z.string(),
    prazo: z.string(),
    lucro_por_venda: z.number().positive(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const today = isoToday();

    if (data.prazo < data.start_date) throw new Error("A data de fim não pode ser anterior à data de início.");

    const { data: active } = await supabase
      .from("lg_card_goals")
      .select("id")
      .eq("card_id", data.card_id).eq("user_id", ownerId)
      .is("closed_at", null).gte("prazo", today)
      .maybeSingle();
    if (active) throw new Error("Já existe uma meta ativa. Finalize-a antes de criar uma nova.");

    const { data: row, error } = await supabase
      .from("lg_card_goals")
      .insert({
        card_id: data.card_id, user_id: ownerId, meta: data.meta,
        start_date: data.start_date, prazo: data.prazo, lucro_por_venda: data.lucro_por_venda,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { goal: row };
  });

export const updateLgCardGoal = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    meta: z.number().positive(),
    start_date: z.string(),
    prazo: z.string(),
    lucro_por_venda: z.number().positive(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;

    if (data.prazo < data.start_date) throw new Error("A data de fim não pode ser anterior à data de início.");

    const { data: row, error } = await supabase
      .from("lg_card_goals")
      .update({
        meta: data.meta, start_date: data.start_date, prazo: data.prazo,
        lucro_por_venda: data.lucro_por_venda, updated_at: new Date().toISOString(),
      })
      .eq("id", data.id).eq("user_id", ownerId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { goal: row };
  });

export const finalizeLgCardGoal = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const { error } = await supabase
      .from("lg_card_goals")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", data.id).eq("user_id", ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listLgCardGoalHistory = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    card_id: z.string().uuid(),
    shop_ids: z.array(z.string().uuid()).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const today = isoToday();

    const { data: rows, error } = await supabase
      .from("lg_card_goals")
      .select("*")
      .eq("card_id", data.card_id).eq("user_id", ownerId)
      .order("start_date", { ascending: false });
    if (error) throw new Error(error.message);

    const goals = await Promise.all((rows ?? []).map(async (g: any) => {
      const isActive = !g.closed_at && g.prazo >= today;
      const closedDate = g.closed_at ? String(g.closed_at).slice(0, 10) : null;
      const endDate = isActive ? today : closedDate && closedDate < g.prazo ? closedDate : g.prazo;
      const { lucro } = await computeAccumulatedLucro(supabase, ownerId, data.shop_ids, g.start_date, endDate);
      return {
        id: g.id as string,
        meta: Number(g.meta),
        start_date: g.start_date as string,
        prazo: g.prazo as string,
        closed_at: g.closed_at as string | null,
        lucro,
        status: isActive ? "ativa" : lucro >= Number(g.meta) ? "batida" : "nao_batida",
      };
    }));

    return { goals };
  });

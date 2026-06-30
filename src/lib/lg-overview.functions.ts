import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── Date helpers ────────────────────────────────────────────────────────────

function isoToday() {
  return new Date().toLocaleDateString("en-CA");
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function isoWeekStart() {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ─── Shopify helpers (same pattern as shop-orders.functions.ts) ───────────────

async function getShopifyCreds(ownerId: string, shopify_store_id: string) {
  const { data, error } = await supabaseAdmin
    .from("shopify_stores")
    .select("shop_domain,access_token")
    .eq("user_id", ownerId)
    .eq("id", shopify_store_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.access_token) throw new Error("Loja Shopify não encontrada");
  return { domain: data.shop_domain as string, token: data.access_token as string };
}

async function fetchShopifyRefundedOrders(domain: string, token: string, fromISO: string, toISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/orders.json`
    + `?status=any&financial_status=refunded%2Cpartially_refunded&limit=250`
    + `&created_at_min=${encodeURIComponent(fromISO)}`
    + `&created_at_max=${encodeURIComponent(toISO)}`
    + `&fields=id,total_price,current_total_price,refunds`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify ${res.status}`);
    }
    const json: any = await res.json();
    out.push(...(json.orders ?? []));
    const link = res.headers.get("link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

async function fetchShopifyDisputes(domain: string, token: string, sinceISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/disputes.json?limit=250&initiated_at_min=${encodeURIComponent(sinceISO)}`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify ${res.status}`);
    }
    const json: any = await res.json();
    out.push(...(json.disputes ?? []));
    const link = res.headers.get("link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

// ─── Main overview metrics ────────────────────────────────────────────────────

export const getLgOverviewMetrics = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_ids: z.array(z.string().uuid()).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const { shop_ids } = data;

    const today     = isoToday();
    const weekStart = isoWeekStart();
    const monthStart = isoMonthStart();

    // ── DB queries in parallel ──────────────────────────────────────────────
    const [
      todayOrders, weekOrders, monthOrders,
      todayAds, weekAds, monthAds,
      todayFees, weekFees, monthFees,
      settingsRes,
      allTimeRes, estornadosRes,
    ] = await Promise.all([
      // Orders per period
      supabase.from("shop_orders").select("revenue,items_count,shop_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .gte("order_date", today).lte("order_date", today),
      supabase.from("shop_orders").select("revenue,items_count,shop_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .gte("order_date", weekStart).lte("order_date", today),
      supabase.from("shop_orders").select("revenue,items_count,shop_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .gte("order_date", monthStart).lte("order_date", today),

      // Meta Ads spend per period
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend")
        .gte("date", today).lte("date", today),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend")
        .gte("date", weekStart).lte("date", today),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend")
        .gte("date", monthStart).lte("date", today),

      // Shopify fees per period
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Taxas Shopify")
        .gte("date", today).lte("date", today),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Taxas Shopify")
        .gte("date", weekStart).lte("date", today),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Taxas Shopify")
        .gte("date", monthStart).lte("date", today),

      // Unit costs
      supabase.from("shop_order_settings").select("shop_id,default_unit_cost,shopify_store_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids),

      // All-time totals (DB only)
      supabase.from("shop_orders").select("revenue")
        .eq("user_id", ownerId).in("shop_id", shop_ids),
      supabase.from("shop_orders").select("id")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("payment_status", "estornado"),
    ]);

    // ── Cost helpers ──────────────────────────────────────────────────────────
    const costByShop = new Map(
      (settingsRes.data ?? []).map((r: any) => [r.shop_id, Number(r.default_unit_cost ?? 0)])
    );
    const configuredCosts = Array.from(costByShop.values()).filter(c => c > 0);
    const avgCost = configuredCosts.length > 0
      ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length
      : 0;

    function orderCost(o: any) {
      const c = costByShop.get(o.shop_id);
      return Number(o.items_count ?? 0) * (c != null && c > 0 ? c : avgCost);
    }

    const sumAmt = (rows: any[] | null) =>
      (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);

    const anunciosHoje = sumAmt(todayAds.data);
    const anunciosSemana = sumAmt(weekAds.data);
    const anunciosMes = sumAmt(monthAds.data);
    const taxasHoje = sumAmt(todayFees.data);
    const taxasSemana = sumAmt(weekFees.data);
    const taxasMes = sumAmt(monthFees.data);

    // ── Period computation (DB only, no Shopify for today/week) ──────────────
    function computePeriod(orders: any[], anuncios: number, taxas: number) {
      const revenue = orders.reduce((s, o) => s + Number(o.revenue ?? 0), 0);
      const custo = orders.reduce((s, o) => s + orderCost(o), 0);
      const pedidos = orders.length;
      const lucro = revenue - custo - taxas - anuncios;
      const cpa = anuncios > 0 && pedidos > 0 ? anuncios / pedidos : 0;
      return { revenue, custo, pedidos, lucro, cpa, anuncios };
    }

    const p_hoje = computePeriod(todayOrders.data ?? [], anunciosHoje, taxasHoje);
    const p_semana = computePeriod(weekOrders.data ?? [], anunciosSemana, taxasSemana);
    const p_mes_raw = computePeriod(monthOrders.data ?? [], anunciosMes, taxasMes);

    // ── Shopify API: refunds + chargebacks for month period only ──────────────
    let reembolsosMes = 0, chargebacksMes = 0;
    const shopifySettings = (settingsRes.data ?? []).filter((s: any) => s.shopify_store_id);
    if (shopifySettings.length > 0) {
      const shopifyResults = await Promise.all(
        shopifySettings.map(async (s: any) => {
          try {
            const { domain, token } = await getShopifyCreds(ownerId, s.shopify_store_id);
            const [refOrders, disputes] = await Promise.all([
              fetchShopifyRefundedOrders(domain, token, `${monthStart}T00:00:00Z`, `${today}T23:59:59Z`),
              fetchShopifyDisputes(domain, token, `${monthStart}T00:00:00Z`),
            ]);
            const orderRefundAmount = (o: any) => {
              const txSum = (o.refunds ?? [])
                .flatMap((r: any) => r.transactions ?? [])
                .filter((t: any) => (t.kind === "refund" || t.kind === "void") && t.status === "success")
                .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
              const priceDiff = Math.max(0, Number(o.total_price ?? 0) - Number(o.current_total_price ?? 0));
              return Math.max(txSum, priceDiff);
            };
            const refAmt = refOrders.reduce((acc: number, o: any) => acc + orderRefundAmount(o), 0);
            const cbAmt = disputes
              .filter((d: any) => d.type === "chargeback" && d.initiated_at <= `${today}T23:59:59Z`)
              .reduce((acc: number, d: any) => acc + Number(d.amount ?? 0), 0);
            return { refAmt, cbAmt };
          } catch {
            return { refAmt: 0, cbAmt: 0 };
          }
        })
      );
      reembolsosMes = shopifyResults.reduce((a, r) => a + r.refAmt, 0);
      chargebacksMes = shopifyResults.reduce((a, r) => a + r.cbAmt, 0);
    }

    const faturamentoMes = p_mes_raw.revenue - reembolsosMes - chargebacksMes;
    const lucroMes = faturamentoMes - p_mes_raw.custo - taxasMes - anunciosMes;
    const cpaMes = anunciosMes > 0 && p_mes_raw.pedidos > 0 ? anunciosMes / p_mes_raw.pedidos : 0;

    const reembolsoRate = p_mes_raw.revenue > 0 ? (reembolsosMes / p_mes_raw.revenue) * 100 : 0;
    const estornoRate = p_mes_raw.revenue > 0 ? (chargebacksMes / p_mes_raw.revenue) * 100 : 0;

    // ── All-time stats ────────────────────────────────────────────────────────
    const allOrders = allTimeRes.data ?? [];
    const totalFaturamento = allOrders.reduce((s, o) => s + Number((o as any).revenue ?? 0), 0);
    const totalPedidos = allOrders.length;
    const totalEstornados = estornadosRes.data?.length ?? 0;
    const percentEstornos = totalPedidos > 0 ? (totalEstornados / totalPedidos) * 100 : 0;

    return {
      today: {
        lucro: p_hoje.lucro,
        faturamento: p_hoje.revenue,
        anuncios: anunciosHoje,
        cpa: p_hoje.cpa,
        pedidos: p_hoje.pedidos,
      },
      week: {
        lucro: p_semana.lucro,
      },
      month: {
        lucro: lucroMes,
        faturamento: faturamentoMes,
        anuncios: anunciosMes,
        cpa: cpaMes,
        pedidos: p_mes_raw.pedidos,
        reembolsoRate,
        estornoRate,
      },
      allTime: {
        faturamento: totalFaturamento,
        pedidos: totalPedidos,
        percentEstornos,
      },
    };
  });

// ─── Accumulated lucro from goal start_date ───────────────────────────────────

export const getLgAccumulatedLucro = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_ids: z.array(z.string().uuid()).min(1),
    start_date: z.string(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const { shop_ids, start_date } = data;
    const today = isoToday();

    const [ordersRes, adsRes, feesRes, settingsRes] = await Promise.all([
      supabase.from("shop_orders").select("revenue,items_count,shop_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .gte("order_date", start_date).lte("order_date", today),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend")
        .gte("date", start_date).lte("date", today),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Taxas Shopify")
        .gte("date", start_date).lte("date", today),
      supabase.from("shop_order_settings").select("shop_id,default_unit_cost")
        .eq("user_id", ownerId).in("shop_id", shop_ids),
    ]);

    const costByShop = new Map(
      (settingsRes.data ?? []).map((r: any) => [r.shop_id, Number(r.default_unit_cost ?? 0)])
    );
    const configuredCosts = Array.from(costByShop.values()).filter(c => c > 0);
    const avgCost = configuredCosts.length > 0
      ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length
      : 0;

    const orders = ordersRes.data ?? [];
    const revenue = orders.reduce((s, o) => s + Number((o as any).revenue ?? 0), 0);
    const custo = orders.reduce((s, o) => {
      const c = costByShop.get((o as any).shop_id);
      return s + Number((o as any).items_count ?? 0) * (c != null && c > 0 ? c : avgCost);
    }, 0);
    const anuncios = (adsRes.data ?? []).reduce((s, r) => s + Number((r as any).amount ?? 0), 0);
    const taxas = (feesRes.data ?? []).reduce((s, r) => s + Number((r as any).amount ?? 0), 0);
    const lucro = revenue - custo - taxas - anuncios;

    return { lucro, pedidos: orders.length };
  });

// ─── Goal CRUD ────────────────────────────────────────────────────────────────

export const getLgCardGoal = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const { data: row } = await supabase
      .from("lg_card_goals")
      .select("*")
      .eq("card_id", data.card_id)
      .eq("user_id", ownerId)
      .maybeSingle();
    return { goal: row ?? null };
  });

export const upsertLgCardGoal = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    card_id: z.string().uuid(),
    meta: z.number().positive(),
    prazo: z.string(),
    start_date: z.string().optional(),
    reset_start: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const today = isoToday();

    // Check if row already exists to preserve start_date
    const { data: existing } = await supabase
      .from("lg_card_goals")
      .select("start_date")
      .eq("card_id", data.card_id)
      .eq("user_id", ownerId)
      .maybeSingle();

    const start_date = data.reset_start || !existing
      ? (data.start_date ?? today)
      : existing.start_date;

    const { data: row, error } = await supabase
      .from("lg_card_goals")
      .upsert(
        { card_id: data.card_id, user_id: ownerId, meta: data.meta, prazo: data.prazo, start_date, updated_at: new Date().toISOString() },
        { onConflict: "card_id,user_id" }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { goal: row };
  });

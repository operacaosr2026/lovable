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

// ─── Main overview metrics (mês, focado na Meta) ──────────────────────────────

export const getLgOverviewMetrics = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_ids: z.array(z.string().uuid()).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const { shop_ids } = data;

    const today = isoToday();
    const monthStart = isoMonthStart();

    const [monthOrders, monthAds, monthFees, settingsRes] = await Promise.all([
      supabase.from("shop_orders").select("revenue,items_count,shop_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .gte("order_date", monthStart).lte("order_date", today),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend")
        .gte("date", monthStart).lte("date", today),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .eq("category", "Taxas Shopify")
        .gte("date", monthStart).lte("date", today),
      supabase.from("shop_order_settings").select("shop_id,default_unit_cost,shopify_store_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids),
    ]);

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
    const anunciosMes = sumAmt(monthAds.data);
    const taxasMes = sumAmt(monthFees.data);

    const orders = monthOrders.data ?? [];
    const revenue = orders.reduce((s, o) => s + Number(o.revenue ?? 0), 0);
    const custo = orders.reduce((s, o) => s + orderCost(o), 0);
    const pedidos = orders.length;

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

    const faturamentoMes = revenue - reembolsosMes - chargebacksMes;
    const lucroMes = faturamentoMes - custo - taxasMes - anunciosMes;
    const cpaMes = anunciosMes > 0 && pedidos > 0 ? anunciosMes / pedidos : 0;

    return {
      month: {
        lucro: lucroMes,
        pedidos,
        cpa: cpaMes,
      },
    };
  });

// ─── Accumulated lucro for a date range (usado tanto pra meta ativa quanto histórico) ──

async function computeAccumulatedLucro(
  supabase: any, ownerId: string, shop_ids: string[], start_date: string, end_date: string,
) {
  const [ordersRes, adsRes, feesRes, settingsRes] = await Promise.all([
    supabase.from("shop_orders").select("revenue,items_count,shop_id,order_date")
      .eq("user_id", ownerId).in("shop_id", shop_ids)
      .gte("order_date", start_date).lte("order_date", end_date),
    supabase.from("shop_cash_entries").select("amount,date")
      .eq("user_id", ownerId).in("shop_id", shop_ids)
      .eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend")
      .gte("date", start_date).lte("date", end_date),
    supabase.from("shop_cash_entries").select("amount,date")
      .eq("user_id", ownerId).in("shop_id", shop_ids)
      .eq("category", "Taxas Shopify")
      .gte("date", start_date).lte("date", end_date),
    supabase.from("shop_order_settings").select("shop_id,default_unit_cost")
      .eq("user_id", ownerId).in("shop_id", shop_ids),
  ]);

  const costByShop = new Map<string, number>(
    (settingsRes.data ?? []).map((r: any) => [r.shop_id, Number(r.default_unit_cost ?? 0)])
  );
  const configuredCosts = Array.from(costByShop.values()).filter((c) => c > 0);
  const avgCost = configuredCosts.length > 0
    ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length
    : 0;

  const orders = ordersRes.data ?? [];
  const orderCost = (o: any) => {
    const c = costByShop.get(o.shop_id);
    return Number(o.items_count ?? 0) * (c != null && c > 0 ? c : avgCost);
  };
  const revenue = orders.reduce((s: number, o: any) => s + Number(o.revenue ?? 0), 0);
  const custo = orders.reduce((s: number, o: any) => s + orderCost(o), 0);
  const anuncios = (adsRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const taxas = (feesRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const lucro = revenue - custo - taxas - anuncios;

  // ── Lucro por dia (série acumulada para o gráfico + tendência) ───────────
  const lucroByDate = new Map<string, number>();
  for (const o of orders) {
    const d = o.order_date as string;
    lucroByDate.set(d, (lucroByDate.get(d) ?? 0) + Number(o.revenue ?? 0) - orderCost(o));
  }
  for (const r of adsRes.data ?? []) {
    const d = r.date as string;
    lucroByDate.set(d, (lucroByDate.get(d) ?? 0) - Number(r.amount ?? 0));
  }
  for (const r of feesRes.data ?? []) {
    const d = r.date as string;
    lucroByDate.set(d, (lucroByDate.get(d) ?? 0) - Number(r.amount ?? 0));
  }

  const days: string[] = [];
  for (let d = start_date; d <= end_date; d = addDays(d, 1)) days.push(d);

  let cum = 0;
  const chartData = days.map((d) => {
    cum += lucroByDate.get(d) ?? 0;
    return { date: d.slice(5).replace("-", "/"), lucroAcumulado: Math.round(cum * 100) / 100 };
  });

  const last7 = days.slice(-7);
  const mediaUltimos7 = last7.length > 0
    ? last7.reduce((s, d) => s + (lucroByDate.get(d) ?? 0), 0) / last7.length
    : 0;
  const mediaGeral = days.length > 0 ? lucro / days.length : 0;
  const cpa = anuncios > 0 && orders.length > 0 ? anuncios / orders.length : 0;

  return { lucro, pedidos: orders.length, chartData, mediaUltimos7, mediaGeral, cpa };
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
      .insert({ card_id: data.card_id, user_id: ownerId, meta: data.meta, start_date: data.start_date, prazo: data.prazo })
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

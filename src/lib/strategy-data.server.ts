import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";
import type { Baseline } from "@/lib/strategy-plan";

// Números de base do Planejamento, só das lojas ativas (sem loja encerrada
// nem as do Cemitério do Banco de Lojas), e a medição automática dos
// resultados-chave (faturamento, pedidos, reembolso, recompra, entrega).

const DAY = 86_400_000;

export async function activeShopIds(ownerId: string): Promise<string[]> {
  const [{ data: shops }, { data: cols }] = await Promise.all([
    supabaseAdmin.from("shops").select("id,closed_on,shopify_store_id").eq("user_id", ownerId),
    supabaseAdmin.from("store_board_columns").select("id,name").eq("user_id", ownerId),
  ]);
  const colIds = ((cols ?? []) as any[]).filter((c) => /cemit/i.test(String(c.name ?? ""))).map((c) => c.id as string);
  let buriedStores = new Set<string>();
  if (colIds.length) {
    const { data: stores } = await supabaseAdmin.from("shopify_stores").select("id").in("board_column_id", colIds);
    buriedStores = new Set(((stores ?? []) as any[]).map((s) => s.id as string));
  }
  return ((shops ?? []) as any[]).filter((s) => !s.closed_on && !(s.shopify_store_id && buriedStores.has(s.shopify_store_id))).map((s) => s.id as string);
}

const isRefunded = (o: any) => ["refunded", "partially_refunded", "voided"].includes(o.fin ?? "") || !!o.cancelled;
const deliveredDays = (o: any) =>
  o.delivery_status === "delivered" && o.delivered_at && !o.kpi_excluded
    ? (Date.parse(o.delivered_at) - Date.parse(`${o.order_date}T12:00:00Z`)) / DAY : null;
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const ORDER_COLS = "shop_id,external_id,order_date,revenue,fin:shopify_financial_status,cancelled:raw->>cancelled_at,delivery_status,delivered_at,kpi_excluded";

async function ordersBetween(ownerId: string, shopIds: string[], from: string, to: string, extra = "") {
  if (!shopIds.length) return [] as any[];
  const { data, error } = await selectAll<any>(supabaseAdmin.from("shop_orders").select(ORDER_COLS + extra)
    .eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", from).lte("order_date", to).order("id"));
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function repeatStats(ownerId: string, shopIds: string[]) {
  if (!shopIds.length) return { repeatRate: null, customers: 0 };
  const { data } = await selectAll<any>(supabaseAdmin.from("shop_orders")
    .select("email:raw->>email,cust_email:raw->customer->>email,fin:shopify_financial_status,cancelled:raw->>cancelled_at")
    .eq("user_id", ownerId).in("shop_id", shopIds).order("id"));
  const count = new Map<string, number>();
  for (const o of (data ?? []) as any[]) {
    const e = String(o.email ?? o.cust_email ?? "").trim().toLowerCase();
    if (!e || isRefunded(o)) continue;
    count.set(e, (count.get(e) ?? 0) + 1);
  }
  const customers = count.size;
  return { repeatRate: customers ? [...count.values()].filter((n) => n >= 2).length / customers : null, customers };
}

export async function computeBaseline(ownerId: string): Promise<Baseline> {
  const today = isoTodayUS();
  const shopIds = await activeShopIds(ownerId);
  const [orders, repeat, { data: disputes }] = await Promise.all([
    ordersBetween(ownerId, shopIds, addDaysIso(today, -120), today, ",items:raw->line_items"),
    repeatStats(ownerId, shopIds),
    shopIds.length
      ? supabaseAdmin.from("shop_order_disputes").select("id").eq("user_id", ownerId).eq("type", "chargeback")
          .in("shop_id", shopIds).gte("initiated_at", `${addDaysIso(today, -90)}T00:00:00Z`)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const d30 = addDaysIso(today, -30), d90 = addDaysIso(today, -90), d14 = addDaysIso(today, -14), d60 = addDaysIso(today, -60);
  const last30 = orders.filter((o) => o.order_date >= d30 && !isRefunded(o));
  const revenue30 = last30.reduce((s, o) => s + Number(o.revenue ?? 0), 0);
  const refundWindow = orders.filter((o) => o.order_date >= d90 && o.order_date <= d14);
  const days = orders.map(deliveredDays).filter((d): d is number => d != null && d >= 0);

  // Produtos (últimos 60 dias): vendidos e quantos estavam em pedido com reembolso.
  const prod = new Map<string, { sold: number; refunded: number }>();
  for (const o of orders) {
    if (o.order_date < d60 || o.order_date > d14) continue;
    const ref = isRefunded(o);
    for (const li of (o.items ?? []) as any[]) {
      const name = String(li?.title ?? li?.name ?? "").trim();
      if (!name) continue;
      const q = Number(li?.quantity ?? 1) || 1;
      const p = prod.get(name) ?? { sold: 0, refunded: 0 };
      p.sold += q; if (ref) p.refunded += q;
      prod.set(name, p);
    }
  }
  const prodList = [...prod].map(([name, p]) => ({ name, sold: p.sold, refundRate: p.sold ? p.refunded / p.sold : 0 }));

  return {
    today,
    revenue30: Math.round(revenue30 * 100) / 100, orders30: last30.length,
    ticket: last30.length ? revenue30 / last30.length : null, dailyRevenue: revenue30 / 30,
    refundRate: refundWindow.length ? refundWindow.filter(isRefunded).length / refundWindow.length : null,
    deliveryMedian: quantile(days, 0.5), deliveryP80: quantile(days, 0.8), deliverySample: days.length,
    repeatRate: repeat.repeatRate, customers: repeat.customers,
    chargebacks90: (disputes ?? []).length, orders90: orders.filter((o) => o.order_date >= d90).length,
    topProducts: [...prodList].sort((a, b) => b.sold - a.sold).slice(0, 5),
    riskyProducts: prodList.filter((p) => p.sold >= 5 && p.refundRate >= 0.15).sort((a, b) => b.refundRate - a.refundRate).slice(0, 5),
  };
}

// Valor atual dos resultados-chave medidos pelo sistema.
// revenue/orders: pedidos válidos na janela; refund_rate (%): pedidos da janela
// com reembolso; delivery_days: mediana da entrega dos pedidos da janela;
// repeat_rate (%): clientes com 2+ compras desde o começo.
export async function measureKeyResults(ownerId: string, krs: { id: string; metric: string | null; metric_from: string | null; metric_to: string | null }[]) {
  const out = new Map<string, number>();
  const auto = krs.filter((k) => k.metric);
  if (!auto.length) return out;
  const shopIds = await activeShopIds(ownerId);
  const today = isoTodayUS();
  const windowed = auto.filter((k) => k.metric !== "repeat_rate" && k.metric_from && k.metric_to);
  let orders: any[] = [];
  if (windowed.length) {
    const from = windowed.reduce((m, k) => (k.metric_from! < m ? k.metric_from! : m), windowed[0].metric_from!);
    const to = windowed.reduce((m, k) => (k.metric_to! > m ? k.metric_to! : m), windowed[0].metric_to!);
    orders = await ordersBetween(ownerId, shopIds, from, to > today ? today : to);
  }
  const repeat = auto.some((k) => k.metric === "repeat_rate") ? await repeatStats(ownerId, shopIds) : null;
  for (const k of auto) {
    if (k.metric === "repeat_rate") { if (repeat?.repeatRate != null) out.set(k.id, Math.round(repeat.repeatRate * 1000) / 10); continue; }
    if (!k.metric_from || !k.metric_to) continue;
    const inWin = orders.filter((o) => o.order_date >= k.metric_from! && o.order_date <= k.metric_to!);
    const valid = inWin.filter((o) => !isRefunded(o));
    if (k.metric === "revenue") out.set(k.id, Math.round(valid.reduce((s, o) => s + Number(o.revenue ?? 0), 0) * 100) / 100);
    else if (k.metric === "orders") out.set(k.id, valid.length);
    else if (k.metric === "refund_rate") { if (inWin.length) out.set(k.id, Math.round((inWin.filter(isRefunded).length / inWin.length) * 1000) / 10); }
    else if (k.metric === "delivery_days") {
      const m = quantile(inWin.map(deliveredDays).filter((d): d is number => d != null && d >= 0), 0.5);
      if (m != null) out.set(k.id, Math.round(m * 10) / 10);
    }
  }
  return out;
}


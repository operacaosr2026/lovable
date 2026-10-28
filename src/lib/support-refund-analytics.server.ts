import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { companyShopIdsForMonth, monthStartOf } from "@/lib/company-goals.server";
import { addDaysIso, isoDateUS, isoTodayUS } from "@/lib/timezone";
import { personNames } from "@/lib/support-approval.server";
import { raiseNotification, resolveNotification } from "@/lib/notifications.server";
import { refundReasonLabel } from "@/lib/refund-reasons";

// Análise de reembolsos (Atendimento › Aprovações › Análise) e o alerta de
// reembolso alto. Fonte: os reembolsos que a Shopify registrou no pedido
// (raw.refunds) — feitos pelo app ou direto na Shopify —, cruzados com o pedido
// do app (support_refund_requests: motivo, quem pediu, tempo de aprovação).
// Lojas: as dos grupos ativos (mesma regra do Dashboard e das Metas). Data do
// reembolso no dia de Nova York. Valor = transações de reembolso concluídas ou
// pendentes (falhou não conta).

const db = (table: string) => (supabaseAdmin as any).from(table);
const r2 = (n: number) => Math.round(n * 100) / 100;
const LOOKBACK_DAYS = 240;   // reembolso de pedido de até ~8 meses antes

type LineItem = { product_id?: number | string | null; title?: string; name?: string; variant_title?: string | null; quantity?: number; price?: string | number };

export type RefundEvent = {
  key: string; orderId: string; orderNumber: string | null; shopId: string; shop: string;
  date: string; at: string; orderDate: string; amount: number; status: "concluido" | "pendente";
  pendingDays: number | null; reason: string | null; source: "app" | "shopify";
  requestedBy: string | null; requestedByName: string | null; conversationId: string | null;
  products: { key: string; name: string; units: number; amount: number }[];
};

async function cardsByShopifyProduct(ownerId: string) {
  const [{ data: links }, { data: cards }] = await Promise.all([
    supabaseAdmin.from("product_shopify_links").select("shopify_product_id,product_id").eq("user_id", ownerId).not("shopify_product_id", "is", null),
    supabaseAdmin.from("products").select("id,name,main_image_url").eq("user_id", ownerId),
  ]);
  const card = new Map((cards ?? []).map((c) => [c.id, c]));
  const out = new Map<string, { key: string; name: string; image: string | null }>();
  for (const l of links ?? []) {
    const c = card.get(l.product_id);
    if (c && l.shopify_product_id) {
      out.set(String(l.shopify_product_id), { key: `card:${c.id}`, name: c.name, image: c.main_image_url && !c.main_image_url.startsWith("data:") ? c.main_image_url : null });
    }
  }
  return out;
}

export async function refundAnalytics(ownerId: string, from: string, to: string) {
  const shopIds = await companyShopIdsForMonth(ownerId, monthStartOf(from));
  const empty = { from, to, shops: [] as { id: string; name: string }[], revenueByDate: new Map<string, number>(), events: [] as RefundEvent[], revenue: 0, orders: 0, sold: new Map<string, number>(), products: new Map<string, { name: string; image: string | null }>(), revenueByShop: new Map<string, number>(), approvalHours: null as number | null };
  if (!shopIds.length) return empty;

  const lookback = addDaysIso(from, -LOOKBACK_DAYS);
  const ORDER_COLS = "id,shop_id,order_number,order_date,revenue,refunds:raw->refunds,line_items:raw->line_items";
  const [shopsRes, refundedRes, appReqRes, periodRes, cardOf] = await Promise.all([
    supabaseAdmin.from("shops").select("id,name").in("id", shopIds),
    selectAll(supabaseAdmin.from("shop_orders").select(ORDER_COLS)
      .eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", lookback)
      .in("shopify_financial_status", ["refunded", "partially_refunded"])),
    // Reembolso pendente na Shopify deixa o pedido "paid": vem pelo pedido do app.
    db("support_refund_requests").select("id,order_id,reason,requested_by,created_at,decided_at,refund_id,conversation_id,status")
      .eq("owner_id", ownerId).in("shop_id", shopIds),
    selectAll(supabaseAdmin.from("shop_orders").select("id,shop_id,order_date,revenue,line_items:raw->line_items")
      .eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", from).lte("order_date", to)),
    cardsByShopifyProduct(ownerId),
  ]);
  for (const [res, what] of [[refundedRes, "pedidos reembolsados"], [appReqRes, "pedidos do app"], [periodRes, "pedidos do período"]] as const) {
    if ((res as any).error) throw new Error(`Análise de reembolsos: ${what}: ${(res as any).error.message}`);
  }
  const requests = ((appReqRes as any).data ?? []) as any[];
  const orders = new Map(((refundedRes.data ?? []) as any[]).map((o) => [o.id as string, o]));
  const missing = [...new Set(requests.filter((r) => ["aprovado", "gerando"].includes(r.status)).map((r) => r.order_id as string))].filter((id) => !orders.has(id));
  if (missing.length) {
    const extra = await selectAllIn<any>(missing, (c) => supabaseAdmin.from("shop_orders").select(ORDER_COLS).eq("user_id", ownerId).in("id", c));
    if (extra.error) throw new Error(`Análise de reembolsos: pedidos pendentes: ${extra.error.message}`);
    for (const o of extra.data) orders.set(o.id, o);
  }

  const shopName = new Map(((shopsRes.data ?? []) as any[]).map((s) => [s.id as string, s.name as string]));
  const products = new Map<string, { name: string; image: string | null }>();
  const productOf = (li: LineItem) => {
    const card = li.product_id != null ? cardOf.get(String(li.product_id)) : undefined;
    if (card) { products.set(card.key, { name: card.name, image: card.image }); return card.key; }
    const name = String(li.title ?? li.name ?? "Item").trim();
    const key = `t:${name.toLowerCase()}`;
    if (!products.has(key)) products.set(key, { name, image: null });
    return key;
  };

  // Vendidos no período (pra taxa por produto) e faturamento por loja.
  const sold = new Map<string, number>();
  const revenueByShop = new Map<string, number>();
  const revenueByDate = new Map<string, number>();
  let revenue = 0;
  for (const o of (periodRes.data ?? []) as any[]) {
    revenue += Number(o.revenue ?? 0);
    revenueByDate.set(o.order_date, (revenueByDate.get(o.order_date) ?? 0) + Number(o.revenue ?? 0));
    revenueByShop.set(o.shop_id, (revenueByShop.get(o.shop_id) ?? 0) + Number(o.revenue ?? 0));
    for (const li of (o.line_items ?? []) as LineItem[]) {
      const k = productOf(li);
      sold.set(k, (sold.get(k) ?? 0) + Number(li.quantity ?? 1));
    }
  }

  const reqByOrder = new Map<string, any[]>();
  for (const r of requests) reqByOrder.set(r.order_id, [...(reqByOrder.get(r.order_id) ?? []), r]);
  const names = await personNames(requests.map((r) => r.requested_by));

  const now = Date.now();
  const events: RefundEvent[] = [];
  for (const o of orders.values()) {
    for (const rf of (o.refunds ?? []) as any[]) {
      const at = String(rf.created_at ?? rf.processed_at ?? "");
      if (!at) continue;
      const date = isoDateUS(at);
      if (date < from || date > to) continue;
      const tx = ((rf.transactions ?? []) as any[]).filter((t) => t.kind === "refund" && (t.status === "success" || t.status === "pending"));
      const amount = tx.reduce((s, t) => s + Number(t.amount ?? 0), 0);
      if (amount <= 0) continue;
      const pending = tx.some((t) => t.status === "pending");

      // Produtos: itens do reembolso; sem itens (valor avulso/frete), rateia
      // pelos itens do pedido conforme o preço.
      const items = ((rf.refund_line_items ?? []) as any[]).filter((x) => x.line_item && Number(x.quantity) > 0);
      const prods = new Map<string, { units: number; amount: number }>();
      if (items.length) {
        const base = items.reduce((s, x) => s + Number(x.subtotal ?? 0), 0);
        for (const x of items) {
          const k = productOf(x.line_item);
          const p = prods.get(k) ?? { units: 0, amount: 0 };
          p.units += Number(x.quantity);
          p.amount += base > 0 ? amount * Number(x.subtotal ?? 0) / base : amount / items.length;
          prods.set(k, p);
        }
      } else {
        const lis = (o.line_items ?? []) as LineItem[];
        const base = lis.reduce((s, li) => s + Number(li.price ?? 0) * Number(li.quantity ?? 1), 0);
        for (const li of lis) {
          const k = productOf(li);
          const p = prods.get(k) ?? { units: 0, amount: 0 };
          const part = base > 0 ? Number(li.price ?? 0) * Number(li.quantity ?? 1) / base : 1 / lis.length;
          // Só valor: entra no valor do produto, não como unidade devolvida.
          p.amount += amount * part;
          prods.set(k, p);
        }
      }

      const list = reqByOrder.get(o.id) ?? [];
      const req = list.find((q) => q.refund_id && String(q.refund_id).endsWith(`/${rf.id}`))
        ?? list.filter((q) => q.status === "aprovado").sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0] ?? null;
      events.push({
        key: `${o.id}:${rf.id}`, orderId: o.id, orderNumber: o.order_number, shopId: o.shop_id, shop: shopName.get(o.shop_id) ?? "—",
        date, at, orderDate: o.order_date, amount: r2(amount), status: pending ? "pendente" : "concluido",
        pendingDays: pending ? Math.floor((now - new Date(at).getTime()) / 86_400_000) : null,
        reason: req?.reason ?? null, source: req ? "app" : "shopify",
        requestedBy: req?.requested_by ?? null, requestedByName: req ? names.get(req.requested_by) ?? "Equipe" : null,
        conversationId: req?.conversation_id ?? null,
        products: [...prods].map(([k, p]) => ({ key: k, name: products.get(k)?.name ?? k, units: p.units, amount: r2(p.amount) })),
      });
    }
  }
  events.sort((a, b) => b.at.localeCompare(a.at));

  // Tempo da solicitação até a decisão (pedidos do app decididos no período).
  const decided = requests.filter((r) => r.decided_at && r.status === "aprovado" && isoDateUS(r.decided_at) >= from && isoDateUS(r.decided_at) <= to);
  const approvalHours = decided.length
    ? decided.reduce((s, r) => s + (new Date(r.decided_at).getTime() - new Date(r.created_at).getTime()), 0) / decided.length / 3_600_000
    : null;

  return {
    from, to, events, revenue, orders: (periodRes.data ?? []).length, sold, products, revenueByShop, revenueByDate, approvalHours,
    shops: shopIds.map((id) => ({ id, name: shopName.get(id) ?? "—" })),
  };
}

// Por produto: unidades e valor reembolsados × vendidos no período.
export function productBreakdown(a: Awaited<ReturnType<typeof refundAnalytics>>) {
  const by = new Map<string, { units: number; amount: number; reasons: Map<string, number> }>();
  for (const e of a.events) {
    for (const p of e.products) {
      const x = by.get(p.key) ?? { units: 0, amount: 0, reasons: new Map() };
      x.units += p.units;
      x.amount += p.amount;
      const rk = e.reason ?? "sem";
      x.reasons.set(rk, (x.reasons.get(rk) ?? 0) + 1);
      by.set(p.key, x);
    }
  }
  return [...by].map(([key, x]) => {
    const sold = a.sold.get(key) ?? 0;
    const top = [...x.reasons].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
    return {
      key, name: a.products.get(key)?.name ?? key, image: a.products.get(key)?.image ?? null,
      units: x.units, amount: r2(x.amount), sold, rate: sold > 0 ? x.units / sold : null,
      topReason: top && top !== "sem" ? top : null,
    };
  }).sort((p, q) => q.amount - p.amount);
}

// ─── Alerta de reembolso alto / pendente (sino) ───────────────────────────────

export const REFUND_ALERT_DEFAULTS = { enabled: true, product_rate_limit: 10, product_min_sold: 5, window_days: 7, pending_days: 3 };
export const ANALYSIS_LINK = "/atendimento?v=reembolsos";

export async function getRefundAlertSettings(ownerId: string) {
  const { data } = await db("support_refund_alerts").select("enabled,product_rate_limit,product_min_sold,window_days,pending_days,last_checked_at")
    .eq("owner_id", ownerId).maybeSingle();
  return data
    ? { ...data, product_rate_limit: Number(data.product_rate_limit) } as typeof REFUND_ALERT_DEFAULTS & { last_checked_at: string | null }
    : { ...REFUND_ALERT_DEFAULTS, last_checked_at: null };
}

// Roda no notifications-refresh (a cada ~10 min), mas no máximo 1x por hora —
// salvar os limites zera a espera (force).
export async function checkRefundAlerts(ownerId: string, force = false) {
  const st = await getRefundAlertSettings(ownerId);
  if (!force && st.last_checked_at && Date.now() - new Date(st.last_checked_at).getTime() < 55 * 60_000) return;
  await db("support_refund_alerts").upsert({ owner_id: ownerId, last_checked_at: new Date().toISOString() }, { onConflict: "owner_id" });

  const want = new Map<string, { title: string; body: string }>();
  if (st.enabled) {
    const today = isoTodayUS();
    const a = await refundAnalytics(ownerId, addDaysIso(today, -(st.window_days - 1)), today);
    for (const p of productBreakdown(a)) {
      if (p.rate == null || p.sold < st.product_min_sold || p.rate * 100 <= st.product_rate_limit) continue;
      want.set(`refund_rate:${p.key}`.slice(0, 160), {
        title: `Reembolso alto: ${p.name} — ${Math.round(p.rate * 100)}% em ${st.window_days} dia${st.window_days === 1 ? "" : "s"}`,
        body: `${p.units} de ${p.sold} vendidos reembolsados (limite ${st.product_rate_limit}%)${p.topReason ? `. Motivo mais comum: ${refundReasonLabel(p.topReason)}` : ""}.`,
      });
    }
    // Pendentes: olha os últimos 60 dias.
    const recent = await refundAnalytics(ownerId, addDaysIso(today, -60), today);
    const stuck = recent.events.filter((e) => e.status === "pendente" && (e.pendingDays ?? 0) >= st.pending_days);
    if (stuck.length) {
      const total = stuck.reduce((s, e) => s + e.amount, 0);
      want.set("refund_pending:shopify", {
        title: `${stuck.length} reembolso${stuck.length === 1 ? "" : "s"} pendente${stuck.length === 1 ? "" : "s"} na Shopify há mais de ${st.pending_days} dia${st.pending_days === 1 ? "" : "s"}`,
        body: `$${total.toFixed(2)} — ${stuck.slice(0, 6).map((e) => e.orderNumber ?? "pedido").join(", ")}${stuck.length > 6 ? "…" : ""}. A Shopify ainda não concluiu a devolução.`,
      });
    }
  }

  const { data: current } = await supabaseAdmin.from("app_notifications").select("key,title,body,resolved_at")
    .eq("user_id", ownerId).or("key.like.refund_rate:*,key.like.refund_pending:*");
  const byKey = new Map((current ?? []).map((n) => [n.key, n]));
  for (const [key, n] of want) {
    const ex = byKey.get(key);
    if (ex && !ex.resolved_at && ex.title === n.title && ex.body === n.body) continue;
    await raiseNotification(ownerId, key, { level: "warning", title: n.title, body: n.body, link: ANALYSIS_LINK });
  }
  for (const n of current ?? []) if (!n.resolved_at && !want.has(n.key)) await resolveNotification(ownerId, n.key);
}

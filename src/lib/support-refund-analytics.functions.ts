import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canSeeApprovals, isApprover, type SupportCtx as Ctx } from "@/lib/support-approval.server";
import { checkRefundAlerts, getRefundAlertSettings, productBreakdown, refundAnalytics } from "@/lib/support-refund-analytics.server";
import { addDaysIso } from "@/lib/timezone";
import { REFUND_REASON_KEYS } from "@/lib/refund-reasons";

// Atendimento › Aprovações › Análise de reembolsos. Vê quem vê as Aprovações;
// os limites do alerta, quem aprova.

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const r2 = (n: number) => Math.round(n * 100) / 100;
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

function assertSee(ctx: Ctx) {
  if (!canSeeApprovals(ctx)) throw new Error("Sem acesso à análise de reembolsos");
}

export const getRefundAnalytics = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ from: ISO, to: ISO }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    assertSee(ctx);
    // Período anterior do mesmo tamanho, pra comparar.
    const len = daysBetween(data.from, data.to) + 1;
    const prevTo = addDaysIso(data.from, -1), prevFrom = addDaysIso(prevTo, -(len - 1));
    const [a, prev, settings, cardLinks] = await Promise.all([
      refundAnalytics(ctx.ownerId, data.from, data.to),
      refundAnalytics(ctx.ownerId, prevFrom, prevTo),
      getRefundAlertSettings(ctx.ownerId),
      supabaseAdmin.from("lg_card_shops").select("card_id,shop_id,lg_cards!inner(user_id,name,status)")
        .eq("lg_cards.user_id", ctx.ownerId).neq("lg_cards.status", "arquivado"),
    ]);

    // Grupo (card de Lojas e Grupos) de cada loja — é o grupo que roda, não a
    // loja. Loja em mais de um grupo conta no de mais lojas.
    const cardShops = new Map<string, { name: string; shops: Set<string> }>();
    for (const l of (cardLinks.data ?? []) as any[]) {
      const c = cardShops.get(l.card_id) ?? { name: l.lg_cards?.name ?? "Grupo", shops: new Set<string>() };
      c.shops.add(l.shop_id);
      cardShops.set(l.card_id, c);
    }
    const groupOf = new Map<string, string>();
    for (const [id, c] of [...cardShops].sort(([, x], [, y]) => x.shops.size - y.shops.size)) {
      for (const s of c.shops) groupOf.set(s, id);   // o maior grupo, por último, fica
    }

    const sum = (ev: typeof a.events) => r2(ev.reduce((s, e) => s + e.amount, 0));
    const kpis = (x: typeof a) => {
      const total = sum(x.events);
      const ordersRefunded = new Set(x.events.map((e) => e.orderId)).size;
      return {
        total, count: x.events.length, ordersRefunded,
        rateRevenue: x.revenue > 0 ? total / x.revenue : null,
        rateOrders: x.orders > 0 ? ordersRefunded / x.orders : null,
      };
    };
    const pending = a.events.filter((e) => e.status === "pendente");
    const daysToRefund = a.events.map((e) => daysBetween(e.orderDate, e.date)).filter((d) => d >= 0);

    const group = <K extends string>(keyOf: (e: (typeof a.events)[number]) => K) => {
      const m = new Map<K, { count: number; amount: number }>();
      for (const e of a.events) {
        const k = keyOf(e);
        const x = m.get(k) ?? { count: 0, amount: 0 };
        x.count++; x.amount += e.amount;
        m.set(k, x);
      }
      return [...m].map(([key, x]) => ({ key, count: x.count, amount: r2(x.amount) })).sort((p, q) => q.amount - p.amount);
    };

    // Por dia: o gráfico e as minilinhas dos cartões (valor, taxa, pendente, dias até o reembolso).
    const daily = new Map<string, { amount: number; count: number; pending: number; days: number[] }>();
    for (let d = data.from; d <= data.to; d = addDaysIso(d, 1)) daily.set(d, { amount: 0, count: 0, pending: 0, days: [] });
    for (const e of a.events) {
      const x = daily.get(e.date);
      if (!x) continue;
      x.amount += e.amount; x.count++;
      if (e.status === "pendente") x.pending += e.amount;
      const dd = daysBetween(e.orderDate, e.date);
      if (dd >= 0) x.days.push(dd);
    }

    return {
      canEdit: isApprover(ctx),
      settings: { enabled: settings.enabled, product_rate_limit: settings.product_rate_limit, product_min_sold: settings.product_min_sold, window_days: settings.window_days, pending_days: settings.pending_days },
      prevRange: { from: prevFrom, to: prevTo },
      kpis: {
        ...kpis(a), revenue: r2(a.revenue), orders: a.orders,
        pendingCount: pending.length, pendingAmount: sum(pending),
        avgDaysToRefund: daysToRefund.length ? daysToRefund.reduce((s, d) => s + d, 0) / daysToRefund.length : null,
        approvalHours: a.approvalHours,
      },
      prev: kpis(prev),
      byReason: group((e) => (e.reason ?? (e.source === "shopify" ? "fora_app" : "sem")) as string),
      byGroup: group((e) => groupOf.get(e.shopId) ?? `loja:${e.shopId}`).map((x) => {
        const card = cardShops.get(x.key);
        const shopIds = card ? [...card.shops].filter((s) => groupOf.get(s) === x.key) : [x.key.slice(5)];
        const rev = shopIds.reduce((s, id) => s + (a.revenueByShop.get(id) ?? 0), 0);
        const name = card?.name ?? a.shops.find((s) => s.id === x.key.slice(5))?.name ?? "—";
        return { ...x, name, shops: shopIds.length, revenue: r2(rev), rate: rev > 0 ? x.amount / rev : null };
      }),
      byProduct: productBreakdown(a).slice(0, 30),
      daily: [...daily].map(([date, x]) => {
        const rev = a.revenueByDate.get(date) ?? 0;
        return {
          date, amount: r2(x.amount), count: x.count, pending: r2(x.pending),
          rate: rev > 0 ? x.amount / rev : null,
          avgDays: x.days.length ? x.days.reduce((s, v) => s + v, 0) / x.days.length : null,
        };
      }),
      events: a.events.slice(0, 500).map(({ products, ...e }) => ({ ...e, product: products.map((p) => p.name).join(", ") })),
    };
  });

export const saveRefundAlertSettings = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    enabled: z.boolean(),
    product_rate_limit: z.number().min(0.5).max(100),
    product_min_sold: z.number().int().min(1).max(1000),
    window_days: z.number().int().min(1).max(90),
    pending_days: z.number().int().min(1).max(60),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!isApprover(ctx)) throw new Error("Sem permissão para mudar os alertas");
    const { error } = await (supabaseAdmin as any).from("support_refund_alerts")
      .upsert({ owner_id: ctx.ownerId, ...data, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    // Aplica na hora (abre/fecha os avisos com o limite novo).
    await checkRefundAlerts(ctx.ownerId, true).catch(() => null);
    return { ok: true };
  });

// Motivo de um reembolso da lista: do app, corrige o pedido; feito direto na
// Shopify, guarda em support_refund_reasons. Quem aprova.
export const setRefundEventReason = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    orderId: z.string().uuid(), refundId: z.string().min(1).max(40), requestId: z.string().uuid().nullable(), reason: z.enum(REFUND_REASON_KEYS),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!isApprover(ctx)) throw new Error("Sem permissão para mudar o motivo");
    const db = (t: string) => (supabaseAdmin as any).from(t);
    const { error } = data.requestId
      ? await db("support_refund_requests").update({ reason: data.reason }).eq("id", data.requestId).eq("owner_id", ctx.ownerId)
      : await db("support_refund_reasons").upsert({
          owner_id: ctx.ownerId, order_id: data.orderId, refund_id: data.refundId, reason: data.reason,
          set_by: ctx.userId, updated_at: new Date().toISOString(),
        }, { onConflict: "owner_id,order_id,refund_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canSeeApprovals, isApprover, type SupportCtx as Ctx } from "@/lib/support-approval.server";
import { checkRefundAlerts, getRefundAlertSettings, productBreakdown, refundAnalytics } from "@/lib/support-refund-analytics.server";
import { addDaysIso } from "@/lib/timezone";

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
    const [a, prev, settings] = await Promise.all([
      refundAnalytics(ctx.ownerId, data.from, data.to),
      refundAnalytics(ctx.ownerId, prevFrom, prevTo),
      getRefundAlertSettings(ctx.ownerId),
    ]);

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

    const daily = new Map<string, { amount: number; count: number }>();
    for (let d = data.from; d <= data.to; d = addDaysIso(d, 1)) daily.set(d, { amount: 0, count: 0 });
    for (const e of a.events) {
      const x = daily.get(e.date);
      if (x) { x.amount += e.amount; x.count++; }
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
      byShop: group((e) => e.shopId).map((x) => {
        const rev = a.revenueByShop.get(x.key) ?? 0;
        return { ...x, name: a.shops.find((s) => s.id === x.key)?.name ?? "—", revenue: r2(rev), rate: rev > 0 ? x.amount / rev : null };
      }),
      byPerson: group((e) => (e.requestedByName ?? "Fora do app (Shopify)")),
      byProduct: productBreakdown(a).slice(0, 30),
      daily: [...daily].map(([date, x]) => ({ date, amount: r2(x.amount), count: x.count })),
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

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { isoTodayUS } from "@/lib/timezone";
import { companyShopIdsForMonth } from "@/lib/company-goals.server";
import type { AuditOrderInput } from "@/lib/intel/supplier-audit";

// Inteligência SRX — pedidos das lojas ativas (grupos ativos de Lojas e Grupos)
// com rastreio e chargeback, pra auditoria do fornecedor (supplier-audit.ts).

// Pedidos dos últimos 100 dias das lojas ativas, com rastreio e chargeback.
export async function loadAuditOrders(ownerId: string): Promise<AuditOrderInput[]> {
  const today = isoTodayUS();
  const shopIds = await companyShopIdsForMonth(ownerId, `${today.slice(0, 7)}-01`);
  if (!shopIds.length) return [];
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 100 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: shops }, ordersRes, disputesRes] = await Promise.all([
    supabaseAdmin.from("shops").select("id,name").in("id", shopIds),
    selectAll<any>(supabaseAdmin.from("shop_orders")
      .select("id,shop_id,external_id,order_number,revenue,created_at_shopify,paid_at,delivered_at,shopify_financial_status,fulfillments:raw->fulfillments")
      .eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", since)
      .filter("raw->>cancelled_at", "is", null)),
    selectAll<any>(supabaseAdmin.from("shop_order_disputes")
      .select("shop_id,order_external_id,reason,initiated_at")
      .eq("user_id", ownerId).in("shop_id", shopIds).eq("type", "chargeback")),
  ]);
  if (ordersRes.error) throw new Error(ordersRes.error.message);
  const orders = ordersRes.data ?? [];
  const { data: tracks } = orders.length
    ? await selectAllIn<any>(orders.map((o) => o.id), (c) => supabaseAdmin.from("shop_order_tracking")
        .select("order_id,tracking_status,timeline").in("order_id", c))
    : { data: [] as any[] };
  const trackBy = new Map((tracks ?? []).map((t: any) => [t.order_id, t]));
  const cbBy = new Map((disputesRes.data ?? []).map((d: any) => [`${d.shop_id}:${d.order_external_id}`, d]));
  const shopName = new Map(((shops ?? []) as any[]).map((s) => [s.id, s.name as string]));
  return orders.map((o) => {
    const t: any = trackBy.get(o.id);
    const cb: any = cbBy.get(`${o.shop_id}:${o.external_id}`);
    return {
      id: o.id, shopId: o.shop_id, shopName: shopName.get(o.shop_id) ?? "", orderNumber: o.order_number, revenue: Number(o.revenue ?? 0),
      createdAt: o.created_at_shopify, paidAt: o.paid_at, fulfillments: o.fulfillments ?? [],
      trackingStatus: t?.tracking_status ?? null, timeline: t?.timeline ?? null, deliveredAt: o.delivered_at,
      financialStatus: o.shopify_financial_status, chargeback: cb ? { reason: cb.reason, initiatedAt: cb.initiated_at } : null,
    };
  });
}

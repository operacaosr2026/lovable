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
      .select("id,shop_id,external_id,order_number,revenue,created_at_shopify,paid_at,delivered_at,shopify_financial_status,fulfillments:raw->fulfillments,"
        + "state:raw->shipping_address->>province_code,ship_zip:raw->shipping_address->>zip,bill_zip:raw->billing_address->>zip,"
        + "landing:raw->>landing_site,ua:raw->client_details->>user_agent,cust_at:raw->customer->>created_at,email:raw->>email,"
        + "phone:raw->>phone,ship_phone:raw->shipping_address->>phone,items:raw->line_items,mkt:raw->>buyer_accepts_marketing")
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
  const { data: risks } = orders.length
    ? await selectAllIn<any>(orders.map((o) => o.external_id), (c) => supabaseAdmin.from("shop_order_risks")
        .select("shop_id,order_external_id,risk_level,payment_brand").eq("user_id", ownerId).in("order_external_id", c))
    : { data: [] as any[] };
  const riskBy = new Map((risks ?? []).map((r: any) => [`${r.shop_id}:${r.order_external_id}`, r]));
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
      attrs: {
        state: o.state ?? null, billingZip: o.bill_zip ?? null, shippingZip: o.ship_zip ?? null, landing: o.landing ?? null,
        userAgent: o.ua ?? null, customerCreatedAt: o.cust_at ?? null, email: o.email ?? null, phone: o.phone || o.ship_phone || null,
        size: (o.items ?? [])[0]?.variant_title ?? null,
        quantity: (o.items ?? []).reduce((s: number, li: any) => s + Number(li.quantity ?? 0), 0) || null,
        acceptsMarketing: o.mkt == null ? null : o.mkt === "true", brand: riskBy.get(`${o.shop_id}:${o.external_id}`)?.payment_brand ?? null,
        risk: riskBy.get(`${o.shop_id}:${o.external_id}`)?.risk_level ?? null,
      },
    };
  });
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Grava disputas (chargeback e inquiry) da Shopify Payments em
// shop_order_disputes — usado pelo sync completo (de hora em hora) e pelo
// webhook disputes/create|update (na hora). Alimenta a taxa de estorno, o
// chargeback descontado no lucro e o aviso de disputa com prazo no sino.
export async function upsertShopDisputes(shopId: string, userId: string, disputes: any[]) {
  const rows = disputes.filter((d: any) => d?.id != null).map((d: any) => ({
    user_id: userId, shop_id: shopId,
    shopify_dispute_id: String(d.id),
    order_external_id: d.order_id != null ? String(d.order_id) : null,
    type: String(d.type ?? "unknown"),
    status: d.status ?? null,
    reason: d.reason ?? null,
    amount: Math.abs(Number(d.amount ?? 0)),
    currency: d.currency ?? null,
    initiated_at: String(d.initiated_at).slice(0, 10),
    finalized_on: d.finalized_on ? String(d.finalized_on).slice(0, 10) : null,
    evidence_due_by: d.evidence_due_by ?? null,
  }));
  if (!rows.length) return;
  const { error } = await supabaseAdmin.from("shop_order_disputes")
    .upsert(rows as any[], { onConflict: "shop_id,shopify_dispute_id" });
  if (error) throw new Error(error.message);
}

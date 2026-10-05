import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshEstornoDisputeCounts } from "@/lib/estorno-daily.server";
import { tracked } from "@/lib/system-errors.server";
import { fetchWithRetry } from "@/lib/http";
import { handleShopifyAccess } from "@/lib/shopify-access.server";

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
  // Chargeback novo já entra na taxa de estorno (sem esperar a meia-noite).
  await tracked(userId, `estorno_recount:${shopId}`, "Taxa de estorno não recontou o chargeback novo",
    () => refreshEstornoDisputeCounts(userId, shopId));
}

// Disputas reais (chargeback/inquiry) da Shopify Payments — fonte do relatório
// "Taxa de estorno" do próprio Shopify. Não confundir com balance transactions:
// lá o type nunca vem como "dispute". nextUrl sobra quando passou de maxPages.
export async function fetchShopifyDisputes(domain: string, token: string, maxPages: number) {
  const disputes: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/disputes.json?limit=250`;
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    // 403 = app sem o escopo read_shopify_payments_disputes; 404 = sem
    // Shopify Payments. Avisa no sino (antes era só um console.warn).
    if (await handleShopifyAccess(res, domain, "disputes")) return { disputes: [], nextUrl: "" };
    if (!res.ok) throw new Error(`Shopify disputes ${res.status}`);
    const json: any = await res.json();
    disputes.push(...(json.disputes ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? "";
  }
  return { disputes, nextUrl: url };
}

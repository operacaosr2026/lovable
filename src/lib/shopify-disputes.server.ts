import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshEstornoDisputeCounts } from "@/lib/estorno-daily.server";
import { tracked } from "@/lib/system-errors.server";
import { fetchWithRetry } from "@/lib/http";
import { handleShopifyAccess } from "@/lib/shopify-access.server";
import { disputeStatusesBefore, notifyDisputeResults } from "@/lib/dispute-results.server";
import { isoDateUS } from "@/lib/timezone";

const FINAL_STATUS = new Set(["won", "lost"]);

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
    // Dia de NY (como o resto do sistema) — o slice pegava o dia em UTC.
    initiated_at: d.initiated_at ? isoDateUS(d.initiated_at) : String(d.initiated_at).slice(0, 10),
    finalized_on: d.finalized_on ? String(d.finalized_on).slice(0, 10) : null,
    evidence_due_by: d.evidence_due_by ?? null,
  }));
  if (!rows.length) return;
  const before = await disputeStatusesBefore(shopId, rows.map((r) => r.shopify_dispute_id));
  // A Shopify não garante a ordem dos webhooks: um disputes/update antigo
  // chegando depois do resultado voltava a disputa ganha/perdida pra aberta
  // (até o sync completo). Resultado final não regride.
  const finalIds = rows.filter((r) => FINAL_STATUS.has(before.get(r.shopify_dispute_id) ?? "") && !FINAL_STATUS.has(r.status ?? ""))
    .map((r) => r.shopify_dispute_id);
  if (finalIds.length) {
    const { data: kept } = await supabaseAdmin.from("shop_order_disputes").select("shopify_dispute_id,status,finalized_on")
      .eq("shop_id", shopId).in("shopify_dispute_id", finalIds);
    const keptBy = new Map((kept ?? []).map((k: any) => [k.shopify_dispute_id as string, k]));
    for (const r of rows) {
      const k: any = keptBy.get(r.shopify_dispute_id);
      if (k) { r.status = k.status; r.finalized_on = k.finalized_on; }
    }
  }
  const { error } = await supabaseAdmin.from("shop_order_disputes")
    .upsert(rows as any[], { onConflict: "shop_id,shopify_dispute_id" });
  if (error) throw new Error(error.message);
  // Ganhou/perdeu agora → aviso no sino (não pode derrubar o sync).
  await tracked(userId, `dispute_result:${shopId}`, "Aviso de chargeback ganho/perdido falhou",
    () => notifyDisputeResults(userId, shopId, before, rows));
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

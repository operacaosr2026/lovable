import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { RECOVERY_ORDER_TAG } from "@/lib/recovery-order";
import type { AlertRow } from "@/lib/chargeback-alerts.shared";

// Recuperação dos Alertas pela Shopify, sem nada por fora:
//  1. No 1º e-mail que usa {link_pagamento}, cria um pedido rascunho na loja do
//     pedido original: item avulso "Payment for order #X" no valor reembolsado,
//     sem envio e sem imposto, tag recuperacao-alerta. O link de pagamento
//     (invoiceUrl, checkout da própria loja) vai no e-mail.
//  2. A cada rodada, confere se o rascunho virou pedido pago. Pago → Recuperado
//     (valor e data do pagamento), sequência para, e o pedido é dado como
//     atendido na Shopify sem rastreio (não fica pendente de envio).
// O pedido pago não entra em shop_orders (recovery-order.ts); o valor abate o
// reembolso no lucro (getGroupRefundsAndChargebacks).

const API = "2026-07";

async function shopCreds(shopId: string) {
  const { data: set } = await supabaseAdmin.from("shop_order_settings").select("shopify_store_id").eq("shop_id", shopId).maybeSingle();
  if (!set?.shopify_store_id) throw new Error("Loja sem Shopify ligada");
  const { data: store } = await supabaseAdmin.from("shopify_stores").select("shop_domain,access_token").eq("id", set.shopify_store_id).maybeSingle();
  if (!store?.shop_domain || !store.access_token) throw new Error("Loja sem token da Shopify");
  return { domain: store.shop_domain as string, token: store.access_token as string };
}

async function gql<T = any>(shopId: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const { domain, token } = await shopCreds(shopId);
  const res = await fetchWithRetry(`https://${domain}/admin/api/${API}/graphql.json`, {
    method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || body?.errors?.length) {
    const msg = body?.errors?.[0]?.message ?? body?.errors ?? `HTTP ${res.status}`;
    // Sem a permissão: a loja ainda não foi reautorizada com os escopos novos.
    throw new Error(/access denied|scope/i.test(String(msg)) ? "Loja sem permissão na Shopify — reautorize a loja" : String(msg).slice(0, 200));
  }
  return body.data as T;
}

// Também usado pra mandar o status do rastreio pra Shopify (shopify-fulfillment-status.server.ts).
export { gql as shopifyGql };

const key = (r: AlertRow) => ({ shop_id: r.shopId, order_external_id: r.orderExternalId });

// Link de pagamento do pedido: reaproveita o rascunho já criado ou cria um.
export async function ensureRecoveryLink(ownerId: string, r: AlertRow): Promise<string> {
  if (r.recoveryInvoiceUrl) return r.recoveryInvoiceUrl;
  const order = r.orderNumber ?? `#${r.orderExternalId}`;
  const data = await gql(r.shopId, `mutation RecoveryDraft($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } }
  }`, {
    input: {
      email: r.customerEmail,
      lineItems: [{ title: `Payment for order ${order}`, originalUnitPrice: r.refundedAmount.toFixed(2), quantity: 1, requiresShipping: false, taxable: false }],
      tags: [RECOVERY_ORDER_TAG],
      note: `Cobrança do pedido ${order}, reembolsado por alerta ${r.network}. Criado pelo SRX Growth (Chargebacks > Alertas).`,
      customAttributes: [{ key: "Original order", value: order }],
    },
  });
  const out = data?.draftOrderCreate;
  if (out?.userErrors?.length) throw new Error(out.userErrors.map((e: any) => e.message).join("; ").slice(0, 200));
  const d = out?.draftOrder;
  if (!d?.invoiceUrl) throw new Error("A Shopify não devolveu o link de pagamento");
  await supabaseAdmin.from("chargeback_alert_followups").upsert(
    { ...key(r), user_id: ownerId, status: r.status }, { onConflict: "shop_id,order_external_id", ignoreDuplicates: true });
  await supabaseAdmin.from("chargeback_alert_followups")
    .update({ recovery_draft_id: d.id, recovery_invoice_url: d.invoiceUrl, recovery_error: null }).match(key(r));
  r.recoveryDraftId = d.id;
  r.recoveryInvoiceUrl = d.invoiceUrl;
  return d.invoiceUrl;
}

// Dá o pedido de cobrança como atendido (sem rastreio, sem avisar o cliente).
async function fulfillRecoveryOrder(shopId: string, orderId: string) {
  const data = await gql(shopId, `query RecoveryFulfillmentOrders($id: ID!) {
    order(id: $id) { displayFulfillmentStatus fulfillmentOrders(first: 5) { nodes { id status } } }
  }`, { id: orderId });
  const open = ((data?.order?.fulfillmentOrders?.nodes ?? []) as any[]).filter((f) => f.status === "OPEN" || f.status === "IN_PROGRESS");
  if (!open.length) return;
  const res = await gql(shopId, `mutation RecoveryFulfill($f: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { field message } }
  }`, { f: { lineItemsByFulfillmentOrder: open.map((f) => ({ fulfillmentOrderId: f.id })), notifyCustomer: false } });
  const errs = res?.fulfillmentCreate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e: any) => e.message).join("; ").slice(0, 200));
}

// Confere os rascunhos em aberto: pagou → Recuperado + atendido na Shopify.
// Também tenta de novo o "atendido" que falhou antes (ex.: loja sem a permissão).
export async function checkRecoveryPayments(ownerId: string, rows: AlertRow[]) {
  let paid = 0;
  for (const r of rows) {
    if (!r.recoveryDraftId) continue;
    try {
      if (!r.recoveryOrderId) {
        const data = await gql(r.shopId, `query RecoveryDraftStatus($id: ID!) {
          draftOrder(id: $id) { status invoiceUrl order { id name createdAt displayFinancialStatus totalPriceSet { shopMoney { amount } } } }
        }`, { id: r.recoveryDraftId });
        const o = data?.draftOrder?.order;
        if (!o || o.displayFinancialStatus !== "PAID") continue;
        const amount = Number(o.totalPriceSet?.shopMoney?.amount ?? r.refundedAmount);
        await supabaseAdmin.from("chargeback_alert_followups").update({
          status: "recuperado", recovered_amount: amount, recovered_at: o.createdAt, recovered_step: r.dunningStep,
          recovery_order_id: o.id, recovery_order_name: o.name, recovery_paid_at: o.createdAt,
          dunning_stop_reason: "pago", recovery_error: null, updated_at: new Date().toISOString(),
        }).match(key(r));
        Object.assign(r, { status: "recuperado", recoveredAmount: amount, recoveryOrderId: o.id, recoveryOrderName: o.name, dunningStopReason: "pago" });
        paid++;
      }
      if (r.recoveryOrderId && !r.recoveryFulfilled) {
        await fulfillRecoveryOrder(r.shopId, r.recoveryOrderId);
        await supabaseAdmin.from("chargeback_alert_followups").update({ recovery_fulfilled: true, recovery_error: null }).match(key(r));
        r.recoveryFulfilled = true;
      }
    } catch (e: any) {
      await supabaseAdmin.from("chargeback_alert_followups").update({ recovery_error: String(e?.message ?? e).slice(0, 200) }).match(key(r));
    }
  }
  return paid;
}

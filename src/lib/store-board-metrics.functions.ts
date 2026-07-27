import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import {
  getShopifyCreds, fetchShopifyPayouts, fetchShopifyPaymentsBalance,
} from "@/lib/shop-orders.functions";

const StoreIdInput = z.object({ shopify_store_id: z.string().uuid() });

// Feature "Em Hold": saldo do Shopify Payments ainda não repassado para a conta bancária.
export const getStoreHoldBalance = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { domain, token } = await getShopifyCreds(context.supabase, context.ownerId, data.shopify_store_id);
    const balance = await fetchShopifyPaymentsBalance(domain, token);
    return { amount: balance?.amount ?? 0, currency: balance?.currency ?? null };
  });

function previousWeekRange() {
  const now = new Date();
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
  const prevMonday = new Date(thisMonday);
  prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
  return { fromISO: prevMonday.toISOString(), toISO: thisMonday.toISOString() };
}

async function fetchShopifyOrdersCountRange(domain: string, token: string, fromISO: string, toISO: string) {
  const url = `https://${domain}/admin/api/2024-10/orders/count.json?financial_status=paid&status=any` +
    `&created_at_min=${encodeURIComponent(fromISO)}&created_at_max=${encodeURIComponent(toISO)}`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return Number(json.count ?? 0);
}

// Feature "Média de pedidos diários": pedidos pagos da semana anterior (segunda a domingo) / 7.
export const getStoreAvgDailyOrders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { domain, token } = await getShopifyCreds(context.supabase, context.ownerId, data.shopify_store_id);
    const { fromISO, toISO } = previousWeekRange();
    const totalOrders = await fetchShopifyOrdersCountRange(domain, token, fromISO, toISO);
    return { avgPerDay: totalOrders / 7, totalOrders };
  });

async function fetchShopifyBalanceTransactionsForPayout(domain: string, token: string, payoutId: string | number) {
  const url = `https://${domain}/admin/api/2024-10/shopify_payments/balance/transactions.json?payout_id=${payoutId}&limit=250`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) return [];
    throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  }
  const json: any = await res.json();
  return json.transactions ?? [];
}

// Feature "Payouts Time": média de dias entre a venda e o depósito, com base nos últimos 3 payouts agendados.
export const getStorePayoutTime = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const { domain, token } = await getShopifyCreds(context.supabase, context.ownerId, data.shopify_store_id);
    const since = new Date(); since.setUTCDate(since.getUTCDate() - 120);
    const payouts = await fetchShopifyPayouts(domain, token, since.toISOString());
    if (!payouts.length) return { avgDays: null };

    const last3 = [...payouts]
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3);

    const days: number[] = [];
    for (const p of last3 as any[]) {
      const txns = await fetchShopifyBalanceTransactionsForPayout(domain, token, p.id);
      for (const t of txns) {
        if (t.type !== "charge") continue;
        const diff = (new Date(`${p.date}T00:00:00Z`).getTime() - new Date(t.processed_at).getTime()) / 86400_000;
        if (diff >= 0) days.push(diff);
      }
    }
    return { avgDays: days.length ? days.reduce((s, d) => s + d, 0) / days.length : null };
  });

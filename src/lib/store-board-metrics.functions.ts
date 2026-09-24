import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { getStoreBalances } from "@/lib/shop-orders.functions";
import { getStoreBoardMetrics } from "@/lib/store-metrics.server";

const StoreIdInput = z.object({ shopify_store_id: z.string().uuid() });

// Badges do Banco de Lojas. Os números vêm guardados em shopify_stores
// (store-metrics.server.ts): saldo atualizado de 10 em 10 min / 1x por dia,
// pedidos/dia e dias até payout 1x por dia. Antes cada badge chamava a
// Shopify a cada abertura — o de payout, 1 chamada por repasse.

// Feature "Em Hold": saldo do Shopify Payments ainda não repassado para a conta bancária.
// Loja parada (Em Hold, Cemitério) sai do cron de 10 min, então aceita o valor do dia.
export const getStoreHoldBalance = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const balances = await getStoreBalances(context.ownerId, [data.shopify_store_id], 36 * 60 * 60_000);
    const b = balances.get(data.shopify_store_id);
    return { amount: b?.amount ?? 0, currency: b?.currency ?? null };
  });

// Feature "Média de pedidos diários": pedidos pagos dos últimos 7 dias corridos / 7.
export const getStoreAvgDailyOrders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const m = await getStoreBoardMetrics(context.ownerId, data.shopify_store_id);
    return { avgPerDay: m.avgPerDay, totalOrders: Math.round(m.avgPerDay * 7) };
  });

// Feature "Payouts Time": média de dias entre a venda e o depósito, com base nos últimos 3 payouts.
export const getStorePayoutTime = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => StoreIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const m = await getStoreBoardMetrics(context.ownerId, data.shopify_store_id);
    return { avgDays: m.payoutDays };
  });

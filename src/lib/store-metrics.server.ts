import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reportSystemError, clearSystemError } from "@/lib/system-errors.server";
import { handleShopifyAccess } from "@/lib/shopify-access.server";
import {
  getShopifyCreds, fetchShopifyPayouts, refreshStoreBalance,
} from "@/lib/shop-orders.functions";
import { fetchWithRetry } from "@/lib/http";
import { getPausedShopifyStores } from "@/lib/sync-pause.server";
import { payoutLagDays } from "@/lib/finance-rules";
import { isoDateUS } from "@/lib/timezone";

// Números da Shopify guardados em shopify_stores pra as telas só lerem, sem
// chamar a Shopify na abertura (ver *_store_cached_metrics.sql):
//  - saldo da Shopify Payments: cron de taxas (10 em 10 min) + 1x por dia;
//  - pedidos/dia e dias até payout do Banco de Lojas: 1x por dia (meia-noite NY).
// Se o valor guardado estiver faltando ou velho demais (cron parado), busca na
// Shopify na hora e grava — nunca mostra vazio nem um número de dias atrás.

const BOARD_MAX_AGE_MS = 36 * 60 * 60_000;

async function fetchShopifyOrdersCountRange(domain: string, token: string, fromISO: string, toISO: string) {
  const url = `https://${domain}/admin/api/2024-10/orders/count.json?financial_status=paid&status=any` +
    `&created_at_min=${encodeURIComponent(fromISO)}&created_at_max=${encodeURIComponent(toISO)}`;
  const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return Number(json.count ?? 0);
}

async function fetchShopifyBalanceTransactionsForPayout(domain: string, token: string, payoutId: string | number) {
  const url = `https://${domain}/admin/api/2024-10/shopify_payments/balance/transactions.json?payout_id=${payoutId}&limit=250`;
  const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
  if (await handleShopifyAccess(res, domain, "balance_transactions")) return [];
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return json.transactions ?? [];
}

// Mesmos cálculos que o Banco de Lojas fazia ao vivo:
//  - pedidos/dia: pedidos pagos dos últimos 7 dias corridos / 7;
//  - dias até payout: dias da venda mais nova até o depósito, mediana dos últimos 5 payouts.
export async function computeStoreBoardMetrics(ownerId: string, storeId: string) {
  const { domain, token } = await getShopifyCreds(supabaseAdmin, ownerId, storeId);
  const toISO = new Date().toISOString();
  const fromISO = new Date(Date.now() - 7 * 86400_000).toISOString();
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 120);
  const [totalOrders, payouts] = await Promise.all([
    fetchShopifyOrdersCountRange(domain, token, fromISO, toISO),
    fetchShopifyPayouts(domain, token, since.toISOString()),
  ]);

  // Prazo pela venda mais nova de cada um dos últimos 5 depósitos (payoutLagDays).
  let payoutDays: number | null = null;
  if (payouts.length) {
    const last = [...payouts]
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);
    const items = await Promise.all((last as any[]).map(async (p) => {
      const txns = await fetchShopifyBalanceTransactionsForPayout(domain, token, p.id);
      return { payoutDate: p.date as string, saleDays: txns.filter((t: any) => t.type === "charge").map((t: any) => isoDateUS(t.processed_at)) };
    }));
    payoutDays = payoutLagDays(items);
  }

  const avgPerDay = totalOrders / 7;
  await supabaseAdmin.from("shopify_stores")
    .update({ board_avg_orders: avgPerDay, board_payout_days: payoutDays, board_metrics_at: new Date().toISOString() })
    .eq("id", storeId).eq("user_id", ownerId);
  return { avgPerDay, payoutDays };
}

export async function getStoreBoardMetrics(ownerId: string, storeId: string) {
  const { data: r } = await supabaseAdmin.from("shopify_stores")
    .select("board_avg_orders,board_payout_days,board_metrics_at")
    .eq("id", storeId).eq("user_id", ownerId).maybeSingle();
  const stored = {
    avgPerDay: r?.board_avg_orders != null ? Number(r.board_avg_orders) : 0,
    payoutDays: r?.board_payout_days != null ? Number(r.board_payout_days) : null,
  };
  if (r?.board_metrics_at && Date.now() - new Date(r.board_metrics_at).getTime() < BOARD_MAX_AGE_MS) return stored;
  // Loja pausada fica no último valor, sem chamar a Shopify.
  if ((await getPausedShopifyStores(ownerId)).has(storeId)) return stored;
  return computeStoreBoardMetrics(ownerId, storeId);
}

// 1x por dia (junto com o estorno, meia-noite NY): todas as lojas Shopify.
// Pausadas (coluna do Banco de Lojas com "Pausar sincronização"): só o saldo, e
// só se a coluna mostra o badge "Em Hold" (ex.: Hold); as outras (ex.:
// Cemitério) ficam no último valor e o aviso antigo delas sai do sino.
export async function runStoreMetricsDaily() {
  const { data: stores } = await supabaseAdmin.from("shopify_stores").select("id,user_id").not("access_token", "is", null);
  const paused = await getPausedShopifyStores();
  let ok = 0;
  const list: any[] = [];
  for (const s of (stores ?? []) as any[]) {
    if (paused.has(s.id) && !paused.get(s.id)!.hold) await clearSystemError(s.user_id, `job:store_metrics:${s.id}`);
    else list.push(s);
  }
  for (let i = 0; i < list.length; i += 4) {
    await Promise.all(list.slice(i, i + 4).map(async (s) => {
      try {
        await Promise.all([
          refreshStoreBalance(s.user_id, s.id),
          paused.has(s.id) ? null : computeStoreBoardMetrics(s.user_id, s.id),
        ]);
        ok++;
        await clearSystemError(s.user_id, `job:store_metrics:${s.id}`);
      } catch (e) {
        console.error("store-metrics-daily fail", s.id, e);
        await reportSystemError(s.user_id, `job:store_metrics:${s.id}`, "Números do Banco de Lojas não atualizaram (saldo / pedidos por dia)", e);
      }
    }));
  }
  return { stores: list.length, ok };
}

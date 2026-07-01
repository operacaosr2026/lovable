import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronApiKey } from "@/lib/cron-auth";

const PROCESSING_DELAY_DAYS = 7;

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}

async function fetchOrders(domain: string, token: string, sinceISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(sinceISO)}`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Shopify ${res.status}`);
    const json: any = await res.json();
    out.push(...(json.orders ?? []));
    const link = res.headers.get("link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

async function unitCostFor(shopId: string, userId: string, date: string, fallback: number) {
  const { data } = await supabaseAdmin.from("shop_product_cost_history")
    .select("unit_cost,valid_from,valid_to")
    .eq("user_id", userId).eq("shop_id", shopId);
  for (const r of (data ?? []).sort((a: any, b: any) => (b.valid_from ?? "").localeCompare(a.valid_from ?? ""))) {
    const okFrom = !r.valid_from || r.valid_from <= date;
    const okTo = !r.valid_to || r.valid_to >= date;
    if (okFrom && okTo) return Number(r.unit_cost);
  }
  return Number(fallback ?? 0);
}

const PAYOUT_CATEGORY = "Depósito Shopify";
const PAYOUT_STATUS_LABEL: Record<string, string> = {
  paid: "depositado",
  in_transit: "em trânsito",
  scheduled: "agendado",
  pending: "previsto",
};

async function fetchPayouts(domain: string, token: string, sinceISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/payouts.json?limit=250&date_min=${encodeURIComponent(sinceISO.slice(0, 10))}`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify payouts ${res.status}`);
    }
    const json: any = await res.json();
    out.push(...(json.payouts ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

async function fetchBalanceTransactions(domain: string, token: string, maxPages: number) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/balance/transactions.json?limit=250`;
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify balance transactions ${res.status}`);
    }
    const json: any = await res.json();
    out.push(...(json.transactions ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

// Tempo médio de repasse: para cada venda já incluída em um payout, mede os dias
// entre o processamento da venda e a data do depósito. Calculado 1x/dia aqui (e não
// na hora, pelo front) porque chamar a API de balanço da Shopify é lento.
async function updatePayoutLag(shopId: string, userId: string, domain: string, token: string) {
  const transactions = await fetchBalanceTransactions(domain, token, 10);
  const charges = transactions.filter((t: any) => t.type === "charge" && t.payout_id != null);
  if (!charges.length) {
    await supabaseAdmin.from("shop_order_settings")
      .update({ payout_lag_avg_days: null, payout_lag_sample_size: 0 })
      .eq("user_id", userId).eq("shop_id", shopId);
    return;
  }

  const since = new Date(); since.setUTCDate(since.getUTCDate() - 90);
  const payouts = await fetchPayouts(domain, token, since.toISOString());
  const payoutDateById = new Map(payouts.map((p: any) => [String(p.id), p.date as string]));

  const days: number[] = [];
  for (const t of charges) {
    const payoutDate = payoutDateById.get(String(t.payout_id));
    if (!payoutDate) continue;
    const diff = (new Date(`${payoutDate}T00:00:00Z`).getTime() - new Date(t.processed_at).getTime()) / 86400_000;
    if (diff >= 0) days.push(diff);
  }

  await supabaseAdmin.from("shop_order_settings").update({
    payout_lag_avg_days: days.length ? days.reduce((s, d) => s + d, 0) / days.length : null,
    payout_lag_sample_size: days.length,
  }).eq("user_id", userId).eq("shop_id", shopId);
}

async function syncPayoutsForShop(shopId: string, userId: string, domain: string, token: string) {
  const payouts = await fetchPayouts(domain, token, "2026-06-15T00:00:00Z");
  const relevant = payouts.filter((p: any) => p.id != null && ["paid", "in_transit", "scheduled", "pending"].includes(p.status));
  if (!relevant.length) return 0;

  const { data: existing } = await supabaseAdmin.from("shop_cash_entries")
    .select("id,shopify_payout_id")
    .eq("user_id", userId).eq("shop_id", shopId)
    .in("shopify_payout_id", relevant.map((p: any) => String(p.id)));
  const existingById = new Map((existing ?? []).map((r: any) => [r.shopify_payout_id, r.id]));

  const toInsert = relevant.filter((p: any) => !existingById.has(String(p.id))).map((p: any) => ({
    user_id: userId, shop_id: shopId,
    kind: "income" as const,
    amount: Number(p.amount ?? 0),
    date: p.date,
    category: PAYOUT_CATEGORY,
    description: `Payout Shopify · ${PAYOUT_STATUS_LABEL[p.status] ?? p.status}`,
    source: "shopify_sync",
    shopify_payout_id: String(p.id),
  }));
  if (toInsert.length) await supabaseAdmin.from("shop_cash_entries").insert(toInsert);

  for (const p of relevant) {
    const id = existingById.get(String(p.id));
    if (!id) continue;
    await supabaseAdmin.from("shop_cash_entries").update({
      amount: Number(p.amount ?? 0),
      date: p.date,
      description: `Payout Shopify · ${PAYOUT_STATUS_LABEL[p.status] ?? p.status}`,
    }).eq("id", id);
  }

  return relevant.length;
}

async function syncRefundsAndChargebacks(shopId: string, userId: string, domain: string, token: string) {
  const transactions = await fetchBalanceTransactions(domain, token, 10);
  const relevant = transactions.filter((t: any) =>
    (t.type === "refund" || t.type === "dispute") && t.amount != null && t.id != null
  );
  if (!relevant.length) return;

  const rows = relevant.map((t: any) => ({
    user_id: userId,
    shop_id: shopId,
    kind: "expense" as const,
    amount: Math.abs(Number(t.amount)),
    date: String(t.processed_at).slice(0, 10),
    category: t.type === "refund" ? "Reembolso" : "Chargeback",
    description: t.type === "refund" ? "Reembolso Shopify" : "Chargeback Shopify",
    source: "shopify_auto_sync",
    shopify_transaction_id: String(t.id),
  }));

  await supabaseAdmin.from("shop_cash_entries")
    .upsert(rows as any[], { onConflict: "shop_id,shopify_transaction_id" });
}

async function syncPendingTransactionsForShop(shopId: string, userId: string, domain: string, token: string, lagDays: number) {
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 14);
  const payouts = await fetchPayouts(domain, token, since.toISOString());
  const payoutDateById = new Map(payouts.map((p: any) => [String(p.id), p.date as string]));

  const transactions = await fetchBalanceTransactions(domain, token, 3);
  const pendingTx = transactions.filter((t: any) =>
    t.payout_status === "pending" &&
    (t.payout_id == null || !payoutDateById.has(String(t.payout_id)))
  );

  await supabaseAdmin.from("shop_cash_entries").delete()
    .eq("user_id", userId).eq("shop_id", shopId).eq("source", "shopify_pending_sync");

  if (!pendingTx.length) return 0;

  const byDate = new Map<string, number>();
  for (const t of pendingTx) {
    const realDate = t.payout_id ? payoutDateById.get(String(t.payout_id)) : null;
    let key: string;
    if (realDate) {
      key = realDate;
    } else {
      const d = new Date(t.processed_at);
      d.setUTCDate(d.getUTCDate() + lagDays);
      key = d.toISOString().slice(0, 10);
    }
    byDate.set(key, (byDate.get(key) ?? 0) + Number(t.net ?? 0));
  }
  const provisionals = Array.from(byDate.entries()).map(([date, amount]) => ({
    user_id: userId, shop_id: shopId,
    kind: "income" as const,
    amount, date,
    category: PAYOUT_CATEGORY,
    description: `Payout Shopify · previsto`,
    source: "shopify_pending_sync",
  }));
  await supabaseAdmin.from("shop_cash_entries").insert(provisionals);
  return pendingTx.length;
}

// Sincronização leve: só busca pedidos novos e grava em shop_orders (sem
// payouts/payout_lag/refunds, que são pesados e já rodam separadamente).
async function syncOrdersOnlyForShop(s: any, today: string) {
  if (!s.shopify_store_id) return;
  const cutoff: string | null = s.cashflow_start_date ?? null;
  const sinceDate = cutoff ?? addDays(today, -30);
  const { data: store } = await supabaseAdmin.from("shopify_stores").select("*")
    .eq("id", s.shopify_store_id).maybeSingle();
  if (!store?.access_token || !store?.shop_domain) return;
  try {
    const orders = await fetchOrders(store.shop_domain, store.access_token, `${sinceDate}T00:00:00Z`);
    if (orders.length) {
      const rows = orders.map((o: any) => ({
        user_id: s.user_id, shop_id: s.shop_id, source: "shopify",
        external_id: String(o.id), order_number: o.name ?? null,
        created_at_shopify: o.created_at,
        order_date: (o.created_at as string).slice(0, 10),
        items_count: (o.line_items ?? []).reduce((x: number, li: any) => x + Number(li.quantity ?? 0), 0),
        revenue: Number(o.total_price ?? 0), currency: o.currency ?? null, raw: o,
        shopify_financial_status: o.financial_status ?? null,
      }));
      await supabaseAdmin.from("shop_orders").upsert(rows, { onConflict: "shop_id,source,external_id" });
    }
  } catch (e: any) {
    console.error("orders-only sync fail", s.shop_id, e);
  }
}

async function processShopPayoutsOnly(s: any) {
  if (!s.shopify_store_id) return;
  const { data: store } = await supabaseAdmin.from("shopify_stores").select("*")
    .eq("id", s.shopify_store_id).maybeSingle();
  if (!store?.access_token || !store?.shop_domain) return;
  const lagDays = s.payout_lag_days != null
    ? Number(s.payout_lag_days)
    : s.payout_lag_avg_days != null ? Math.round(Number(s.payout_lag_avg_days)) : 7;
  await syncPayoutsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token);
  await syncPendingTransactionsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token, lagDays);
}

async function processShop(s: any, today: string) {
  const cutoff: string | null = s.cashflow_start_date ?? null;
  const sinceDate = cutoff ?? addDays(today, -30);

  // sync orders from the configured cashflow cutoff date (fallback: last 30 days)
  if (s.shopify_store_id) {
    const { data: store } = await supabaseAdmin.from("shopify_stores").select("*")
      .eq("id", s.shopify_store_id).maybeSingle();
    if (store?.access_token && store?.shop_domain) {
      try {
        const orders = await fetchOrders(store.shop_domain, store.access_token, `${sinceDate}T00:00:00Z`);
        if (orders.length) {
          const rows = orders.map((o: any) => ({
            user_id: s.user_id, shop_id: s.shop_id, source: "shopify",
            external_id: String(o.id), order_number: o.name ?? null,
            created_at_shopify: o.created_at,
            order_date: (o.created_at as string).slice(0, 10),
            items_count: (o.line_items ?? []).reduce((x: number, li: any) => x + Number(li.quantity ?? 0), 0),
            revenue: Number(o.total_price ?? 0), currency: o.currency ?? null, raw: o,
            shopify_financial_status: o.financial_status ?? null,
          }));
          await supabaseAdmin.from("shop_orders").upsert(rows, { onConflict: "shop_id,source,external_id" });
        }
        await syncPayoutsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token);
        await updatePayoutLag(s.shop_id, s.user_id, store.shop_domain, store.access_token);
        await syncRefundsAndChargebacks(s.shop_id, s.user_id, store.shop_domain, store.access_token);
        const lagDays = s.payout_lag_days != null
          ? Number(s.payout_lag_days)
          : s.payout_lag_avg_days != null ? Math.round(Number(s.payout_lag_avg_days)) : 7;
        await syncPendingTransactionsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token, lagDays);
        await supabaseAdmin.from("shopify_stores").update({
          last_sync_at: new Date().toISOString(), last_sync_status: "ok", last_sync_error: null,
        }).eq("id", s.shopify_store_id);
      } catch (e: any) {
        await supabaseAdmin.from("shopify_stores").update({
          last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: e.message?.slice(0, 500),
        }).eq("id", s.shopify_store_id);
      }
    }
  }

  // recompute today's processing
  const orderDate = addDays(today, -PROCESSING_DELAY_DAYS);
  const { data: existing } = await supabaseAdmin.from("shop_cash_entries").select("*")
    .eq("user_id", s.user_id).eq("shop_id", s.shop_id)
    .eq("auto_kind", "order_cost").eq("auto_ref_date", orderDate).maybeSingle();
  if (existing && existing.source === "manual_override") return;

  if (cutoff && orderDate < cutoff) {
    if (existing) await supabaseAdmin.from("shop_cash_entries").delete().eq("id", existing.id);
    return;
  }

  const { data: orders } = await supabaseAdmin.from("shop_orders").select("items_count")
    .eq("user_id", s.user_id).eq("shop_id", s.shop_id).eq("order_date", orderDate);
  const items = (orders ?? []).reduce((x: number, o: any) => x + Number(o.items_count ?? 0), 0);
  const unit = await unitCostFor(s.shop_id, s.user_id, orderDate, s.default_unit_cost);
  const amount = items * unit;

  // ensure category
  const { data: cat } = await supabaseAdmin.from("shop_cash_categories").select("id")
    .eq("user_id", s.user_id).eq("shop_id", s.shop_id).eq("kind", "expense").eq("name", "Custo de pedidos").maybeSingle();
  if (!cat) {
    await supabaseAdmin.from("shop_cash_categories").insert({
      user_id: s.user_id, shop_id: s.shop_id, kind: "expense", name: "Custo de pedidos", position: 999,
    });
  }

  if (existing) {
    await supabaseAdmin.from("shop_cash_entries").update({
      amount, date: today, description: `${items} itens × ${unit}`,
    }).eq("id", existing.id);
  } else if (amount > 0) {
    await supabaseAdmin.from("shop_cash_entries").insert({
      user_id: s.user_id, shop_id: s.shop_id,
      kind: "expense", amount, date: today,
      category: "Custo de pedidos",
      description: `${items} itens × ${unit}`,
      source: "auto", auto_kind: "order_cost", auto_ref_date: orderDate,
    });
  }
}

export const Route = createFileRoute("/api/public/hooks/sync-shop-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        const today = isoDate(new Date());
        const body = await request.json().catch(() => ({})) as any;
        const payoutsOnly = Boolean(body?.payouts_only);
        const ordersOnly  = Boolean(body?.orders_only);
        const { data: settings, error } = await supabaseAdmin
          .from("shop_order_settings").select("*").eq("automation_enabled", true);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        let processed = 0;
        for (const s of settings ?? []) {
          try {
            if (payoutsOnly) await processShopPayoutsOnly(s);
            else if (ordersOnly) await syncOrdersOnlyForShop(s, today);
            else await processShop(s, today);
            processed++;
          } catch (e) { console.error("shop fail", s.shop_id, e); }
        }
        return new Response(JSON.stringify({ processed, today, payoutsOnly, ordersOnly }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});

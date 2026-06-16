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

async function processShop(s: any, today: string) {
  // sync last 30 days
  if (s.shopify_store_id) {
    const { data: store } = await supabaseAdmin.from("shopify_stores").select("*")
      .eq("id", s.shopify_store_id).maybeSingle();
    if (store?.access_token && store?.shop_domain) {
      const since = new Date(); since.setUTCDate(since.getUTCDate() - 30);
      try {
        const orders = await fetchOrders(store.shop_domain, store.access_token, since.toISOString());
        if (orders.length) {
          const rows = orders.map((o: any) => ({
            user_id: s.user_id, shop_id: s.shop_id, source: "shopify",
            external_id: String(o.id), order_number: o.name ?? null,
            created_at_shopify: o.created_at,
            order_date: (o.created_at as string).slice(0, 10),
            items_count: (o.line_items ?? []).reduce((x: number, li: any) => x + Number(li.quantity ?? 0), 0),
            revenue: Number(o.total_price ?? 0), currency: o.currency ?? null, raw: o,
          }));
          await supabaseAdmin.from("shop_orders").upsert(rows, { onConflict: "shop_id,source,external_id" });
        }
        await syncPayoutsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token);
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
        const { data: settings, error } = await supabaseAdmin
          .from("shop_order_settings").select("*").eq("automation_enabled", true);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        let processed = 0;
        for (const s of settings ?? []) {
          try { await processShop(s, today); processed++; } catch (e) { console.error("shop fail", s.shop_id, e); }
        }
        return new Response(JSON.stringify({ processed, today }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});

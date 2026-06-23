import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runTrack123Sync } from "@/lib/track123-sync.server";

// Fetches recently-fulfilled Shopify orders and upserts them into shop_orders so that
// the track123 backfill can find their tracking numbers (even if the regular Shopify
// sync hasn't run yet or ran before the order was fulfilled).
async function refreshShopifyFulfillments(shopId: string, userId: string) {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const sinceISO = since.toISOString();

  // New system: shop_group_stores → shopify_connections
  const { data: groupStores } = await supabaseAdmin
    .from("shop_group_stores")
    .select("conn:shopify_connections!inner(shop_domain, access_token)")
    .eq("shop_id", shopId)
    .order("position");

  let connections: Array<{ domain: string; token: string }> = (groupStores ?? []).map((r: any) => ({
    domain: r.conn.shop_domain as string,
    token: r.conn.access_token as string,
  }));

  // Legacy fallback: shopify_stores via shop_order_settings
  if (!connections.length) {
    const { data: settings } = await supabaseAdmin
      .from("shop_order_settings")
      .select("shopify_store_id")
      .eq("shop_id", shopId).eq("user_id", userId).maybeSingle();
    if (settings?.shopify_store_id) {
      const { data: store } = await supabaseAdmin
        .from("shopify_stores")
        .select("shop_domain, access_token")
        .eq("id", settings.shopify_store_id).maybeSingle();
      if (store?.access_token) {
        connections = [{ domain: store.shop_domain as string, token: store.access_token as string }];
      }
    }
  }

  if (!connections.length) return;

  for (const conn of connections) {
    try {
      // Fetch orders updated recently that have been shipped — covers fulfillments added
      // to Shopify after the last regular sync ran.
      let url = `https://${conn.domain}/admin/api/2024-10/orders.json?status=any&fulfillment_status=shipped&limit=250&updated_at_min=${encodeURIComponent(sinceISO)}`;
      const orders: any[] = [];
      for (let i = 0; i < 10 && url; i++) {
        const res = await fetch(url, { headers: { "X-Shopify-Access-Token": conn.token } });
        if (!res.ok) break;
        const json: any = await res.json();
        orders.push(...(json.orders ?? []));
        const link = res.headers.get("link") || "";
        const m = link.match(/<([^>]+)>;\s*rel="next"/);
        url = m ? m[1] : "";
      }
      if (!orders.length) continue;

      const rows = orders.map((o: any) => ({
        user_id: userId, shop_id: shopId, source: "shopify",
        external_id: String(o.id), order_number: o.name ?? null,
        created_at_shopify: o.created_at,
        order_date: (o.created_at as string).slice(0, 10),
        items_count: (o.line_items ?? []).reduce((s: number, li: any) => s + Number(li.quantity ?? 0), 0),
        revenue: Number(o.total_price ?? 0), currency: o.currency ?? null, raw: o,
      }));
      await supabaseAdmin.from("shop_orders").upsert(rows, { onConflict: "shop_id,source,external_id" });
    } catch (e) {
      console.error("refreshShopifyFulfillments fail", shopId, conn.domain, e);
    }
  }
}

export const Route = createFileRoute("/api/public/hooks/sync-track123")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;

        const { data: integrations, error } = await supabaseAdmin
          .from("track123_integrations")
          .select("shop_id, api_key, user_id")
          .eq("enabled", true)
          .not("api_key", "is", null);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

        let processed = 0;
        for (const integ of integrations ?? []) {
          if (!integ.api_key) continue;
          try {
            await refreshShopifyFulfillments(integ.shop_id, integ.user_id);
            await runTrack123Sync(integ.shop_id, integ.api_key, supabaseAdmin);
            processed++;
          } catch (e) {
            console.error("track123 sync fail", integ.shop_id, e);
          }
        }
        return new Response(JSON.stringify({ processed }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const syncShopifyVisitors = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string; since_date: string }) =>
    z.object({
      shop_id:    z.string().uuid(),
      since_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: settings } = await context.supabase
      .from("shop_order_settings")
      .select("shopify_store_id")
      .eq("user_id", ownerId)
      .eq("shop_id", data.shop_id)
      .maybeSingle();

    if (!settings?.shopify_store_id) return { synced: 0, error: "no_shopify_store" };

    const { data: store } = await supabaseAdmin
      .from("shopify_stores")
      .select("shop_domain, access_token")
      .eq("id", settings.shopify_store_id)
      .eq("user_id", ownerId)
      .maybeSingle();

    if (!store?.access_token) return { synced: 0, error: "no_token" };

    const { shop_domain, access_token } = store as { shop_domain: string; access_token: string };
    const today = new Date().toISOString().slice(0, 10);

    const gql = `{
      shopifyqlQuery(query: "FROM sessions SINCE ${data.since_date} UNTIL ${today} DIMENSIONS BY day METRICS sessions") {
        ... on TableData {
          rowData
          columns { name dataType }
        }
        ... on QueryRootError {
          parseError { code message }
        }
      }
    }`;

    let resp: Response;
    try {
      resp = await fetch(`https://${shop_domain}/admin/api/2024-01/graphql.json`, {
        method:  "POST",
        headers: {
          "X-Shopify-Access-Token": access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gql }),
      });
    } catch {
      return { synced: 0, error: "network_error" };
    }

    if (!resp.ok) return { synced: 0, error: `http_${resp.status}` };

    const json = await resp.json() as any;
    const queryResult = json?.data?.shopifyqlQuery;
    if (!queryResult || queryResult.parseError) return { synced: 0, error: "query_error" };

    const { columns, rowData } = queryResult;
    if (!columns || !rowData) return { synced: 0, error: "no_data" };

    const cols     = columns as { name: string }[];
    const dayIdx     = cols.findIndex((c) => c.name === "day");
    const sessionIdx = cols.findIndex((c) => c.name === "sessions");
    if (dayIdx < 0 || sessionIdx < 0) return { synced: 0, error: "unexpected_columns" };

    const rows = (rowData as any[][]).map((r) => ({
      shop_id:  data.shop_id,
      user_id:  ownerId,
      date:     String(r[dayIdx]).slice(0, 10),
      sessions: Number(r[sessionIdx]) || 0,
    }));

    if (rows.length === 0) return { synced: 0 };

    const { error } = await supabaseAdmin
      .from("shop_daily_analytics")
      .upsert(rows, { onConflict: "shop_id,date" });

    if (error) throw new Error(error.message);
    return { synced: rows.length };
  });

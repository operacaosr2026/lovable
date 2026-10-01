import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";

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

    // ShopifyQL novo (a sintaxe antiga "DIMENSIONS BY … METRICS" e os tipos
    // TableData/QueryRootError saíram da API): SHOW … TIMESERIES day, resposta em
    // tableData.rows como objetos { day, sessions } e erros em parseErrors.
    const gql = `{
      shopifyqlQuery(query: "FROM sessions SHOW sessions TIMESERIES day SINCE ${data.since_date} UNTIL ${today}") {
        parseErrors
        tableData { columns { name dataType } rows }
      }
    }`;

    let resp: Response;
    try {
      resp = await fetchWithRetry(`https://${shop_domain}/admin/api/2026-07/graphql.json`, {
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
    if (json?.errors?.length) return { synced: 0, error: "query_error" };
    const queryResult = json?.data?.shopifyqlQuery;
    if (!queryResult || queryResult.parseErrors?.length) return { synced: 0, error: "query_error" };

    const tableRows = queryResult.tableData?.rows as { day?: string; sessions?: string | number }[] | undefined;
    if (!tableRows) return { synced: 0, error: "no_data" };

    const rows = tableRows.filter((r) => r.day).map((r) => ({
      shop_id:  data.shop_id,
      user_id:  ownerId,
      date:     String(r.day).slice(0, 10),
      sessions: Number(r.sessions) || 0,
    }));

    if (rows.length === 0) return { synced: 0 };

    const { error } = await supabaseAdmin
      .from("shop_daily_analytics")
      .upsert(rows, { onConflict: "shop_id,date" });

    if (error) throw new Error(error.message);
    return { synced: rows.length };
  });

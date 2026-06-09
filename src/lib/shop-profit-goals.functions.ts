import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const upsertSchema = z.object({
  shop_id: z.string().uuid(),
  target_profit: z.number().min(0),
  start_date: z.string(),
  end_date: z.string(),
  sale_price: z.number().min(0),
  supplier_cost: z.number().min(0),
  fees_pct: z.number().min(0).max(100),
  max_cpa: z.number().min(0),
  total_sales: z.number().min(0),
  total_revenue: z.number().min(0),
  total_marketing: z.number().min(0),
  daily_budget: z.number().min(0),
  currency: z.string().min(1).max(8),
});

export const getShopProfitGoal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { shop_id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("shop_profit_goals")
      .select("*")
      .eq("shop_id", data.shop_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { goal: row };
  });

export const upsertShopProfitGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("shop_profit_goals")
      .upsert(
        { ...data, user_id: userId },
        { onConflict: "shop_id" }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { goal: row };
  });

export const getProfitGoalLiveStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { shop_id: string; start_date: string; end_date: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: settings } = await supabase
      .from("shop_order_settings")
      .select("shopify_store_id")
      .eq("user_id", userId)
      .eq("shop_id", data.shop_id)
      .maybeSingle();

    let storeInfo: { id: string; name: string | null; last_sync_at: string | null } | null = null;
    if (settings?.shopify_store_id) {
      const { data: st } = await supabase
        .from("shopify_stores")
        .select("id,name,last_sync_at")
        .eq("user_id", userId)
        .eq("id", settings.shopify_store_id)
        .maybeSingle();
      if (st) storeInfo = st as any;
    }

    const { data: rows, error } = await supabase
      .from("shop_orders")
      .select("items_count,revenue,currency")
      .eq("user_id", userId)
      .eq("shop_id", data.shop_id)
      .gte("order_date", data.start_date)
      .lte("order_date", data.end_date);
    if (error) throw new Error(error.message);

    let sales = 0;
    let revenue = 0;
    let currency: string | null = null;
    for (const r of rows ?? []) {
      sales += Number(r.items_count ?? 0);
      revenue += Number(r.revenue ?? 0);
      if (!currency && r.currency) currency = r.currency;
    }
    return {
      sales,
      revenue,
      orders_count: rows?.length ?? 0,
      currency,
      connected: Boolean(storeInfo),
      store: storeInfo,
    };
  });


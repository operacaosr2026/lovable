import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";

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
  .inputValidator((data: { shop_ids: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("shop_profit_goals")
      .select("*")
      .in("shop_id", data.shop_ids);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return { goal: null };
    if (rows.length === 1) return { goal: rows[0] };
    // Aggregate multiple goals: sum numeric targets, use first row's per-product fields
    const agg: any = { ...rows[0] };
    for (const key of ["target_profit", "total_revenue", "total_sales", "total_marketing", "daily_budget"] as const) {
      agg[key] = rows.reduce((s: number, r: any) => s + Number(r[key] ?? 0), 0);
    }
    return { goal: agg };
  });

export const upsertShopProfitGoal = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((input) => upsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;
    const { data: row, error } = await supabase
      .from("shop_profit_goals")
      .upsert(
        { ...data, user_id: ownerId },
        { onConflict: "shop_id" }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { goal: row };
  });

export const getProfitGoalLiveStats = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((data: { shop_ids: string[]; start_date: string; end_date: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, ownerId } = context;

    const { data: rows, error } = await supabase
      .from("shop_orders")
      .select("items_count,revenue,currency")
      .eq("user_id", ownerId)
      .in("shop_id", data.shop_ids)
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
      connected: true,
      store: null,
    };
  });


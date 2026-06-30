import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listLogisticsOrders = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) =>
    z.object({
      shop_ids: z.array(z.string().uuid()),
      from: z.string(),
      to: z.string(),
      delivery_status: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ context, data }: any) => {
    let q = supabaseAdmin
      .from("shop_orders")
      .select("id,order_number,order_date,shop_id,items_count,customer_name,carrier,tracking_code,tracking_url,delivery_status,shipped_at,delivered_at,problem_at")
      .eq("user_id", context.ownerId)
      .in("shop_id", data.shop_ids)
      .gte("order_date", data.from)
      .lte("order_date", data.to)
      .order("order_date", { ascending: false }) as any;
    if (data.delivery_status) q = q.eq("delivery_status", data.delivery_status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateOrderLogistics = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) =>
    z.object({
      order_id: z.string().uuid(),
      carrier: z.string().optional().nullable(),
      tracking_code: z.string().optional().nullable(),
      tracking_url: z.string().optional().nullable(),
      delivery_status: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ context, data }: any) => {
    const { order_id, ...patch } = data;
    const extra: Record<string, string> = {};
    if (patch.delivery_status === "shipped") extra.shipped_at = new Date().toISOString().slice(0, 10);
    if (patch.delivery_status === "delivered") extra.delivered_at = new Date().toISOString().slice(0, 10);
    if (patch.delivery_status === "problem") extra.problem_at = new Date().toISOString().slice(0, 10);
    const { error } = await supabaseAdmin
      .from("shop_orders")
      .update({ ...patch, ...extra } as any)
      .eq("id", order_id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

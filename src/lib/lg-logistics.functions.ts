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
    const { data: rows, error } = await supabaseAdmin
      .from("shop_orders")
      .select("id,order_number,order_date,shop_id,items_count,carrier,tracking_code,tracking_url,delivery_status,shipped_at,delivered_at,problem_at,logistics_note")
      .eq("user_id", context.ownerId)
      .in("shop_id", data.shop_ids)
      .gte("order_date", data.from)
      .lte("order_date", data.to)
      .order("order_date", { ascending: false });
    if (error) throw new Error(error.message);

    // O status pode ter sido atualizado automaticamente (Track123) via shipped_at/
    // delivered_at/problem_at sem que a coluna delivery_status tenha sido tocada —
    // aqui reconciliamos as duas fontes pra refletir o que já foi detectado.
    // delivered_at/problem_at são sinais fortes: sempre prevalecem sobre um
    // delivery_status desatualizado (ex.: preso em "shipped" desde o envio).
    const withEffectiveStatus = (rows ?? []).map((o: any) => {
      let status = o.delivery_status;
      if (o.delivered_at) status = "delivered";
      else if (o.problem_at) status = "problem";
      else if (!status || status === "pending_shipment") status = o.shipped_at ? "shipped" : "pending_shipment";
      return { ...o, delivery_status: status };
    });

    return data.delivery_status
      ? withEffectiveStatus.filter((o: any) => o.delivery_status === data.delivery_status)
      : withEffectiveStatus;
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
      logistics_note: z.string().max(500).optional().nullable(),
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

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { recomputeShopAutomation } from "@/lib/shop-orders.functions";

export const SHOP_STATUSES = ["ativa", "pausada", "arquivada"] as const;

const ShopInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(SHOP_STATUSES).default("ativa"),
  country: z.string().max(60).nullable().optional(),
  tag: z.string().max(40).nullable().optional(),
  logo_url: z.string().max(2_000_000).nullable().optional(),
  pipeline_stage: z.string().trim().min(1).max(64).optional(),
  pipeline_position: z.number().int().optional(),
});

export const getShop = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: shop, error } = await context.supabase
      .from("shops").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!shop) throw new Error("Loja não encontrada");
    return { shop };
  });

export const createShop = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ShopInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("shops").insert({
      user_id: context.ownerId,
      name: data.name,
      description: data.description ?? null,
      status: data.status,
      country: data.country ?? null,
      tag: data.tag ?? null,
      logo_url: data.logo_url ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { shop: row };
  });

export const updateShop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: ShopInput.partial().extend({ archived: z.boolean().optional() }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shops").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    // Archiving/unarchiving a shop pauses or resumes its Shopify sync.
    if (data.patch.status !== undefined) await recomputeShopAutomation(data.id);
    return { ok: true };
  });

export const deleteShop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shops").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

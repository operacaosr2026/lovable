import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PRODUCT_STATUSES = ["producao", "validacao", "escala", "pausado", "vencedor"] as const;

const LinkItem = z.object({ label: z.string().max(80), url: z.string().max(500) });

const ProductInput = z.object({
  shop_id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  image_url: z.string().max(500).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  links: z.array(LinkItem).max(20).optional(),
  notes: z.string().max(4000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(15).optional(),
  status: z.enum(PRODUCT_STATUSES).default("producao"),
  product_date: z.string().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
});

export const listShopProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("shop_products").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const productIds = Array.from(new Set((rows ?? []).map((r: any) => r.product_id).filter(Boolean)));
    let productsMap: Record<string, any> = {};
    if (productIds.length) {
      const { data: linked } = await context.supabase
        .from("products").select("id,name,main_image_url")
        .in("id", productIds);
      productsMap = Object.fromEntries((linked ?? []).map((p: any) => [p.id, p]));
    }
    return {
      products: (rows ?? []).map((r: any) => ({
        ...r,
        linked_product: r.product_id ? (productsMap[r.product_id] ?? null) : null,
      })),
    };
  });

export const createShopProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ProductInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: top } = await context.supabase
      .from("shop_products").select("position")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).eq("status", data.status)
      .order("position", { ascending: true }).limit(1).maybeSingle();
    const position = (top?.position ?? 0) - 1;
    const { data: row, error } = await context.supabase.from("shop_products").insert({
      user_id: context.userId,
      shop_id: data.shop_id,
      name: data.name,
      image_url: data.image_url ?? null,
      description: data.description ?? null,
      links: data.links ?? [],
      notes: data.notes ?? null,
      tags: data.tags ?? [],
      status: data.status,
      product_date: data.product_date ?? null,
      product_id: data.product_id ?? null,
      position,
    }).select().single();
    if (error) throw new Error(error.message);
    return { product: row };
  });

export const updateShopProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: ProductInput.partial().omit({ shop_id: true }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_products").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderShopProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      updates: z.array(z.object({
        id: z.string().uuid(),
        status: z.enum(PRODUCT_STATUSES),
        position: z.number(),
      })).max(500),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await context.supabase.from("shop_products").update({
        status: u.status, position: u.position,
      }).eq("id", u.id);
    }
    return { ok: true };
  });

export const deleteShopProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

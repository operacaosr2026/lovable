import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";


export const GROUP_STATUSES = ["ativo", "pausado", "arquivado"] as const;

const GroupInput = z.object({
  name:        z.string().trim().min(1).max(100),
  description: z.string().nullable().optional(),
  status:      z.enum(GROUP_STATUSES).default("ativo"),
  country:     z.string().nullable().optional(),
  tag:         z.string().nullable().optional(),
  logo_url:    z.string().nullable().optional(),
});

export const listGroups = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data: groups, error } = await supabaseAdmin
      .from("shop_groups")
      .select("*, shop_group_stores(id, role, shopify_store_id)")
      .eq("user_id", context.ownerId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { groups: groups ?? [] };
  });

export const createGroup = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) =>
    z.object({
      group: GroupInput,
      stores: z.array(z.object({
        shopify_store_id: z.string().uuid(),
        role: z.enum(["matriz", "subloja"]),
      })).default([]),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("shop_groups")
      .insert({ user_id: context.ownerId, ...data.group })
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (data.stores.length > 0) {
      const { error: se } = await supabaseAdmin
        .from("shop_group_stores")
        .insert(data.stores.map((s) => ({ group_id: row.id, ...s })));
      if (se) throw new Error(se.message);
    }

    return { group: row };
  });

export const updateGroup = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) =>
    z.object({
      id:     z.string().uuid(),
      patch:  GroupInput.partial(),
      stores: z.array(z.object({
        shopify_store_id: z.string().uuid(),
        role: z.enum(["matriz", "subloja"]),
      })).optional(),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("shop_groups")
      .update(data.patch)
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);

    if (data.stores !== undefined) {
      await supabaseAdmin.from("shop_group_stores").delete().eq("group_id", data.id);
      if (data.stores.length > 0) {
        const { error: se } = await supabaseAdmin
          .from("shop_group_stores")
          .insert(data.stores.map((s) => ({ group_id: data.id, ...s })));
        if (se) throw new Error(se.message);
      }
    }

    return { ok: true };
  });

export const getGroup = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: group, error } = await supabaseAdmin
      .from("shop_groups")
      .select("*, shop_group_stores(id, role, shopify_store_id)")
      .eq("id", data.id)
      .eq("user_id", context.ownerId)
      .single();
    if (error) throw new Error(error.message);

    // Resolve internal shops linked to these Shopify stores
    const shopifyIds = (group.shop_group_stores ?? []).map((s: any) => s.shopify_store_id);
    let shops: any[] = [];
    if (shopifyIds.length > 0) {
      const { data: settings } = await supabaseAdmin
        .from("shop_order_settings")
        .select("shop_id, shopify_store_id")
        .eq("user_id", context.ownerId)
        .in("shopify_store_id", shopifyIds);

      const shopIds = (settings ?? []).map((s: any) => s.shop_id).filter(Boolean);
      if (shopIds.length > 0) {
        const { data: shopRows } = await supabaseAdmin
          .from("shops")
          .select("*")
          .in("id", shopIds)
          .eq("user_id", context.ownerId);
        shops = (shopRows ?? []).map((s: any) => {
          const setting = (settings ?? []).find((st: any) => st.shop_id === s.id);
          const groupStore = (group.shop_group_stores ?? []).find(
            (gs: any) => gs.shopify_store_id === setting?.shopify_store_id
          );
          return { ...s, shopify_store_id: setting?.shopify_store_id, role: groupStore?.role ?? "subloja" };
        });
        // Sort: matriz first
        shops.sort((a, b) => (a.role === "matriz" ? -1 : b.role === "matriz" ? 1 : 0));
      }
    }

    return { group, shops };
  });

export const deleteGroup = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("shop_groups")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

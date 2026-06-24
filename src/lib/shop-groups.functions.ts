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

const StoreEntry = z.object({
  shopify_store_id: z.string().uuid(),
  role: z.enum(["matriz", "subloja"]),
});

// Ensures each shopify store in a group has a corresponding internal shop record.
// Uses separate queries to avoid relying on PostgREST FK auto-discovery.
async function syncGroupShops(
  ownerId: string,
  groupId: string,
  stores: { shopify_store_id: string; role: string }[]
) {
  // Get existing internal shops for this group
  const { data: existingGroupShops } = await supabaseAdmin
    .from("shops")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", ownerId);

  const existingShopIds = (existingGroupShops ?? []).map((s: any) => s.id);

  // Get shopify_store_id for each existing group shop
  const existingSettings =
    existingShopIds.length > 0
      ? await supabaseAdmin
          .from("shop_order_settings")
          .select("shop_id, shopify_store_id")
          .in("shop_id", existingShopIds)
          .then(({ data }) => data ?? [])
      : [];

  const existingByShopifyId = new Map<string, string>(
    (existingSettings as any[])
      .filter((s) => s.shopify_store_id)
      .map((s) => [s.shopify_store_id, s.shop_id])
  );

  if (stores.length === 0) {
    // Remove all group shops
    for (const shopId of existingShopIds) {
      await supabaseAdmin.from("shops").delete().eq("id", shopId);
    }
    return;
  }

  // Get Shopify store names
  const shopifyIds = stores.map((s) => s.shopify_store_id);
  const { data: shopifyStores } = await supabaseAdmin
    .from("shopify_stores")
    .select("id, name, shop_domain")
    .in("id", shopifyIds);

  // Create a shop for each store not yet linked
  for (const store of stores) {
    if (existingByShopifyId.has(store.shopify_store_id)) continue;

    const shopifyStore = (shopifyStores ?? []).find((s: any) => s.id === store.shopify_store_id);
    const name = (shopifyStore as any)?.name || (shopifyStore as any)?.shop_domain || "Loja";

    const { data: newShop, error: shopErr } = await supabaseAdmin
      .from("shops")
      .insert({ user_id: ownerId, group_id: groupId, name, status: "ativa" })
      .select("id")
      .single();
    if (shopErr) throw new Error("Erro ao criar shop do grupo: " + shopErr.message);

    const { error: settErr } = await supabaseAdmin
      .from("shop_order_settings")
      .upsert(
        { user_id: ownerId, shop_id: newShop.id, shopify_store_id: store.shopify_store_id },
        { onConflict: "shop_id" }
      );
    if (settErr) throw new Error("Erro ao vincular loja Shopify: " + settErr.message);
  }

  // Remove shops whose shopify store was removed from the group
  const currentShopifySet = new Set(shopifyIds);
  for (const [shopifyId, shopId] of existingByShopifyId) {
    if (!currentShopifySet.has(shopifyId)) {
      await supabaseAdmin.from("shops").delete().eq("id", shopId);
    }
  }
}

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

    // Load shops belonging to this group
    const { data: shopRows } = await supabaseAdmin
      .from("shops")
      .select("*")
      .eq("group_id", data.id)
      .eq("user_id", context.ownerId);

    const shopIds = (shopRows ?? []).map((s: any) => s.id);

    // Get shopify_store_id for each shop via separate query
    const settings =
      shopIds.length > 0
        ? await supabaseAdmin
            .from("shop_order_settings")
            .select("shop_id, shopify_store_id")
            .in("shop_id", shopIds)
            .then(({ data: d }) => d ?? [])
        : [];

    const groupStores: any[] = group.shop_group_stores ?? [];
    const shops = (shopRows ?? []).map((s: any) => {
      const setting = (settings as any[]).find((st) => st.shop_id === s.id);
      const shopifyId = setting?.shopify_store_id ?? null;
      const groupStore = groupStores.find((gs) => gs.shopify_store_id === shopifyId);
      return { ...s, shopify_store_id: shopifyId, role: groupStore?.role ?? "subloja" };
    });
    shops.sort((a, b) => (a.role === "matriz" ? -1 : b.role === "matriz" ? 1 : 0));

    return { group, shops };
  });

export const createGroup = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) =>
    z.object({
      group: GroupInput,
      stores: z.array(StoreEntry).default([]),
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

      await syncGroupShops(context.ownerId, row.id, data.stores);
    }

    return { group: row };
  });

export const updateGroup = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) =>
    z.object({
      id:     z.string().uuid(),
      patch:  GroupInput.partial(),
      stores: z.array(StoreEntry).optional(),
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

      await syncGroupShops(context.ownerId, data.id, data.stores);
    }

    return { ok: true };
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

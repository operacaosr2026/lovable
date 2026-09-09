import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recomputeShopAutomation } from "@/lib/shop-orders.functions";


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
// Reuses an existing `shops` mirror row for that Shopify store when one already
// exists (e.g. one created by Lojas e Grupos, or by another group) instead of
// creating a duplicate — a shop stays a single record no matter which feature
// attached it. Removing a store from a group unlinks its shop (group_id = null)
// rather than deleting it, so the record — and anything else pointing at it —
// survives and the shop becomes pickable elsewhere (e.g. a Lojas e Grupos card).
async function syncGroupShops(
  ownerId: string,
  groupId: string,
  stores: { shopify_store_id: string; role: string }[]
) {
  const keepShopifyIds = new Set(stores.map((s) => s.shopify_store_id));
  const affectedShopIds = new Set<string>();

  const { data: existingGroupShops } = await supabaseAdmin
    .from("shops")
    .select("id, shopify_store_id")
    .eq("group_id", groupId)
    .eq("user_id", ownerId);

  for (const s of (existingGroupShops ?? []) as any[]) {
    if (!s.shopify_store_id || !keepShopifyIds.has(s.shopify_store_id)) {
      await supabaseAdmin.from("shops").update({ group_id: null }).eq("id", s.id);
      affectedShopIds.add(s.id);
    }
  }

  if (stores.length > 0) {
    // Get Shopify store names
    const shopifyIds = stores.map((s) => s.shopify_store_id);
    const { data: shopifyStores } = await supabaseAdmin
      .from("shopify_stores")
      .select("id, name, shop_domain")
      .in("id", shopifyIds);

    for (const store of stores) {
      const { data: existing } = await supabaseAdmin
        .from("shops")
        .select("id")
        .eq("user_id", ownerId)
        .eq("shopify_store_id", store.shopify_store_id)
        .maybeSingle();

      const shopifyStore = (shopifyStores ?? []).find((s: any) => s.id === store.shopify_store_id);
      const name = (shopifyStore as any)?.name || (shopifyStore as any)?.shop_domain || "Loja";

      let shopId: string;
      if (existing) {
        shopId = existing.id;
        const { error: updErr } = await supabaseAdmin
          .from("shops")
          .update({ group_id: groupId, name })
          .eq("id", shopId);
        if (updErr) throw new Error("Erro ao vincular loja ao grupo: " + updErr.message);
      } else {
        const { data: newShop, error: shopErr } = await supabaseAdmin
          .from("shops")
          .insert({ user_id: ownerId, group_id: groupId, name, status: "ativa", shopify_store_id: store.shopify_store_id })
          .select("id")
          .single();
        if (shopErr) throw new Error("Erro ao criar shop do grupo: " + shopErr.message);
        shopId = newShop.id;
      }

      const { error: settErr } = await supabaseAdmin
        .from("shop_order_settings")
        .upsert(
          { user_id: ownerId, shop_id: shopId, shopify_store_id: store.shopify_store_id },
          { onConflict: "shop_id" }
        );
      if (settErr) throw new Error("Erro ao vincular loja Shopify: " + settErr.message);
      affectedShopIds.add(shopId);
    }
  }

  // Archiving/reactivating the group, or changing which shops it holds, can
  // change whether those shops should keep syncing.
  await Promise.all([...affectedShopIds].map((id) => recomputeShopAutomation(id)));
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

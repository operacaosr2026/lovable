import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShopifyConnection {
  id: string;
  name: string;
  shop_domain: string;
  access_token: string;
  last_sync_at: string | null;
  last_sync_status: string;
  last_sync_error: string | null;
  created_at: string;
}

export interface GroupStore {
  id: string;
  connection_id: string;
  role: "matrix" | "sub";
  position: number;
  connection: ShopifyConnection;
}

// ─── Banco de Lojas CRUD ─────────────────────────────────────────────────────

export const listConnections = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;
    const { data, error } = await supabaseAdmin
      .from("shopify_connections")
      .select("id,name,shop_domain,last_sync_at,last_sync_status,last_sync_error,created_at")
      .eq("user_id", ownerId)
      .order("name");
    if (error) throw new Error(error.message);
    return { connections: (data ?? []) as ShopifyConnection[] };
  });

export const deleteConnection = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    // Check if connection is used in any group
    const { count } = await supabaseAdmin
      .from("shop_group_stores")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", data.id);
    if ((count ?? 0) > 0)
      throw new Error("Esta loja está vinculada a um ou mais grupos. Remova-a dos grupos antes de excluir.");

    const { error } = await supabaseAdmin
      .from("shopify_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Group ↔ Store management ─────────────────────────────────────────────────

export const getGroupStores = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    const { data: rows, error } = await supabaseAdmin
      .from("shop_group_stores")
      .select(`
        id, connection_id, role, position,
        connection:shopify_connections!inner(id,name,shop_domain,last_sync_at,last_sync_status,last_sync_error,created_at)
      `)
      .eq("shop_id", data.shop_id)
      .order("position");
    if (error) throw new Error(error.message);

    // Verify ownership via shops table
    const { data: shop } = await supabaseAdmin
      .from("shops").select("user_id").eq("id", data.shop_id).maybeSingle();
    if (!shop || shop.user_id !== ownerId) throw new Error("Acesso negado");

    return { stores: (rows ?? []) as GroupStore[] };
  });

export const setGroupStores = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) =>
    z.object({
      shop_id: z.string().uuid(),
      stores: z.array(z.object({
        connection_id: z.string().uuid(),
        role: z.enum(["matrix", "sub"]),
      })).min(0),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    // Verify group ownership
    const { data: shop } = await supabaseAdmin
      .from("shops").select("user_id").eq("id", data.shop_id).maybeSingle();
    if (!shop || shop.user_id !== ownerId) throw new Error("Acesso negado");

    // Only one matrix allowed
    const matrixCount = data.stores.filter(s => s.role === "matrix").length;
    if (matrixCount > 1) throw new Error("Um grupo pode ter apenas uma loja matriz.");

    // Replace all group stores atomically
    await supabaseAdmin.from("shop_group_stores").delete().eq("shop_id", data.shop_id);

    if (data.stores.length > 0) {
      const rows = data.stores.map((s, i) => ({
        shop_id:       data.shop_id,
        connection_id: s.connection_id,
        role:          s.role,
        position:      i,
      }));
      const { error } = await supabaseAdmin.from("shop_group_stores").insert(rows);
      if (error) throw new Error(error.message);
    }

    // Keep shop_order_settings.shopify_store_id in sync with matrix store
    const matrix = data.stores.find(s => s.role === "matrix");
    await supabaseAdmin
      .from("shop_order_settings")
      .upsert({
        shop_id: data.shop_id,
        user_id: ownerId,
        shopify_store_id: matrix?.connection_id ?? null,
      }, { onConflict: "shop_id" });

    return { ok: true };
  });


import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_COLUMN_NAME = "Novo";

export const listBoardColumns = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("store_board_columns")
      .select("id,name,position,features")
      .eq("user_id", context.ownerId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);

    if ((data ?? []).length > 0) return data;

    const { data: created, error: createErr } = await supabaseAdmin
      .from("store_board_columns")
      .insert({ user_id: context.ownerId, name: DEFAULT_COLUMN_NAME, position: 0 })
      .select("id,name,position,features")
      .single();
    if (createErr) throw new Error(createErr.message);
    return [created];
  });

export const createBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: last } = await supabaseAdmin
      .from("store_board_columns")
      .select("position")
      .eq("user_id", context.ownerId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = (last?.position ?? -1) + 1;

    const { data: row, error } = await supabaseAdmin
      .from("store_board_columns")
      .insert({ user_id: context.ownerId, name: data.name, position })
      .select("id,name,position,features")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const BOARD_COLUMN_FEATURES = ["hold", "avg_orders", "payout_time", "note"] as const;

export const setBoardColumnFeatures = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    features: z.array(z.enum(BOARD_COLUMN_FEATURES)),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("store_board_columns")
      .update({ features: data.features })
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const renameBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("store_board_columns")
      .update({ name: data.name })
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("store_board_columns")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderBoardColumns = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    updates: z.array(z.object({ id: z.string().uuid(), position: z.number().int() })).max(200),
  }).parse(d))
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await supabaseAdmin
        .from("store_board_columns")
        .update({ position: u.position })
        .eq("id", u.id)
        .eq("user_id", context.ownerId);
    }
    return { ok: true };
  });

export const moveBoardStores = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    updates: z.array(z.object({
      id: z.string().uuid(),
      board_column_id: z.string().uuid(),
      board_position: z.number().int(),
    })).max(500),
  }).parse(d))
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await supabaseAdmin
        .from("shopify_stores")
        .update({ board_column_id: u.board_column_id, board_position: u.board_position })
        .eq("id", u.id)
        .eq("user_id", context.ownerId);
    }
    return { ok: true };
  });

export const setStoreBoardNote = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    note: z.string().trim().max(200).nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("shopify_stores")
      .update({ board_note: data.note || null })
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

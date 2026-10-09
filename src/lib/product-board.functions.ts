import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BOARD_COLUMN_COLORS } from "@/lib/store-board.functions";

// Esteira de Produtos — as colunas são os status do produto. Mesmas regras
// das colunas do Banco de Lojas (store-board.functions.ts).

const DEFAULT_COLUMNS = [
  { name: "Ativo", color: "emerald" }, { name: "Teste", color: "blue" }, { name: "Escala", color: "amber" },
  { name: "Pausado", color: "orange" }, { name: "Arquivado", color: "slate" },
];
const COLS = "id,name,position,color";

export const listProductBoardColumns = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin.from("product_board_columns").select(COLS)
      .eq("user_id", context.ownerId).order("position", { ascending: true });
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) return data!;

    const { data: created, error: createErr } = await supabaseAdmin.from("product_board_columns")
      .insert(DEFAULT_COLUMNS.map((c, i) => ({ user_id: context.ownerId, ...c, position: i })))
      .select(COLS).order("position", { ascending: true });
    if (createErr) throw new Error(createErr.message);
    return created ?? [];
  });

export const createProductBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: last } = await supabaseAdmin.from("product_board_columns").select("position")
      .eq("user_id", context.ownerId).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: row, error } = await supabaseAdmin.from("product_board_columns")
      .insert({ user_id: context.ownerId, name: data.name, position: (last?.position ?? -1) + 1 })
      .select(COLS).single();
    if (error) throw new Error(error.message);
    return row;
  });

export const renameProductBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("product_board_columns")
      .update({ name: data.name }).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setProductBoardColumnColor = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), color: z.enum(BOARD_COLUMN_COLORS).nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("product_board_columns")
      .update({ color: data.color }).eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductBoardColumn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { count } = await supabaseAdmin.from("products").select("id", { count: "exact", head: true })
      .eq("user_id", context.ownerId).eq("board_column_id", data.id);
    if ((count ?? 0) > 0) throw new Error("Mova ou remova os produtos deste status antes de excluí-lo.");
    const { error } = await supabaseAdmin.from("product_board_columns")
      .delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderProductBoardColumns = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    updates: z.array(z.object({ id: z.string().uuid(), position: z.number().int() })).max(200),
  }).parse(d))
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await supabaseAdmin.from("product_board_columns")
        .update({ position: u.position }).eq("id", u.id).eq("user_id", context.ownerId);
    }
    return { ok: true };
  });

export const moveBoardProducts = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    updates: z.array(z.object({
      id: z.string().uuid(),
      board_column_id: z.string().uuid(),
      board_position: z.number().int(),
    })).max(1000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await supabaseAdmin.from("products")
        .update({ board_column_id: u.board_column_id, board_position: u.board_position })
        .eq("id", u.id).eq("user_id", context.ownerId);
    }
    return { ok: true };
  });

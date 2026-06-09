import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BOARD_TYPES = z.enum([
  "shop_pipeline",
  "task_list",
  "shop_tasks",
  "project_tasks",
  "shop_products",
  "product_creatives",
]);

const ColorSchema = z.string().min(1).max(80);
const KeySchema = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);
const LabelSchema = z.string().trim().min(1).max(120);

export const listKanbanColumns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ board_type: BOARD_TYPES, board_id: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cols, error } = await supabase
      .from("kanban_columns")
      .select("*")
      .eq("user_id", userId)
      .eq("board_type", data.board_type)
      .eq("board_id", data.board_id)
      .order("position")
      .order("created_at");
    if (error) throw new Error(error.message);
    return { columns: cols ?? [] };
  });

export const seedKanbanColumns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        board_type: BOARD_TYPES,
        board_id: z.string().min(1),
        columns: z
          .array(z.object({ key: KeySchema, label: LabelSchema, color: ColorSchema }))
          .min(1)
          .max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("kanban_columns")
      .select("id")
      .eq("user_id", userId)
      .eq("board_type", data.board_type)
      .eq("board_id", data.board_id)
      .limit(1);
    if (existing && existing.length > 0) return { seeded: false, columns: [] };
    const rows = data.columns.map((c, i) => ({
      user_id: userId,
      board_type: data.board_type,
      board_id: data.board_id,
      key: c.key,
      label: c.label,
      color: c.color,
      position: i,
    }));
    const { data: inserted, error } = await supabase
      .from("kanban_columns")
      .insert(rows)
      .select();
    if (error) throw new Error(error.message);
    return { seeded: true, columns: inserted ?? [] };
  });

export const createKanbanColumn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        board_type: BOARD_TYPES,
        board_id: z.string().min(1),
        key: KeySchema,
        label: LabelSchema,
        color: ColorSchema,
        position: z.number().int(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: col, error } = await supabase
      .from("kanban_columns")
      .insert({
        user_id: userId,
        board_type: data.board_type,
        board_id: data.board_id,
        key: data.key,
        label: data.label,
        color: data.color,
        position: data.position,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { column: col };
  });

export const updateKanbanColumn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        patch: z.object({
          label: LabelSchema.optional(),
          color: ColorSchema.optional(),
          position: z.number().int().optional(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: col, error } = await supabase
      .from("kanban_columns")
      .update(data.patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { column: col };
  });

export const deleteKanbanColumn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("kanban_columns")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderKanbanColumns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        updates: z
          .array(z.object({ id: z.string().uuid(), position: z.number().int() }))
          .max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    for (const u of data.updates) {
      await context.supabase
        .from("kanban_columns")
        .update({ position: u.position })
        .eq("id", u.id);
    }
    return { ok: true };
  });

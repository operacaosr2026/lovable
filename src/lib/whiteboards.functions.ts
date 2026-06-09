import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listWhiteboards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ projectId: z.string().uuid().nullable().optional() }).optional().parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("whiteboards")
      .select("*")
      .eq("user_id", userId);
    if (data?.projectId !== undefined) {
      if (data.projectId === null) q = q.is("project_id", null);
      else q = q.eq("project_id", data.projectId);
    }
    const { data: rows, error } = await q
      .order("is_favorite", { ascending: false })
      .order("last_opened_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((b: any) => b.id);
    const counts: Record<string, number> = {};
    if (ids.length) {
      const { data: nodes } = await supabase
        .from("whiteboard_nodes").select("board_id").in("board_id", ids);
      for (const n of nodes ?? []) counts[(n as any).board_id] = (counts[(n as any).board_id] ?? 0) + 1;
    }
    return { boards: (rows ?? []).map((b: any) => ({ ...b, node_count: counts[b.id] ?? 0 })) };
  });


export const createWhiteboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().trim().min(1).max(120).default("Novo quadro"),
    color: z.string().max(120).optional(),
    icon: z.string().max(40).optional(),
    project_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("whiteboards")
      .insert({
        user_id: context.userId,
        name: data.name,
        color: data.color ?? "oklch(0.6 0.22 285)",
        icon: data.icon ?? null,
        project_id: data.project_id ?? null,

        last_opened_at: new Date().toISOString(),
      })
      .select().single();
    if (error) throw new Error(error.message);
    return { board: row };
  });

export const updateWhiteboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      color: z.string().max(120).optional(),
      icon: z.string().max(40).nullable().optional(),
      is_favorite: z.boolean().optional(),
      viewport: z.record(z.any()).optional(),
      last_opened_at: z.string().optional(),
    }),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("whiteboards").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWhiteboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("whiteboards").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getWhiteboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: board, error } = await context.supabase
      .from("whiteboards").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!board) throw new Error("Quadro não encontrado");
    // touch last_opened_at
    await context.supabase.from("whiteboards")
      .update({ last_opened_at: new Date().toISOString() }).eq("id", data.id);
    return { board };
  });

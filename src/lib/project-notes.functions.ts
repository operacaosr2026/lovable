import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listProjectNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: notes, error } = await supabase
      .from("project_notes").select("*")
      .eq("user_id", userId).eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { notes: notes ?? [] };
  });

export const createProjectNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      project_id: z.string().uuid(),
      content: z.string().trim().min(1).max(5000),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase.from("project_notes").insert({
      user_id: userId,
      project_id: data.project_id,
      content: data.content,
    }).select().single();
    if (error) throw new Error(error.message);
    return { note: row };
  });

export const deleteProjectNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("project_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

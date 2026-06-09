import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getGratitudeEntry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ date: z.string() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("gratitude_entries")
      .select("*")
      .eq("user_id", context.userId)
      .eq("date", data.date)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { entry: row };
  });

export const saveGratitudeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ date: z.string(), content: z.string().max(10000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("gratitude_entries")
      .upsert(
        { user_id: context.userId, date: data.date, content: data.content, updated_at: new Date().toISOString() },
        { onConflict: "user_id,date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listGratitudeEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("gratitude_entries")
      .select("id,date,content,updated_at")
      .eq("user_id", context.userId)
      .order("date", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);
    return { entries: rows ?? [] };
  });

export const deleteGratitudeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("gratitude_entries")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

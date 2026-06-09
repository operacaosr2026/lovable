import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listHabitsWithLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const sinceDate = new Date(new Date().getFullYear(), 0, 1); // Jan 1 of current year
    const since = sinceDate.toISOString().slice(0, 10);

    const [habits, logs] = await Promise.all([
      supabase.from("habits").select("*").eq("user_id", userId).order("position"),
      supabase.from("habit_logs").select("*").eq("user_id", userId).gte("date", since),
    ]);
    return { habits: habits.data ?? [], logs: logs.data ?? [], since };
  });

export const updateHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        name: z.string().trim().min(1).max(100).optional(),
        weekly_goal: z.number().int().min(1).max(7).optional(),
        annual_goal: z.number().int().min(1).nullable().optional(),
      }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("habits").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("habits").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleHabitOnDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      habit_id: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const existing = await supabase
      .from("habit_logs")
      .select("id")
      .eq("habit_id", data.habit_id)
      .eq("date", data.date)
      .maybeSingle();
    if (existing.data) {
      await supabase.from("habit_logs").delete().eq("id", existing.data.id);
    } else {
      await supabase.from("habit_logs").insert({ user_id: userId, habit_id: data.habit_id, date: data.date });
    }
    return { ok: true };
  });

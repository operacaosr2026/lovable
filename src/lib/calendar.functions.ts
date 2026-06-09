import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listCalendarEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ year: z.number(), month: z.number() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const from = `${data.year}-${String(data.month).padStart(2, "0")}-01`;
    const lastDay = new Date(data.year, data.month, 0).getDate();
    const to = `${data.year}-${String(data.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const { data: events, error } = await supabase
      .from("calendar_events")
      .select("*")
      .eq("user_id", userId)
      .gte("date", from)
      .lte("date", to)
      .order("date");
    if (error) throw new Error(error.message);
    return events ?? [];
  });

export const createCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      title: z.string().trim().min(1).max(200),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      color: z.string().default("bg-primary"),
      start_time: z.string().nullable().optional(),
      end_time: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("calendar_events").insert({
      user_id: context.userId,
      title: data.title,
      date: data.date,
      color: data.color,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("calendar_events")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        title: z.string().trim().min(1).max(200).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        color: z.string().optional(),
        start_time: z.string().nullable().optional(),
        end_time: z.string().nullable().optional(),
      }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("calendar_events")
      .update(data.patch)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUSES = ["todo", "doing", "done"] as const;
const FREQUENCIES = ["daily", "weekly", "monthly", "custom"] as const;

function computeNextDueAt(
  current: string | null,
  frequency: typeof FREQUENCIES[number],
  weekdays: number[],
  time: string | null,
): string {
  // Base = current due_at if any, otherwise now
  const base = current ? new Date(current) : new Date();
  const next = new Date(base);

  if (frequency === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (frequency === "monthly") {
    next.setMonth(next.getMonth() + 1);
  } else if (frequency === "custom") {
    const days = (weekdays ?? []).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    if (days.length === 0) {
      next.setDate(next.getDate() + 1);
    } else {
      // find next weekday strictly after base
      const cur = base.getDay();
      let delta = 7;
      for (const d of days) {
        const diff = (d - cur + 7) % 7 || 7;
        if (diff < delta) delta = diff;
      }
      next.setDate(base.getDate() + delta);
    }
  }

  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(":").map(Number);
    next.setHours(h, m, 0, 0);
  }
  return next.toISOString();
}

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const now = new Date();
    const tasks = (data ?? []).map((t: any) => ({
      ...t,
      overdue: t.status !== "done" && t.due_at && new Date(t.due_at) < now,
    }));
    return { tasks };
  });

export const getTaskWidgets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);

    const { data } = await supabase
      .from("tasks")
      .select("id,title,due_at,status")
      .eq("user_id", userId)
      .neq("status", "done")
      .not("due_at", "is", null)
      .order("due_at", { ascending: true });

    const list = data ?? [];
    const dueToday = list.filter((t: any) => {
      const d = new Date(t.due_at);
      return d >= start && d <= end;
    });
    const overdue = list.filter((t: any) => new Date(t.due_at) < start);
    return { dueToday, overdue };
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      title: z.string().trim().min(1).max(200),
      status: z.enum(STATUSES).default("todo"),
      due_at: z.string().nullable().optional(),
      tags: z.array(z.string().min(1).max(40)).max(10).optional(),
      recurrence_frequency: z.enum(FREQUENCIES).nullable().optional(),
      recurrence_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
      recurrence_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: top } = await supabase
      .from("tasks").select("position")
      .eq("user_id", userId).eq("status", data.status)
      .order("position", { ascending: true }).limit(1).maybeSingle();
    const position = (top?.position ?? 0) - 1;

    const { data: row, error } = await supabase.from("tasks").insert({
      user_id: userId,
      title: data.title,
      status: data.status,
      due_at: data.due_at ?? null,
      tags: data.tags ?? [],
      position,
      done: data.status === "done",
      done_at: data.status === "done" ? new Date().toISOString() : null,
      recurrence_frequency: data.recurrence_frequency ?? null,
      recurrence_weekdays: data.recurrence_weekdays ?? [],
      recurrence_time: data.recurrence_time ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { task: row };
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        status: z.enum(STATUSES).optional(),
        position: z.number().optional(),
        due_at: z.string().nullable().optional(),
        tags: z.array(z.string().min(1).max(40)).max(10).optional(),
        reminder_minutes: z.array(z.number().int().min(1).max(43200)).max(5).optional(),
        recurrence_frequency: z.enum(FREQUENCIES).nullable().optional(),
        recurrence_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
        recurrence_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const patch: any = { ...data.patch };

    if (patch.status === "done") {
      const { data: existing } = await context.supabase
        .from("tasks")
        .select("recurrence_frequency, recurrence_weekdays, recurrence_time, due_at")
        .eq("id", data.id)
        .maybeSingle();
      if (existing?.recurrence_frequency) {
        const nextDue = computeNextDueAt(
          existing.due_at,
          existing.recurrence_frequency as any,
          existing.recurrence_weekdays ?? [],
          existing.recurrence_time,
        );
        await context.supabase.from("task_completion_logs").insert({
          user_id: context.userId, task_id: data.id,
        });
        patch.status = "todo";
        patch.done = false;
        patch.done_at = null;
        patch.due_at = nextDue;
      } else {
        patch.done = true;
        patch.done_at = new Date().toISOString();
      }
    } else if ("status" in patch) {
      patch.done = false;
      patch.done_at = null;
    }

    const { error } = await context.supabase.from("tasks").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      updates: z.array(z.object({
        id: z.string().uuid(),
        status: z.enum(STATUSES),
        position: z.number(),
      })).max(500),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    for (const u of data.updates) {
      if (u.status === "done") {
        const { data: existing } = await supabase
          .from("tasks")
          .select("recurrence_frequency, recurrence_weekdays, recurrence_time, due_at")
          .eq("id", u.id)
          .maybeSingle();
        if (existing?.recurrence_frequency) {
          const nextDue = computeNextDueAt(
            existing.due_at,
            existing.recurrence_frequency as any,
            existing.recurrence_weekdays ?? [],
            existing.recurrence_time,
          );
          await supabase.from("task_completion_logs").insert({
            user_id: context.userId, task_id: u.id,
          });
          await supabase.from("tasks").update({
            status: "todo",
            done: false,
            done_at: null,
            due_at: nextDue,
            position: u.position,
          }).eq("id", u.id);
          continue;
        }
      }
      await supabase.from("tasks").update({
        status: u.status,
        position: u.position,
        done: u.status === "done",
        done_at: u.status === "done" ? new Date().toISOString() : null,
      }).eq("id", u.id);
    }
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getRoutineLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date();
    since.setDate(since.getDate() - 60);
    const { data } = await supabase
      .from("task_completion_logs")
      .select("task_id, completed_on")
      .eq("user_id", userId)
      .gte("completed_on", since.toISOString().slice(0, 10));
    return { logs: data ?? [] };
  });

/* ===== User settings (WhatsApp) ===== */

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
    return { settings: data ?? { whatsapp_number: "", whatsapp_enabled: false } };
  });

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      whatsapp_number: z.string().trim().max(30).nullable().optional(),
      whatsapp_enabled: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("user_settings").upsert({
      user_id: userId,
      whatsapp_number: data.whatsapp_number ?? null,
      whatsapp_enabled: data.whatsapp_enabled ?? false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

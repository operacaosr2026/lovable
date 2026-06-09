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
  const base = current ? new Date(current) : new Date();
  const next = new Date(base);
  if (frequency === "daily") next.setDate(next.getDate() + 1);
  else if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  else if (frequency === "custom") {
    const days = (weekdays ?? []).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    if (days.length === 0) next.setDate(next.getDate() + 1);
    else {
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

const ChecklistItem = z.object({ id: z.string(), text: z.string().max(200), done: z.boolean() });

const TaskInput = z.object({
  project_id: z.string().uuid(),
  parent_task_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(STATUSES).default("todo"),
  checklist: z.array(ChecklistItem).max(50).optional(),
  due_at: z.string().nullable().optional(),
  recurrence_frequency: z.enum(FREQUENCIES).nullable().optional(),
  recurrence_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  recurrence_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

export const listProjectTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: tasks, error } = await supabase
      .from("project_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("project_id", data.project_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const now = new Date();
    return {
      tasks: (tasks ?? []).map((t: any) => ({
        ...t,
        overdue: t.status !== "done" && t.due_at && new Date(t.due_at) < now,
      })),
    };
  });

export const createProjectTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => TaskInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: top } = await supabase
      .from("project_tasks").select("position")
      .eq("user_id", userId).eq("project_id", data.project_id).eq("status", data.status)
      .order("position", { ascending: true }).limit(1).maybeSingle();
    const position = (top?.position ?? 0) - 1;
    const { data: row, error } = await supabase.from("project_tasks").insert({
      user_id: userId,
      project_id: data.project_id,
      parent_task_id: data.parent_task_id ?? null,
      title: data.title,
      description: data.description ?? null,
      status: data.status,
      checklist: data.checklist ?? [],
      due_at: data.due_at ?? null,
      recurrence_frequency: data.recurrence_frequency ?? null,
      recurrence_weekdays: data.recurrence_weekdays ?? [],
      recurrence_time: data.recurrence_time ?? null,
      position,
    }).select().single();
    if (error) throw new Error(error.message);
    return { task: row };
  });

export const updateProjectTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: TaskInput.partial().omit({ project_id: true }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const patch: any = { ...data.patch };
    if (patch.status === "done") {
      const { data: existing } = await context.supabase
        .from("project_tasks")
        .select("recurrence_frequency, recurrence_weekdays, recurrence_time, due_at")
        .eq("id", data.id).maybeSingle();
      if (existing?.recurrence_frequency) {
        patch.status = "todo";
        patch.due_at = computeNextDueAt(
          existing.due_at,
          existing.recurrence_frequency as any,
          existing.recurrence_weekdays ?? [],
          existing.recurrence_time,
        );
      }
    }
    const { error } = await context.supabase.from("project_tasks").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderProjectTasks = createServerFn({ method: "POST" })
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
          .from("project_tasks")
          .select("recurrence_frequency, recurrence_weekdays, recurrence_time, due_at")
          .eq("id", u.id).maybeSingle();
        if (existing?.recurrence_frequency) {
          await supabase.from("project_tasks").update({
            status: "todo",
            due_at: computeNextDueAt(
              existing.due_at,
              existing.recurrence_frequency as any,
              existing.recurrence_weekdays ?? [],
              existing.recurrence_time,
            ),
            position: u.position,
          }).eq("id", u.id);
          continue;
        }
      }
      await supabase.from("project_tasks").update({
        status: u.status,
        position: u.position,
      }).eq("id", u.id);
    }
    return { ok: true };
  });

export const deleteProjectTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("project_tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

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

async function resolveList(supabase: any, userId: string, listId: string) {
  const { data, error } = await supabase
    .from("task_lists").select("*").eq("id", listId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Lista não encontrada");
  return data;
}

export const listListTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ list_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const list = await resolveList(supabase, userId, data.list_id);
    const now = new Date();

    if (list.shop_id) {
      const { data: rows, error } = await supabase
        .from("shop_tasks").select("*")
        .eq("user_id", userId).eq("shop_id", list.shop_id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return {
        list,
        kind: "shop" as const,
        tasks: (rows ?? []).map((t: any) => ({
          ...t, source: "shop_task" as const,
          overdue: t.status !== "done" && t.due_at && new Date(t.due_at) < now,
        })),
      };
    }

    // Personal/system "Pessoal" includes orphan tasks (list_id IS NULL) too
    let query = supabase.from("tasks").select("*").eq("user_id", userId);
    if (list.is_system) {
      query = query.or(`list_id.eq.${list.id},list_id.is.null`);
    } else {
      query = query.eq("list_id", list.id);
    }
    const { data: rows, error } = await query
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      list,
      kind: "task" as const,
      tasks: (rows ?? []).map((t: any) => ({
        ...t, source: "task" as const,
        overdue: t.status !== "done" && t.due_at && new Date(t.due_at) < now,
      })),
    };
  });

const CreateInput = z.object({
  list_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  status: z.enum(STATUSES).default("todo"),
  due_at: z.string().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(10).optional(),
  recurrence_frequency: z.enum(FREQUENCIES).nullable().optional(),
  recurrence_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  recurrence_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

export const createListTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CreateInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const list = await resolveList(supabase, userId, data.list_id);

    if (list.shop_id) {
      const { data: top } = await supabase
        .from("shop_tasks").select("position")
        .eq("user_id", userId).eq("shop_id", list.shop_id).eq("status", data.status)
        .order("position", { ascending: true }).limit(1).maybeSingle();
      const position = (top?.position ?? 0) - 1;
      const { data: row, error } = await supabase.from("shop_tasks").insert({
        user_id: userId,
        shop_id: list.shop_id,
        title: data.title,
        status: data.status,
        priority: "media",
        due_at: data.due_at ?? null,
        position,
      }).select().single();
      if (error) throw new Error(error.message);
      return { task: row, source: "shop_task" };
    }

    const { data: top } = await supabase
      .from("tasks").select("position")
      .eq("user_id", userId).eq("status", data.status)
      .order("position", { ascending: true }).limit(1).maybeSingle();
    const position = (top?.position ?? 0) - 1;
    const { data: row, error } = await supabase.from("tasks").insert({
      user_id: userId,
      list_id: list.id,
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
    return { task: row, source: "task" };
  });

const ChecklistItem = z.object({ id: z.string(), text: z.string().max(200), done: z.boolean() });

const UpdateInput = z.object({
  id: z.string().uuid(),
  source: z.enum(["task", "shop_task"]),
  patch: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    position: z.number().optional(),
    due_at: z.string().nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(10).optional(),
    checklist: z.array(ChecklistItem).max(100).optional(),
    recurrence_frequency: z.enum(FREQUENCIES).nullable().optional(),
    recurrence_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    recurrence_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  }),
});

export const updateListTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const patch: any = { ...data.patch };
    // tags only valid for tasks table
    if (data.source === "shop_task") delete patch.tags;
    if (data.source === "shop_task") {
      delete patch.recurrence_frequency;
      delete patch.recurrence_weekdays;
      delete patch.recurrence_time;
    }

    let nextDue: string | null = null;
    if (data.source === "task" && patch.status === "done") {
      const { data: existing } = await supabase
        .from("tasks").select("recurrence_frequency, recurrence_weekdays, recurrence_time, due_at")
        .eq("id", data.id).maybeSingle();
      if (existing?.recurrence_frequency) {
        nextDue = computeNextDueAt(
          existing.due_at,
          existing.recurrence_frequency as any,
          existing.recurrence_weekdays ?? [],
          existing.recurrence_time,
        );
        await supabase.from("task_completion_logs").insert({ user_id: userId, task_id: data.id });
        patch.status = "todo";
        patch.done = false;
        patch.done_at = null;
        patch.due_at = nextDue;
      } else {
        patch.done = true;
        patch.done_at = new Date().toISOString();
      }
    } else if (data.source === "task" && "status" in patch) {
      patch.done = false;
      patch.done_at = null;
    }

    if (data.source === "shop_task" && patch.status === "done") {
      patch.done_at = new Date().toISOString();
    } else if (data.source === "shop_task" && "status" in patch) {
      patch.done_at = null;
    }

    const table = data.source === "task" ? "tasks" : "shop_tasks";
    const { error } = await supabase.from(table).update(patch).eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, recurrence_next_due_at: nextDue };
  });

export const deleteListTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), source: z.enum(["task", "shop_task"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const table = data.source === "task" ? "tasks" : "shop_tasks";
    const { error } = await context.supabase.from(table).delete()
      .eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export const TASK_PRIORITIES = ["baixa", "media", "alta"] as const;

const ChecklistItem = z.object({ id: z.string(), text: z.string().max(200), done: z.boolean() });

const TaskInput = z.object({
  shop_id: z.string().uuid(),
  parent_task_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(TASK_PRIORITIES).default("media"),
  due_at: z.string().nullable().optional(),
  checklist: z.array(ChecklistItem).max(50).optional(),
  assignee: z.string().max(100).nullable().optional(),
  reminder_minutes: z.array(z.number().int().min(1).max(43200)).max(5).optional(),
});

export const listShopTasks = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_ids: z.array(z.string().uuid()).min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: tasks, error } = await context.supabase
      .from("shop_tasks").select("*")
      .eq("user_id", context.ownerId).in("shop_id", data.shop_ids)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const now = new Date();
    return {
      tasks: (tasks ?? []).map((t: any) => ({
        ...t,
        overdue: t.status !== "done" && t.due_at && new Date(t.due_at) < now,
      })),
    };
  });

export const createShopTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TaskInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: top } = await context.supabase
      .from("shop_tasks").select("position")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).eq("status", data.status)
      .order("position", { ascending: true }).limit(1).maybeSingle();
    const position = (top?.position ?? 0) - 1;
    const { data: row, error } = await context.supabase.from("shop_tasks").insert({
      user_id: context.ownerId,
      shop_id: data.shop_id,
      parent_task_id: data.parent_task_id ?? null,
      title: data.title,
      description: data.description ?? null,
      status: data.status,
      priority: data.priority,
      due_at: data.due_at ?? null,
      checklist: data.checklist ?? [],
      assignee: data.assignee ?? null,
      reminder_minutes: data.reminder_minutes ?? [],
      position,
    }).select().single();
    if (error) throw new Error(error.message);
    return { task: row };
  });

export const updateShopTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: TaskInput.partial().omit({ shop_id: true }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const patch: any = { ...data.patch };
    if (patch.status === "done") patch.done_at = new Date().toISOString();
    if (patch.status && patch.status !== "done") patch.done_at = null;
    const { error } = await context.supabase.from("shop_tasks").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderShopTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      updates: z.array(z.object({
        id: z.string().uuid(),
        status: z.enum(TASK_STATUSES),
        position: z.number(),
      })).max(500),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await context.supabase.from("shop_tasks").update({
        status: u.status,
        position: u.position,
        done_at: u.status === "done" ? new Date().toISOString() : null,
      }).eq("id", u.id);
    }
    return { ok: true };
  });

export const deleteShopTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTaskComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows } = await context.supabase
      .from("shop_task_comments").select("*")
      .eq("task_id", data.task_id).order("created_at", { ascending: true });
    return { comments: rows ?? [] };
  });

export const addTaskComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ task_id: z.string().uuid(), content: z.string().trim().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("shop_task_comments").insert({
      user_id: context.userId,
      task_id: data.task_id,
      content: data.content,
    }).select().single();
    if (error) throw new Error(error.message);
    return { comment: row };
  });

export const deleteTaskComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await context.supabase.from("shop_task_comments").delete().eq("id", data.id);
    return { ok: true };
  });

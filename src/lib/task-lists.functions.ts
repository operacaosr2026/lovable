import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext, getSectionResourceFilter } from "@/integrations/supabase/workspace-middleware";

const ListInput = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(80).optional(),
  icon: z.string().trim().max(40).nullable().optional(),
});

export const listTaskLists = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { supabase, userId, ownerId } = context;
    const shopFilter = getSectionResourceFilter(context, "shops");

    let shopTasksQuery = supabase.from("shop_tasks").select("id,shop_id,status").eq("user_id", ownerId);
    if (Array.isArray(shopFilter)) shopTasksQuery = shopTasksQuery.in("shop_id", shopFilter);

    const [{ data: lists }, { data: tasks }, { data: shopTasks }] = await Promise.all([
      supabase.from("task_lists").select("*").eq("user_id", userId).order("position").order("created_at"),
      supabase.from("tasks").select("id,list_id,status").eq("user_id", userId),
      shopFilter === "none" ? Promise.resolve({ data: [] as any[] }) : shopTasksQuery,
    ]);

    const counts = new Map<string, { open: number; total: number }>();
    const bumpFor = (key: string | null, status: string) => {
      if (!key) return;
      const c = counts.get(key) ?? { open: 0, total: 0 };
      c.total += 1;
      if (status !== "done") c.open += 1;
      counts.set(key, c);
    };

    const personal = (lists ?? []).find((l: any) => l.is_system && !l.shop_id);
    for (const t of tasks ?? []) {
      bumpFor(t.list_id ?? personal?.id ?? null, t.status);
    }
    const shopToList = new Map<string, string>();
    for (const l of lists ?? []) if (l.shop_id) shopToList.set(l.shop_id, l.id);
    for (const t of shopTasks ?? []) {
      bumpFor(shopToList.get(t.shop_id) ?? null, t.status);
    }

    return {
      lists: (lists ?? []).map((l: any) => ({
        ...l,
        open_count: counts.get(l.id)?.open ?? 0,
        total_count: counts.get(l.id)?.total ?? 0,
      })),
    };
  });

export const getTaskList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: list, error } = await context.supabase
      .from("task_lists").select("*").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!list) throw new Error("Lista não encontrada");
    return { list };
  });

export const createTaskList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: top } = await context.supabase
      .from("task_lists").select("position")
      .eq("user_id", context.userId).order("position", { ascending: false }).limit(1).maybeSingle();
    const position = (top?.position ?? -1) + 1;
    const { data: row, error } = await context.supabase.from("task_lists").insert({
      user_id: context.userId,
      name: data.name,
      color: data.color ?? "oklch(0.6 0.22 285)",
      icon: data.icon ?? null,
      position,
    }).select().single();
    if (error) throw new Error(error.message);
    return { list: row };
  });

export const updateTaskList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: ListInput.partial(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: list } = await context.supabase
      .from("task_lists").select("shop_id").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (!list) throw new Error("Lista não encontrada");
    if (list.shop_id) throw new Error("Listas de loja são gerenciadas pela própria loja");
    const { error } = await context.supabase.from("task_lists").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTaskList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: list } = await context.supabase
      .from("task_lists").select("shop_id,is_system").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (!list) throw new Error("Lista não encontrada");
    if (list.shop_id) throw new Error("Listas de loja só podem ser removidas excluindo a loja");
    if (list.is_system) throw new Error("Lista do sistema não pode ser removida");
    const { error } = await context.supabase.from("task_lists").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderTaskLists = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      updates: z.array(z.object({ id: z.string().uuid(), position: z.number().int() })).max(200),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    for (const u of data.updates) {
      await context.supabase.from("task_lists").update({ position: u.position })
        .eq("id", u.id).eq("user_id", context.userId);
    }
    return { ok: true };
  });

/* ============= Workspace summary ============= */

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const getTasksSummary = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { supabase, userId, ownerId } = context;
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
    const end7 = new Date(start); end7.setDate(end7.getDate() + 7);
    const end30 = new Date(start); end30.setDate(end30.getDate() + 30);
    const shopFilter = getSectionResourceFilter(context, "shops");

    let shopTasksQuery = supabase.from("shop_tasks")
      .select("id,title,due_at,status,shop_id")
      .eq("user_id", ownerId).neq("status", "done").not("due_at", "is", null);
    if (Array.isArray(shopFilter)) shopTasksQuery = shopTasksQuery.in("shop_id", shopFilter);

    const [{ data: tasks }, { data: shopTasks }] = await Promise.all([
      supabase.from("tasks")
        .select("id,title,due_at,status,list_id")
        .eq("user_id", userId).neq("status", "done").not("due_at", "is", null),
      shopFilter === "none" ? Promise.resolve({ data: [] as any[] }) : shopTasksQuery,
    ]);

    type Item = {
      id: string;
      title: string;
      due_at: string;
      kind: "task" | "shop_task";
      list_id?: string | null;
      shop_id?: string | null;
    };
    const all: Item[] = [
      ...(tasks ?? []).map((t: any) => ({
        id: t.id, title: t.title, due_at: t.due_at, kind: "task" as const, list_id: t.list_id,
      })),
      ...(shopTasks ?? []).map((t: any) => ({
        id: t.id, title: t.title, due_at: t.due_at, kind: "shop_task" as const, shop_id: t.shop_id,
      })),
    ].sort((a, b) => a.due_at.localeCompare(b.due_at));

    const today = all.filter((t) => {
      const d = new Date(t.due_at);
      return d >= start && d <= endToday;
    });
    const next7 = all.filter((t) => {
      const d = new Date(t.due_at);
      return d > endToday && d <= end7;
    });
    const next30 = all.filter((t) => {
      const d = new Date(t.due_at);
      return d > end7 && d <= end30;
    });
    const overdue = all.filter((t) => new Date(t.due_at) < start);

    return {
      counts: {
        today: today.length,
        next7: next7.length,
        next30: next30.length,
        overdue: overdue.length,
      },
      today, next7, next30, overdue,
      todayStr: ymd(start),
    };
  });

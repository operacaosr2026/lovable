import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { broadcast } from "@/lib/realtime.server";
import { notifyTaskDone } from "@/lib/notifications.server";

export const TASK_AREAS = [
  "pedidos", "marketing", "lojas", "fornecedores", "analise",
  "produtos", "atendimento", "sistema", "gestao", "processos",
] as const;
export const TASK_PRIORITIES = ["alta", "media", "baixa"] as const;
export const TASK_STATUSES = ["pendente", "em_andamento", "concluida"] as const;

export type TaskArea = (typeof TASK_AREAS)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string;
  title: string;
  description: string | null;
  area: TaskArea;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  assignee_id: string | null;
  completed_at: string | null;
  created_at: string;
};

const TaskFields = z.object({
  title: z.string().trim().min(1, "Informe o título").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  area: z.enum(TASK_AREAS),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
});

// Dono do workspace + membros — quem pode ser responsável por uma tarefa.
async function workspaceUserIds(ownerId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("workspace_members").select("member_id").eq("owner_id", ownerId);
  return [ownerId, ...(data ?? []).map((m: any) => m.member_id as string)];
}

async function assertAssignee(ownerId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const ids = await workspaceUserIds(ownerId);
  if (!ids.includes(assigneeId)) throw new Error("Responsável não faz parte deste workspace.");
}

const TASK_COLUMNS = "id,title,description,area,priority,status,due_date,assignee_id,completed_at,created_at";

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await selectAll<Task>(supabaseAdmin.from("tasks")
      .select(TASK_COLUMNS)
      .eq("user_id", context.ownerId)
      .order("created_at", { ascending: false }));
    if (error) throw new Error(error.message);
    return data;
  });

export const listTaskAssignees = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const ids = await workspaceUserIds(context.ownerId);
    const { data: profiles } = await supabaseAdmin.from("profiles").select("id,full_name,avatar_url").in("id", ids);
    const byId = new Map((profiles ?? []).map((p: any) => [p.id as string, p]));
    return ids.map((id) => ({
      id,
      name: (byId.get(id)?.full_name as string | null) ?? "Sem nome",
      avatar_url: (byId.get(id)?.avatar_url as string | null) ?? null,
    }));
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => TaskFields.parse(d))
  .handler(async ({ context, data }) => {
    await assertAssignee(context.ownerId, data.assignee_id);
    const { data: row, error } = await supabaseAdmin.from("tasks").insert({
      ...data,
      description: data.description || null,
      due_date: data.due_date || null,
      assignee_id: data.assignee_id || null,
      user_id: context.ownerId,
      created_by: context.userId,
      completed_at: data.status === "concluida" ? new Date().toISOString() : null,
    }).select(TASK_COLUMNS).single();
    if (error) throw new Error(error.message);
    await broadcast(context.ownerId, "tasks");
    return row as Task;
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), patch: TaskFields.partial() }).parse(d))
  .handler(async ({ context, data }) => {
    const patch: TablesUpdate<"tasks"> = { ...data.patch };
    if ("assignee_id" in patch) {
      patch.assignee_id = patch.assignee_id || null;
      await assertAssignee(context.ownerId, patch.assignee_id);
    }
    if ("description" in patch) patch.description = patch.description || null;
    if ("due_date" in patch) patch.due_date = patch.due_date || null;
    // Data de conclusão acompanha o status (pra saber quando foi concluída).
    if (patch.status === "concluida") patch.completed_at = new Date().toISOString();
    else if (patch.status) patch.completed_at = null;
    const { data: before } = patch.status === "concluida"
      ? await supabaseAdmin.from("tasks").select("status,created_by,title").eq("id", data.id).eq("user_id", context.ownerId).maybeSingle()
      : { data: null };
    const { data: row, error } = await supabaseAdmin.from("tasks")
      .update(patch).eq("id", data.id).eq("user_id", context.ownerId)
      .select(TASK_COLUMNS).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Tarefa não encontrada.");
    // Outra pessoa concluiu a tarefa → aviso pra quem criou.
    if (before && before.status !== "concluida" && before.created_by && before.created_by !== context.userId) {
      const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", context.userId).maybeSingle();
      const who = prof?.full_name?.trim() || "Alguém da equipe";
      await notifyTaskDone(context.ownerId, { id: data.id, created_by: before.created_by }, {
        title: `${who} concluiu: ${row.title}`,
      }).catch((e) => console.error("notifyTaskDone", e));
    }
    await broadcast(context.ownerId, "tasks");
    return row as Task;
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("tasks").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    await broadcast(context.ownerId, "tasks");
    return { ok: true };
  });

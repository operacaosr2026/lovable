import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Source = z.enum(["task", "shop_task", "project_task"]);
export type TaskSource = z.infer<typeof Source>;

const tableFor = (s: TaskSource) =>
  s === "task" ? "tasks" : s === "shop_task" ? "shop_tasks" : "project_tasks";

const attachmentTableFor = (s: TaskSource) =>
  s === "task" ? "task_attachments"
  : s === "shop_task" ? "shop_task_attachments"
  : "project_attachments";

const ATTACHMENT_BUCKET = "task-attachments";

export const getTaskDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ source: Source, id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: task, error } = await supabase
      .from(tableFor(data.source))
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!task) throw new Error("Tarefa não encontrada");

    const { data: atts } = await supabase
      .from(attachmentTableFor(data.source))
      .select("*")
      .eq("user_id", userId)
      .eq("task_id", data.id)
      .order("created_at", { ascending: false });

    const attachments = await Promise.all((atts ?? []).map(async (a: any) => {
      const { data: signed } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(a.file_path, 60 * 60);
      return { ...a, url: signed?.signedUrl ?? null };
    }));

    return { task, attachments };
  });

export const registerTaskAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      source: Source,
      task_id: z.string().uuid(),
      file_name: z.string().min(1).max(300),
      file_path: z.string().min(1).max(500),
      mime_type: z.string().max(120).nullable().optional(),
      size_bytes: z.number().int().nonnegative().nullable().optional(),
      // For project_task we also need project_id (NOT NULL on table)
      project_id: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const row: any = {
      user_id: userId,
      task_id: data.task_id,
      file_name: data.file_name,
      file_path: data.file_path,
      mime_type: data.mime_type ?? null,
      size_bytes: data.size_bytes ?? null,
    };
    if (data.source === "project_task") {
      if (!data.project_id) throw new Error("project_id obrigatório");
      row.project_id = data.project_id;
    }
    const { error } = await supabase
      .from(attachmentTableFor(data.source))
      .insert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTaskAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ source: Source, id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const table = attachmentTableFor(data.source);
    const { data: row } = await supabase
      .from(table).select("file_path").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (row?.file_path) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([row.file_path]);
    }
    const { error } = await supabase.from(table).delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const TASK_ATTACHMENT_BUCKET = ATTACHMENT_BUCKET;

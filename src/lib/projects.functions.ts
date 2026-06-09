import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const CATEGORIES = ["pessoal", "trabalho", "evento", "construcao", "financeiro", "estudos", "outros"] as const;
export const STATUSES = ["planejando", "em_andamento", "pausado", "finalizado"] as const;
export const PRIORITIES = ["baixa", "media", "alta"] as const;

const ProjectInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  category: z.enum(CATEGORIES).default("outros"),
  status: z.enum(STATUSES).default("planejando"),
  priority: z.enum(PRIORITIES).default("media"),
  due_date: z.string().nullable().optional(),
  color: z.string().max(60).optional(),
});

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ includeArchived: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    let q = supabase.from("projects").select("*").eq("user_id", userId);
    if (!data.includeArchived) q = q.eq("archived", false);
    const { data: projects, error } = await q.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (projects ?? []).map((p: any) => p.id);
    let counts: Record<string, { total: number; done: number }> = {};
    if (ids.length) {
      const { data: tasks } = await supabase
        .from("project_tasks")
        .select("project_id,status")
        .in("project_id", ids);
      for (const t of tasks ?? []) {
        const k = (t as any).project_id;
        counts[k] ??= { total: 0, done: 0 };
        counts[k].total++;
        if ((t as any).status === "done") counts[k].done++;
      }
    }
    const enriched = (projects ?? []).map((p: any) => {
      const c = counts[p.id] ?? { total: 0, done: 0 };
      return { ...p, taskCount: c.total, doneCount: c.done, progress: c.total ? Math.round((c.done / c.total) * 100) : 0 };
    });
    return { projects: enriched };
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: project, error } = await supabase.from("projects").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Projeto não encontrado");
    return { project };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ProjectInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase.from("projects").insert({
      user_id: userId,
      name: data.name,
      description: data.description ?? null,
      category: data.category,
      status: data.status,
      priority: data.priority,
      due_date: data.due_date ?? null,
      color: data.color ?? "oklch(0.6 0.22 285)",
    }).select().single();
    if (error) throw new Error(error.message);
    return { project: row };
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: ProjectInput.partial().extend({ archived: z.boolean().optional() }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("projects").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: src } = await supabase.from("projects").select("*").eq("id", data.id).maybeSingle();
    if (!src) throw new Error("Projeto não encontrado");
    const { data: copy, error } = await supabase.from("projects").insert({
      user_id: userId,
      name: `${src.name} (cópia)`,
      description: src.description,
      category: src.category,
      status: "planejando",
      priority: src.priority,
      due_date: src.due_date,
      color: src.color,
    }).select().single();
    if (error) throw new Error(error.message);

    const { data: tasks } = await supabase.from("project_tasks").select("*").eq("project_id", data.id).is("parent_task_id", null);
    if (tasks?.length) {
      const rows = tasks.map((t: any) => ({
        user_id: userId,
        project_id: copy.id,
        title: t.title,
        description: t.description,
        status: "todo",
        checklist: (t.checklist ?? []).map((c: any) => ({ ...c, done: false })),
        position: t.position,
      }));
      await supabase.from("project_tasks").insert(rows);
    }
    return { project: copy };
  });

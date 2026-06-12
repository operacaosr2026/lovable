import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeRichText } from "@/lib/sanitize-html";

const NODE_KINDS = ["note", "text", "image", "link", "checklist", "card", "mindmap", "task_ref"] as const;

function sanitizeNodeData(data: any): any {
  if (data && typeof data === "object" && typeof data.titleHtml === "string") {
    return { ...data, titleHtml: sanitizeRichText(data.titleHtml) };
  }
  return data;
}

export const listBoardContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ boardId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const [{ data: nodes, error: ne }, { data: edges, error: ee }] = await Promise.all([
      context.supabase.from("whiteboard_nodes").select("*").eq("board_id", data.boardId),
      context.supabase.from("whiteboard_edges").select("*").eq("board_id", data.boardId),
    ]);
    if (ne) throw new Error(ne.message);
    if (ee) throw new Error(ee.message);

    // Hydrate task_ref nodes with task info
    const taskIds = (nodes ?? []).filter((n: any) => n.kind === "task_ref" && n.task_id).map((n: any) => n.task_id);
    let taskMap: Record<string, any> = {};
    if (taskIds.length) {
      const { data: tasks } = await context.supabase
        .from("tasks").select("id,title,status,due_at,done").in("id", taskIds);
      for (const t of tasks ?? []) taskMap[(t as any).id] = t;
    }
    return {
      nodes: (nodes ?? []).map((n: any) => ({ ...n, task: n.task_id ? taskMap[n.task_id] ?? null : null })),
      edges: edges ?? [],
    };
  });

export const createNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    board_id: z.string().uuid(),
    kind: z.enum(NODE_KINDS),
    x: z.number(),
    y: z.number(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    data: z.any().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    task_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("whiteboard_nodes").insert({
        user_id: context.userId,
        board_id: data.board_id,
        kind: data.kind,
        x: data.x, y: data.y,
        width: data.width ?? null,
        height: data.height ?? null,
        data: sanitizeNodeData(data.data ?? {}),
        parent_id: data.parent_id ?? null,
        task_id: data.task_id ?? null,
      }).select().single();
    if (error) throw new Error(error.message);
    return { node: row };
  });

export const updateNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().nullable().optional(),
      height: z.number().nullable().optional(),
      data: z.any().optional(),
      z_index: z.number().int().optional(),
    }),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const patch = { ...data.patch };
    if (patch.data !== undefined) patch.data = sanitizeNodeData(patch.data);
    const { error } = await context.supabase
      .from("whiteboard_nodes").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const bulkUpdatePositions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    updates: z.array(z.object({ id: z.string().uuid(), x: z.number(), y: z.number() })).max(500),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await Promise.all(data.updates.map(u =>
      context.supabase.from("whiteboard_nodes").update({ x: u.x, y: u.y }).eq("id", u.id)
    ));
    return { ok: true };
  });

export const deleteNode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("whiteboard_nodes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createEdge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    board_id: z.string().uuid(),
    source_node_id: z.string().uuid(),
    target_node_id: z.string().uuid(),
    kind: z.enum(["line", "arrow", "mindmap"]).default("arrow"),
    color: z.string().max(120).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("whiteboard_edges").insert({
        user_id: context.userId,
        board_id: data.board_id,
        source_node_id: data.source_node_id,
        target_node_id: data.target_node_id,
        kind: data.kind,
        color: data.color ?? "oklch(0.6 0.22 285)",
      }).select().single();
    if (error) throw new Error(error.message);
    return { edge: row };
  });

export const deleteEdge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("whiteboard_edges").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAvailableTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tasks").select("id,title,status,due_at,done,list_id")
      .eq("user_id", context.userId)
      .eq("done", false)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { tasks: data ?? [] };
  });

export const convertNodeToTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    node_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: task, error: te } = await context.supabase
      .from("tasks").insert({
        user_id: context.userId,
        title: data.title,
      }).select().single();
    if (te) throw new Error(te.message);
    const { error: ue } = await context.supabase
      .from("whiteboard_nodes")
      .update({ kind: "task_ref", task_id: (task as any).id })
      .eq("id", data.node_id);
    if (ue) throw new Error(ue.message);
    return { task };
  });

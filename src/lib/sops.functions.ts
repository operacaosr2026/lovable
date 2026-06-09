import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Processes ----------
export const listSopProcesses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("sop_processes")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // Compute progress per process
    const ids = (data ?? []).map((p: any) => p.id);
    let stepsByProcess: Record<string, { total: number; done: number }> = {};
    if (ids.length) {
      const { data: steps } = await supabase
        .from("sop_steps")
        .select("process_id,status")
        .in("process_id", ids);
      for (const s of (steps ?? []) as any[]) {
        const b = (stepsByProcess[s.process_id] ||= { total: 0, done: 0 });
        b.total += 1;
        if (s.status === "done") b.done += 1;
      }
    }
    return { processes: (data ?? []).map((p: any) => ({ ...p, ...(stepsByProcess[p.id] ?? { total: 0, done: 0 }) })) };
  });

export const getSopProcess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: process, error: e1 }, { data: steps, error: e2 }, { data: edges, error: e3 }] =
      await Promise.all([
        supabase.from("sop_processes").select("*").eq("id", data.id).maybeSingle(),
        supabase.from("sop_steps").select("*").eq("process_id", data.id).order("position"),
        supabase.from("sop_edges").select("*").eq("process_id", data.id),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (e3) throw new Error(e3.message);
    return { process, steps: steps ?? [], edges: edges ?? [] };
  });

export const createSopProcess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { name?: string; description?: string; color?: string; icon?: string; is_template?: boolean }) => i)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: maxRow } = await supabase
      .from("sop_processes")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = ((maxRow?.position ?? -1) as number) + 1;
    const { data: row, error } = await supabase
      .from("sop_processes")
      .insert({
        user_id: userId,
        name: data.name ?? "Novo processo",
        description: data.description ?? null,
        color: data.color ?? "oklch(0.6 0.22 285)",
        icon: data.icon ?? null,
        is_template: !!data.is_template,
        position,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { process: row };
  });

export const updateSopProcess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; patch: any }) => i)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("sop_processes").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSopProcess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("sop_processes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateSopProcess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: src } = await supabase.from("sop_processes").select("*").eq("id", data.id).single();
    if (!src) throw new Error("Processo não encontrado");
    const { data: newProc, error: pe } = await supabase
      .from("sop_processes")
      .insert({
        user_id: userId,
        name: `${src.name} (cópia)`,
        description: src.description,
        color: src.color,
        icon: src.icon,
        is_template: false,
      })
      .select("*")
      .single();
    if (pe) throw new Error(pe.message);

    const { data: steps } = await supabase.from("sop_steps").select("*").eq("process_id", data.id);
    const idMap: Record<string, string> = {};
    if (steps && steps.length) {
      // Insert steps without parent first to get new ids, then we'll patch parent
      const rows = steps.map((s: any) => ({
        user_id: userId,
        process_id: newProc.id,
        title: s.title,
        description: s.description,
        status: "todo",
        position: s.position,
        x: s.x,
        y: s.y,
        color: s.color,
        checklist: (s.checklist ?? []).map((c: any) => ({ ...c, done: false })),
        links: s.links,
        media: s.media,
        attachments: [],
        assignee: s.assignee,
        notes: s.notes,
      }));
      const { data: inserted, error: se } = await supabase.from("sop_steps").insert(rows).select("id");
      if (se) throw new Error(se.message);
      steps.forEach((s: any, i: number) => {
        idMap[s.id] = (inserted as any[])[i].id;
      });
      // Patch parents
      const updates = steps.filter((s: any) => s.parent_id).map((s: any) => ({
        id: idMap[s.id],
        parent_id: idMap[s.parent_id],
      }));
      for (const u of updates) {
        await supabase.from("sop_steps").update({ parent_id: u.parent_id }).eq("id", u.id);
      }
    }

    const { data: edges } = await supabase.from("sop_edges").select("*").eq("process_id", data.id);
    if (edges && edges.length) {
      const rows = edges
        .filter((e: any) => idMap[e.source_id] && idMap[e.target_id])
        .map((e: any) => ({
          user_id: userId,
          process_id: newProc.id,
          source_id: idMap[e.source_id],
          target_id: idMap[e.target_id],
        }));
      if (rows.length) await supabase.from("sop_edges").insert(rows);
    }
    return { process: newProc };
  });

// ---------- Steps ----------
export const createSopStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { process_id: string; title?: string; x?: number; y?: number; parent_id?: string | null }) => i)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("sop_steps")
      .insert({
        user_id: userId,
        process_id: data.process_id,
        title: data.title ?? "Nova etapa",
        x: data.x ?? 200,
        y: data.y ?? 200,
        parent_id: data.parent_id ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { step: row };
  });

export const updateSopStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; patch: any }) => i)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: any = { ...data.patch };
    if (patch.status === "done" && !patch.done_at) patch.done_at = new Date().toISOString();
    if (patch.status === "todo") patch.done_at = null;
    const { error } = await supabase.from("sop_steps").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSopStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("sop_steps").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Edges ----------
export const createSopEdge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { process_id: string; source_id: string; target_id: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("sop_edges")
      .insert({ ...data, user_id: userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { edge: row };
  });

export const deleteSopEdge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("sop_edges").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Comments ----------
export const listSopComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { step_id: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("sop_step_comments")
      .select("*")
      .eq("step_id", data.step_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { comments: rows ?? [] };
  });

export const addSopComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { step_id: string; content: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("sop_step_comments")
      .insert({ user_id: userId, step_id: data.step_id, content: data.content })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { comment: row };
  });

export const deleteSopComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("sop_step_comments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Gerencial › Planejamento: objetivos do trimestre (OKR), cada um com
// resultados-chave medidos e as iniciativas que fazem ele andar. Iniciativa
// pode apontar pra um Projeto — aí o progresso dela vem das tarefas do projeto.
// Não exportar valores/funções comuns daqui (só server fns e tipos): o arquivo
// importa client.server e quebraria o build da Vercel no cliente.

type Ctx = { ownerId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const assertAccess = (c: Ctx) => {
  if (c.role !== "admin" && !c.permissions.some((p) => p.section === "gerencial")) throw new Error("Sem acesso ao Gerencial");
};
// As tabelas novas ainda não estão nos tipos gerados do Supabase.
const db = (t: string) => (supabaseAdmin as any).from(t);

export type KrUnit = "numero" | "pct" | "usd";
export type InitiativeStatus = "a_fazer" | "em_andamento" | "concluida";
export type StrategyKr = { id: string; title: string; unit: KrUnit; start_value: number; target_value: number; current_value: number };
export type StrategyInitiative = {
  id: string; title: string; owner_id: string | null; due_date: string | null; status: InitiativeStatus;
  project: { id: string; name: string; progress: number } | null;
};
export type StrategyObjective = {
  id: string; quarter: string; title: string; description: string | null; owner_id: string | null;
  krs: StrategyKr[]; initiatives: StrategyInitiative[];
};

const QUARTER = z.string().regex(/^\d{4}-T[1-4]$/);

export const getStrategy = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ quarter: QUARTER }).parse(d))
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    assertAccess(ctx);
    const { ownerId } = ctx;
    const [{ data: objs, error }, { data: projects }] = await Promise.all([
      db("strategy_objectives").select("id,quarter,title,description,owner_id,position,created_at")
        .eq("user_id", ownerId).eq("quarter", data.quarter).order("position").order("created_at"),
      supabaseAdmin.from("projects").select("id,name").eq("user_id", ownerId).eq("archived", false).order("name"),
    ]);
    if (error) throw new Error(error.message);
    const ids = ((objs ?? []) as any[]).map((o) => o.id as string);
    const [{ data: krs }, { data: inits }] = ids.length
      ? await Promise.all([
          db("strategy_key_results").select("id,objective_id,title,unit,start_value,target_value,current_value,position,created_at")
            .in("objective_id", ids).order("position").order("created_at"),
          db("strategy_initiatives").select("id,objective_id,title,owner_id,due_date,status,project_id,position,created_at")
            .in("objective_id", ids).order("position").order("created_at"),
        ])
      : [{ data: [] }, { data: [] }];

    // Progresso dos projetos ligados = tarefas concluídas / total.
    const projIds = [...new Set(((inits ?? []) as any[]).map((i) => i.project_id).filter(Boolean))] as string[];
    const { data: tasks } = projIds.length
      ? await supabaseAdmin.from("project_tasks").select("project_id,status").in("project_id", projIds)
      : { data: [] as any[] };
    const tally = new Map<string, { t: number; d: number }>();
    for (const t of (tasks ?? []) as any[]) {
      const c = tally.get(t.project_id) ?? { t: 0, d: 0 };
      c.t++; if (t.status === "done") c.d++;
      tally.set(t.project_id, c);
    }
    const projName = new Map(((projects ?? []) as any[]).map((p) => [p.id as string, p.name as string]));

    const objectives: StrategyObjective[] = ((objs ?? []) as any[]).map((o) => ({
      id: o.id, quarter: o.quarter, title: o.title, description: o.description, owner_id: o.owner_id,
      krs: ((krs ?? []) as any[]).filter((k) => k.objective_id === o.id).map((k) => ({
        id: k.id, title: k.title, unit: k.unit, start_value: Number(k.start_value), target_value: Number(k.target_value), current_value: Number(k.current_value),
      })),
      initiatives: ((inits ?? []) as any[]).filter((i) => i.objective_id === o.id).map((i) => {
        const c = i.project_id ? tally.get(i.project_id) : null;
        return {
          id: i.id, title: i.title, owner_id: i.owner_id, due_date: i.due_date, status: i.status,
          project: i.project_id && projName.has(i.project_id)
            ? { id: i.project_id, name: projName.get(i.project_id)!, progress: c?.t ? Math.round((c.d / c.t) * 100) : 0 }
            : null,
        };
      }),
    }));
    return { objectives, projects: ((projects ?? []) as any[]).map((p) => ({ id: p.id as string, name: p.name as string })) };
  });

// Confere que o registro pai é do mesmo dono antes de mexer.
async function assertObjective(ownerId: string, id: string) {
  const { data } = await db("strategy_objectives").select("id").eq("id", id).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Objetivo não encontrado");
}

export const saveObjective = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    quarter: QUARTER,
    title: z.string().trim().min(1).max(160),
    description: z.string().max(1000).nullable().optional(),
    owner_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    assertAccess(ctx);
    const row = { quarter: data.quarter, title: data.title, description: data.description || null, owner_id: data.owner_id ?? null };
    if (data.id) {
      const { error } = await db("strategy_objectives").update(row).eq("id", data.id).eq("user_id", ctx.ownerId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { count } = await db("strategy_objectives").select("id", { count: "exact", head: true }).eq("user_id", ctx.ownerId).eq("quarter", data.quarter);
    const { data: ins, error } = await db("strategy_objectives").insert({ ...row, user_id: ctx.ownerId, position: count ?? 0 }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id as string };
  });

export const saveKeyResult = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    objective_id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    unit: z.enum(["numero", "pct", "usd"]).default("numero"),
    start_value: z.number().finite().default(0),
    target_value: z.number().finite(),
    current_value: z.number().finite().default(0),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    assertAccess(ctx);
    await assertObjective(ctx.ownerId, data.objective_id);
    const { id, ...row } = data;
    if (id) {
      const { error } = await db("strategy_key_results").update(row).eq("id", id).eq("user_id", ctx.ownerId);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { data: ins, error } = await db("strategy_key_results").insert({ ...row, user_id: ctx.ownerId, position: Date.now() % 1_000_000_000 }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id as string };
  });

// Atualizar só o valor atual (edição rápida na linha).
export const setKeyResultValue = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), current_value: z.number().finite() }).parse(d))
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    assertAccess(ctx);
    const { error } = await db("strategy_key_results").update({ current_value: data.current_value }).eq("id", data.id).eq("user_id", ctx.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveInitiative = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    objective_id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    owner_id: z.string().uuid().nullable().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    status: z.enum(["a_fazer", "em_andamento", "concluida"]).default("a_fazer"),
    project_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    assertAccess(ctx);
    await assertObjective(ctx.ownerId, data.objective_id);
    if (data.project_id) {
      const { data: p } = await supabaseAdmin.from("projects").select("id").eq("id", data.project_id).eq("user_id", ctx.ownerId).maybeSingle();
      if (!p) throw new Error("Projeto não encontrado");
    }
    const { id, ...rest } = data;
    const row = { ...rest, owner_id: rest.owner_id ?? null, due_date: rest.due_date || null, project_id: rest.project_id ?? null };
    if (id) {
      const { error } = await db("strategy_initiatives").update(row).eq("id", id).eq("user_id", ctx.ownerId);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { data: ins, error } = await db("strategy_initiatives").insert({ ...row, user_id: ctx.ownerId, position: Date.now() % 1_000_000_000 }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id as string };
  });

export const setInitiativeStatus = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), status: z.enum(["a_fazer", "em_andamento", "concluida"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    assertAccess(ctx);
    const { error } = await db("strategy_initiatives").update({ status: data.status }).eq("id", data.id).eq("user_id", ctx.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteStrategyItem = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ kind: z.enum(["objective", "kr", "initiative"]), id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    assertAccess(ctx);
    const table = data.kind === "objective" ? "strategy_objectives" : data.kind === "kr" ? "strategy_key_results" : "strategy_initiatives";
    const { error } = await db(table).delete().eq("id", data.id).eq("user_id", ctx.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

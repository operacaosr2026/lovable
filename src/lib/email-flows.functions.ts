import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { getZohoAccount } from "@/lib/zoho-mail.server";
import { activeShops, enrollAudience, fdb, matchAudience, type AudienceOrder } from "@/lib/email-flows.server";
import { FLOW_STOP_RULES, flowFiltersSchema, flowStepSchema, type FlowFilters, type FlowStep } from "@/lib/email-flows";

// Notificações › Fluxos: sequência de e-mails pra um público escolhido por
// filtro. Motor em email-flows.server.ts (roda no cron da fila da aba).
// Acesso: admin, ou membro com a permissão "avisos_clientes".

type Ctx = { role: "admin" | "member"; ownerId: string; userId: string; permissions: { section: string }[] };
function assertAccess(ctx: Ctx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "avisos_clientes")) {
    throw new Error("Sem acesso a Notificações");
  }
}

export type EmailFlow = {
  id: string; name: string; mode: "campanha" | "continuo"; status: "rascunho" | "ativo" | "pausado" | "concluido";
  filters: FlowFilters; steps: FlowStep[]; stopRules: string[]; activatedAt: string | null; createdAt: string;
  counts: { ativo: number; concluido: number; parado: number; emails: number };
};

export const listEmailFlows = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<{ flows: EmailFlow[]; shops: { id: string; name: string }[] }> => {
    assertAccess(context);
    const [flows, enrolls, shops] = await Promise.all([
      fdb("email_flows").select("id,name,mode,status,filters,steps,stop_rules,activated_at,created_at").eq("owner_id", context.ownerId).order("created_at", { ascending: false }),
      selectAll<any>(fdb("email_flow_enrollments").select("flow_id,status,emails_sent").eq("owner_id", context.ownerId)),
      activeShops(context.ownerId),
    ]);
    if (flows.error) throw new Error(flows.error.message);
    if (enrolls.error) throw new Error(enrolls.error.message);
    const counts = new Map<string, EmailFlow["counts"]>();
    for (const e of enrolls.data) {
      const c = counts.get(e.flow_id) ?? { ativo: 0, concluido: 0, parado: 0, emails: 0 };
      c[e.status as "ativo"]++;
      c.emails += e.emails_sent ?? 0;
      counts.set(e.flow_id, c);
    }
    return {
      flows: (flows.data ?? []).map((f: any) => ({
        id: f.id, name: f.name, mode: f.mode, status: f.status,
        filters: flowFiltersSchema.catch(flowFiltersSchema.parse({})).parse(f.filters),
        steps: z.array(flowStepSchema).catch([]).parse(f.steps), stopRules: f.stop_rules ?? [],
        activatedAt: f.activated_at, createdAt: f.created_at,
        counts: counts.get(f.id) ?? { ativo: 0, concluido: 0, parado: 0, emails: 0 },
      })),
      shops: [...shops.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

// Quem bate no filtro agora (conta + os primeiros pra conferir).
export const previewFlowAudience = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ filters: flowFiltersSchema }).parse(d))
  .handler(async ({ data, context }): Promise<{ count: number; sample: AudienceOrder[] }> => {
    assertAccess(context);
    const list = await matchAudience(context.ownerId, data.filters);
    return { count: list.length, sample: list.slice(0, 20) };
  });

export const saveEmailFlow = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().nullable(),
    name: z.string().trim().min(1).max(120),
    mode: z.enum(["campanha", "continuo"]),
    filters: flowFiltersSchema,
    steps: z.array(flowStepSchema).max(30),
    stopRules: z.array(z.enum(FLOW_STOP_RULES.map((r) => r.key) as [string, ...string[]])).max(10),
    activate: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const ownerId = context.ownerId;
    if (data.activate) {
      if (!data.steps.some((s) => s.type === "email")) throw new Error("A sequência precisa de pelo menos um e-mail");
      const acc = await getZohoAccount(ownerId);
      if (!acc?.refresh_token || !acc.account_id) throw new Error("Zoho Mail não conectado (Atendimento → Configurações)");
    }
    const fields = { name: data.name, mode: data.mode, filters: data.filters, steps: data.steps, stop_rules: data.stopRules };
    let flow: any;
    if (data.id) {
      const { data: cur } = await fdb("email_flows").select("id,status,activated_at").eq("id", data.id).eq("owner_id", ownerId).maybeSingle();
      if (!cur) throw new Error("Fluxo não encontrado");
      const { data: row, error } = await fdb("email_flows").update(fields).eq("id", data.id).select("*").single();
      if (error) throw new Error(error.message);
      flow = row;
    } else {
      const { data: row, error } = await fdb("email_flows").insert({ ...fields, owner_id: ownerId, created_by: context.userId }).select("*").single();
      if (error) throw new Error(error.message);
      flow = row;
    }
    let enrolled = 0;
    if (data.activate && flow.status !== "ativo") {
      // Campanha: o público é tirado só na 1ª ativação. Contínuo: o cron põe os novos.
      if (!flow.activated_at || flow.mode === "continuo") enrolled = await enrollAudience(ownerId, flow);
      const { error } = await fdb("email_flows").update({ status: "ativo", activated_at: flow.activated_at ?? new Date().toISOString() }).eq("id", flow.id);
      if (error) throw new Error(error.message);
    }
    return { id: flow.id as string, enrolled };
  });

export const setEmailFlowStatus = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), status: z.enum(["ativo", "pausado"]) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { data: flow } = await fdb("email_flows").select("*").eq("id", data.id).eq("owner_id", context.ownerId).maybeSingle();
    if (!flow) throw new Error("Fluxo não encontrado");
    let enrolled = 0;
    if (data.status === "ativo") {
      if (!z.array(flowStepSchema).catch([]).parse(flow.steps).some((s) => s.type === "email")) throw new Error("A sequência precisa de pelo menos um e-mail");
      if (!flow.activated_at || flow.mode === "continuo") enrolled = await enrollAudience(context.ownerId, flow);
    }
    const { error } = await fdb("email_flows").update({
      status: data.status, ...(data.status === "ativo" && !flow.activated_at ? { activated_at: new Date().toISOString() } : {}),
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { enrolled };
  });

export const deleteEmailFlow = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { data: enrolls } = await selectAll<any>(fdb("email_flow_enrollments").select("id").eq("flow_id", data.id).eq("owner_id", context.ownerId));
    // E-mails dele na fila não saem (apagar o fluxo solta o vínculo da fila).
    const ids = enrolls.map((e) => e.id);
    for (let i = 0; i < ids.length; i += 200) {
      await supabaseAdmin.from("order_notices").update({ status: "cancelado", error: "fluxo apagado" })
        .in("flow_enrollment_id" as any, ids.slice(i, i + 200)).in("status", ["na_fila"]);
    }
    const { error } = await fdb("email_flows").delete().eq("id", data.id).eq("owner_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type FlowEnrollment = {
  id: string; orderNumber: string; shopName: string; email: string; stepIndex: number; emailsSent: number;
  nextAt: string; status: "ativo" | "concluido" | "parado"; stopReason: string | null; enrolledAt: string; finishedAt: string | null;
};

export const listFlowEnrollments = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ flowId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<FlowEnrollment[]> => {
    assertAccess(context);
    const { data: rows, error } = await selectAll<any>(fdb("email_flow_enrollments")
      .select("id,to_email,step_index,emails_sent,next_at,status,stop_reason,enrolled_at,finished_at,shop_orders(order_number),shops(name)")
      .eq("flow_id", data.flowId).eq("owner_id", context.ownerId).order("enrolled_at", { ascending: false }));
    if (error) throw new Error(error.message);
    return rows.map((r) => ({
      id: r.id, orderNumber: String(r.shop_orders?.order_number ?? ""), shopName: r.shops?.name ?? "", email: r.to_email,
      stepIndex: r.step_index, emailsSent: r.emails_sent, nextAt: r.next_at, status: r.status, stopReason: r.stop_reason,
      enrolledAt: r.enrolled_at, finishedAt: r.finished_at,
    }));
  });

// Tira uma pessoa do fluxo na mão.
export const stopFlowEnrollment = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { error } = await fdb("email_flow_enrollments").update({ status: "parado", stop_reason: "tirado na mão", finished_at: new Date().toISOString() })
      .eq("id", data.id).eq("owner_id", context.ownerId).eq("status", "ativo");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

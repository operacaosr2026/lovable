import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runConsultant, runRequestedAnalysis, type ConsultantResult } from "@/lib/consultant.server";
import { resolveNotification } from "@/lib/notifications.server";
import { isoDateUS, isoTodayUS } from "@/lib/timezone";

// Página Consultor (ver consultant.server.ts). Acesso: admin, ou membro com a
// permissão "consultor".

export type TipStatus = "testando" | "feita" | "ignorada";
export type ConsultantReport = {
  id: string; createdAt: string; periodFrom: string; periodTo: string; model: string | null;
  result: ConsultantResult; tipsStatus: Record<string, { status: TipStatus; at: string }>; facts: Record<string, any>;
};

function assertAccess(context: any) {
  if (context.role !== "admin" && !context.permissions.some((p: any) => p.section === "consultor")) {
    throw new Error("Sem acesso ao Consultor");
  }
}

export const getConsultant = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ report_id: z.string().uuid().nullable().optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    assertAccess(context);
    const { data: history, error } = await supabaseAdmin.from("consultant_reports")
      .select("id,created_at").eq("user_id", context.ownerId).order("created_at", { ascending: false }).limit(30);
    // Migration ainda não rodada: página vazia em vez de erro.
    if (error?.code === "42P01" || error?.code === "PGRST205") return { report: null, history: [] };
    if (error) throw new Error(error.message);
    const id = data.report_id ?? history?.[0]?.id;
    let report: ConsultantReport | null = null;
    if (id) {
      const { data: r } = await supabaseAdmin.from("consultant_reports").select("*")
        .eq("user_id", context.ownerId).eq("id", id).maybeSingle();
      if (r) report = {
        id: r.id, createdAt: r.created_at, periodFrom: r.period_from, periodTo: r.period_to, model: r.model,
        result: r.result as any, tipsStatus: (r.tips_status ?? {}) as any, facts: (r.facts ?? {}) as Record<string, any>,
      };
    }
    // Abriu a página: o aviso "análise nova" sai do sino.
    await resolveNotification(context.ownerId, "consultor:analise").catch(() => {});
    return { report, history: (history ?? []).map((h) => ({ id: h.id, createdAt: h.created_at })) };
  });

export const runConsultantNow = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAccess(context);
    // Análise completa custa caro: no máximo 1 por dia (dia de Nova York).
    const { data: last } = await supabaseAdmin.from("consultant_reports").select("created_at")
      .eq("user_id", context.ownerId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && isoDateUS(last.created_at) === isoTodayUS()) {
      throw new Error("Já tem uma análise de hoje. A próxima pode ser feita amanhã.");
    }
    const r = await runConsultant(context.ownerId);
    return { id: r.id };
  });

// "Pedir análise": investigação nova sobre o que o dono escrever.
export const requestConsultantAnalysis = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ pedido: z.string().trim().min(5).max(800) }).parse(d))
  .handler(async ({ context, data }) => {
    assertAccess(context);
    return runRequestedAnalysis(context.ownerId, data.pedido);
  });

// Encerrar teste (aba Testando). Teste marcado na tela (origem "<report>:<índice>"):
// a dica vira "feita". Teste que veio do contexto do dono: entra no contexto
// como encerrado, pra IA não avaliar mais. Nos dois casos sai da análise atual.
export const endConsultantTest = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    report_id: z.string().uuid(), titulo: z.string().min(1).max(300), origem: z.string().max(80).nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    assertAccess(context);
    const owner = context.ownerId;
    const now = new Date().toISOString();
    const [rid, idx] = (data.origem ?? "").split(":");
    if (rid && idx != null && /^[0-9a-f-]{36}$/.test(rid)) {
      const { data: r } = await supabaseAdmin.from("consultant_reports").select("tips_status").eq("user_id", owner).eq("id", rid).maybeSingle();
      if (r) {
        const tips = { ...((r.tips_status ?? {}) as Record<string, unknown>), [String(Number(idx))]: { status: "feita", at: now } };
        await supabaseAdmin.from("consultant_reports").update({ tips_status: tips as any }).eq("user_id", owner).eq("id", rid);
      }
    } else {
      const { data: st } = await supabaseAdmin.from("consultant_settings").select("context").eq("user_id", owner).maybeSingle();
      const line = `Teste encerrado em ${now.slice(0, 10)}: "${data.titulo}" — não avaliar mais.`;
      const { error } = await supabaseAdmin.from("consultant_settings")
        .upsert({ user_id: owner, context: [st?.context?.trim(), line].filter(Boolean).join("\n"), updated_at: now });
      if (error) throw new Error(error.message);
    }
    const { data: rep } = await supabaseAdmin.from("consultant_reports").select("result").eq("user_id", owner).eq("id", data.report_id).maybeSingle();
    if (rep) {
      const result = rep.result as any;
      result.testes_avaliados = (result.testes_avaliados ?? []).filter((t: any) => t.titulo !== data.titulo);
      await supabaseAdmin.from("consultant_reports").update({ result }).eq("user_id", owner).eq("id", data.report_id);
    }
    return { ok: true };
  });

export const setConsultantTipStatus = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    report_id: z.string().uuid(),
    index: z.number().int().min(0).max(50),
    status: z.enum(["testando", "feita", "ignorada"]).nullable(),
    // Motivo ao ignorar: "ja_sei" (a IA deixa de sugerir o assunto) ou "sem_sentido".
    motivo: z.enum(["ja_sei", "sem_sentido"]).nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    assertAccess(context);
    const { data: r, error } = await supabaseAdmin.from("consultant_reports").select("tips_status")
      .eq("user_id", context.ownerId).eq("id", data.report_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) throw new Error("Análise não encontrada");
    const tips = { ...((r.tips_status ?? {}) as Record<string, unknown>) };
    if (data.status) tips[String(data.index)] = { status: data.status, at: new Date().toISOString(), ...(data.motivo ? { motivo: data.motivo } : {}) };
    else delete tips[String(data.index)];
    const { error: upErr } = await supabaseAdmin.from("consultant_reports").update({ tips_status: tips as any })
      .eq("user_id", context.ownerId).eq("id", data.report_id);
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

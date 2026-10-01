import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runConsultant, type ConsultantResult } from "@/lib/consultant.server";
import { resolveNotification } from "@/lib/notifications.server";

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
    const r = await runConsultant(context.ownerId);
    return { id: r.id };
  });

export const setConsultantTipStatus = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    report_id: z.string().uuid(),
    index: z.number().int().min(0).max(50),
    status: z.enum(["testando", "feita", "ignorada"]).nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    assertAccess(context);
    const { data: r, error } = await supabaseAdmin.from("consultant_reports").select("tips_status")
      .eq("user_id", context.ownerId).eq("id", data.report_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) throw new Error("Análise não encontrada");
    const tips = { ...((r.tips_status ?? {}) as Record<string, unknown>) };
    if (data.status) tips[String(data.index)] = { status: data.status, at: new Date().toISOString() };
    else delete tips[String(data.index)];
    const { error: upErr } = await supabaseAdmin.from("consultant_reports").update({ tips_status: tips as any })
      .eq("user_id", context.ownerId).eq("id", data.report_id);
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { alertShopIds, loadAlerts, getChargebackSettings as readSettings, sendDunningEmail } from "@/lib/chargeback-alerts.server";
import { ALERT_STATUSES, type AlertRow } from "@/lib/chargeback-alerts.shared";

// Chargebacks > Alertas e Chargebacks > Configurações (sequência de cobrança).
// A lógica fica em chargeback-alerts.server.ts; aqui só as chamadas da tela.

type Ctx = { role: string; ownerId: string; permissions: { section: string }[] };
function assertAccess(ctx: Ctx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "chargebacks")) throw new Error("Sem acesso a Chargebacks");
}

export const getChargebackAlerts = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAccess(context);
    const rows: AlertRow[] = await loadAlerts(context.ownerId, await alertShopIds(context.ownerId));
    return { rows };
  });

export const saveAlertFollowup = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shopId: z.string().uuid(), orderExternalId: z.string().min(1).max(40),
    status: z.enum(ALERT_STATUSES), recoveredAmount: z.number().min(0).max(100_000).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    dunningPaused: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { data: shop } = await supabaseAdmin.from("shops").select("id").eq("id", data.shopId).eq("user_id", context.ownerId).maybeSingle();
    if (!shop) throw new Error("Loja não encontrada");
    const { error } = await supabaseAdmin.from("chargeback_alert_followups").upsert({
      shop_id: data.shopId, order_external_id: data.orderExternalId, user_id: context.ownerId,
      status: data.status, recovered_amount: data.status === "recuperado" ? data.recoveredAmount ?? null : null,
      note: data.note?.trim() || null, updated_at: new Date().toISOString(), updated_by: context.userId,
      // Pausar/retomar a cobrança automática (retomar limpa o motivo da parada).
      ...(data.dunningPaused !== undefined ? { dunning_paused: data.dunningPaused, dunning_stop_reason: data.dunningPaused ? "pausado" : null } : {}),
    }, { onConflict: "shop_id,order_external_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Configurações ────────────────────────────────────────────────────────────

const Step = z.object({ subject: z.string().max(300), body: z.string().max(20_000), days: z.number().min(0).max(90) });

export const getChargebackSettings = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAccess(context);
    return readSettings(context.ownerId);
  });

export const saveChargebackSettings = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    dunningEnabled: z.boolean(),
    dunningSteps: z.array(Step).max(10),
    dunningFinalWaitDays: z.number().int().min(1).max(60),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const steps = data.dunningSteps.map((s) => ({ subject: s.subject.trim(), body: s.body.trim(), days: s.days }));
    if (data.dunningEnabled && !steps.some((s) => s.subject && s.body)) throw new Error("Escreva pelo menos um e-mail antes de ligar a sequência");
    const { error } = await supabaseAdmin.from("chargeback_settings").upsert({
      owner_id: context.ownerId, dunning_enabled: data.dunningEnabled, dunning_steps: steps,
      dunning_final_wait_days: data.dunningFinalWaitDays, updated_at: new Date().toISOString(), updated_by: context.userId,
    }, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// E-mail de teste pro próprio usuário, com os dados de um alerta de verdade (o
// entregue mais recente) — só pra ver como o texto chega.
export const sendDunningTest = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => Step.parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    if (!data.subject.trim() || !data.body.trim()) throw new Error("Preencha o assunto e o texto");
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const to = u?.user?.email;
    if (!to) throw new Error("Seu usuário não tem e-mail");
    const rows = await loadAlerts(context.ownerId, await alertShopIds(context.ownerId));
    const sample = rows.find((r) => r.deliveryStatus === "delivered") ?? rows[0];
    if (!sample) throw new Error("Nenhum alerta pra usar de exemplo");
    await sendDunningEmail(context.ownerId, context.userId, to, { ...data, subject: `[TESTE] ${data.subject}` }, sample);
    return { to, orderNumber: sample.orderNumber };
  });

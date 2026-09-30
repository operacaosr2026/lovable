import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { alertShopIds, loadAlerts, getChargebackSettings as readSettings } from "@/lib/chargeback-alerts.server";
import { ensureRecoveryLink } from "@/lib/chargeback-recovery.server";
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
    const shopIds = await alertShopIds(context.ownerId);
    const [rows, { data: sends }] = await Promise.all([
      loadAlerts(context.ownerId, shopIds) as Promise<AlertRow[]>,
      shopIds.length
        ? supabaseAdmin.from("chargeback_dunning_sends").select("step,sent_at").eq("user_id", context.ownerId).in("shop_id", shopIds)
        : Promise.resolve({ data: [] as { step: number; sent_at: string }[] }),
    ]);
    // Métrica: cada e-mail que saiu da sequência (etapa + data, pro filtro de período).
    return { rows, sends: (sends ?? []).map((x) => ({ step: x.step, sentAt: x.sent_at })) };
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
    // Métrica: quando virou Recuperado e depois de quantos e-mails da sequência.
    const { data: prev } = await supabaseAdmin.from("chargeback_alert_followups").select("status,dunning_step,recovered_at,recovered_step")
      .eq("shop_id", data.shopId).eq("order_external_id", data.orderExternalId).maybeSingle();
    const recovered = data.status !== "recuperado" ? { recovered_at: null, recovered_step: null }
      : prev?.status === "recuperado" ? {}
      : { recovered_at: new Date().toISOString(), recovered_step: prev?.dunning_step ?? 0 };
    const { error } = await supabaseAdmin.from("chargeback_alert_followups").upsert({
      ...recovered,
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

// Botão "Link de pagamento" da lista: cria o pedido de cobrança na Shopify (ou
// devolve o que já existe) — o mesmo link que a sequência usa no {link_pagamento}.
export const createRecoveryPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shopId: z.string().uuid(), orderExternalId: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const shopIds = await alertShopIds(context.ownerId);
    if (!shopIds.includes(data.shopId)) throw new Error("Loja não encontrada");
    const row = (await loadAlerts(context.ownerId, [data.shopId])).find((r) => r.orderExternalId === data.orderExternalId);
    if (!row) throw new Error("Alerta não encontrado");
    if (row.recoveryOrderId) throw new Error(`Já pago no pedido ${row.recoveryOrderName ?? ""}`.trim());
    return { url: await ensureRecoveryLink(context.ownerId, row) };
  });

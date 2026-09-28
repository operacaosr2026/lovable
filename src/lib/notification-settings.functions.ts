import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { NOTIFICATION_CATEGORIES, allowedCategories } from "@/lib/notification-categories";
import { getUserNotificationPrefs } from "@/lib/notify.server";
import { pushConfigured, sendPushToUser, vapidPublicKey } from "@/lib/push.server";

// Configurações > Notificações: cada pessoa vê e muda só o que é dela
// (tipos liberados pelo admin, Não Perturbe, dispositivos). Tudo filtrado
// pelo usuário logado — nunca por id vindo da tela.

const hasBell = (ctx: { role: string; permissions: { section: string }[] }) =>
  ctx.role === "admin" || ctx.permissions.some((p) => p.section === "notificacoes");

export const getNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const allowed = allowedCategories(context.role, context.permissions);
    const [prefs, { data: devices }] = await Promise.all([
      getUserNotificationPrefs(context.userId),
      supabaseAdmin.from("push_subscriptions").select("id,endpoint,device_label,created_at,last_used_at,disabled_at")
        .eq("user_id", context.userId).order("created_at", { ascending: false }),
    ]);
    return {
      hasBell: hasBell(context),
      categories: NOTIFICATION_CATEGORIES.filter((c) => allowed.has(c.key))
        .map((c) => ({ key: c.key, label: c.label, desc: c.desc, enabled: !prefs.muted.has(c.key) })),
      dnd: { enabled: prefs.dndEnabled, start: prefs.dndStart, end: prefs.dndEnd },
      timezone: prefs.timezone,
      // O endpoint vai pra tela só pra ela saber qual dos dispositivos é "este".
      devices: (devices ?? []).map((d) => ({
        id: d.id, endpoint: d.endpoint, label: d.device_label, createdAt: d.created_at,
        lastUsedAt: d.last_used_at, active: !d.disabled_at,
      })),
      push: { configured: pushConfigured(), publicKey: vapidPublicKey() },
    };
  });

const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const validTimeZone = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

export const saveNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    // Tipos desligados pela pessoa (só entre os liberados pra ela).
    muted: z.array(z.string().max(40)).max(50).optional(),
    dnd: z.object({ enabled: z.boolean(), start: Hhmm, end: Hhmm }).optional(),
    timezone: z.string().max(60).refine(validTimeZone, "Fuso inválido").optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const allowed = allowedCategories(context.role, context.permissions);
    const row: Record<string, unknown> = { user_id: context.userId, updated_at: new Date().toISOString() };
    if (data.muted) row.muted_categories = [...new Set(data.muted.filter((c) => allowed.has(c as any)))];
    if (data.dnd) { row.dnd_enabled = data.dnd.enabled; row.dnd_start = data.dnd.start; row.dnd_end = data.dnd.end; }
    if (data.timezone) row.timezone = data.timezone;
    const { error } = await supabaseAdmin.from("notification_settings").upsert(row as any, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "Endpoint inválido"),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
    label: z.string().trim().max(80).optional(),
    timezone: z.string().max(60).refine(validTimeZone).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (!hasBell(context)) throw new Error("Sem acesso às notificações — peça ao administrador");
    // Mesmo aparelho reativado (ou outra pessoa logando nele): o endpoint é
    // único, então a linha passa a ser de quem ativou agora.
    const { error } = await supabaseAdmin.from("push_subscriptions").upsert({
      endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth,
      user_id: context.userId, owner_id: context.ownerId, device_label: data.label ?? null,
      created_at: new Date().toISOString(), failure_count: 0, disabled_at: null,
    }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
    // Fuso do aparelho vira o padrão do Não Perturbe (só na primeira vez).
    if (data.timezone) {
      await supabaseAdmin.from("notification_settings")
        .upsert({ user_id: context.userId, timezone: data.timezone }, { onConflict: "user_id", ignoreDuplicates: true });
    }
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid().optional(), endpoint: z.string().max(1000).optional() })
    .refine((v) => v.id || v.endpoint, "Informe o dispositivo").parse(d))
  .handler(async ({ data, context }) => {
    let q = supabaseAdmin.from("push_subscriptions").delete().eq("user_id", context.userId);
    q = data.id ? q.eq("id", data.id) : q.eq("endpoint", data.endpoint!);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Teste de verdade: servidor → serviço de push (Apple/Google/Mozilla) → aparelhos.
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    if (!pushConfigured()) throw new Error("Push não configurado no servidor (faltam as chaves VAPID nas variáveis de ambiente)");
    // Contra abuso: 1 teste a cada 15 s por pessoa.
    const { data: last } = await supabaseAdmin.from("push_log").select("created_at")
      .eq("user_id", context.userId).eq("notification_key", "test").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.created_at).getTime() < 15_000) throw new Error("Aguarde alguns segundos pra testar de novo");
    const r = await sendPushToUser(context.ownerId, context.userId, {
      title: "🔔 SRX Growth", body: "As notificações estão funcionando neste dispositivo.", url: "/settings/notificacoes", tag: "test",
    }, "test");
    if (!r.sent && !r.failed) throw new Error("Nenhum dispositivo ativo — ative as notificações neste aparelho primeiro");
    return r;
  });

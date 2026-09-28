import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Canal "push no celular" (Web Push com VAPID): iPhone com o app na Tela de
// Início (iOS 16.4+), Chrome/Edge/Firefox, Android e Safari do Mac. As chaves
// ficam só nas variáveis de ambiente (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
// VAPID_SUBJECT); a pública vai pro navegador ao ativar o dispositivo.

export type PushPayload = { title: string; body?: string | null; url?: string | null; tag?: string | null };

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

let vapidSet = false;
function ensureVapid() {
  if (vapidSet) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "https://lojas-one.vercel.app",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  vapidSet = true;
}

// Depois de tantas falhas seguidas (sem ser "não existe mais"), para de tentar.
const MAX_FAILURES = 10;

// Manda pra todos os dispositivos ativos da pessoa e registra cada envio.
// Dispositivo que o serviço diz não existir mais (404/410) é desativado na hora.
// Nunca lança — quem chamou (sino, webhook, cron) não pode quebrar por causa do push.
export async function sendPushToUser(
  ownerId: string, userId: string, payload: PushPayload, notificationKey: string,
): Promise<{ sent: number; failed: number }> {
  if (!pushConfigured()) return { sent: 0, failed: 0 };
  try {
    ensureVapid();
    const { data: subs } = await supabaseAdmin.from("push_subscriptions")
      .select("id,endpoint,p256dh,auth,failure_count").eq("user_id", userId).is("disabled_at", null);
    if (!subs?.length) return { sent: 0, failed: 0 };
    // Só o necessário pra mostrar e abrir a tela certa — nada sensível.
    const body = JSON.stringify({
      title: payload.title.slice(0, 120),
      body: (payload.body ?? "").slice(0, 300),
      url: payload.url ?? "/",
      tag: payload.tag ?? notificationKey,
    });
    let sent = 0, failed = 0;
    const now = new Date().toISOString();
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 24 * 3600, urgency: "high" },
        );
        sent++;
        await Promise.all([
          supabaseAdmin.from("push_subscriptions").update({ last_used_at: now, failure_count: 0 }).eq("id", s.id),
          supabaseAdmin.from("push_log").insert({ owner_id: ownerId, user_id: userId, subscription_id: s.id, notification_key: notificationKey, title: payload.title.slice(0, 200), status: "sent" }),
        ]);
      } catch (e: any) {
        failed++;
        const code = Number(e?.statusCode ?? 0);
        const gone = code === 404 || code === 410;
        const failures = (s.failure_count ?? 0) + 1;
        await Promise.all([
          supabaseAdmin.from("push_subscriptions").update({
            failure_count: failures,
            ...(gone || failures >= MAX_FAILURES ? { disabled_at: now } : {}),
          }).eq("id", s.id),
          supabaseAdmin.from("push_log").insert({
            owner_id: ownerId, user_id: userId, subscription_id: s.id, notification_key: notificationKey,
            title: payload.title.slice(0, 200), status: "failed",
            // Só o código e a mensagem curta — sem endpoint nem chaves.
            error: `${code || "erro"}${gone ? " (dispositivo não existe mais — desativado)" : ""}: ${String(e?.body ?? e?.message ?? "").slice(0, 200)}`,
          }),
        ]);
      }
    }));
    return { sent, failed };
  } catch (e) {
    console.error("sendPushToUser", userId, e instanceof Error ? e.message : e);
    return { sent: 0, failed: 0 };
  }
}

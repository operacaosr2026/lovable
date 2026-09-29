import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveWorkspaceAccess } from "@/integrations/supabase/workspace-middleware";
import { allowedCategories, categoryOfKey, type NotificationCategory } from "@/lib/notification-categories";
import { sendPushToUser } from "@/lib/push.server";

// Motor das notificações: um aviso novo no sino (ou que voltou depois de
// resolvido) vira push pras pessoas certas. O próprio sino já deduplica por
// problema (key) — um problema repetido 50 vezes é 1 aviso = 1 push.
//
//   aviso → destinatários (dono + membros, ou só o destinatário do aviso)
//         → tipo liberado pro membro (Configurações > Membros)
//         → tipo ligado pela pessoa (Configurações > Notificações)
//         → Não Perturbe (no fuso da pessoa)
//         → canais (hoje: push) → registro em push_log
//
// Outros canais (e-mail, WhatsApp…) entram aqui como mais um "envia por".

export type NotifyInput = {
  key: string; title: string; body?: string | null; link?: string | null; level?: string;
  targetUserId?: string | null;
  // Horário escolhido pela própria pessoa (Lucro do dia): chega mesmo no Não Perturbe.
  ignoreDnd?: boolean;
};

export type UserNotificationPrefs = {
  muted: Set<string>; dndEnabled: boolean; dndStart: string; dndEnd: string; timezone: string; profitTimes: string[];
};

// Padrão pra quem nunca mexeu (igual ao DEFAULT da tabela notification_settings).
export const DEFAULT_PROFIT_TIMES = ["00:00", "12:00", "20:00"];
export const DEFAULT_DND = { start: "00:00", end: "07:00" };

export async function getUserNotificationPrefs(userId: string): Promise<UserNotificationPrefs> {
  const { data } = await supabaseAdmin.from("notification_settings")
    .select("muted_categories,dnd_enabled,dnd_start,dnd_end,timezone,profit_times").eq("user_id", userId).maybeSingle();
  return {
    muted: new Set(data?.muted_categories ?? []),
    dndEnabled: data?.dnd_enabled ?? false,
    dndStart: data?.dnd_start ?? DEFAULT_DND.start,
    dndEnd: data?.dnd_end ?? DEFAULT_DND.end,
    timezone: data?.timezone ?? "America/Sao_Paulo",
    profitTimes: data?.profit_times ?? DEFAULT_PROFIT_TIMES,
  };
}

// Agora está dentro do horário de silêncio (no fuso da pessoa)? Aceita faixa
// que vira a meia-noite (23:00 → 07:00).
export function inQuietHours(p: UserNotificationPrefs, now = new Date()): boolean {
  if (!p.dndEnabled || p.dndStart === p.dndEnd) return false;
  let hhmm: string;
  try {
    hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: p.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  } catch {
    return false;
  }
  return p.dndStart < p.dndEnd ? hhmm >= p.dndStart && hhmm < p.dndEnd : hhmm >= p.dndStart || hhmm < p.dndEnd;
}

// A pessoa vê/recebe esse tipo? (liberado pelo admin e não desligado por ela)
export function canReceive(
  category: NotificationCategory | null, access: { role: string; permissions: { section: string }[] }, muted: Set<string>,
): boolean {
  const hasBell = access.role === "admin" || access.permissions.some((p) => p.section === "notificacoes");
  if (!hasBell) return false;
  if (!category) return true;
  return allowedCategories(access.role, access.permissions).has(category) && !muted.has(category);
}

async function workspacePeople(ownerId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("workspace_members").select("member_id").eq("owner_id", ownerId);
  return [ownerId, ...((data ?? []) as { member_id: string }[]).map((m) => m.member_id)];
}

// Nunca lança: aviso no sino não pode falhar por causa do push.
export async function notifyPeople(ownerId: string, n: NotifyInput) {
  try {
    const category = categoryOfKey(n.key);
    const people = n.targetUserId ? [n.targetUserId] : await workspacePeople(ownerId);
    await Promise.all(people.map(async (userId) => {
      const [access, prefs] = await Promise.all([resolveWorkspaceAccess(supabaseAdmin, userId), getUserNotificationPrefs(userId)]);
      if (access.ownerId !== ownerId || !canReceive(category, access, prefs.muted)) return;
      if (!n.ignoreDnd && inQuietHours(prefs)) {
        await supabaseAdmin.from("push_log").insert({
          owner_id: ownerId, user_id: userId, notification_key: n.key, title: n.title.slice(0, 200),
          status: "skipped", error: "Não Perturbe",
        });
        return;
      }
      await sendPushToUser(ownerId, userId, { title: n.title, body: n.body, url: n.link || "/", tag: n.key }, n.key);
    }));
  } catch (e) {
    console.error("notifyPeople", n.key, e instanceof Error ? e.message : e);
  }
}

// Evento (venda nova, e-mail novo, meta atingida): registra a chave uma vez
// só por workspace e só o primeiro a registrar manda o push — o mesmo pedido
// chegando 2x pelo webhook, ou a meta checada a cada 10 min, avisa uma vez.
// Não vai pro sino (ele é pra problemas). Nunca lança.
export async function emitEvent(ownerId: string, n: NotifyInput) {
  try {
    const { data, error } = await supabaseAdmin.from("notification_events")
      .upsert({ owner_id: ownerId, key: n.key }, { onConflict: "owner_id,key", ignoreDuplicates: true })
      .select("key");
    if (error || !data?.length) return;   // já avisado (ou falhou ao registrar)
    await notifyPeople(ownerId, n);
  } catch (e) {
    console.error("emitEvent", n.key, e instanceof Error ? e.message : e);
  }
}

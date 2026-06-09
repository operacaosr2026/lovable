import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronApiKey } from "@/lib/cron-auth";

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";

async function sendWhatsApp(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
  const FROM = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
  if (!LOVABLE_API_KEY || !TWILIO_API_KEY || !FROM) {
    return { ok: false, error: "twilio not configured" };
  }
  const dest = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const res = await fetch(`${TWILIO_GATEWAY}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: dest, From: FROM, Body: body }),
  });
  if (!res.ok) return { ok: false, error: `twilio ${res.status}` };
  return { ok: true };
}

export const Route = createFileRoute("/api/public/hooks/task-notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        const now = new Date();
        const nowIso = now.toISOString();

        // 1) Overdue tasks not yet notified
        const { data: overdue } = await supabaseAdmin
          .from("tasks")
          .select("id,user_id,title,due_at,reminder_minutes")
          .neq("status", "done")
          .not("due_at", "is", null)
          .lte("due_at", nowIso);

        // 2) Settings map
        const userIds = Array.from(new Set((overdue ?? []).map((t: any) => t.user_id)));
        const settingsMap = new Map<string, any>();
        if (userIds.length > 0) {
          const { data: settings } = await supabaseAdmin
            .from("user_settings").select("*").in("user_id", userIds);
          for (const s of settings ?? []) settingsMap.set(s.user_id, s);
        }

        let sent = 0;
        for (const t of overdue ?? []) {
          // dedupe
          const { data: dup } = await supabaseAdmin
            .from("task_notifications").select("id")
            .eq("task_id", t.id).eq("kind", "overdue").maybeSingle();
          if (dup) continue;

          const settings = settingsMap.get(t.user_id);
          if (settings?.whatsapp_enabled && settings?.whatsapp_number) {
            await sendWhatsApp(settings.whatsapp_number, `Tarefa atrasada: ${t.title}`);
            sent++;
          }
          await supabaseAdmin.from("task_notifications").insert({
            task_id: t.id, user_id: t.user_id, kind: "overdue",
          });
        }

        // 3) Reminders: tasks whose due_at - reminder is within last minute window
        const { data: upcoming } = await supabaseAdmin
          .from("tasks")
          .select("id,user_id,title,due_at,reminder_minutes")
          .neq("status", "done")
          .not("due_at", "is", null)
          .gt("due_at", nowIso);

        for (const t of upcoming ?? []) {
          const dueMs = new Date(t.due_at).getTime();
          for (const m of (t.reminder_minutes ?? [])) {
            const triggerMs = dueMs - m * 60_000;
            // window: triggered in the last 60s
            if (triggerMs > now.getTime() || triggerMs < now.getTime() - 60_000) continue;

            const { data: dup } = await supabaseAdmin
              .from("task_notifications").select("id")
              .eq("task_id", t.id).eq("kind", "reminder").eq("minutes_before", m).maybeSingle();
            if (dup) continue;

            const settings = settingsMap.get(t.user_id) ??
              (await supabaseAdmin.from("user_settings").select("*").eq("user_id", t.user_id).maybeSingle()).data;
            if (settings?.whatsapp_enabled && settings?.whatsapp_number) {
              const label = m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}min`;
              await sendWhatsApp(settings.whatsapp_number, `Lembrete: "${t.title}" vence em ${label}`);
              sent++;
            }
            await supabaseAdmin.from("task_notifications").insert({
              task_id: t.id, user_id: t.user_id, kind: "reminder", minutes_before: m,
            });
          }
        }

        return Response.json({ ok: true, sent });
      },
    },
  },
});

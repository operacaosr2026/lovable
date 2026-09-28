import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshSystemNotifications } from "@/lib/notifications.server";
import { checkGoalEvents } from "@/lib/goal-events.server";

// Disparado a cada 10 min pelo pg_cron (ver *_push_notifications_cron.sql):
// recalcula os avisos do sino de cada workspace (token da Meta, sync da
// Shopify, Track123, disputas, Zoho). Antes isso só rodava quando alguém
// abria o sino — agora o aviso novo nasce sozinho e vira push no celular
// mesmo com o sistema fechado. Só consultas no banco.
export const Route = createFileRoute("/api/public/hooks/notifications-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        const [{ data: shops }, { data: zoho }] = await Promise.all([
          supabaseAdmin.from("shop_order_settings").select("user_id").eq("automation_enabled", true),
          supabaseAdmin.from("zoho_mail_accounts").select("owner_id"),
        ]);
        const owners = [...new Set([
          ...((shops ?? []) as { user_id: string }[]).map((s) => s.user_id),
          ...((zoho ?? []) as { owner_id: string }[]).map((z) => z.owner_id),
        ])];
        const out: Record<string, string> = {};
        for (const owner of owners) {
          try { await refreshSystemNotifications(owner); out[owner] = "ok"; }
          catch (e: any) { console.error("notifications-refresh", owner, e); out[owner] = String(e?.message ?? e).slice(0, 200); }
          // Push de Metas (meta do dia / do mês atingida).
          try { await checkGoalEvents(owner); }
          catch (e: any) { console.error("notifications-refresh metas", owner, e); out[owner] += ` · metas: ${String(e?.message ?? e).slice(0, 120)}`; }
        }
        return Response.json(out);
      },
    },
  },
});

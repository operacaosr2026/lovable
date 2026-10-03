import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshSystemNotifications } from "@/lib/notifications.server";
import { checkGoalEvents, checkProfitReports } from "@/lib/goal-events.server";
import { recheckStoreSetups } from "@/lib/store-policies.server";

// Disparado a cada 5 min pelo pg_cron (ver *_push_notifications_cron.sql):
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
          // Push de Metas (meta do mês atingida) e do Lucro do dia (horários de cada pessoa).
          try { await checkGoalEvents(owner); }
          catch (e: any) { console.error("notifications-refresh metas", owner, e); out[owner] += ` · metas: ${String(e?.message ?? e).slice(0, 120)}`; }
          try { await checkProfitReports(owner); }
          catch (e: any) { console.error("notifications-refresh lucro", owner, e); out[owner] += ` · lucro: ${String(e?.message ?? e).slice(0, 120)}`; }
          // Loja nova: só as com aviso aberto (some sozinho quando corrigir) e as esperando os 1ºs pedidos.
          try { await recheckStoreSetups(owner); }
          catch (e: any) { console.error("notifications-refresh loja nova", owner, e); out[owner] += ` · loja nova: ${String(e?.message ?? e).slice(0, 120)}`; }
        }
        return Response.json(out);
      },
    },
  },
});

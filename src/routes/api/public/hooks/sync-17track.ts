import { createFileRoute } from "@tanstack/react-router";
import { recordCronRun } from "@/lib/cron-runs.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reportSystemError, clearSystemError } from "@/lib/system-errors.server";
import { broadcast } from "@/lib/realtime.server";
import { runSeventeenTrackSync, seventeenTrackConfigured } from "@/lib/seventeen-track.server";
import { fixShopifyTrackingLinks } from "@/lib/tracking-links.server";

// Cron do 17track (pg_cron a cada 30 min, migração 20261006000000): só as lojas
// com "Rastreio por: 17track". Sem loja ligada, não faz nada nem gasta crédito.
export const Route = createFileRoute("/api/public/hooks/sync-17track")({
  server: {
    handlers: {
      POST: async ({ request }) => recordCronRun("sync-17track", async () => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        if (!seventeenTrackConfigured()) return Response.json({ skipped: "sem SEVENTEEN_TRACK_API_KEY" });

        const { data: owners } = await supabaseAdmin.from("track123_integrations").select("user_id").eq("provider", "17track");
        const ownerIds = [...new Set((owners ?? []).map((o) => o.user_id as string))];
        try {
          const started = Date.now();
          const r = await runSeventeenTrackSync({ deadline: started + 240_000 });
          // Link de rastreio errado em envio de qualquer pedido das lojas ativas
          // (entregue também — o sync acima só cuida dos em aberto). Até 50 por
          // rodada, no tempo que sobrar; falha aqui não derruba o rastreio.
          const links = await fixShopifyTrackingLinks({ limit: 50, deadline: started + 270_000 })
            .catch((e) => ({ error: String((e as Error)?.message ?? e) }));
          for (const u of ownerIds) {
            if (r.outOfQuota) await reportSystemError(u, "seventeen_track:quota", "17track sem crédito — códigos novos não estão sendo cadastrados", new Error("Compre mais créditos no painel do 17track."));
            else await clearSystemError(u, "seventeen_track:quota");
            await clearSystemError(u, "seventeen_track:run");
            if (r.updated) await broadcast(u, "orders", {});
          }
          return Response.json({ ...r, links });
        } catch (e) {
          console.error("17track sync fail", e);
          for (const u of ownerIds) await reportSystemError(u, "seventeen_track:run", "Rastreio (17track) não sincronizou", e);
          return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
        }
      }),
    },
  },
});

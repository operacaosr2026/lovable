import { createFileRoute } from "@tanstack/react-router";
import { recordCronRun } from "@/lib/cron-runs.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reportSystemError, clearSystemError } from "@/lib/system-errors.server";
import { broadcast } from "@/lib/realtime.server";
import { runSeventeenTrackSync, seventeenTrackConfigured } from "@/lib/seventeen-track.server";

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
          const r = await runSeventeenTrackSync({ deadline: Date.now() + 240_000 });
          for (const u of ownerIds) {
            if (r.outOfQuota) await reportSystemError(u, "seventeen_track:quota", "17track sem crédito — códigos novos não estão sendo cadastrados", new Error("Compre mais créditos no painel do 17track."));
            else await clearSystemError(u, "seventeen_track:quota");
            await clearSystemError(u, "seventeen_track:run");
            if (r.updated) await broadcast(u, "orders", {});
          }
          return Response.json(r);
        } catch (e) {
          console.error("17track sync fail", e);
          for (const u of ownerIds) await reportSystemError(u, "seventeen_track:run", "Rastreio (17track) não sincronizou", e);
          return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
        }
      }),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runCaixaSnapshots } from "@/lib/caixa-snapshot.server";
import { reportSystemErrorAll, clearSystemErrorAll } from "@/lib/system-errors.server";

// Disparado 1x por dia pelo pg_cron, no fim do dia (ver *_caixa_daily_snapshots.sql).
export const Route = createFileRoute("/api/public/hooks/caixa-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          const r = await runCaixaSnapshots();
          await clearSystemErrorAll("job:caixa_snapshot");
          return Response.json(r);
        } catch (e: any) {
          console.error("caixa-snapshot fail", e);
          await reportSystemErrorAll("job:caixa_snapshot", "Foto diária do Caixa não foi gravada", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runCaixaSnapshots } from "@/lib/caixa-snapshot.server";

// Disparado 1x por dia pelo pg_cron, no fim do dia (ver *_caixa_daily_snapshots.sql).
export const Route = createFileRoute("/api/public/hooks/caixa-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          return Response.json(await runCaixaSnapshots());
        } catch (e: any) {
          console.error("caixa-snapshot fail", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

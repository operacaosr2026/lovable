import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runEstornoDaily } from "@/lib/estorno-daily.server";

// Disparado 1x por dia pelo pg_cron, à meia-noite de Nova York (ver *_estorno_daily.sql).
export const Route = createFileRoute("/api/public/hooks/estorno-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          return Response.json(await runEstornoDaily());
        } catch (e: any) {
          console.error("estorno-daily fail", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { recordCronRun } from "@/lib/cron-runs.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runClarityDaily } from "@/lib/clarity.server";

// Disparado pelo pg_cron às 04:10 e 05:10 UTC (ver *_clarity.sql); só busca na
// que cair às 00:10 de Nova York, fechando o dia anterior de cada produto com Clarity.
export const Route = createFileRoute("/api/public/hooks/clarity-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => recordCronRun("clarity-daily", async () => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          return Response.json(await runClarityDaily());
        } catch (e: any) {
          console.error("clarity-daily fail", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      }),
    },
  },
});

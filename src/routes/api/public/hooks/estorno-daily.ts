import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runEstornoDaily } from "@/lib/estorno-daily.server";
import { runStoreMetricsDaily } from "@/lib/store-metrics.server";

// Disparado 1x por dia pelo pg_cron, à meia-noite de Nova York (ver *_estorno_daily.sql):
// taxa de estorno + números do Banco de Lojas (saldo, pedidos/dia, dias até payout).
export const Route = createFileRoute("/api/public/hooks/estorno-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          const [estorno, stores] = await Promise.all([runEstornoDaily(), runStoreMetricsDaily()]);
          return Response.json({ estorno, stores });
        } catch (e: any) {
          console.error("estorno-daily fail", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runEstornoDaily } from "@/lib/estorno-daily.server";
import { runStoreMetricsDaily } from "@/lib/store-metrics.server";
import { freezeAllCompanyGoals } from "@/lib/company-goals.server";
import { purgeOldAudit } from "@/lib/audit.server";
import { reportSystemErrorAll, clearSystemErrorAll } from "@/lib/system-errors.server";

// Disparado 1x por dia pelo pg_cron, à meia-noite de Nova York (ver *_estorno_daily.sql):
// taxa de estorno + números do Banco de Lojas (saldo, pedidos/dia, dias até payout)
// + congela o realizado das metas da empresa de meses que fecharam + apaga
// auditoria com mais de 1 ano.
export const Route = createFileRoute("/api/public/hooks/estorno-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          const [estorno, stores, goals, audit] = await Promise.all([runEstornoDaily(), runStoreMetricsDaily(), freezeAllCompanyGoals(), purgeOldAudit()]);
          await clearSystemErrorAll("job:estorno_daily");
          return Response.json({ estorno, stores, goals, audit });
        } catch (e: any) {
          console.error("estorno-daily fail", e);
          await reportSystemErrorAll("job:estorno_daily", "Rotina diária (taxa de estorno, Banco de Lojas, Metas) falhou", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

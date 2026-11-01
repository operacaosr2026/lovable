import { createFileRoute } from "@tanstack/react-router";
import { recordCronRun } from "@/lib/cron-runs.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { hasQueuedNotices, runNoticeQueue } from "@/lib/order-notices.server";
import { hasActiveFlows, runEmailFlows } from "@/lib/email-flows.server";

// Disparado a cada minuto pelo pg_cron (ver *_order_notices_queue.sql): anda
// com os Fluxos ativos (põem e-mails na fila) e manda o próximo e-mail da fila
// da aba Notificações. Fila vazia não grava rodada (senão seriam 1.440 linhas
// por dia no histórico de crons).
export const Route = createFileRoute("/api/public/hooks/order-notices-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        let flows: Record<string, string> | string | null = null;
        if (await hasActiveFlows()) {
          try { flows = await runEmailFlows(); }
          catch (e: any) { flows = `erro: ${String(e?.message ?? e)}`; }
        }
        if (!(await hasQueuedNotices())) return Response.json({ idle: true, flows });
        return recordCronRun("order-notices-send", async () => Response.json({ ...(await runNoticeQueue()), flows }));
      },
    },
  },
});

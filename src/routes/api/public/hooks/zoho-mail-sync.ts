import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { syncAllZohoMailboxes } from "@/lib/zoho-mail.server";
import { runAllChargebackDunning } from "@/lib/chargeback-alerts.server";

// Disparado a cada 5 min pelo pg_cron (ver *_atendimento_zoho.sql): puxa os
// e-mails novos do Zoho de cada workspace conectado. Depois roda a sequência de
// cobrança dos Alertas de chargeback (já sabendo se o cliente respondeu).
export const Route = createFileRoute("/api/public/hooks/zoho-mail-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          const mail = await syncAllZohoMailboxes();
          let dunning: unknown;
          try { dunning = await runAllChargebackDunning(); }
          catch (e: any) { console.error("chargeback dunning fail", e); dunning = { error: String(e?.message ?? e) }; }
          return Response.json({ mail, dunning });
        } catch (e: any) {
          console.error("zoho-mail-sync fail", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

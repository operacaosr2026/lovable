import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { syncAllZohoMailboxes } from "@/lib/zoho-mail.server";

// Disparado a cada 5 min pelo pg_cron (ver *_atendimento_zoho.sql): puxa os
// e-mails novos do Zoho de cada workspace conectado.
export const Route = createFileRoute("/api/public/hooks/zoho-mail-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          return Response.json(await syncAllZohoMailboxes());
        } catch (e: any) {
          console.error("zoho-mail-sync fail", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { syncAllZohoMailboxes } from "@/lib/zoho-mail.server";
import { runAllChargebackDunning } from "@/lib/chargeback-alerts.server";
import { reportSystemError, clearSystemError } from "@/lib/system-errors.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { collectAiBatches } from "@/lib/ai-batch-collect.server";

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
          // Lotes de IA prontos (comparações, manual do Atendimento, Consultor) — não depende do Zoho.
          const batches = await collectAiBatches();
          const mail = await syncAllZohoMailboxes();
          let dunning: unknown;
          try { dunning = await runAllChargebackDunning(); }
          catch (e: any) { console.error("chargeback dunning fail", e); dunning = { error: String(e?.message ?? e) }; }
          // Erro por workspace na rodada dos Alertas (tags, pagamentos, sequência).
          for (const [owner, r] of Object.entries((dunning ?? {}) as Record<string, any>)) {
            if (r?.error) await reportSystemError(owner, "alerts_round", "Rodada dos Alertas de chargeback falhou", r.error);
            else await clearSystemError(owner, "alerts_round");
          }
          const { data: accs } = await supabaseAdmin.from("zoho_mail_accounts").select("owner_id");
          for (const a of accs ?? []) await clearSystemError(a.owner_id, "zoho_round");
          return Response.json({ mail, dunning, batches });
        } catch (e: any) {
          console.error("zoho-mail-sync fail", e);
          const { data: accs } = await supabaseAdmin.from("zoho_mail_accounts").select("owner_id");
          for (const a of accs ?? []) await reportSystemError(a.owner_id, "zoho_round", "Sincronização do Zoho Mail falhou", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

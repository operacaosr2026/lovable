import { createFileRoute } from "@tanstack/react-router";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runConsultantWeekly } from "@/lib/consultant.server";
import { reportSystemErrorAll, clearSystemErrorAll } from "@/lib/system-errors.server";

// Disparado toda segunda pelo pg_cron (ver *_consultant_reports.sql): análise
// semanal do Consultor pra cada dono com loja ativa.
export const Route = createFileRoute("/api/public/hooks/consultant-weekly")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        try {
          const out = await runConsultantWeekly();
          const failed = out.filter((o) => !o.ok);
          if (failed.length) await reportSystemErrorAll("job:consultant_weekly", "Consultor: análise da semana falhou", failed[0].error);
          else await clearSystemErrorAll("job:consultant_weekly");
          return Response.json({ out });
        } catch (e: any) {
          console.error("consultant-weekly fail", e);
          await reportSystemErrorAll("job:consultant_weekly", "Consultor: análise da semana falhou", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});

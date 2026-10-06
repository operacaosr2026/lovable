import { createFileRoute } from "@tanstack/react-router";
import { recordCronRun } from "@/lib/cron-runs.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runConsultantWeekly } from "@/lib/consultant.server";
import { reportSystemErrorAll, clearSystemErrorAll } from "@/lib/system-errors.server";
import { nyParts } from "@/lib/timezone";

// Disparado toda segunda às 12:00 e 13:00 UTC pelo pg_cron (ver *_consultant_monday_8am_ny.sql):
// só segue na que for 8h de Nova York (muda com o horário de verão). Análise
// semanal do Consultor pra cada dono com loja ativa.
export const Route = createFileRoute("/api/public/hooks/consultant-weekly")({
  server: {
    handlers: {
      POST: async ({ request }) => recordCronRun("consultant-weekly", async () => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;
        const ny = nyParts(new Date());
        if (ny.weekday !== 1 || ny.hour !== 8) return Response.json({ skipped: `não é segunda 8h em NY (${ny.iso} ${ny.hm})` });
        try {
          const out = await runConsultantWeekly();
          const failed = out.filter((o) => !o.ok);
          if (failed.length) await reportSystemErrorAll("job:consultant_weekly", "Inteligência: análise da semana falhou", failed[0].error);
          else await clearSystemErrorAll("job:consultant_weekly");
          return Response.json({ out });
        } catch (e: any) {
          console.error("consultant-weekly fail", e);
          await reportSystemErrorAll("job:consultant_weekly", "Inteligência: análise da semana falhou", e);
          return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
        }
      }),
    },
  },
});

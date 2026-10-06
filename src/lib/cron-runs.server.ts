import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Histórico das rotinas automáticas (pg_cron → /api/public/hooks/*).
//
// O pg_cron só registra que DISPAROU a chamada, e o pg_net desiste de esperar a
// resposta em 5s — então "succeeded" no cron não diz nada sobre a rotina ter
// rodado. Cada rotina grava aqui, ao terminar, uma linha com o resultado; o sino
// (refreshSystemNotifications → cronHealthAlerts) avisa quando uma falha ou fica
// sem rodar mais tempo que o normal — inclusive quando nem começa (chave
// recusada, Vercel fora do ar, cron desligado).

// Intervalo máximo esperado entre duas rodadas OK de cada rotina (com folga).
export const CRON_JOBS: Record<string, { label: string; maxHours: number }> = {
  "sync:orders":           { label: "Pedidos da Shopify (a cada 10 min)", maxHours: 1 },
  "sync:ads":              { label: "Gasto com anúncios Meta (a cada 10 min)", maxHours: 1 },
  "sync:fees":             { label: "Taxas da Shopify (a cada 10 min)", maxHours: 1 },
  "sync:payouts":          { label: "Depósitos da Shopify (3x por dia)", maxHours: 13 },
  "sync:full":             { label: "Sincronização completa da Shopify (2x por dia)", maxHours: 13 },
  "zoho-mail-sync":        { label: "E-mails do Atendimento e cobrança de chargeback (a cada 5 min)", maxHours: 0.5 },
  "notifications-refresh": { label: "Avisos e push (a cada 5 min)", maxHours: 0.5 },
  "sync-17track":          { label: "Rastreio 17track (a cada 30 min)", maxHours: 2 },
  "caixa-snapshot":        { label: "Foto diária do Caixa", maxHours: 26 },
  "estorno-daily":         { label: "Rotina diária (estorno, Banco de Lojas, Metas)", maxHours: 26 },
  "consultant-weekly":     { label: "Análise semanal da Inteligência", maxHours: 24 * 8 },
};

const KEEP_DAYS = 30;

// Roda a rotina e grava o resultado. Chamada recusada (401) não grava: não é
// uma rodada — e a falta de rodada é justamente o que o aviso de "parada" pega.
// Falha ao gravar o histórico nunca derruba a rotina.
export async function recordCronRun(job: string, fn: () => Promise<Response>): Promise<Response> {
  const startedAt = new Date();
  let res: Response;
  try {
    res = await fn();
  } catch (e: any) {
    await saveRun(job, startedAt, false, 500, String(e?.message ?? e));
    throw e;
  }
  if (res.status !== 401) {
    const summary = await res.clone().text().catch(() => "");
    await saveRun(job, startedAt, res.ok, res.status, summary);
  }
  return res;
}

async function saveRun(job: string, startedAt: Date, ok: boolean, status: number, summary: string) {
  try {
    await supabaseAdmin.from("cron_runs" as any).insert({
      job, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(),
      ok, status, summary: summary.slice(0, 1000),
    });
    await supabaseAdmin.from("cron_runs" as any).delete()
      .lt("started_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());
  } catch (e) {
    console.error("cron_runs", job, e);
  }
}

type Alert = { key: string; level: "warning" | "error"; title: string; body: string; link: string | null };

// Avisos do sino sobre as rotinas: falhou na última rodada, ou está parada.
// Só avisa "parada" depois que o histórico já cobre o intervalo da rotina
// (logo depois de ligar o histórico, as semanais ainda não rodaram).
export async function cronHealthAlerts(): Promise<Alert[]> {
  const { data, error } = await supabaseAdmin.from("cron_runs" as any)
    .select("job,started_at,ok,status,summary")
    .gte("started_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString())
    .order("started_at", { ascending: false }).limit(5000);
  if (error) return []; // tabela ainda não criada: sem aviso
  const rows = (data ?? []) as any[];
  if (!rows.length) return [];
  const oldest = Date.parse(rows[rows.length - 1].started_at);
  const now = Date.now();
  const out: Alert[] = [];
  for (const [job, cfg] of Object.entries(CRON_JOBS)) {
    const runs = rows.filter((r) => r.job === job);
    const last = runs[0];
    const lastOk = runs.find((r) => r.ok);
    const hoursSinceOk = lastOk ? (now - Date.parse(lastOk.started_at)) / 3_600_000 : (now - oldest) / 3_600_000;
    if (last && !last.ok) {
      out.push({
        key: `cron:${job}`, level: "error", link: null,
        title: `Rotina com erro: ${cfg.label}`,
        body: `Última rodada falhou (HTTP ${last.status}): ${String(last.summary ?? "").slice(0, 180)}`,
      });
    } else if (hoursSinceOk > cfg.maxHours && (now - oldest) / 3_600_000 > cfg.maxHours) {
      const h = Math.floor(hoursSinceOk);
      out.push({
        key: `cron:${job}`, level: "error", link: null,
        title: `Rotina parada: ${cfg.label}`,
        body: `${lastOk ? `Última rodada OK há ${h >= 1 ? `${h}h` : `${Math.round(hoursSinceOk * 60)} min`}` : "Nenhuma rodada OK registrada"}. `
          + "Pode ser a chave do agendador recusada, a Vercel fora do ar ou o cron desligado no Supabase.",
      });
    }
  }
  return out;
}

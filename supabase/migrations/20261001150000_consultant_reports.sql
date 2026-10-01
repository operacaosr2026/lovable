-- Consultor: análise com IA dos números da operação (ver consultant.server.ts).
-- O sistema calcula os números (facts), a IA lê e devolve as dicas (result).
-- tips_status: o que a pessoa fez com cada dica, por índice
-- ({"0": {"status": "testando", "at": "..."}}) — testes em andamento entram na
-- próxima análise pra IA dizer se funcionaram.
CREATE TABLE IF NOT EXISTS public.consultant_reports (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  period_from date NOT NULL,
  period_to   date NOT NULL,
  model       text,
  facts       jsonb NOT NULL,
  result      jsonb NOT NULL,
  tips_status jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS consultant_reports_user_created ON public.consultant_reports (user_id, created_at DESC);

ALTER TABLE public.consultant_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_consultant_reports"
  ON public.consultant_reports FOR ALL USING (auth.uid() = user_id);

-- Toda segunda às 12:00 UTC (08:00 de Nova York no horário de verão).
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'consultant-weekly';
SELECT cron.schedule(
  'consultant-weekly',
  '0 12 * * 1',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/consultant-weekly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Reverter:
-- SELECT cron.unschedule('consultant-weekly');
-- DROP TABLE public.consultant_reports;

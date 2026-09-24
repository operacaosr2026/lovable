-- Foto diária do caixa de cada loja (saldo atual + a receber), pro gráfico do
-- "Saldo total" no Caixa de Lojas e Grupos. O "a receber" de dias passados não
-- dá pra recalcular depois, então precisa ser guardado no dia.
-- Gravada 1x por dia às 03:55 UTC (23:55 de Nova York no horário de verão,
-- 22:55 no inverno — sempre ainda no mesmo dia do Caixa).

CREATE TABLE IF NOT EXISTS public.caixa_daily_snapshots (
  shop_id    uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  date       date NOT NULL,
  user_id    uuid NOT NULL,
  saldo      numeric NOT NULL,
  receivable numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, date)
);

ALTER TABLE public.caixa_daily_snapshots ENABLE ROW LEVEL SECURITY;
-- Leitura pelo servidor com supabaseAdmin (getCaixaSnapshots); escrita só pelo cron.

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'caixa-snapshot-daily';

SELECT cron.schedule(
  'caixa-snapshot-daily',
  '55 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/caixa-snapshot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

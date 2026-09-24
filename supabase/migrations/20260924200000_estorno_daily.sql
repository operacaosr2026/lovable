-- Taxa de estorno (30 dias) por loja calculada 1x por dia, à meia-noite de
-- Nova York, e guardada aqui — o card de Lojas e Grupos só lê, em vez de
-- recalcular a cada abertura. Ver runEstornoDaily (estorno-daily.server.ts).
-- 04:00 UTC = 00:00 de Nova York no horário de verão (23:00 do dia anterior no inverno).

ALTER TABLE public.shop_order_settings
  ADD COLUMN IF NOT EXISTS chargeback_orders_30d integer,
  ADD COLUMN IF NOT EXISTS chargeback_count_30d  integer,
  ADD COLUMN IF NOT EXISTS chargeback_stats_at   timestamptz;

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'estorno-daily';

SELECT cron.schedule(
  'estorno-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/estorno-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

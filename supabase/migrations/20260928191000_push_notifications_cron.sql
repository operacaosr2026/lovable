-- Recalcula os avisos do sino a cada 10 min (antes só ao abrir o sino), pra
-- aviso novo virar push no celular mesmo com o sistema fechado.
-- Aplicar depois do deploy da rota /api/public/hooks/notifications-refresh.
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'notifications-refresh';

SELECT cron.schedule(
  'notifications-refresh',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/notifications-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

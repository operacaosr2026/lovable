-- Consultor: análise automática toda segunda às 8h de Nova York, o ano todo.
-- 8h em NY = 12:00 UTC no horário de verão e 13:00 UTC no inverno: o cron
-- dispara nas duas e o hook (consultant-weekly.ts) só roda na que for 8h em NY.
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'consultant-weekly';
SELECT cron.schedule(
  'consultant-weekly',
  '0 12,13 * * 1',
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

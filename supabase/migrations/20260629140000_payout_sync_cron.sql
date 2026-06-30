CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Sincronizar payouts Shopify 3x ao dia: meia-noite, meio-dia e 18h (UTC)
SELECT cron.unschedule('sync-payouts-midnight') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-payouts-midnight');
SELECT cron.unschedule('sync-payouts-noon')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-payouts-noon');
SELECT cron.unschedule('sync-payouts-evening')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-payouts-evening');

SELECT cron.schedule(
  'sync-payouts-midnight',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-shop-orders',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eGlzYWNzZmRseWV1cXl1YnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NjMzODksImV4cCI6MjA5NjUzOTM4OX0.MASpMnBEJrji266B_Q23eYz0sFz-IIhDm5yPi7Bcq1Q"}'::jsonb,
    body    := '{"payouts_only":true}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'sync-payouts-noon',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-shop-orders',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eGlzYWNzZmRseWV1cXl1YnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NjMzODksImV4cCI6MjA5NjUzOTM4OX0.MASpMnBEJrji266B_Q23eYz0sFz-IIhDm5yPi7Bcq1Q"}'::jsonb,
    body    := '{"payouts_only":true}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'sync-payouts-evening',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-shop-orders',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eGlzYWNzZmRseWV1cXl1YnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NjMzODksImV4cCI6MjA5NjUzOTM4OX0.MASpMnBEJrji266B_Q23eYz0sFz-IIhDm5yPi7Bcq1Q"}'::jsonb,
    body    := '{"payouts_only":true}'::jsonb
  );
  $$
);

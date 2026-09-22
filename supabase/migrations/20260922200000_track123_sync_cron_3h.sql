-- Sync a cada 3h em vez de 12h — com muitos pedidos em aberto por loja e um
-- orçamento de tempo por rodada (ver track123-mcp-sync.server.ts), rodar mais
-- vezes por dia reduz o tempo até um pedido "parado" ser reconferido.
SELECT cron.unschedule('track123-sync-12h');

SELECT cron.schedule(
  'track123-sync-3h',
  '0 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lojas-one.vercel.app/api/public/hooks/sync-track123',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eGlzYWNzZmRseWV1cXl1YnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NjMzODksImV4cCI6MjA5NjUzOTM4OX0.MASpMnBEJrji266B_Q23eYz0sFz-IIhDm5yPi7Bcq1Q"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

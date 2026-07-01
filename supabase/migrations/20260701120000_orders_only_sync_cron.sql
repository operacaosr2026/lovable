-- Sincronização leve de pedidos (só shop_orders, sem payouts/payout_lag/refunds)
-- a cada 10 minutos, para manter Pedidos/Dashboard/Overview/Logística atualizados
-- sem depender de ninguém com o sistema aberto.
SELECT cron.unschedule('sync-orders-light') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-orders-light');

SELECT cron.schedule(
  'sync-orders-light',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-shop-orders',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eGlzYWNzZmRseWV1cXl1YnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NjMzODksImV4cCI6MjA5NjUzOTM4OX0.MASpMnBEJrji266B_Q23eYz0sFz-IIhDm5yPi7Bcq1Q"}'::jsonb,
    body    := '{"orders_only":true}'::jsonb
  );
  $$
);

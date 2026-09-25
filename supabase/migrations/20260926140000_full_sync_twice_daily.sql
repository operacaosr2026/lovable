-- Sync completo da Shopify (repasses, prazo de repasse, vendas sem repasse,
-- reembolsos no Caixa, custo do dia, conferência dos webhooks) passa de toda
-- hora (+2 rodadas da Vercel) pra 2x por dia: 08:00 e 20:00 de Brasília
-- (11:00 e 23:00 UTC). Pedidos, anúncios, taxas, saldo e disputas têm cron de
-- 10 min ou webhook próprios. As 2 rodadas da Vercel saíram do vercel.json.

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('sync-full-hourly', 'sync-full-2x');

SELECT cron.schedule(
  'sync-full-2x',
  '0 11,23 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-shop-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

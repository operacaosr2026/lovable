-- Custos do dia (gasto Meta Ads + taxas Shopify Payments) de 10 em 10 min.
-- Antes eles só eram sincronizados quando alguém abria o Dashboard de Lojas e
-- Grupos: o lucro aparecia alto (sem o anúncio do dia) e caía uns segundos
-- depois, quando o sync da tela terminava. Deslocado 5 min do sync leve de
-- pedidos pra não disputar a mesma janela.
--
-- Usa o segredo cron_api_key do Vault (ver 20260923120000_cron_api_key.sql).

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'sync-costs';

SELECT cron.schedule(
  'sync-costs',
  '5-55/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-shop-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{"costs_only":true}'::jsonb
  );
  $$
);

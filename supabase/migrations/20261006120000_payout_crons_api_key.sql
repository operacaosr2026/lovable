-- Os 3 crons de depósitos (sync-payouts-*) ainda mandavam a chave anon no
-- header `apikey`. Desde que CRON_API_KEY passou a valer (cron-auth.ts), a rota
-- recusa com 401 — e o pg_cron mostra "succeeded" (só registra que disparou).
-- Mesmo header dos outros jobs: x-api-key vindo do Vault (cron_api_key).
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('sync-payouts-midnight', 'sync-payouts-noon', 'sync-payouts-evening') LOOP
    PERFORM cron.alter_job(j.jobid, command := $cmd$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-shop-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{"payouts_only":true}'::jsonb
  );
  $cmd$);
  END LOOP;
END $$;

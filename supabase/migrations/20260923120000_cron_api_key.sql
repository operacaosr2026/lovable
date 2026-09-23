-- Os jobs do pg_cron autenticavam nos endpoints /api/public/hooks/* com a
-- chave anon (pública — vai no JS do navegador), então qualquer um podia
-- disparar os syncs. Passam a mandar uma chave própria (CRON_API_KEY na
-- Vercel), lida do Supabase Vault — nada de segredo neste arquivo.
--
-- PRÉ-REQUISITO (rodar uma vez no SQL Editor, com o mesmo valor configurado
-- como CRON_API_KEY na Vercel):
--   select vault.create_secret('<valor da CRON_API_KEY>', 'cron_api_key');
--
-- Também:
--  - Track123 passa de 3 em 3h pra toda hora: o cron agora tem um orçamento de
--    tempo único e começa pelas lojas mais desatualizadas, então rodar mais vezes
--    é o que garante que todas as lojas sejam cobertas.
--  - Sync completo (pedidos + payouts + disputas/chargebacks + custo do dia) de
--    hora em hora: antes ele só era disparado pelo Vercel Cron, que recebia 401
--    (não tinha CRON_SECRET) — as disputas não eram atualizadas desde 17/08. O
--    endpoint processa as lojas em rodízio dentro de ~50s por chamada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_api_key') THEN
    RAISE EXCEPTION 'Crie antes o segredo cron_api_key no Vault (ver comentário no topo).';
  END IF;
END $$;

SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN ('sync-orders-light', 'track123-sync-3h', 'track123-sync-hourly', 'sync-full-hourly');

SELECT cron.schedule(
  'sync-orders-light',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-shop-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{"orders_only":true}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'track123-sync-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-track123',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'sync-full-hourly',
  '30 * * * *',
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

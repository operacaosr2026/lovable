-- 17track substitui o Track123, loja por loja.
--  - track123_integrations.provider: qual serviço puxa o rastreio da loja. Todas
--    começam em 'track123'; trocar pra '17track' faz o cron do Track123 pular a
--    loja e o do 17track assumir. (A tabela continua guardando o modelo do link
--    de rastreio, usado no sistema todo.)
--  - shop_order_tracking: quando o código foi cadastrado no 17track (1 crédito,
--    uma vez só) e a previsão de entrega oficial.
--  - cron do 17track a cada 30 min (cadastra códigos novos + busca atualizações).

ALTER TABLE public.track123_integrations
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'track123'
    CHECK (provider IN ('track123', '17track'));

ALTER TABLE public.shop_order_tracking
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS registered_17track_at timestamptz,
  ADD COLUMN IF NOT EXISTS edd_from date,
  ADD COLUMN IF NOT EXISTS edd_to date,
  ADD COLUMN IF NOT EXISTS edd_source text;

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'seventeen-track-sync';

SELECT cron.schedule(
  'seventeen-track-sync',
  '7,37 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lojas-one.vercel.app/api/public/hooks/sync-17track',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_api_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

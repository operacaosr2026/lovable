-- Track123 saiu do sistema (o rastreio é todo pelo 17track). Desliga o cron
-- do Track123 e faz loja nova já nascer no 17track. A tabela
-- track123_integrations continua (nome antigo): guarda por loja o modelo do link
-- de rastreio e o status do último sync. As colunas api_key/mcp_store_uuid/
-- webhook_secret ficam sem uso.
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN ('track123-sync-hourly', 'track123-sync-3h');

ALTER TABLE public.track123_integrations ALTER COLUMN provider SET DEFAULT '17track';
UPDATE public.track123_integrations SET provider = '17track' WHERE provider <> '17track';

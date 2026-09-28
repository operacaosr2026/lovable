-- Track123: sincronização a cada 15 min (antes, de hora em hora).
-- O Track123 só aguenta ~1 consulta de pedido a cada 1,6s por chave (ver
-- track123-mcp-sync.server.ts), então cada rodada de 50s confere ~30 pedidos
-- por loja. De hora em hora, loja com 150+ pedidos em aberto levava 5-6 horas
-- pra reconferir cada rastreio; a cada 15 min, ~1h30.
-- Aplicar só depois do deploy do ritmo novo: com o código antigo (8 chamadas
-- em paralelo) rodar mais vezes só gera mais recusa do Track123.
SELECT cron.alter_job(jobid, schedule := '*/15 * * * *')
FROM cron.job WHERE jobname = 'track123-sync-hourly';

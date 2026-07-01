-- Lucro previsto por venda: valor usado para calcular quantas vendas/dia são
-- necessárias pra bater a meta (falta_para_meta / dias_restantes / lucro_por_venda).
ALTER TABLE lg_card_goals ADD COLUMN IF NOT EXISTS lucro_por_venda NUMERIC(10,2);

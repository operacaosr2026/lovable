-- Colunas do Banco de Lojas podem pausar a sincronização automática das lojas
-- que estão nelas (crons de pedidos/payouts/disputas e Track123, e avisos do
-- sino). Separado de excluded_from_caixa ("Fora do Caixa") de propósito: uma
-- coluna pode ficar fora do Caixa e continuar sincronizando, ou o contrário.
ALTER TABLE public.store_board_columns
  ADD COLUMN IF NOT EXISTS sync_paused boolean NOT NULL DEFAULT false;

-- Em Hold, Com Retenção e Cemitério já deviam estar pausadas (combinado em 24/09/2026).
UPDATE public.store_board_columns
  SET sync_paused = true
  WHERE name IN ('Em Hold', 'Com Retenção', 'Cemitério');

-- Cor escolhida pelo usuário para a coluna do Banco de Lojas (chave da paleta
-- em COLUMN_COLORS). NULL = cor automática pelo nome da coluna.
ALTER TABLE public.store_board_columns
  ADD COLUMN IF NOT EXISTS color text;

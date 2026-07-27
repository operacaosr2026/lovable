-- Permite selecionar mais de uma funcionalidade por coluna do quadro de lojas.
ALTER TABLE public.store_board_columns
  ADD COLUMN IF NOT EXISTS features text[] NOT NULL DEFAULT '{}';

UPDATE public.store_board_columns
  SET features = CASE WHEN feature = 'none' THEN '{}'::text[] ELSE ARRAY[feature] END
  WHERE features = '{}';

ALTER TABLE public.store_board_columns
  DROP CONSTRAINT IF EXISTS store_board_columns_feature_check;
ALTER TABLE public.store_board_columns
  DROP COLUMN IF EXISTS feature;

ALTER TABLE public.store_board_columns
  ADD CONSTRAINT store_board_columns_features_check
  CHECK (features <@ ARRAY['hold', 'avg_orders', 'payout_time', 'note']::text[]);

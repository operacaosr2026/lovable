ALTER TABLE public.store_board_columns
  ADD COLUMN IF NOT EXISTS feature text NOT NULL DEFAULT 'none';

ALTER TABLE public.store_board_columns
  DROP CONSTRAINT IF EXISTS store_board_columns_feature_check;
ALTER TABLE public.store_board_columns
  ADD CONSTRAINT store_board_columns_feature_check
  CHECK (feature IN ('none', 'hold', 'avg_orders', 'payout_time', 'note'));

ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS board_note text;

CREATE TABLE IF NOT EXISTS public.store_board_columns (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.store_board_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_store_board_columns"
  ON public.store_board_columns FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS board_column_id uuid REFERENCES public.store_board_columns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS board_position integer NOT NULL DEFAULT 0;

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.shop_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS shops_group_id_idx ON public.shops (group_id);

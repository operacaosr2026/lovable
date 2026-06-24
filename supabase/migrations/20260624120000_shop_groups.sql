CREATE TABLE IF NOT EXISTS public.shop_groups (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'ativo',
  country     text,
  tag         text,
  logo_url    text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shop_group_stores (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id         uuid NOT NULL REFERENCES public.shop_groups(id) ON DELETE CASCADE,
  shopify_store_id uuid NOT NULL REFERENCES public.shopify_stores(id) ON DELETE CASCADE,
  role             text NOT NULL DEFAULT 'subloja' CHECK (role IN ('matriz', 'subloja')),
  created_at       timestamptz DEFAULT now(),
  UNIQUE (group_id, shopify_store_id)
);

ALTER TABLE public.shop_groups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_group_stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_shop_groups"
  ON public.shop_groups FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "owner_shop_group_stores"
  ON public.shop_group_stores FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.shop_groups g
      WHERE g.id = group_id AND g.user_id = auth.uid()
    )
  );

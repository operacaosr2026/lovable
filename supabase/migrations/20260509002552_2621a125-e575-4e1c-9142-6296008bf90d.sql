
ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS installed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS shopify_stores_user_shop_unique
  ON public.shopify_stores (user_id, shop_domain);

CREATE TABLE IF NOT EXISTS public.shopify_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  shop_domain text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shopify_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own oauth states all"
  ON public.shopify_oauth_states
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

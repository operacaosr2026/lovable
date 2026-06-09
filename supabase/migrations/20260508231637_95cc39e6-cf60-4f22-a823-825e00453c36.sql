CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.shopify_stores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  store_id UUID NOT NULL UNIQUE,
  shop_domain TEXT NOT NULL,
  token_secret_name TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shopify_stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own shopify_stores all"
ON public.shopify_stores FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_shopify_stores_user ON public.shopify_stores(user_id);

CREATE TRIGGER update_shopify_stores_updated_at
BEFORE UPDATE ON public.shopify_stores
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
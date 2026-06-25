ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS iana_timezone text;

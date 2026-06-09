ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS access_token text;

ALTER TABLE public.shopify_stores
  ALTER COLUMN store_id DROP NOT NULL,
  ALTER COLUMN token_secret_name DROP NOT NULL;
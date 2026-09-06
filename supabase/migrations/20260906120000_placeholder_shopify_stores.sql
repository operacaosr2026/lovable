-- Allows adding a "loja para produzir" (name-only) card to the store board
-- before it exists on Shopify. Once created there, "Conectar Shopify" on the
-- card runs the normal OAuth flow and replaces the placeholder in place.
ALTER TABLE public.shopify_stores
  ALTER COLUMN shop_domain DROP NOT NULL;

ALTER TABLE public.shopify_stores
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

ALTER TABLE public.shopify_oauth_states
  ADD COLUMN IF NOT EXISTS replace_placeholder_id uuid;

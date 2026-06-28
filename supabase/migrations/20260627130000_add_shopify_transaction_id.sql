ALTER TABLE public.shop_cash_entries
  ADD COLUMN IF NOT EXISTS shopify_transaction_id text;

CREATE UNIQUE INDEX IF NOT EXISTS shop_cash_entries_shopify_transaction_unique
  ON public.shop_cash_entries (shop_id, shopify_transaction_id)
  WHERE shopify_transaction_id IS NOT NULL;

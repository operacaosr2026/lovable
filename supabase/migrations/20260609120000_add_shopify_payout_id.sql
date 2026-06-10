ALTER TABLE public.shop_cash_entries ADD COLUMN IF NOT EXISTS shopify_payout_id text;
CREATE UNIQUE INDEX IF NOT EXISTS shop_cash_entries_shopify_payout_unique
  ON public.shop_cash_entries (shop_id, shopify_payout_id)
  WHERE shopify_payout_id IS NOT NULL;

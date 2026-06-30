ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS shopify_financial_status TEXT;

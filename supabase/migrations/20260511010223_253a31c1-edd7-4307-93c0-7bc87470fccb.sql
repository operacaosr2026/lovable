ALTER TABLE public.shop_order_settings
ADD COLUMN IF NOT EXISTS cashflow_start_date date NULL;
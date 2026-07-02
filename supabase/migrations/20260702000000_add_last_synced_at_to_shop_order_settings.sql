alter table public.shop_order_settings
  add column if not exists last_synced_at timestamptz;

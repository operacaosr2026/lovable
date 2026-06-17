alter table public.shop_order_settings
  add column if not exists payout_lag_avg_days numeric,
  add column if not exists payout_lag_sample_size integer;

ALTER TABLE public.shop_orders
  DROP CONSTRAINT IF EXISTS shop_orders_payment_status_check;

ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_payment_status_check
  CHECK (payment_status IN ('pending','paid','shipped','estornado'));

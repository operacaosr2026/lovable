ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS carrier TEXT,
  ADD COLUMN IF NOT EXISTS tracking_code TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'pending_shipment'
    CHECK (delivery_status IN ('pending_shipment','shipped','in_transit','delivered','returned','problem'));

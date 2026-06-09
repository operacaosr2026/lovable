
-- Status operacional e lote de pagamento em pedidos
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','shipped')),
  ADD COLUMN IF NOT EXISTS payment_batch_id uuid NULL,
  ADD COLUMN IF NOT EXISTS paid_at date NULL,
  ADD COLUMN IF NOT EXISTS shipped_at date NULL;

CREATE INDEX IF NOT EXISTS shop_orders_payment_status_idx
  ON public.shop_orders(shop_id, payment_status, order_date);

-- Lotes de pagamento
CREATE TABLE IF NOT EXISTS public.shop_order_payment_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  batch_number integer NOT NULL,
  payment_date date NOT NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  total_orders integer NOT NULL DEFAULT 0,
  order_dates date[] NOT NULL DEFAULT '{}',
  cash_entry_id uuid NULL,
  description text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_order_payment_batches TO authenticated;
GRANT ALL ON public.shop_order_payment_batches TO service_role;

ALTER TABLE public.shop_order_payment_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own batches all" ON public.shop_order_payment_batches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "members access batches" ON public.shop_order_payment_batches
  FOR ALL USING (has_workspace_access(auth.uid(), user_id, 'shops'::text, shop_id))
  WITH CHECK (has_workspace_access(auth.uid(), user_id, 'shops'::text, shop_id));

CREATE TRIGGER shop_order_payment_batches_updated
  BEFORE UPDATE ON public.shop_order_payment_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS shop_order_payment_batches_number_uq
  ON public.shop_order_payment_batches(shop_id, batch_number);

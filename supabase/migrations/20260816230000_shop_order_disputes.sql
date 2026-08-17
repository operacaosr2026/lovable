-- Disputas de pagamento reais (chargebacks/inquiries), sincronizadas via
-- Shopify Payments Disputes API. Fonte usada pra bater com o "Taxa de
-- estorno" (chargeback_rate) que o Shopify mostra no admin — a sync antiga
-- filtrava balance transactions por type='dispute', que nunca aparece
-- nesse endpoint, então "Chargeback" ficava sempre zerado.
CREATE TABLE IF NOT EXISTS public.shop_order_disputes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  shopify_dispute_id text NOT NULL,
  order_external_id text NULL,
  type text NOT NULL,
  status text NULL,
  reason text NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NULL,
  initiated_at date NOT NULL,
  finalized_on date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_order_disputes TO authenticated;
GRANT ALL ON public.shop_order_disputes TO service_role;

ALTER TABLE public.shop_order_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own shop_order_disputes all" ON public.shop_order_disputes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "members access shop_order_disputes" ON public.shop_order_disputes
  FOR ALL USING (has_workspace_access(auth.uid(), user_id, 'shops'::text, shop_id))
  WITH CHECK (has_workspace_access(auth.uid(), user_id, 'shops'::text, shop_id));

CREATE TRIGGER shop_order_disputes_updated
  BEFORE UPDATE ON public.shop_order_disputes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS shop_order_disputes_shopify_id_uq
  ON public.shop_order_disputes(shop_id, shopify_dispute_id);

CREATE INDEX IF NOT EXISTS shop_order_disputes_order_idx
  ON public.shop_order_disputes(shop_id, order_external_id);

CREATE INDEX IF NOT EXISTS shop_order_disputes_initiated_idx
  ON public.shop_order_disputes(shop_id, type, initiated_at);

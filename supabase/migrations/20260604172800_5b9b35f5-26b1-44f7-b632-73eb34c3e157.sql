
-- Track123 integration tables

CREATE TABLE public.track123_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL UNIQUE,
  api_key text,
  token text,
  webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  enabled boolean NOT NULL DEFAULT false,
  tracking_link_template text NOT NULL DEFAULT 'https://chierie.com/apps/track123?nums=[CODE]',
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.track123_integrations TO authenticated;
GRANT ALL ON public.track123_integrations TO service_role;

ALTER TABLE public.track123_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own track123_integrations all" ON public.track123_integrations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members access track123_integrations" ON public.track123_integrations
  FOR ALL USING (has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE TRIGGER track123_integrations_updated_at BEFORE UPDATE ON public.track123_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Event mapping rules
CREATE TABLE public.track123_event_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  event_key text NOT NULL,
  event_label text NOT NULL,
  target_status text NOT NULL DEFAULT 'ignore', -- shipped | delivered | problem | ignore
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, event_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.track123_event_rules TO authenticated;
GRANT ALL ON public.track123_event_rules TO service_role;

ALTER TABLE public.track123_event_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own track123_event_rules all" ON public.track123_event_rules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members access track123_event_rules" ON public.track123_event_rules
  FOR ALL USING (has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE TRIGGER track123_event_rules_updated_at BEFORE UPDATE ON public.track123_event_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-order tracking
CREATE TABLE public.shop_order_tracking (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  order_id uuid NOT NULL UNIQUE,
  tracking_number text,
  carrier text,
  tracking_status text,
  last_event_at timestamptz,
  last_event_label text,
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  shipped_at timestamptz,
  delivered_at timestamptz,
  problem_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shop_order_tracking_tracking_number_idx ON public.shop_order_tracking (shop_id, tracking_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_order_tracking TO authenticated;
GRANT ALL ON public.shop_order_tracking TO service_role;

ALTER TABLE public.shop_order_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own shop_order_tracking all" ON public.shop_order_tracking
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members access shop_order_tracking" ON public.shop_order_tracking
  FOR ALL USING (has_workspace_access(auth.uid(), user_id, 'shops', shop_id))
  WITH CHECK (has_workspace_access(auth.uid(), user_id, 'shops', shop_id));

CREATE TRIGGER shop_order_tracking_updated_at BEFORE UPDATE ON public.shop_order_tracking
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Extend shop_orders with delivered/problem timestamps (payment_status already supports 'shipped')
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS delivered_at date;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS problem_at date;

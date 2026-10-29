-- Histórico de códigos de rastreio: quando o código do pedido troca (à mão na
-- Logística ou pelo sync com a Shopify), o anterior fica guardado com a data
-- da troca — [{code, until}], mais antigo primeiro.
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS tracking_code_history jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.shop_orders_keep_tracking_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(btrim(OLD.tracking_code), '') <> ''
     AND upper(btrim(OLD.tracking_code)) IS DISTINCT FROM upper(btrim(COALESCE(NEW.tracking_code, ''))) THEN
    NEW.tracking_code_history := COALESCE(NEW.tracking_code_history, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('code', OLD.tracking_code, 'until', now()));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS shop_orders_keep_tracking_history ON public.shop_orders;
CREATE TRIGGER shop_orders_keep_tracking_history
  BEFORE UPDATE OF tracking_code ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_keep_tracking_history();

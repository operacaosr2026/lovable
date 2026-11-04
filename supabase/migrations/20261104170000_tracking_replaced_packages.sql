-- Pacote trocado (reenvio / envio cancelado na Shopify): antes, o sync do
-- 17track zerava a timeline do código antigo e ela se perdia. Agora o rastreio
-- antigo vai pra replaced_packages quando o tracking_number muda — o Gerencial ›
-- Transportadoras conta onde o pacote descartado parou (ex.: preso na
-- alfândega) contra a transportadora dele.
ALTER TABLE public.shop_order_tracking
  ADD COLUMN IF NOT EXISTS replaced_packages jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.keep_replaced_tracking_package()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tracking_number IS NOT NULL
     AND upper(OLD.tracking_number) IS DISTINCT FROM upper(NEW.tracking_number)
     AND jsonb_typeof(OLD.timeline) = 'array' AND jsonb_array_length(OLD.timeline) > 0 THEN
    NEW.replaced_packages := COALESCE(NEW.replaced_packages, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'number', OLD.tracking_number,
      'replaced_at', now(),
      'tracking_status', OLD.tracking_status,
      'last_event_at', OLD.last_event_at,
      'last_event_label', OLD.last_event_label,
      'timeline', OLD.timeline
    ));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_keep_replaced_tracking_package ON public.shop_order_tracking;
CREATE TRIGGER trg_keep_replaced_tracking_package
  BEFORE UPDATE OF tracking_number ON public.shop_order_tracking
  FOR EACH ROW EXECUTE FUNCTION public.keep_replaced_tracking_package();

-- Reverter:
-- DROP TRIGGER trg_keep_replaced_tracking_package ON public.shop_order_tracking;
-- DROP FUNCTION public.keep_replaced_tracking_package();
-- ALTER TABLE public.shop_order_tracking DROP COLUMN replaced_packages;

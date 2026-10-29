-- Troca do código de rastreio (à mão ou pela Shopify): o problema era do pacote
-- antigo — some junto (status volta pra "pendente envio" até o pacote novo
-- andar). Pedido já entregue fica como está.
CREATE OR REPLACE FUNCTION public.shop_orders_keep_tracking_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(btrim(OLD.tracking_code), '') <> ''
     AND upper(btrim(OLD.tracking_code)) IS DISTINCT FROM upper(btrim(COALESCE(NEW.tracking_code, ''))) THEN
    NEW.tracking_code_history := COALESCE(NEW.tracking_code_history, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('code', OLD.tracking_code, 'until', now()));
    NEW.kpi_excluded := true;
    IF NEW.delivered_at IS NULL AND COALESCE(NEW.delivery_status, '') <> 'delivered' THEN
      IF NEW.delivery_status = 'problem' THEN NEW.delivery_status := 'pending_shipment'; END IF;
      NEW.problem_at := NULL;
      NEW.logistics_note := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Reenvios que já existem com o problema do pacote antigo (marcado antes da troca).
UPDATE public.shop_orders o
   SET problem_at = NULL, logistics_note = NULL,
       delivery_status = CASE WHEN o.delivery_status = 'problem' THEN 'pending_shipment' ELSE o.delivery_status END
 WHERE o.delivered_at IS NULL AND COALESCE(o.delivery_status, '') <> 'delivered'
   AND (o.problem_at IS NOT NULL OR o.delivery_status = 'problem')
   AND jsonb_array_length(o.tracking_code_history) > 0
   AND o.problem_at::date <= (o.tracking_code_history->-1->>'until')::timestamptz::date;

-- Troca do código de rastreio (reenvio): o pacote novo começa do zero, mesmo
-- que o antigo já conste como entregue. Antes o "entregue" do pacote antigo
-- ficava, e o sync do 17track (que só acompanha pedido não entregue) nunca
-- cadastrava o código novo — o cliente via o rastreio do pacote antigo
-- (caso #L5-1045). A Data Postado (1º envio) fica.
CREATE OR REPLACE FUNCTION public.shop_orders_keep_tracking_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(btrim(OLD.tracking_code), '') <> ''
     AND upper(btrim(OLD.tracking_code)) IS DISTINCT FROM upper(btrim(COALESCE(NEW.tracking_code, ''))) THEN
    NEW.tracking_code_history := COALESCE(NEW.tracking_code_history, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('code', OLD.tracking_code, 'until', now()));
    NEW.kpi_excluded := true;
    IF NEW.delivery_status IN ('problem', 'delivered') THEN NEW.delivery_status := 'pending_shipment'; END IF;
    NEW.delivered_at := NULL;
    NEW.problem_at := NULL;
    NEW.logistics_note := NULL;
  END IF;
  RETURN NEW;
END $$;

-- Reenvios que ficaram com o "entregue" do pacote antigo (código trocado
-- depois da entrega e rastreio ainda no código antigo).
UPDATE public.shop_orders o
   SET delivery_status = 'pending_shipment', delivered_at = NULL, problem_at = NULL, logistics_note = NULL
  FROM public.shop_order_tracking t
 WHERE t.order_id = o.id
   AND (o.delivery_status = 'delivered' OR o.delivered_at IS NOT NULL)
   AND jsonb_array_length(o.tracking_code_history) > 0
   AND upper(btrim(o.tracking_code)) <> upper(COALESCE(t.tracking_number, ''))
   AND (o.tracking_code_history->-1->>'until')::timestamptz::date >= o.delivered_at;

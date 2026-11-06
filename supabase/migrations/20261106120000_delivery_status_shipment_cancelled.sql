-- "Envio cancelado": o pedido não vai ser entregue (ex.: reenvio cancelado com o
-- código já trocado — #WV1384) mas não foi cancelado na Shopify. Sai de todo o
-- acompanhamento de entrega (sync do 17track, alertas, transportadoras, avisos).
alter table public.shop_orders drop constraint if exists shop_orders_delivery_status_check;
alter table public.shop_orders add constraint shop_orders_delivery_status_check
  check (delivery_status = any (array['pending_shipment','shipped','in_transit','delivered','returned','problem','waiting_customer','shipment_cancelled']));

-- Adiciona "waiting_customer" (Esperando o cliente) como status manual de
-- entrega — pra pedidos travados esperando resposta do cliente (endereço,
-- troca de tamanho, confirmação etc.), distinto de "problem".
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.shop_orders'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%delivery_status%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.shop_orders DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_delivery_status_check
  CHECK (delivery_status IN ('pending_shipment','shipped','in_transit','delivered','returned','problem','waiting_customer'));

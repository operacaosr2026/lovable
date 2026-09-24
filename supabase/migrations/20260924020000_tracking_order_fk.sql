-- shop_order_tracking.order_id não tinha FK: apagar pedidos (corte de data da
-- integração, "excluir pedidos") deixava o rastreio deles solto — 449 órfãos em
-- 24/09/2026, todos de pedidos anteriores ao corte de 01/09 do Route. Remove os
-- órfãos e cria a FK com ON DELETE CASCADE pra não voltar a acontecer.

DELETE FROM public.shop_order_tracking t
WHERE NOT EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = t.order_id);

ALTER TABLE public.shop_order_tracking
  DROP CONSTRAINT IF EXISTS shop_order_tracking_order_id_fkey;

ALTER TABLE public.shop_order_tracking
  ADD CONSTRAINT shop_order_tracking_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.shop_orders(id) ON DELETE CASCADE;

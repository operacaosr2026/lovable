-- Notificações (avisos de atraso): pedido marcado à mão como "excluído" sai das
-- etapas (5/10/21/30 dias) e fica só no card "Excluídos" até ser restaurado.
alter table public.shop_orders add column if not exists notice_excluded_at timestamptz;

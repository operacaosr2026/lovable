-- Lojas e Grupos › Pedidos: pedido com o mesmo item repetido (repeated-items.ts)
-- fica separado — fora da mensagem e do pagamento ao fornecedor — até alguém
-- marcar que o cliente confirmou. Aqui fica quando foi liberado (e por quem).
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS supplier_hold_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_hold_released_by uuid;

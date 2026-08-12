-- Campo de observação livre por pedido, usado na aba Rastreamento.
alter table public.shop_orders
  add column if not exists logistics_note text;

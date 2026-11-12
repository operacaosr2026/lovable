-- Caixa Geral (cópia isolada em shop_cash_overrides): o "Pago com o Shopify
-- Balance" e a loja do Balance não eram gravados — a mudança sumia. Nulo =
-- herda do lançamento original (shop_cash_entries).
alter table public.shop_cash_overrides
  add column if not exists via_balance boolean,
  add column if not exists balance_shop_id uuid references public.shops(id) on delete set null;

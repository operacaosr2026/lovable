-- Gasto pago com o Shopify Balance: de qual loja foi a conta cobrada. Um pagamento
-- único (ex.: fornecedor) fica como despesa de cada loja, mas sai de um Balance só.
-- Vazio = a própria loja do lançamento.
alter table public.shop_cash_entries
  add column if not exists balance_shop_id uuid references public.shops(id) on delete set null;

create index if not exists shop_cash_entries_balance_shop_idx
  on public.shop_cash_entries (balance_shop_id) where balance_shop_id is not null;

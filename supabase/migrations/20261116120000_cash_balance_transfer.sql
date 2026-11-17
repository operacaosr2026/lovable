-- Transferência do Shopify Balance pra conta bancária: vira um par de
-- lançamentos da mesma loja (saída paga com o Balance + entrada na conta) com o
-- mesmo transfer_id. Somados dão zero — saldo total e lucro não mudam, só a
-- divisão conta/Balance. Excluir/editar mexe nos dois juntos.
alter table public.shop_cash_entries
  add column if not exists transfer_id uuid;
alter table public.shop_cash_overrides
  add column if not exists transfer_id uuid;

create index if not exists shop_cash_entries_transfer_idx
  on public.shop_cash_entries (transfer_id) where transfer_id is not null;
create index if not exists shop_cash_overrides_transfer_idx
  on public.shop_cash_overrides (transfer_id) where transfer_id is not null;

-- Shopify Balance: a conta do próprio Shopify onde os repasses de algumas lojas
-- caem (em vez do banco). Não tem API pública, então o Caixa só marca quais
-- lançamentos passaram por ela: o depósito (payout) e as saídas pagas no cartão.
alter table public.shop_cash_entries
  add column if not exists via_balance boolean not null default false;

-- Loja cujos repasses caem no Shopify Balance: payouts novos já entram marcados.
alter table public.shops
  add column if not exists payouts_to_balance boolean not null default false;

-- Vale pros dois syncs de payout (botão e cron) sem mexer em cada um.
create or replace function public.shop_cash_entries_mark_balance_payout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shopify_payout_id is not null and not new.via_balance then
    select coalesce(s.payouts_to_balance, false) into new.via_balance
      from public.shops s where s.id = new.shop_id;
    new.via_balance := coalesce(new.via_balance, false);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shop_cash_entries_mark_balance_payout on public.shop_cash_entries;
create trigger trg_shop_cash_entries_mark_balance_payout
  before insert on public.shop_cash_entries
  for each row execute function public.shop_cash_entries_mark_balance_payout();

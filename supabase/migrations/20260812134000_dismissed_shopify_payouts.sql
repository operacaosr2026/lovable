-- Tombstone table: payouts a user explicitly deleted from the cashflow, so the
-- Shopify sync stops recreating them on every "Sincronizar" click.
create table if not exists public.shop_cash_dismissed_payouts (
  user_id uuid not null,
  shop_id uuid not null,
  shopify_payout_id text not null,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, shop_id, shopify_payout_id)
);

alter table public.shop_cash_dismissed_payouts enable row level security;

create policy "members access shop_cash_dismissed_payouts"
  on public.shop_cash_dismissed_payouts
  for all
  using (has_workspace_access(auth.uid(), user_id, 'shops'::text, shop_id))
  with check (has_workspace_access(auth.uid(), user_id, 'shops'::text, shop_id));

create policy "own shop_cash_dismissed_payouts all"
  on public.shop_cash_dismissed_payouts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

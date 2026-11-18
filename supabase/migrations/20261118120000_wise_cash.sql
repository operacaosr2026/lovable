-- Caixa Geral › Wise (R$): conta no Brasil que recebe o dinheiro mandado do
-- caixa em dólar e paga funcionário, contabilidade etc. Lançamentos manuais em
-- reais; o Saldo atual soma só os conciliados. Entrada vinda do caixa guarda o
-- lançamento de origem (saída "Retirada Empresa" em US$) e o valor em dólar,
-- pra mostrar o câmbio e saber o que ainda não chegou.
create table if not exists public.wise_cash_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  amount numeric(14, 2) not null check (amount > 0),
  date date not null,
  category text,
  description text,
  reconciled boolean not null default false,
  usd_amount numeric(14, 2),
  -- id do lançamento do caixa em dólar (shop_cash_entries ou shop_cash_overrides).
  source_cash_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists wise_cash_entries_owner_date_idx on public.wise_cash_entries (owner_id, date);
create unique index if not exists wise_cash_entries_source_idx
  on public.wise_cash_entries (owner_id, source_cash_id) where source_cash_id is not null;

alter table public.wise_cash_entries enable row level security;
-- Acesso só pelo servidor (supabaseAdmin), que confere a permissão do Caixa.

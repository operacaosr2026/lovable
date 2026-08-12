-- Marca lançamentos cuja data foi ajustada manualmente pelo usuário, para que a
-- sincronização de payouts do Shopify pare de sobrescrever a data corrigida
-- (o valor pode divergir da data prevista quando o banco processa em dia diferente).
alter table public.shop_cash_entries
  add column if not exists date_locked boolean not null default false;

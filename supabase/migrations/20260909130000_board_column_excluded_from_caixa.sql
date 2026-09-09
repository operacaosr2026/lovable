-- Lets a Banco de Lojas board column (e.g. "Em Hold", "Cemitério") be marked so
-- its shops are left out of the consolidated Caixa page — a store parked as
-- on-hold/dead shouldn't count toward the combined balance/receivable totals.
alter table store_board_columns
  add column if not exists excluded_from_caixa boolean not null default false;

-- Wise: nota livre no lançamento (além da descrição).
alter table public.wise_cash_entries add column if not exists note text;

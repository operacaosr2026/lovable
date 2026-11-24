-- Wise: um envio do caixa em US$ pode ser convertido aos poucos (várias
-- entradas ligadas ao mesmo lançamento de origem). O envio sai da lista de
-- pendentes quando a soma em dólar das entradas cobre o valor enviado, ou
-- quando uma entrada encerra o envio (o resto foi taxa / ficou lá).
drop index if exists public.wise_cash_entries_source_idx;
create index if not exists wise_cash_entries_source_idx
  on public.wise_cash_entries (owner_id, source_cash_id) where source_cash_id is not null;

alter table public.wise_cash_entries add column if not exists closes_transfer boolean not null default false;

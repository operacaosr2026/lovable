-- Gastos hipotéticos usados pelo Simulador de caixa (aba "Simulador" em
-- /shops/caixa) — não afetam o caixa real, só a projeção.
create table if not exists simulated_expenses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  description       text not null check (char_length(description) <= 120),
  amount            numeric not null check (amount > 0),
  start_date        date not null,
  recurrence        text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  recurrence_until  date,
  created_at        timestamptz default now()
);

alter table simulated_expenses enable row level security;

create policy "owner_simulated_expenses"
  on simulated_expenses for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

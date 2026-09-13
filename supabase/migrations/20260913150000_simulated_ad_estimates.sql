-- Estimativa de vendas por investimento em Ads, usada pelo Simulador de caixa
-- (aba "Simulador" em /shops/caixa) — não afeta o caixa real, só a projeção.
-- Investimento diário em Ads gera vendas estimadas (investimento / cpa) que
-- viram receita (vendas * ticket_medio) projetada payout_lag_days depois,
-- imitando o atraso de repasse da loja (D+7 por padrão).
create table if not exists simulated_ad_estimates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  description       text not null default 'Facebook Ads' check (char_length(description) <= 120),
  daily_spend       numeric not null check (daily_spend > 0),
  cpa               numeric not null check (cpa > 0),
  avg_ticket        numeric not null check (avg_ticket > 0),
  payout_lag_days   integer not null default 7 check (payout_lag_days >= 0),
  start_date        date not null,
  end_date          date,
  created_at        timestamptz default now()
);

alter table simulated_ad_estimates enable row level security;

create policy "owner_simulated_ad_estimates"
  on simulated_ad_estimates for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

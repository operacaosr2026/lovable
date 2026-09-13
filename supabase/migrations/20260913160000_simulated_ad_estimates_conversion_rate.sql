-- Nem toda venda estimada de Ads efetivamente cai como receita no caixa
-- (recusa de pagamento, cancelamento, etc.) — permite informar a % que
-- realmente converte em receita recebida.
alter table simulated_ad_estimates
  add column if not exists conversion_rate numeric not null default 100
    check (conversion_rate > 0 and conversion_rate <= 100);

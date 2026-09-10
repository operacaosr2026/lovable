-- Trava o valor de um lançamento sincronizado quando o usuário edita o
-- amount manualmente, pro próximo sync da Shopify não sobrescrever o ajuste
-- (mesmo comportamento já existente pra date_locked, agora pra amount).
ALTER TABLE public.shop_cash_entries
  ADD COLUMN IF NOT EXISTS amount_locked boolean NOT NULL DEFAULT false;

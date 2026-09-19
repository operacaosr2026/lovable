-- Guarda o status real do payout na Shopify (paid/in_transit/scheduled/pending)
-- pra "A receber (Shopify)" poder excluir payouts já depositados (o dinheiro já
-- caiu, não é mais "a receber") e contar só saldo disponível + agendado.
ALTER TABLE public.shop_cash_entries
  ADD COLUMN IF NOT EXISTS shopify_payout_status text;

-- Backfill a partir do texto da descrição já salva pelo sync anterior.
UPDATE public.shop_cash_entries
SET shopify_payout_status = 'paid'
WHERE shopify_payout_id IS NOT NULL AND description ILIKE '%depositado%' AND shopify_payout_status IS NULL;

UPDATE public.shop_cash_entries
SET shopify_payout_status = 'in_transit'
WHERE shopify_payout_id IS NOT NULL AND description ILIKE '%em trânsito%' AND shopify_payout_status IS NULL;

UPDATE public.shop_cash_entries
SET shopify_payout_status = 'scheduled'
WHERE shopify_payout_id IS NOT NULL AND description ILIKE '%agendado%' AND shopify_payout_status IS NULL;

UPDATE public.shop_cash_entries
SET shopify_payout_status = 'pending'
WHERE shopify_payout_id IS NOT NULL AND description ILIKE '%previsto%' AND shopify_payout_status IS NULL;

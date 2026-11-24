-- Pagar fornecedor: agora são dois fornecedores (Alice, FlowBorder). Cada lote
-- de pagamento guarda de qual fornecedor é; lotes do mesmo dia só se juntam
-- quando são do mesmo fornecedor. Lotes antigos ficam sem (null).
alter table public.shop_order_payment_batches add column if not exists supplier text;

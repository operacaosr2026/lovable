-- Os lançamentos "Payout Shopify · previsto" (source = shopify_pending_sync)
-- são recriados a cada sync: apaga todos da loja e insere de novo, um por data.
-- Com o sync completo rodando de hora em hora + o botão "Sincronizar" do Caixa,
-- duas execuções simultâneas podiam apagar juntas e depois inserir as duas,
-- duplicando o previsto no Caixa. Com o índice único, o segundo INSERT falha
-- inteiro (os dois caminhos já ignoram esse erro) e fica só um conjunto.
-- Conferido antes de criar: nenhuma data duplicada em 23/09/2026.
CREATE UNIQUE INDEX IF NOT EXISTS shop_cash_entries_pending_payout_unique
  ON public.shop_cash_entries (shop_id, date)
  WHERE source = 'shopify_pending_sync';

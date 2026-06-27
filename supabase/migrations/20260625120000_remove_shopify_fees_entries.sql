-- Remove lançamentos de taxas, chargebacks e reembolsos Shopify do caixa.
-- Os payouts já vêm com valor líquido (descontando taxas e reembolsos),
-- então sincronizar essas entradas separadamente gerava dupla contagem.
DELETE FROM shop_cash_entries
WHERE source = 'shopify_fees_sync';

-- Remove também as categorias órfãs criadas por essas sincronizações.
DELETE FROM shop_cash_categories
WHERE name IN ('Taxas Shopify', 'Chargeback', 'Reembolso')
  AND kind = 'expense';

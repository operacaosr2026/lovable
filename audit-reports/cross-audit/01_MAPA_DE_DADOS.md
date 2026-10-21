# 01 — Mapa de dados e fontes de verdade

Auditoria cruzada de 20–21/10/2026, só leitura. **A produção roda o commit `f17bc38`.** As correções da auditoria anterior (`67ec290`…`3122a39`) estão só no repositório local; os dados de hoje refletem as regras antigas.

## Escopo

Lojas ativas = as do card **Route** (status `ativo`): Lojas 1 a 7. A Loja 4 também está ligada ao card arquivado "Woovah". Walktowave, Serafinie, Chierie, walkesty-caixa e Voultie Matriz ficam fora (sem card ativo).

## Fonte autoritativa por informação

| Informação | Fonte de verdade | Onde fica no sistema | Como chega | Quem lê |
|---|---|---|---|---|
| Pedido, valor bruto, status financeiro | Shopify (pedido) | `shop_orders` (`revenue` = `total_price`, `raw`) | webhook `orders/*` + cron 10 min (30 dias) + sync completo 2×/dia | todas as telas de lucro, Rastreamento, Atendimento, IA |
| Reembolso (valor e dia) | Shopify (`refunds[].transactions`) | `shop_orders.raw->refunds` | junto com o pedido | `loadRefundCbSources` → lucro |
| Chargeback / inquiry | Shopify Payments (disputes) | `shop_order_disputes` | webhook `disputes/*` + sync completo | lucro (dia aberto / dia ganho), taxa de estorno, sino |
| Dinheiro recebido | Shopify Payments (payouts) | `shop_cash_entries` source `shopify_sync` / `shopify_pending_sync` | cron 3×/dia + botão | Caixa |
| Taxas Shopify | Shopify Payments (balance transactions `fee`) | `shop_cash_entries` categoria "Taxas Shopify", source `shopify_fees_sync` | cron 10 min | lucro (o Caixa exclui, pois o depósito já vem líquido) |
| Gasto com anúncios (lucro) | Meta Insights da conta do **card** | `lg_card_ad_spend` | cron 10 min (2 dias pra trás) | todas as telas de lucro |
| Gasto com anúncios (por loja) | Meta Insights das contas **por loja** | `shop_cash_entries` `auto_kind=meta_ads_spend` | cron 10 min | só o resumo 7/30 dias da integração (não entra no lucro nem no Caixa) |
| Saída de caixa da Meta | Meta (cobranças do cartão) | `shop_cash_entries` `auto_kind=meta_billing_charge`, dividida igual entre as lojas | cron 10 min | Caixa |
| Custo do produto (lucro) | Catálogo `products` + `product_cost_history` (por data) | calculado na leitura por item (`orderLineItemsCost`) | — | todas as telas de lucro |
| Pagamento ao fornecedor (caixa) | Lote (`shop_order_payment_batches`) + lançamento conciliado | `shop_cash_entries` "Fornecedor" | ação manual "marcar pago" + previsão automática | Caixa |
| Custo de frete | **não existe no sistema** | — | — | — |
| Rastreio / entrega | 17track | `shop_order_tracking`, `shop_orders.delivery_status` | cron 30 min | Rastreamento, avisos, IA, alertas |
| Recuperação de chargeback | Pedido de cobrança pago na Shopify (tag `recuperacao-alerta`, fora de `shop_orders`) | `chargeback_alert_followups.recovered_amount` | rodada de cobrança | abate o reembolso no dia do pagamento |
| Meta mensal (realizado) | cálculo `computeAccumulatedLucro`, congelado no mês fechado | `company_goals.realizado_final` | job diário 00:00 NY | Metas, Dashboard |

## Datas

- Pedido: dia de NY (`orderDateFor`, desde 23/09/2026).
- Reembolso: dia do fuso da loja no código em produção (`processed_at` com offset −03:00/−04:00); NY no código local.
- Chargeback: `initiated_at` (dia de abertura); ganho em `finalized_on`.
- Taxas: dia no fuso da loja (`shopifyLocalDate` com `iana_timezone`).
- Anúncios do card: dia da conta Meta.
- Depósitos: data do payout.

## Ciclo do pedido (onde cada etapa pode falhar)

| Etapa | Evento/serviço | Tabela | Recuperação | Evidência de processamento |
|---|---|---|---|---|
| Criado/pago | webhook `orders/create` | `shop_orders` | cron 10 min (30 dias) | `raw->>updated_at` igual ao da Shopify (Loja 1: 148/148) |
| Custo previsto | `recomputeOrderCostForecast` | `shop_cash_entries` auto | sync completo | — |
| Postado | webhook `orders/updated` | `tracking_code`, `delivery_status` | cron | 0 pedidos com envio na Shopify e sem código no banco |
| Rastreio | 17track | `shop_order_tracking` | próxima rodada | linhas consultadas em 20/10 |
| Reembolso | webhook `orders/updated` | `raw.refunds` | cron (≤30 dias); local: +busca por alterados 26 h | status igual ao da Shopify em todos os pedidos da Loja 1 |
| Chargeback | webhook `disputes/*` | `shop_order_disputes` | sync completo | tags `chargeback-*` dos pedidos batem com as disputas |
| Recuperação | pedido de cobrança pago | followup | rodada de cobrança | 2 de 2 conferidos com a Shopify (Loja 1) |
| Lucro | leitura | — | — | — |
| Meta | job diário | `company_goals` | não recalcula mês fechado | — |

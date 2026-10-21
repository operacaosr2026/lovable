# 03 — Eventos perdidos, duplicados e sincronização

## Reconciliação com a origem (Shopify)

O conector da Shopify disponível dá acesso a **uma loja** (Loja 1 - Walkesty, `18tpzr-qu.myshopify.com`) e **não** tem permissão de Shopify Payments (payouts, disputas, taxas).

### Loja 1 — pedidos desde o início do Caixa (01/09)

| Verificação | Shopify | Banco | Resultado |
|---|---|---|---|
| Pedidos (dia de NY ≥ 01/09, sem cobrança de alerta) | 148 | 148 | igual |
| Pagos / reembolsados / parciais | 139 / 8 / 1 | 139 / 8 / 1 | igual |
| `updatedAt` × `raw->>updated_at` (amostra de 26 pedidos alterados após 06/10, todos os de outubro) | — | — | igual em todos |
| Pedidos de cobrança `recuperacao-alerta` (#L1-1327, 1328) | 2 | 0 em `shop_orders` | esperado (ficam de fora de propósito) |

Não houve evento perdido, duplicado nem sobrescrito na Loja 1 no período. A loja parou de vender em 06/10 (último pedido #L1-1326), o que bate com a Shopify.

## Checagens internas (lojas ativas, pedidos desde 01/09)

| Sinal de evento perdido | Casos |
|---|---|
| Envio com código na Shopify (`raw.fulfillments`) e sem código no pedido | 0 |
| Envio na Shopify e pedido ainda "aguardando envio" | 0 |
| Pedido com tag `chargeback*` e sem disputa gravada | 0 |
| Disputa (aberta após 15/09) sem pedido no banco | 0 |
| Pedido "reembolsado" sem transação de reembolso | 0 |
| Pedido cancelado e não reembolsado/estornado | 0 |
| Código de rastreio sem linha de rastreio | 0 |
| `revenue` diferente de `total_price` | 0 |
| Status financeiro da coluna diferente do `raw` | 0 |
| Enviado sem evento de rastreio há mais de 10 dias | 30 (ver abaixo) |

### Os 30 rastreios parados

As linhas de rastreio desses pedidos foram consultadas em 20/10, então o 17track está rodando. Os pacotes estão parados de verdade, vários com o último evento no mesmo dia (29/09 e 06/10), o que indica lote retido na transportadora. Só 1 está marcado como problema. É situação operacional, não falha de sincronização (**CROSS-014**).

## Duplicidade e idempotência (banco real)

| Verificação | Duplicatas |
|---|---|
| Pedidos (`shop_id, source, external_id`) | 0 |
| Depósitos (`shopify_payout_id`) | 0 |
| "Previsto" por loja/dia | 0 |
| Cobranças da Meta (`mercury_transaction_id`) | 0 (136 cobranças = 136 lançamentos) |
| Avisos ao cliente enviados 2× no mesmo dia | 0 |
| Recuperações × pedidos de cobrança | 1:1 |

## Histórico das rotinas

`cron_runs` (2 dias): 0 falhas e 0 execuções sem terminar. O `pg_net` desiste em 5 s (≈90 timeouts em 6 h), mas a função continua na Vercel e grava o resultado. **Ressalva:** em produção ainda vale o BUG-005 da auditoria anterior (falha no sync completo não chega ao sino); a correção está só no código local.

## Eventos que dependem só do webhook (código em produção)

Mudança em pedido com mais de 30 dias (reembolso tardio, cancelamento) só chega pelo webhook. Se ele falhar até a Shopify desistir, a mudança se perde. Corrigido no código local (busca de pedidos alterados nas últimas 26 h), **ainda não publicado**.

# Fase 3 — Regras de negócio e financeiro

## O que está bem (verificado)

- Regras centralizadas em `src/lib/finance-rules.ts` (funções puras) com testes que bloqueiam o deploy.
- **Sem dupla contagem de reembolso/chargeback no Caixa**: os depósitos da Shopify já vêm líquidos, e os lançamentos `shopify_auto_sync` (Reembolso/Chargeback) são excluídos de todas as leituras do Caixa, simulador e snapshot.
- Previsão de fornecedor exclui pedidos já pagos em lote, reembolsados e com chargeback não ganho (`supplierForecastOrders`, `finance-rules.ts:202`).
- Ajuste manual em depósito (data/valor travados, conciliado) é respeitado no cron e no botão (`payoutPatch`, `finance-rules.ts:252`).
- Chargeback ganho volta como valor negativo no dia do ganho (`finance-rules.ts:91`).
- Moeda: todos os pedidos das lojas ativas dos últimos 60 dias são USD (consulta no banco).
- `order_date` usa a mesma função (`orderDateFor`, fuso NY desde 23/09/2026) nas três cópias da gravação.
- Duplicatas no banco (consulta): 0 depósitos duplicados, 0 "previsto" duplicado, 0 pedidos duplicados. 5 casos de vários lançamentos `auto` no mesmo dia/loja eram lotes legítimos diferentes.

## Defeitos

- **BUG-001 (P1, Confirmado)** — reembolso parcial contado como total. Detalhe e números no relatório final.
- **BUG-002 (P1, Confirmado)** — mudar a data de início do Caixa apaga dados manuais e conciliados.
- **BUG-003 (P1, Provável)** — webhook antigo chegando depois sobrescreve o pedido (pode "desfazer" um reembolso).
- **BUG-012 (P2)** — pedido apagado volta como "pendente" e o custo de fornecedor pode ser previsto de novo.
- **BUG-013 (P2, latente)** — gasto da Meta sem conversão de moeda.
- **BUG-020 (P2, dúvida de regra)** — Dashboard conta custo de produto de pedido reembolsado/cancelado; Caixa não.
- **BUG-018 (P3)** — valores gravados com resíduo de ponto flutuante.
- **BUG-019 (P3)** — reembolso, chargeback e `shipped_at` datados em UTC.

## Dúvidas de regra (não presumi a resposta)

1. Pedido reembolsado **antes do envio**: o custo do produto deve sair do lucro? Hoje o Dashboard desconta, o Caixa não prevê pagamento.
2. Taxa de disputa da Shopify (US$ 15 por chargeback): não encontrei onde entra no lucro. Pode estar em "Taxas Shopify" se a sincronização de taxas ler esse tipo de transação — não verifiquei (`syncShopifyFeesForShop`, `shop-orders.functions.ts:1099`).
3. Pedido com reembolso **e** chargeback no mesmo pedido: hoje os dois descontam. É raro, mas seria desconto em dobro.

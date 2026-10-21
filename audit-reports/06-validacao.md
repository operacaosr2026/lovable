# Fase 6 — Validação (testes seguros)

Nenhum teste que escreve em produção foi executado. Validação feita por consultas `SELECT` ao banco real e pela suíte existente.

## Reproduções com dados reais

### BUG-001 — reembolso parcial superestimado
Consulta nos pedidos das lojas ativas, últimos 60 dias, status `partially_refunded` (8 pedidos):
- devolvido de fato em transações bem-sucedidas: **US$ 441,35**
- reembolso que o sistema calcula (`max(transações, total_price − current_total_price)`): **US$ 1.049,10**
- diferença: **US$ 607,75** contados como reembolso sem o dinheiro ter saído.
Exemplos: `#L2-1146`, `#L2-1123`, `#L3-1043` (devolveu 38,97 de 129,90; o sistema conta 129,90); `#L1-1224`, `#L3-1051`, `#WK1160` (devolveu 49,95 de 99,90; conta 99,90). Em todos, a Shopify registra a parte não devolvida como `order_adjustments.kind = "refund_discrepancy"`.
Pedidos `refunded` (40): calculado = devolvido = US$ 4.206,00 — sem erro.

### Duplicidades (todas zeradas hoje)
Depósitos por `shopify_payout_id`: 0. "Previsto" por loja/dia: 0. Pedidos por `shop_id,source,external_id`: 0. Avisos ao cliente enviados 2x no mesmo dia para o mesmo pedido: 0. Fila de avisos sem item preso em `enviando`.

### Saúde das rotinas (cron_runs, 2 dias)
Todas as rotinas com 0 falhas e 0 execuções sem terminar.

## Cenários extremos — o que o código faz

| Cenário | Comportamento observado no código |
|---|---|
| Sem registros | Dashboard divide por zero protegido (`pedidos > 0 ? …`); deltas retornam 0 quando o período anterior é 0 (mostra "0%" mesmo se subiu de 0 para 100 — informativo, não erro) |
| Valor negativo/zero | previsão de fornecedor ≤ 0 apaga o lançamento (se não travado); reembolso/chargeback usam `Math.abs` |
| Campo obrigatório ausente | `Number(x ?? 0)` vira 0 em silêncio |
| Virada de mês/ano | datas em NY no geral; reembolso/chargeback em UTC podem cair no mês seguinte (BUG-019) |
| Operação repetida após timeout | mutações GraphQL podem duplicar (BUG-008); e-mails podem duplicar (BUG-009) |
| Duas operações simultâneas | "previsto" pode duplicar (BUG-007); permissões de membro podem zerar (BUG-021) |

## Testes que recomendo criar (sem banco)

1. `orderRefundAmountByDate` com `refund_discrepancy` (pedido 129,90, transação 38,97) → deve dar 38,97.
2. `orderRefundAmountByDate` com refund sem transação e status `paid` → 0.
3. Ingestão de pedido com `updated_at` mais antigo que o gravado → não deve sobrescrever.
4. Link de rastreio no webhook com `tracking_code` trocado à mão → usa o código manual.

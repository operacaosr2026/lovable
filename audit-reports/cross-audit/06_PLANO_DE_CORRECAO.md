# 06 — Plano de correção

## Passo 0 — publicar o que já está pronto

Os 4 commits locais (`67ec290`, `ef76332`, `030b087`, `3122a39`) resolvem CROSS-002, a parte de reembolso do CROSS-011, a falta de rede de segurança para pedidos antigos (03) e a falha silenciosa do sync completo. As migrações já estão em produção. Nada desta auditoria depende de esperar.

## Lote 1 — números do lucro (decisão + código)

| Ordem | Item | Depende de | Risco | Regressão |
|---|---|---|---|---|
| 1 | **CROSS-001** taxas pela origem `shopify_fees_sync` | revisar com você os 11 lançamentos manuais | baixo | totais de set/out antes e depois |
| 2 | **CROSS-003** custo × pago ao fornecedor | **você explicar** o que os valores conciliados incluem | — | — |
| 3 | **CROSS-006** reembolso pendente no lucro | — | baixo | teste em `finance-rules` |
| 4 | **CROSS-004** carência no congelamento da meta | — | baixo | conferir em 01/11 |
| 5 | **CROSS-008** recuperação de pedido anterior ao início | decisão de regra | baixo | — |

Itens 1, 3 e 5 mexem no mesmo ponto (`loadRefundCbSources` e leitura de taxas): fazer juntos, com teste de regressão no total de setembro e outubro.

## Lote 2 — telas e dados

| Item | Risco |
|---|---|
| **CROSS-005** detalhe por loja sem anúncio do card inteiro | baixo |
| **CROSS-007** nomes bruto/líquido para a IA | baixo |
| **CROSS-011** taxas no dia de NY | baixo (move algumas taxas de dia) |

## Lote 3 — higiene

**CROSS-009** (contas Meta por loja), **CROSS-010** (funções mortas), **CROSS-012**, **CROSS-013**, **CROSS-014** (alerta de lote parado).

## Sobre o setembro congelado

O realizado de setembro nas Metas (US$ 14.759,72) inclui CROSS-001 e CROSS-002 (até ~US$ 663 abaixo do real). Por desenho, ele não recalcula. Se você quiser o valor corrigido, depois de publicar dá para recongelar setembro de forma pontual (apagar `realizado_final` daquele mês para o job recalcular) — operação de escrita, só com a sua autorização.

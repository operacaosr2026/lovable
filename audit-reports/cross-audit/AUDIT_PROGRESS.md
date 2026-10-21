# Andamento — auditoria cruzada

Início e fim: 20–21/10/2026. Produção no commit `f17bc38`; correções da auditoria anterior só no repositório local (`67ec290`…`3122a39`).

| Fase | Situação |
|---|---|
| 1 Fontes e fluxos | Concluída — 01_MAPA_DE_DADOS.md |
| 2 Regras financeiras | Concluída — 02 (tabela de fórmulas) |
| 3 Comparação entre módulos | Concluída — 02 |
| 4 Eventos perdidos e duplicados | Concluída — 03 |
| 5 Reconciliação financeira e temporal | Concluída — 03 e 04 (Loja 1 contra a Shopify; demais por sinais internos) |
| 6 Perdas silenciosas | Concluída — 05 |
| 7 Validação e causa raiz | Concluída — 04 e 05 |
| 8 Consolidação | Concluída — 06 e 07 |

## Decisões (21/10/2026)

- CROSS-003: os valores conciliados ao fornecedor estão certos (decisão do usuário). Nada a corrigir nos dados.
- CROSS-006: reembolso pendente fica de fora até concluir (regra do usuário). A regra local passou a contar só transação concluída, e a diferença de preço não substitui reembolso pendente.
- CROSS-004: corrigido — o mês só congela 3 dias depois de fechar; até lá o realizado é ao vivo.
- CROSS-001: mantido como está (decisão do usuário). Os lançamentos manuais em "Taxas Shopify" foram conciliados com o banco e continuam contando no Caixa e no lucro.
- Commits publicados (push) junto com estas correções.

## Para continuar

- Com acesso de leitura à Shopify Payments (escopo `read_shopify_payments`), conferir depósitos, taxas e disputas contra a origem.
- Conectar as Lojas 2 a 7 ao conector da Shopify para repetir a reconciliação de pedidos.
- Pendência de negócio: explicar os valores conciliados ao fornecedor em setembro (CROSS-003).
- Reavaliar CROSS-004 em 01–05/11 (primeiro congelamento no dia 1).

# 02 — Auditoria entre módulos

## Fórmulas de lucro encontradas

| Onde | Usado por | Receita | Reembolso/chargeback | Custo produto | Taxas | Anúncios |
|---|---|---|---|---|---|---|
| `getDashboardOverview` (`lg-cards.functions.ts:636`) | Dashboard inicial | soma `revenue` | `getPanelRefundsAndChargebacks` (1 dia = diluído; vários = real) | `orderLineItemsCost` | categoria "Taxas Shopify" | `lg_card_ad_spend` dos cards ativos |
| `getShopDashboardMetrics` (`shop-orders.functions.ts:~2190`) | Dashboard de Lojas e Grupos | igual | igual (diluído em 1 dia) | igual | igual | `adSpendForShops` |
| `getLgCardQuickMetrics` (`lg-cards.functions.ts:~930`) | card de Lojas e Grupos | igual | real | igual | igual | `adSpendForCards` |
| `computeAccumulatedLucro` (`lg-overview.functions.ts:22`) | Metas, Metas da empresa, IA (Consultor), eventos de meta | igual | real | igual | igual | `adSpendForShops` |
| `getMonthlyProfit` (`shop-orders.functions.ts:1459`) | **nenhuma tela** | igual | real | igual | igual | "Facebook Ads" **da loja** |
| `listShops.monthProfit` (`shops.functions.ts:22`) | **nenhuma tela** | igual | real | **pagamentos ao fornecedor do Caixa** | igual | "Facebook Ads" **da loja** |

**Conclusão:** as telas em uso têm a mesma fórmula e as mesmas fontes. A única diferença proposital é a diluição de reembolso/chargeback quando se olha um único dia. As duas fórmulas divergentes estão em funções sem uso (CROSS-010).

## 4.1 Dashboard × Caixa

São coisas diferentes por definição: o Dashboard é **competência** (pedido no dia da venda, custo calculado) e o Caixa é **dinheiro** (depósito, pagamento real). Não reconciliam linha a linha, e isso não é defeito. O que conferi:

- **Taxas:** o Caixa exclui `shopify_fees_sync` (o depósito já vem líquido) — correto. Porém lançamentos **manuais** de conciliação com a categoria "Taxas Shopify" entram no lucro por categoria (**CROSS-001**).
- **Reembolso/chargeback:** o Caixa não lança (o depósito já vem descontado); o lucro lê dos pedidos e disputas — sem dupla contagem. A gravação `shopify_auto_sync` nunca persistiu nada (0 linhas).
- **Anúncios:** o Caixa usa as cobranças do cartão (`meta_billing_charge`) e ignora o gasto diário (`LgCashflowView.tsx:1138`, `caixa-snapshot.server.ts:46`); o lucro usa o gasto do card. Sem dupla contagem. Cobranças de 24/09 a 20/10: US$ 18.362,90; gasto do card no mesmo período: US$ 17.396,09 (diferença de defasagem e impostos da Meta, plausível).
- **Custo do produto × pagamento ao fornecedor:** nos lançamentos de setembro ligados a lotes, o pago conciliado é US$ 25.024,00 contra US$ 21.527,00 calculados (+16%). Em outubro, US$ 6.246,90 contra US$ 6.370,60 (−2%). Ver **CROSS-003**.

## 4.2 Dashboard × Metas

- Mesma fórmula (`computeAccumulatedLucro`), mesmas fontes. Diferença esperada: no filtro de um único dia, o Dashboard dilui reembolso/chargeback e as Metas não.
- Projeção: lucro até ontem + média dos 3 últimos dias fechados × dias restantes; o dia corrente fica fora da média. Coerente.
- Mês fechado é **congelado** (`company_goals.realizado_final`) e nunca recalcula (**CROSS-004**). Setembro foi congelado em 07/10 com US$ 14.759,72; as divergências confirmadas (CROSS-001, CROSS-002) deixam esse valor até ~US$ 663 abaixo do real.

## 4.3 Chargebacks × Caixa

- Disputas da Loja 1 (10 no banco) batem com as tags dos pedidos na Shopify: `chargeback-submitted` = `under_review` (#L1-1221, 1261, 1291), `chargeback-lost` = `lost` (#L1-1280, 1287), `chargeback-won` = `won` (#L1-1206).
- Pedido com reembolso **e** chargeback (#L1-1206): chargeback −99 em 17/09, ganho +99 em 18/09, reembolso −99,90 em 18/09. Efeito líquido = o dinheiro que saiu. Sem dupla contagem; único caso nas lojas ativas.
- Taxa de disputa (US$ 15): vem pelas taxas automáticas (9 lançamentos tipo `dispute` desde setembro). Uma delas também foi lançada à mão (CROSS-001).
- Recuperações: 5 pagas (US$ 99,90 cada). As 2 da Loja 1 batem com os pedidos de cobrança #L1-1327 e #L1-1328 na Shopify. Duas recuperações são de pedidos anteriores ao início do Caixa (**CROSS-008**).

## 4.4 Atendimento × Pedidos × Reembolsos

- 36 pedidos reembolsados nas lojas ativas desde 01/09; 6 foram entregues **depois** do reembolso (US$ 599,40). Os 6 estão nos Alertas de chargeback (cobrança), e 2 já foram recuperados — o sistema enxerga a perda.
- Reembolsos pendentes (transação `pending`, pedido ainda `paid`): 3 desde 20/10 (US$ 359,70), fora do lucro até concluírem (**CROSS-006**).
- Não cruzei o status das conversas do Atendimento com o dos pedidos (limitação; ver 07).

## 4.5 Produtos × Pedidos × Caixa

- Catálogo cobre os itens vendidos: desde 01/09, só 1 unidade ("Samba Jane") caiu no custo padrão da loja.
- Histórico de custo por data existe para os 13 produtos, semeado desde 1900-01-01. Mudar o custo hoje não altera o passado.
- Mas trocar **nome ou palavra-chave** de um produto muda retroativamente qual produto casa com cada item, e o custo do passado muda junto (ver 05).
- Produto com custo 0 ("Nike Zoom Vomero 5 …"): sem vendas desde setembro (**CROSS-013**, latente).
- Custo de frete: o sistema não tem esse conceito.

## 4.6 IA × dados operacionais

- O Consultor usa `computeAccumulatedLucro` (mesmo lucro das Metas) e `getGroupRefundsAndChargebacks` (mesmos reembolsos e chargebacks). Coerente.
- "Faturamento" para a IA é o **bruto**; no Dashboard é o **líquido** (**CROSS-007**).
- Herda as divergências do lucro (CROSS-001, CROSS-002) — a IA recebe os mesmos números.

## Dashboard de Lojas e Grupos — detalhe por loja

O modal de detalhamento (`LgDashboard.tsx:266`) consulta cada loja isoladamente. `adSpendForShops` devolve o gasto do card inteiro para qualquer lista de lojas, então o "Custo total" de **cada** loja inclui todo o anúncio do Route (**CROSS-005**).

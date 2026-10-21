# 04 — Inconsistências financeiras

Valores: lojas ativas (card Route), consultas de leitura em 20–21/10/2026.

---

**ID:** CROSS-001
**Título:** Lançamentos manuais de conciliação na categoria "Taxas Shopify" são descontados do lucro além das taxas automáticas e dos reembolsos
**Prioridade:** P1
**Evidência:** Confirmado (inclusão no lucro e duplicidade de 2 itens, US$ 114,90) · Provável (duplicidade dos demais)
**Módulos afetados:** Dashboard, Dashboard de Lojas e Grupos, card, Metas (inclusive o setembro congelado), IA
**Fonte original:** lançamentos manuais do Caixa (`source = manual`, todos `reconciled = true`)
**Arquivo e linha:** `src/lib/shop-orders.functions.ts` (~2214–2220, `getShopDashboardMetrics`); `src/lib/lg-overview.functions.ts:33-36`; `src/lib/lg-cards.functions.ts:697-698` e `~949`
**Registro ou evento:** 11 lançamentos, US$ 572,79 (set: 10 / US$ 563,07; out: 1 / US$ 9,72). Ex.: Loja 1, 30/09, US$ 99,90 "Reembolso Shopify"; Loja 1, 29/09, US$ 15,00 (taxa de disputa); Loja 2, 20–23/09, US$ 28,07 + 118,73 + 42,09 + 99,90 + 105,19
**Comportamento esperado:** o lucro conta cada taxa uma vez (as automáticas) e cada reembolso uma vez (pelos pedidos)
**Comportamento encontrado:** todas as telas de lucro somam `category = 'Taxas Shopify'` sem olhar a origem; os ajustes que o usuário lançou para conciliar o Caixa (débitos da Shopify na conta bancária, reembolsos, taxa de disputa) entram de novo no lucro. Nos mesmos dias já existem as taxas automáticas (ex.: Loja 2, 20/09: automáticas US$ 14,54 + manuais US$ 146,80)
**Causa raiz:** o lucro filtra taxas pela **categoria** (que o usuário pode usar à mão), não pela origem `shopify_fees_sync`
**Impacto operacional:** lucro do mês e realizado das Metas abaixo do real
**Impacto financeiro:** até US$ 572,79 de lucro a menos (set + out); confirmado em US$ 114,90
**Como reproduzir:** `select date, amount, description, source from shop_cash_entries where category='Taxas Shopify' and source <> 'shopify_fees_sync'`
**Correção recomendada:** no lucro, ler só `source = 'shopify_fees_sync'` para taxas (o reembolso e a taxa de disputa já vêm de outras fontes); orientar que conciliação manual use outra categoria
**Risco da correção:** se algum lançamento manual era uma taxa real que a Shopify não reporta (ex.: US$ 1 "Shopify" da Loja 3), ela sai do lucro — revisar os 11 com você

---

**ID:** CROSS-002
**Título:** Reembolso parcial contado como total (código em produção)
**Prioridade:** P1
**Evidência:** Confirmado
**Módulos afetados:** todas as telas de lucro, Metas, IA
**Fonte original:** `shop_orders.raw.refunds` (ajuste `refund_discrepancy`)
**Arquivo e linha:** `src/lib/finance-rules.ts` (`orderRefundAmountByDate`, versão em produção)
**Registro ou evento:** ex.: #L2-1146, #L2-1123, #L3-1043, #L1-1224, #L3-1051, #WK1160
**Comportamento esperado:** reembolso = dinheiro devolvido
**Comportamento encontrado:** reembolso = máx(transações, total − total atual)
**Causa raiz:** BUG-001 da auditoria anterior
**Impacto financeiro:** setembro US$ 99,90; outubro (até 20/10) US$ 507,85 de reembolso a mais
**Correção recomendada:** já feita no commit local `67ec290` (BUG-001), **falta publicar**
**Risco da correção:** muda números de meses passados (exceto setembro congelado nas Metas)

---

**ID:** CROSS-003
**Título:** Custo do produto calculado diverge do valor pago ao fornecedor conciliado no Caixa
**Prioridade:** P1 (se confirmado)
**Evidência:** Hipótese / Não verificável sem informação do negócio
**Módulos afetados:** Dashboard, Metas, IA × Caixa
**Fonte original:** lotes de pagamento (`shop_order_payment_batches.total_amount`, calculado na hora de marcar pago) × lançamento conciliado (`shop_cash_entries.amount`)
**Arquivo e linha:** custo: `src/lib/product-cost-match.ts:63`; lotes: `shop-orders.functions.ts` (`markOrdersPaid`)
**Registro ou evento:** set: lançamentos ligados a lotes somam US$ 25.024,00 contra US$ 21.527,00 dos lotes (+US$ 3.497, +16%). Maiores: Loja 1 lote #16 (4 itens, US$ 152 → conciliado US$ 1.550); Loja 2 lote #21 (US$ 164 → US$ 1.010); Loja 3 lote #2 (US$ 76 → US$ 761). Out: US$ 6.246,90 × US$ 6.370,60 (−2%)
**Comportamento esperado:** custo do lucro ≈ o que se paga ao fornecedor pelos mesmos pedidos
**Comportamento encontrado:** em setembro, vários lotes foram conciliados com valores muito maiores que o custo dos seus itens, e a descrição ainda diz "4 itens"
**Causa raiz (hipóteses):** (a) transferência bancária cobrindo vários lotes conciliada num só lançamento; (b) frete ou taxa do fornecedor, que o sistema não modela (não há custo de frete); (c) custo de catálogo desatualizado em setembro
**Impacto financeiro:** se (b) ou (c), o lucro de setembro estaria superestimado em até US$ 3.497; se (a), não há erro
**Como reproduzir:** comparar `e.amount` × `b.total_amount` em `shop_cash_entries e join shop_order_payment_batches b on b.cash_entry_id = e.id`
**Correção recomendada:** confirmar com você o que esses valores incluem; se houver frete ou taxa do fornecedor, criar o campo de custo logístico; se for transferência agrupada, conciliar ligando os lotes à transferência em vez de editar o valor de um lote
**Risco da correção:** nenhum até haver decisão

---

**ID:** CROSS-006
**Título:** Reembolso pendente fica fora do lucro enquanto não conclui
**Prioridade:** P2
**Evidência:** Confirmado
**Módulos afetados:** lucro, Metas
**Fonte original:** transação de reembolso `status = pending` com o pedido ainda `paid`
**Arquivo e linha:** `src/lib/shop-orders.functions.ts` (`loadRefundCbSources`, filtro `shopify_financial_status in ('refunded','partially_refunded')`)
**Registro ou evento:** #L1-1258, #L1-1299, #L4-1431 (20/10, US$ 359,70). Em lojas inativas há pendentes desde julho e agosto (#WK1092, #SF1235, #SF1199, #SF1171, #SF1083)
**Comportamento encontrado:** enquanto pendente, o lucro conta a venda inteira; o reembolso entra no dia em que conclui
**Causa raiz:** o filtro olha o status do pedido, não as transações
**Impacto financeiro:** temporário; US$ 359,70 hoje
**Correção recomendada:** incluir pedidos `paid` que tenham transação de reembolso pendente na lista de reembolsos (o código local já soma transações `pending`, só falta o filtro de carga); aviso no sino para reembolso pendente há mais de 3 dias
**Risco da correção:** um reembolso pendente que falhar sairia do lucro e voltaria — aceitável

---

**ID:** CROSS-008
**Título:** Recuperação de chargeback de pedido anterior ao início do Caixa abate reembolso que nunca foi contado
**Prioridade:** P3
**Evidência:** Confirmado
**Módulos afetados:** lucro de outubro
**Registro ou evento:** Loja 4 (pedido fora do banco, recuperado #L4-1533 em 15/10) e Loja 2 (#SB4-1031, recuperado #L2-1290 em 16/10), US$ 99,90 cada
**Comportamento encontrado:** o pagamento entra como reembolso negativo em outubro, embora o reembolso original nunca tenha sido descontado (é anterior ao início)
**Impacto financeiro:** +US$ 199,80 de lucro em outubro. O dinheiro entrou de fato — é questão de definição, não de erro de caixa
**Correção recomendada:** decidir a regra; se o lucro deve ser só de competência dentro do Caixa, ignorar recuperação de pedido anterior ao início
**Risco da correção:** baixo

---

**ID:** CROSS-011
**Título:** Datas de reembolso e taxa usam o fuso da loja; pedido usa NY
**Prioridade:** P3
**Evidência:** Confirmado
**Arquivo e linha:** taxas `shop-orders.functions.ts` (`shopifyLocalDate`, ~1067); reembolso em produção `finance-rules.ts` (`slice(0,10)` do horário da loja)
**Registro ou evento:** 1 de 47 reembolsos desde 01/09 cai em dia diferente (US$ 99,90); nenhum muda de mês
**Impacto financeiro:** desprezível hoje; o reembolso já está corrigido no código local (BUG-019); as taxas seguem no fuso da loja
**Correção recomendada:** datar as taxas pelo dia de NY (`isoDateUS`)

# 05 — Riscos silenciosos

---

**ID:** CROSS-004
**Título:** Meta do mês é congelada à meia-noite do dia 1, antes de os dados do último dia chegarem, e nunca é recalculada
**Prioridade:** P2
**Evidência:** Confirmado (mecanismo) · Não medido (impacto)
**Módulos afetados:** Metas da empresa, Dashboard (meta), histórico
**Arquivo e linha:** `src/lib/company-goals.server.ts:44-57` (`freezeClosedCompanyGoals`, chamado pelo job `estorno-daily` às 04:00 UTC = 00:00 NY)
**Comportamento esperado:** o realizado do mês fechado reflete o mês completo
**Comportamento encontrado:** congela na virada. O gasto da Meta do último dia ainda é ajustado por até 2 dias (sync de anúncios lê 2 dias pra trás), e taxas e reembolsos atrasados chegam depois. Depois de congelado, nada atualiza
**Causa raiz:** congelamento sem carência
**Impacto financeiro:** não medido. Setembro foi congelado em 07/10 (primeira execução, 7 dias depois do fim do mês), então ainda não houve congelamento "no dia 1"; o primeiro será em 01/11
**Como reproduzir:** comparar `realizado_final` de outubro com o recálculo em 05/11
**Correção recomendada:** congelar só a partir do dia 3 (ou 5) do mês seguinte
**Risco da correção:** nenhum relevante

---

**ID:** CROSS-005
**Título:** No detalhe por loja do Dashboard de Lojas e Grupos, cada loja recebe todo o gasto de anúncios do card
**Prioridade:** P2
**Evidência:** Confirmado
**Módulos afetados:** Dashboard de Lojas e Grupos (modal de detalhamento de "Custo total")
**Arquivo e linha:** `src/components/lojas-grupos/LgDashboard.tsx:266-270` (consulta uma loja por vez); `src/lib/lg-card-ad-spend.server.ts` (`adSpendForShops` devolve o gasto do card inteiro)
**Comportamento esperado:** custo total por loja com a parte de anúncios dela (ou sem anúncios, se não dá para separar)
**Comportamento encontrado:** cada uma das 7 lojas mostra o gasto inteiro do Route; a soma das linhas fica 7× maior que o total
**Causa raiz:** o gasto é por card (conta da Meta), sem rateio por loja
**Impacto financeiro:** só de leitura (o total do painel está certo); análise por loja enganosa
**Correção recomendada:** no detalhe por loja, não somar anúncios (mostrar "anúncios do card" à parte) ou ratear por pedidos ou faturamento, com rótulo claro
**Risco da correção:** baixo

---

**ID:** CROSS-007
**Título:** "Faturamento" tem dois significados
**Prioridade:** P3
**Evidência:** Confirmado
**Arquivo e linha:** `src/lib/consultant.server.ts:114-117` (bruto) × `getShopDashboardMetrics`/`getDashboardOverview` (líquido: vendas − reembolsos − chargebacks)
**Impacto:** a IA pode citar um faturamento maior que o do Dashboard para o mesmo período
**Correção recomendada:** mandar à IA "faturamento_bruto" e "faturamento_liquido" com esses nomes

---

**ID:** CROSS-009
**Título:** Gasto da Meta "por loja" gravado a cada 10 min com campanhas sobrepostas
**Prioridade:** P3
**Evidência:** Confirmado
**Registro ou evento:** a mesma conta `act_3955…` está na Loja 1 (28 campanhas), Loja 2 (25), Loja 4 (2) e no card Route (31). Desde setembro: Loja 1 US$ 22.300,08 e Loja 2 US$ 30.432,90 de "gasto da loja", mais que o card inteiro
**Impacto:** não entra no lucro nem no Caixa; só o resumo 7/30 dias da integração Meta de cada loja mostra números sobrepostos. Gasta chamada à API e escrita no banco a cada 10 min
**Correção recomendada:** desligar as contas por loja que repetem a conta do card, ou tirar o resumo por loja

---

**ID:** CROSS-010
**Título:** Duas funções de lucro com fórmulas diferentes continuam no código, sem uso
**Prioridade:** P3
**Evidência:** Confirmado
**Arquivo e linha:** `src/lib/shop-orders.functions.ts:1459` (`getMonthlyProfit`, anúncios "Facebook Ads" da loja); `src/lib/shops.functions.ts:22` (`listShops`: custo = pagamento ao fornecedor; "saldo" soma também as taxas automáticas, que já vêm descontadas do depósito)
**Impacto:** nenhum hoje; se alguém religar, as telas passam a divergir
**Correção recomendada:** apagar ou alinhar à fórmula central

---

**ID:** CROSS-012
**Título:** Prazo de pagamento ao fornecedor lido do "primeiro" card da loja, sem ordem
**Prioridade:** P3
**Evidência:** Confirmado (latente)
**Arquivo e linha:** `getShopPaymentDays` (`sync-shop-orders.ts`, `lg_card_shops … limit(1)`)
**Registro ou evento:** Loja 4 está no Route (ativo) e no Woovah (arquivado); hoje os dois têm 1 dia, sem efeito
**Correção recomendada:** preferir o card ativo

---

**ID:** CROSS-013
**Título:** Produto com custo zero no catálogo
**Prioridade:** P3
**Evidência:** Confirmado (latente)
**Registro ou evento:** "Nike Zoom Vomero 5 Photon Dust Metallic Silver", custo 0, sem palavra-chave; 0 vendas desde setembro
**Impacto:** se vender, entra no lucro sem custo
**Correção recomendada:** exigir custo > 0 no cadastro ou avisar no sino

---

**ID:** CROSS-014
**Título:** Pacotes parados sem marcação de problema
**Prioridade:** P3 (operacional)
**Evidência:** Confirmado
**Registro ou evento:** 30 pedidos enviados sem evento de rastreio há mais de 10 dias (último evento em 29/09 ou 06/10 para a maioria); 1 marcado como problema
**Impacto:** cliente sem notícia → risco de chargeback "produto não recebido" (motivo das 2 disputas perdidas da Loja 1)
**Correção recomendada:** regra de alerta "lote parado" (vários pedidos com o mesmo último evento sem movimento por N dias)

---

## Outros riscos (sem defeito hoje)

- **Troca de nome ou palavra-chave de produto** muda retroativamente qual custo casa com cada item do passado. O histórico de custo cobre a data, não o casamento de nomes.
- **Custo padrão da loja** (fallback) não tem histórico: mudar o padrão muda o custo de itens antigos sem cadastro (hoje: 1 unidade desde setembro).
- **Reembolsos pendentes "eternos":** nas lojas inativas há pendentes desde julho; se acontecer em loja ativa, o lucro fica alto em silêncio (CROSS-006).

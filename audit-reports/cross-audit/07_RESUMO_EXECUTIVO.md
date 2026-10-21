# 07 — Resumo executivo

## Os números são confiáveis?

**Na maior parte, sim.** Os dados do banco batem com a Shopify onde deu para conferir. Na Loja 1, 148 de 148 pedidos desde 01/09 estão iguais na origem (status, valores e última alteração), sem evento perdido, duplicado ou sobrescrito. As checagens internas das 7 lojas ativas deram zero inconsistência entre pedidos, envios, disputas e reembolsos. As telas em uso (Dashboard, Lojas e Grupos, Metas, IA) usam a mesma fórmula de lucro e as mesmas fontes.

Onde o sistema **não** diz a verdade é em pontos específicos da conta de lucro, todos para menos ou para mais em valores pequenos frente ao faturamento (~US$ 100 mil em 60 dias).

## Contagem

| Prioridade | Total | Confirmados | Prováveis | Hipóteses |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 3 | 2 (CROSS-001 parcial, CROSS-002) | CROSS-001 (resto) | CROSS-003 |
| P2 | 3 | 3 (CROSS-004 mecanismo, 005, 006) | — | — |
| P3 | 8 | 8 | — | — |
| **Total** | **14** | | | |

## Valores confirmados

| Item | Período | Valor | Efeito no lucro |
|---|---|---|---|
| CROSS-001 taxas manuais duplicadas | set–out | US$ 114,90 confirmado; até US$ 572,79 | lucro menor |
| CROSS-002 reembolso parcial (produção) | set / out | US$ 99,90 / US$ 507,85 | lucro menor |
| CROSS-006 reembolso pendente | hoje | US$ 359,70 | lucro maior (temporário) |
| CROSS-008 recuperação de pedido anterior ao início | out | US$ 199,80 | lucro maior (definição) |
| CROSS-003 custo × pago ao fornecedor | set | +US$ 3.497 (não verificável) | possivelmente lucro maior |

Setembro congelado nas Metas (US$ 14.759,72): até ~US$ 663 abaixo do real pelas divergências confirmadas.

## Respostas diretas

1. **Números confiáveis?** Sim, com os desvios acima.
2. **Diferenças entre módulos?** Não nas fórmulas usadas. Só a diluição proposital de 1 dia e o detalhe por loja, que atribui o anúncio do card inteiro a cada loja (CROSS-005).
3. **Pedido contabilizado errado?** Sim: reembolsos parciais (CROSS-002) e reembolsos pendentes (CROSS-006).
4. **Reembolso ou chargeback fora do financeiro?** Nenhum chargeback. Reembolsos só os pendentes (3, US$ 359,70).
5. **Evento perdido?** Nenhum encontrado (Loja 1 100% reconciliada; checagens internas zeradas). O risco de perder mudança de pedido antigo está corrigido no código local, não publicado.
6. **Registros duplicados?** Não (pedidos, depósitos, previsto, cobranças Meta, avisos: 0). Há duplicidade **de conta**, não de registro: ajustes manuais na categoria de taxas (CROSS-001).
7. **Histórico íntegro?** Sim para custo de produto (histórico por data desde 1900). Riscos: troca de nome/palavra-chave do produto e meta congelada cedo demais (CROSS-004).
8. **Prejuízo escondido?** Possível em CROSS-003, se os pagamentos maiores ao fornecedor forem custo real (frete/taxa) — o sistema não tem custo de frete. Também os 30 pacotes parados (risco de chargeback).
9. **Causas?** Filtro por categoria em vez de origem; regra de reembolso; filtro de reembolso pelo status do pedido; gasto de anúncio só por card; congelamento sem carência.
10. **O que corrigir primeiro?** Publicar o que já está pronto → CROSS-001 → explicar CROSS-003 → CROSS-006 → CROSS-004 → CROSS-005.

## Limitações

- O conector da Shopify só acessa a Loja 1 e não tem permissão de Shopify Payments. Depósitos, taxas e disputas **não foram conferidos contra a origem**, só contra sinais internos (tags dos pedidos). As Lojas 2 a 7 não foram reconciliadas contra a Shopify.
- O gasto da Meta não foi conferido contra a Meta.
- A produção roda código antigo. As conclusões valem para os dados atuais; algumas já estão corrigidas no código local.
- Não cruzei o status das conversas do Atendimento com o dos pedidos, nem comparei as fotos diárias do Caixa (`caixa_daily_snapshots`) com o recálculo.
- Nada foi alterado: só `SELECT` no banco e consultas de leitura na Shopify.

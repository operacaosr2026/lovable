# Auditoria técnica — relatório consolidado

> **Andamento das correções (21/10/2026, autorizadas P1 + P2):** corrigidos no código BUG-001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 012 (função `deleteOrders` removida: sem uso na tela e nunca chamada segundo o `audit_log`), 013 (conta da Meta fora de USD é recusada com erro, em vez de somar), 015.
> **BUG-020 era falso positivo:** `lineItemCostQty` (`src/lib/product-cost-match.ts:49`) já zera o custo de item reembolsado/cancelado antes do envio e mantém o do enviado. Nada a corrigir.
> Migração `20261021120000_replace_pending_payouts.sql` (BUG-007) aplicada em produção em 21/10/2026 (conferido: só `service_role` executa).
> **P3 (21/10/2026):** corrigidos BUG-014, 016, 018, 019, 021, 023, 024, 025, 026 e a parte de código do BUG-017. O cadastro **já era fechado no banco** (`handle_new_user` recusa conta sem convite; falso positivo parcial da auditoria). Ficou só o padrão "admin" do middleware, trocado por "member", e foi removido o código morto de signUp/login Google/Lovable. O BUG-023 nunca gravou nada: o upsert falhava sempre em silêncio (0 linhas `shopify_auto_sync` no banco). Migração `20261021130000_audit_p3.sql` aplicada em produção (conferido). **BUG-011 corrigido:** as três gravações de pedido (cron, webhook, botão) usam `src/lib/shopify-order-apply.ts` (com testes). Regras decididas: link sempre pelo template da loja com o código do pedido (só grava quando muda); o botão não grava mais em `shop_order_tracking`; o cron só regrava pedido alterado, o webhook ignora versão antiga e o botão regrava tudo; pedido anterior ao início do Caixa é ignorado pelos três. BUG-022 não foi pedido.

Commit `f17bc38` · 20/10/2026 · só leitura (código, `tsc`, testes, lint e `SELECT` no banco de produção).

## A. Resumo executivo

**Estado geral: bom, com falhas pontuais em dinheiro e em sincronização.** O sistema é mais cuidadoso do que a média. As regras financeiras estão centralizadas e testadas, a autorização entre workspaces está correta em todas as funções que verifiquei e as rotinas têm histórico e aviso no sino. Não achei nada P0: nenhum vazamento entre contas, nenhuma credencial exposta e nenhuma corrupção em massa.

| Prioridade | Qtde |
|---|---|
| P0 | 0 |
| P1 | 3 |
| P2 | 11 |
| P3 | 12 |

**Principais riscos**
1. **Lucro aparece menor que o real** por causa do reembolso parcial contado como total: US$ 607,75 nos últimos 60 dias, já medido nos dados (BUG-001).
2. **Perda de dados manuais** ao mudar a data de início do Caixa: pedidos, disputas e lançamentos conciliados ou travados são apagados (BUG-002).
3. **Pedido pode "voltar no tempo"**: webhook antigo chegando depois sobrescreve o pedido. Em pedido com mais de 30 dias, não existe rede de segurança (BUG-003, BUG-015).
4. **Erros de sync que não chegam ao sino** (BUG-005, BUG-006).
5. **Ações repetidas após timeout** podem duplicar e-mail ao cliente ou pedido de cobrança na Shopify (BUG-008, BUG-009).

**Módulos mais vulneráveis:** sincronização de pedidos (3 cópias da mesma lógica), Caixa (rotinas de apagar e recriar) e integrações com efeito externo (e-mail, Shopify).

**Limitações:** as telas não foram testadas uma a uma no navegador. Projetos, SOPs, Academia, Tarefas, Diário, Concorrentes, Consultor/Inteligência e Produção de loja só passaram pela varredura de autorização. Não criei contas, não disparei webhooks e não chamei APIs externas. Detalhes na seção G.

## B. Inventário de módulos

| Módulo | Arquivos analisados | Situação | Problemas | Risco |
|---|---|---|---|---|
| Auth / acesso | `integrations/supabase/*`, `members.functions.ts`, `route-guards.ts`, políticas RLS (banco) | Sólido | BUG-017, BUG-021 | Baixo |
| Sync Shopify (cron) | `hooks/sync-shop-orders.ts` | Funcional, falhas silenciosas | BUG-005, 006, 007, 011, 019, 023 | Alto |
| Webhook Shopify | `hooks/shopify.$storeId.ts`, `shopify-order-ingest.server.ts`, `shopify-disputes.server.ts`, `shopify-webhooks.server.ts` | Seguro, sem controle de ordem | BUG-003, 004, 014, 015 | Alto |
| Pedidos / Caixa (servidor) | `shop-orders.functions.ts` (seções de settings, sync manual, payouts, previsão, delete, métricas), `finance-rules.ts`, `shop-cash*.ts` (filtros) | Regras boas, operações destrutivas | BUG-001, 002, 007, 012, 018, 020 | Alto |
| Dashboard de lojas | `getShopDashboardMetrics` | Fórmula consistente | BUG-001, BUG-020 | Médio |
| Chargebacks / cobrança | `chargeback-alerts.server.ts`, `chargeback-recovery.server.ts` | Trava de envio ok | BUG-008, BUG-009 | Médio |
| Atendimento / IA | `support-autoreply.server.ts`, `zoho-mail.server.ts` (envio), `api/atendimento/attachment.ts`, `zoho/callback.ts` | Boas travas | BUG-009, BUG-010 | Médio |
| Avisos ao cliente | `order-notices.server.ts`, `hooks/order-notices-send.ts` | Trava ok | BUG-009, BUG-024 | Médio |
| Rastreio / público | `public-tracking.server.ts`, `api/public/track.ts`, `pixel.ts`, `sync-17track.ts` | Ok | BUG-016, BUG-026 | Baixo |
| Meta Ads | `meta-ads.functions.ts` (grep), Edge `meta-oauth-callback` | Ok, sem moeda | BUG-013 | Médio (latente) |
| Rotinas / observabilidade | `cron-runs.server.ts`, `cron-auth.ts`, `cron.job`, `net._http_response`, `cron_runs` | Bom | BUG-005 | Baixo |
| Lojas e Grupos (cards) | `lg-cards.functions.ts` (autorização) | Ok | BUG-025 | Baixo |
| Projetos, SOPs, Academia, Tarefas, Diário, Concorrentes, Consultor, Produção | só varredura de autorização | Não auditado a fundo | — | Desconhecido |

## C. Defeitos

### BUG-001 — Reembolso parcial contado como reembolso total
**Prioridade:** P1 · **Evidência:** Confirmado (código + dados reais) · **Módulo:** Financeiro (Dashboard, Lojas e Grupos, Metas, card Custos Adicionais)
**Arquivo:** `src/lib/finance-rules.ts` · **Linha:** 44–53
**Descrição:** o valor reembolsado é `max(transações de reembolso, total_price − current_total_price)`. Num reembolso parcial "para manter o cliente" (ex.: devolve 30%), a Shopify marca o item como removido (`current_total_price` vira 0) e registra a parte não devolvida como `order_adjustments.kind = "refund_discrepancy"`. O sistema passa a contar o pedido inteiro como reembolsado.
**Causa raiz:** usar a diferença de preço como fonte da verdade quando ela é maior que as transações, sem descontar `refund_discrepancy`.
**Impacto:** reembolso inflado e lucro subestimado em todas as telas que usam `loadRefundCbSources` (`shop-orders.functions.ts:1260`). Nos últimos 60 dias das lojas ativas, 8 pedidos `partially_refunded`: devolvido US$ 441,35, contado US$ 1.049,10, ou seja, **US$ 607,75 a mais**. Pedidos com reembolso total estão corretos.
**Reprodução:** `#L2-1146` (pedido 129,90; transação 38,97; ajuste `refund_discrepancy` de 90,93): o sistema conta 129,90.
**Correção sugerida:** somar só as transações `refund` com `status = success` (e `void`). Usar a diferença de preço apenas quando não houver transação **e** o status for `refunded`, descontando os `refund_discrepancy`. Acrescentar o caso aos testes.
**Risco da correção:** muda números de meses fechados (para melhor). Avisar antes de publicar, porque metas e fechamentos já vistos vão mudar.

### BUG-002 — Mudar a data de início do Caixa apaga dados manuais e conciliados
**Prioridade:** P1 · **Evidência:** Confirmado (código) · **Módulo:** Lojas e Grupos › Integrações / Caixa
**Arquivo:** `src/lib/shop-orders.functions.ts` · **Linha:** 400–411 (`upsertOrderSettings`)
**Descrição:** ao salvar `cashflow_start_date`, a função apaga **todos** os `shop_orders` anteriores à data (sem filtro), as disputas e os lançamentos automáticos (`auto`, `shopify_sync` etc.), **inclusive os conciliados e os de data/valor travados**.
**Causa raiz:** o expurgo filtra só por `source` e data, sem respeitar `reconciled`/`date_locked`/`amount_locked`/`manual_override`. Além disso, contradiz o sync, que sempre reimporta os últimos 30 dias: pedidos apagados dessa janela voltam no próximo ciclo, mas sem código de rastreio trocado à mão, sem status de pagamento ao fornecedor e sem observações.
**Impacto:** perda irreversível de ajustes manuais e conciliações, o que fere a regra "ajuste manual é sagrado". Lotes de pagamento ficam apontando para pedidos que deixaram de existir.
**Reprodução (não executada):** numa loja de teste, conciliar um depósito de 10/10 e mudar a data de início para 15/10. O depósito some.
**Correção sugerida:** não apagar. Filtrar as leituras por `cashflow_start_date` e, se for preciso limpar, poupar conciliados, travados e `manual_override`. Nunca apagar `shop_orders`. Pedir confirmação explícita na tela.
**Risco da correção:** telas que contam com o expurgo precisam passar a filtrar por data.

### BUG-003 — Webhook antigo que chega depois sobrescreve o pedido mais novo
**Prioridade:** P1 · **Evidência:** Provável (código confirmado; ocorrência não medida) · **Módulo:** Webhook Shopify
**Arquivo:** `src/lib/shopify-order-ingest.server.ts` · **Linha:** 62–70
**Descrição:** o `upsert` grava `raw`, `revenue` e `shopify_financial_status` sem comparar o `updated_at` recebido com o já gravado. A Shopify não garante a ordem de entrega dos `orders/updated`.
**Causa raiz:** falta de controle de versão (last-write-wins).
**Impacto:** um evento de antes do reembolso, chegando depois, devolve o pedido para `paid`. O reembolso some do lucro e o pedido volta para a previsão de fornecedor. Pedidos de até 30 dias se corrigem no sync seguinte (10 min); **pedidos mais antigos ficam errados até o próximo evento**.
**Correção sugerida:** só gravar se `o.updated_at >= raw->>updated_at` gravado (condição no `upsert` via RPC ou leitura antes da escrita).
**Risco da correção:** baixo; exige cuidado para não bloquear a primeira gravação.

### BUG-004 — Webhook refaz o link de rastreio com o código da Shopify (correção do `f17bc38` ficou só no cron)
**Prioridade:** P2 · **Evidência:** Confirmado · **Módulo:** Rastreamento
**Arquivo:** `src/lib/shopify-order-ingest.server.ts` · **Linha:** 97
**Descrição:** o sync de 10 em 10 min passou a usar o código do pedido, que pode ter sido trocado à mão (`sync-shop-orders.ts:110`). O webhook continua usando o `trackingNumber` da Shopify. Cada `orders/updated` de pedido com código trocado regrava o link antigo, e o 17track/sync volta a corrigir em seguida.
**Impacto:** link errado para o cliente entre um ciclo e outro, além de escrita em vai e vem (Disk IO).
**Correção:** usar `row.tracking_code ?? trackingNumber`, como no cron. Melhor ainda, unificar as três cópias (ver D).
**Risco:** baixo.

### BUG-005 — Falha no sync completo não chega ao sino e ainda apaga o aviso
**Prioridade:** P2 · **Evidência:** Confirmado · **Módulo:** Sync Shopify
**Arquivo:** `src/routes/api/public/hooks/sync-shop-orders.ts` · **Linha:** 405–409 e 606–613
**Descrição:** `processShop` captura qualquer erro (pedidos, depósitos, prazo de repasse, risco, "previsto") e só grava `last_sync_status = "error"` em `shopify_stores`, sem relançar. `runOne` entende como sucesso, conta `processed++` e chama `clearSystemError(shop_sync:…)`. O `cron_runs` fica `ok = true`.
**Impacto:** depósitos e "previsto" podem parar de atualizar sem aviso. A exceção é reembolso, que tem aviso próprio.
**Correção:** relançar o erro, ou chamar `reportSystemError` no `catch`.
**Risco:** pode gerar avisos que hoje estão escondidos (é o objetivo).

### BUG-006 — Erro ao gravar pedidos é ignorado e o aviso é limpo
**Prioridade:** P2 · **Evidência:** Confirmado · **Módulo:** Sync Shopify
**Arquivo:** `src/routes/api/public/hooks/sync-shop-orders.ts` · **Linha:** 82 e 121–122
**Descrição:** o `upsert` dos pedidos e o `update` do rastreio não leem `error`. Em seguida `syncOrdersOnlyForShop` chama `clearSystemError(orders_sync:…)` (linha 336).
**Impacto:** pedido não gravado por erro de banco (constraint, timeout, Disk IO como em 20/10) passa como sincronizado. Nota: o próximo ciclo tenta de novo, porque o `updated_at` continua diferente.
**Correção:** `if (error) throw` nos dois pontos.
**Risco:** baixo.

### BUG-007 — "Previsto" apagado e recriado sem transação
**Prioridade:** P2 · **Evidência:** Confirmado (código); duplicação hoje: 0 · **Módulo:** Caixa
**Arquivos:** `src/routes/api/public/hooks/sync-shop-orders.ts:285–311` e `src/lib/shop-orders.functions.ts:1024–1055` (cópia do botão)
**Descrição:** apaga todos os `shopify_pending_sync` da loja e insere de novo, sem checar o erro do insert. Duas execuções ao mesmo tempo (botão + cron de depósitos) podem intercalar apaga/apaga/insere/insere e duplicar o "previsto". Se o insert falhar, ou a função morrer no meio, o "previsto" some até a próxima rodada.
**Impacto:** saldo projetado do Caixa errado para cima (duplicado) ou para baixo (sumido).
**Correção:** função SQL única (apaga + insere numa transação) com trava por loja (`pg_advisory_xact_lock`).
**Risco:** baixo.

### BUG-008 — Mutações da Shopify com nova tentativa automática podem duplicar
**Prioridade:** P2 · **Evidência:** Confirmado (código); ocorrência: Hipótese · **Módulo:** Cobrança de chargeback
**Arquivo:** `src/lib/chargeback-recovery.server.ts` · **Linha:** 31 (usada por `draftOrderCreate` 52 e `fulfillmentCreate` 83)
**Descrição:** `fetchWithRetry` repete em timeout de 20 s e em 5xx. `draftOrderCreate` não é idempotente: a Shopify pode ter criado o rascunho e a resposta não chegar. O próprio código já evita isso na criação de produto (`product-shopify.server.ts:12`, `retries: 0`).
**Impacto:** dois pedidos de cobrança ou links de pagamento para o mesmo cliente.
**Correção:** `retries: 0` nas mutações. Para leituras GraphQL, manter o retry.
**Risco:** baixo.

### BUG-009 — E-mail ao cliente pode sair duas vezes após timeout do Zoho
**Prioridade:** P2 · **Evidência:** Hipótese · **Módulo:** Notificações / Alertas de chargeback
**Arquivos:** `src/lib/order-notices.server.ts:65`; `src/lib/chargeback-alerts.server.ts:278–305`
**Descrição:** na fila de avisos, erro com "timeout" ou "5xx" devolve o e-mail para `na_fila`. Na cobrança de chargeback, qualquer erro desfaz o passo. Se o Zoho aceitou a mensagem e só a resposta falhou, ela é reenviada na próxima rodada.
**Impacto:** cliente recebe o mesmo aviso ou cobrança duas vezes.
**Correção:** em timeout, marcar como "incerto" (sem reenvio automático) e conferir na pasta Enviados do Zoho antes de tentar de novo.
**Risco:** alguns envios realmente perdidos passam a exigir ação manual.

### BUG-010 — Resposta automática da IA usa pedido citado por número sem conferir quem escreveu
**Prioridade:** P2 · **Evidência:** Confirmado (código) · **Módulo:** Atendimento (resposta automática)
**Arquivo:** `src/lib/support-autoreply.server.ts` · **Linha:** 133–137
**Descrição:** `ordersFor` junta os pedidos do e-mail do remetente **e** qualquer número de pedido citado no texto, sem exigir que o pedido citado seja do remetente.
**Impacto:** quem souber ou chutar um número de pedido (são sequenciais, ex. `#L1-1246`) recebe automaticamente o status e o link de rastreio de outra pessoa. É vazamento de dado de entrega.
**Correção:** na resposta automática, usar pedido citado só se o e-mail do pedido for o do remetente. Caso contrário, deixar para humano.
**Risco:** menos respostas automáticas quando o cliente escreve de outro e-mail.

### BUG-011 — Três cópias da gravação de pedido com regras diferentes
**Prioridade:** P3 · **Evidência:** Confirmado · **Módulo:** Pedidos / Rastreamento
**Arquivos:** `sync-shop-orders.ts:95–124`, `shopify-order-ingest.server.ts:80–112`, `shop-orders.functions.ts:808–940`
**Descrição:** `shipped_at` em UTC no cron (`sync-shop-orders.ts:118`) e em NY nos outros dois. O sync manual não aplica o template de link da loja. Só o sync manual grava `shop_order_tracking`.
**Impacto:** a data de postagem muda conforme quem gravou primeiro (envio entre 20h e 24h em NY cai no dia seguinte) e o link difere entre o botão e o automático.
**Correção:** uma função única `applyShopifyOrder(...)` usada pelos três.

### BUG-012 — Pedido apagado volta no próximo sync como "pendente"
**Prioridade:** P2 · **Evidência:** Confirmado (código); custo em dobro: Provável · **Módulo:** Pedidos / Caixa
**Arquivo:** `src/lib/shop-orders.functions.ts` · **Linha:** 2208–2238
**Descrição:** `deleteOrders` apaga pedidos da Shopify sem registrar o descarte (os depósitos têm `shop_cash_dismissed_payouts`; pedidos não). O sync de 10 min recria o pedido dos últimos 30 dias com `payment_status` padrão. Um pedido já pago em lote e apagado volta a entrar na previsão de fornecedor.
**Impacto:** custo de fornecedor contado duas vezes no Caixa (lote + previsão).
**Correção:** tabela de pedidos descartados, consultada pelo sync e pelo webhook, ou não permitir apagar pedido vindo da Shopify (só ocultar).

### BUG-013 — Gasto da Meta sem conversão de moeda
**Prioridade:** P2 (latente) · **Evidência:** Confirmado (código); impacto atual: nenhum · **Módulo:** Lucro
**Arquivos:** `src/lib/meta-ads.functions.ts` (`syncMetaAdsSpendForShop`), `src/lib/lg-card-ad-spend.server.ts`
**Descrição:** o gasto é gravado no valor bruto da conta. O token tem 49 contas em BRL disponíveis; hoje só as 6 contas ligadas são USD. Existe `lg_card_currency_rates` (BRL/EUR), mas não é usada na gravação do gasto.
**Impacto:** ligar uma conta em BRL infla os anúncios cerca de 5×, e o lucro desaba.
**Correção:** converter na gravação com a moeda da conta, ou bloquear a ativação de conta não USD.

### BUG-014 — Status de disputa pode regredir com webhook fora de ordem
**Prioridade:** P3 · **Evidência:** Provável · **Arquivo:** `src/lib/shopify-disputes.server.ts:28`
**Descrição:** mesmo padrão do BUG-003. `disputes/update` antigo depois de um "won" volta a disputa para aberta até o sync completo (2×/dia). Nota: o comentário fala em "de hora em hora", mas o cron é `0 11,23`.
**Correção:** não regredir status final (`won`/`lost`) e comparar `updated_at`.

### BUG-015 — Pedidos com mais de 30 dias dependem só do webhook
**Prioridade:** P2 · **Evidência:** Hipótese · **Arquivo:** `sync-shop-orders.ts:326–327` e `41`
**Descrição:** o sync busca por `created_at_min`, não por `updated_at_min`. Reembolso, chargeback ou entrega de pedido mais antigo só chegam pelo webhook. Se o webhook falhar até a Shopify desistir, a mudança se perde em silêncio. O reembolso é olhado até 180 dias para trás (`REFUND_LOOKBACK_DAYS`).
**Correção:** no sync completo, buscar também `updated_at_min = última rodada`.

### BUG-016 — Pixel público aceita qualquer evento
**Prioridade:** P3 · **Evidência:** Confirmado · **Arquivo:** `src/routes/api/public/pixel.ts`
**Descrição:** sem assinatura e sem limite. Qualquer pessoa infla sessões ou checkouts de qualquer loja informando o domínio `.myshopify.com`. É limitação do pixel da Shopify; dá para mitigar.
**Correção:** limite por IP/client_id e descarte de `client_id` com volume anormal.

### BUG-017 — Possível cadastro aberto + papel padrão "admin"
**Prioridade:** P3 · **Evidência:** Hipótese · **Arquivos:** `src/integrations/supabase/workspace-middleware.ts:15`, `src/lib/auth.tsx:56`
**Descrição:** o código ainda tem `signUp` e login com Google. Sem linha em `user_roles`, o usuário é tratado como admin. Os dados ficam isolados por `user_id`, então o risco é conta indesejada (uso de crédito de IA, caminhos `supabaseAdmin` não auditados), não vazamento. Não testei, para não criar conta em produção.
**Verificação:** Supabase → Auth → "Allow new users to sign up" e provedores ativos. Ativar também a proteção contra senha vazada (advisor).
**Correção:** padrão `member` sem acesso quando não há papel; desligar cadastro público (o convite já cria conta pelo Admin API).

### BUG-018 — Valores gravados com resíduo de ponto flutuante
**Prioridade:** P3 · **Evidência:** Confirmado (dados) · **Exemplo:** lote "Lote #1" da Chierie gravado como `2502.4000000000005`; `1839.9999999999984`.
**Causa:** somas em JS gravadas sem arredondar para centavos.
**Impacto:** conciliação por igualdade exata pode falhar; centavos fantasmas em exportação.
**Correção:** `Math.round(x*100)/100` antes de gravar.

### BUG-019 — Reembolso, chargeback e postagem datados em UTC
**Prioridade:** P3 · **Evidência:** Confirmado · **Arquivos:** `finance-rules.ts:38`, `shopify-disputes.server.ts:22`, `sync-shop-orders.ts:118, 241, 251`, `order-notices.functions.ts:156`
**Descrição:** `String(ts).slice(0,10)` pega a data UTC. Evento entre 20h e 24h de NY cai no dia seguinte e, no último dia do mês, no mês seguinte. O resto do sistema usa NY (`orderDateFor`).
**Correção:** `isoDateUS(ts)`.

### BUG-020 — Dashboard conta custo de produto de pedido reembolsado ou cancelado
**Prioridade:** P2 · **Evidência:** Confirmado (divergência); regra de negócio a definir · **Arquivo:** `src/lib/shop-orders.functions.ts:2354`
**Descrição:** `custoProduto` soma todos os pedidos do período. A previsão de pagamento do Caixa exclui reembolsados e chargebacks (`finance-rules.ts:202`). Nos últimos 60 dias: 48 pedidos reembolsados (total ou parcial) nas lojas ativas.
**Impacto:** Dashboard e Caixa discordam. Se o pedido foi reembolsado antes do envio, o lucro do Dashboard fica subestimado.
**Correção:** definir a regra (ver dúvidas na Fase 3) e aplicar igual nos dois lados.

### BUG-021 — Salvar permissões de membro apaga e reinsere sem transação
**Prioridade:** P3 · **Evidência:** Confirmado · **Arquivo:** `src/lib/members.functions.ts:263–277`
**Impacto:** se o insert falhar, o membro fica sem nenhuma permissão. O erro do delete também não é checado.
**Correção:** RPC transacional.

### BUG-022 — Tipos do banco desatualizados (`as any`)
**Prioridade:** P3 · **Evidência:** Confirmado · ex.: `cron-runs.server.ts:50`, `public-tracking.server.ts:121`, `pixel.ts:56`. Mais 1.510 `any` no lint.
**Impacto:** coluna renomeada ou removida não quebra o `tsc`; o erro só aparece em produção.
**Correção:** regenerar `types.ts` e remover os casts.

### BUG-023 — Lançamentos `shopify_auto_sync` gravados e nunca lidos
**Prioridade:** P3 · **Evidência:** Confirmado · **Arquivo:** `sync-shop-orders.ts:229–261`
**Impacto:** escrita a cada sync completo sem uso (Disk IO). O `upsert` também sobrescreve valor e data sem respeitar travas, caso alguém edite esses lançamentos.
**Correção:** parar de gravar ou passar a usar; se mantiver, respeitar as travas.

### BUG-024 — Envio preso em "enviando" não tem destravamento
**Prioridade:** P3 · **Evidência:** Confirmado (código); hoje: 0 presos · **Arquivos:** `order-notices.server.ts:56`, `support-autoreply.server.ts:118`
**Descrição:** escolha correta para não duplicar, mas nenhum aviso mostra itens presos.
**Correção:** aviso no sino para `enviando` com mais de 15 min.

### BUG-025 — `deleteLgCard` age nas lojas antes de conferir a posse
**Prioridade:** P3 · **Evidência:** Confirmado · **Arquivo:** `src/lib/lg-cards.functions.ts:254`
**Impacto:** recalcula a automação de lojas de outro dono (idempotente, sem vazamento).
**Correção:** conferir a posse primeiro.

### BUG-026 — Limite da busca pública não é atômico e falha aberto
**Prioridade:** P3 · **Evidência:** Confirmado · **Arquivo:** `src/lib/public-tracking.server.ts:118–131`
**Impacto:** rajadas paralelas passam do limite; erro no banco libera tudo.
**Correção:** contador atômico (RPC com `insert … returning count`).

## D. Problemas arquiteturais

1. **Lógica duplicada no núcleo de dados.** Gravação de pedido em 3 cópias e "previsto" em 2. Cada correção precisa ser feita em vários lugares, e o `f17bc38` já esqueceu uma (BUG-004).
2. **Last-write-wins sem versão** em todas as entradas da Shopify (BUG-003, 014).
3. **"Apaga e recria" sem transação** como padrão de atualização (BUG-002, 007, 021).
4. **Escritas sem checar erro** em rotinas de fundo (BUG-005, 006).
5. **Segurança das 58 tabelas sem política depende só do código.** Hoje está correto, mas uma função nova que esqueça `.eq("user_id", ownerId)` vaza dados entre workspaces. Um teste automatizado de varredura (como o que fiz na Fase 2) evitaria isso.
6. **Tipos do banco fora de sincronia** (BUG-022) e lint fora do build.
7. **`raw` completo do pedido em cada linha** (~20 KB): custo de I/O cresce linearmente com o volume.

## E. Problemas silenciosos (podem estar acontecendo agora, sem alerta)

| ID | O que acontece em silêncio |
|---|---|
| BUG-001 | Lucro menor que o real (~US$ 300/mês nos dados atuais) |
| BUG-003 / 015 | Pedido antigo com status errado (reembolso que some ou fica de fora) |
| BUG-005 | Sync completo falhando, sem aviso no sino |
| BUG-006 | Pedido não gravado, com aviso limpo |
| BUG-012 | Custo de fornecedor em dobro depois de apagar pedido pago |
| BUG-020 | Dashboard e Caixa divergindo no custo |
| BUG-018 | Centavos fantasmas |
| BUG-019 | Reembolso ou chargeback no dia (ou mês) errado |

## F. Plano de correção (ordem sugerida)

**Lote 1 — dinheiro e dados (fazer primeiro, com testes):**
1. BUG-001: regra de reembolso + 2 testes novos em `finance-rules.test.ts`. Avisar que os meses anteriores mudam.
2. BUG-002: tirar o expurgo destrutivo; filtrar por data nas leituras. Precisa de teste de regressão no Caixa (saldo, conciliados).
3. BUG-003 + BUG-014: guarda de `updated_at` no webhook e nas disputas.

**Lote 2 — sincronização (fazer juntos, porque mexem nos mesmos arquivos):**
4. BUG-004 + BUG-011: unificar a gravação de pedido numa função só (resolve as divergências de uma vez).
5. BUG-005 + BUG-006: propagar erros para o sino.
6. BUG-007: "previsto" numa RPC transacional; as duas cópias passam a chamar a RPC.
7. BUG-015: `updated_at_min` no sync completo.
8. BUG-012: lista de pedidos descartados.

**Lote 3 — efeitos externos:**
9. BUG-008 (trivial), BUG-009, BUG-010.

**Lote 4 — decisões e higiene:**
10. BUG-020 (decidir a regra antes), BUG-013, BUG-017 (conferir o painel do Supabase — 5 min), BUG-018, BUG-019, BUG-021 a 026, regenerar tipos, lint no CI.

**Regressão obrigatória:** lotes 1 e 2 mexem em Caixa, Dashboard e Metas. Comparar os totais de um mês fechado antes e depois (devem mudar só pelo BUG-001).

## G. Cobertura e limitações

**Analisado (leitura de código):** autenticação e middlewares, todas as rotas públicas, sync da Shopify (cron e manual), webhook, disputas, regras financeiras, métricas do Dashboard, depósitos e previsão do Caixa, fila de avisos, cobrança de chargeback, resposta automática da IA, OAuth (Shopify, Zoho, Meta), helpers de fuso, varredura de autorização das 401 server functions.

**Testado:** `tsc` (ok), 30 testes (ok), eslint (19.342 problemas, a maioria de formatação), cerca de 25 consultas `SELECT` em produção (políticas RLS, advisors, cron, pg_net, `cron_runs`, duplicatas, moedas, reembolsos).

**Não verificado:**
- Telas no navegador (loading infinito, botões habilitados durante envio, confirmações). O servidor local está no ar, mas a navegação autenticada não foi feita.
- Os 38 avisos `react-hooks/exhaustive-deps`.
- Regras de negócio de Projetos, SOPs, Academia, Tarefas, Diário, Concorrentes, Consultor/Inteligência, Produção de loja, Metas da empresa (`company-goals.server.ts`), simulador do Caixa, taxas da Shopify (`syncShopifyFeesForShop`), 17track em detalhe.
- Configuração do Supabase Auth (cadastro aberto?), que exige o painel (BUG-017).
- Dependências vulneráveis: `npm audit` não foi rodado (consulta à rede; posso rodar com autorização).

**Conclusões que pedem confirmação:** BUG-003, 009, 014, 015 (ocorrência real), BUG-017 (configuração) e BUG-020 (regra de negócio).

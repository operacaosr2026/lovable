# Fase 5 — Segurança e performance

## Segurança — verificado e ok

- Chave de serviço só em `client.server.ts` (server-only); o navegador usa a chave pública.
- Cron: aceita `CRON_API_KEY`/`CRON_SECRET` com comparação em tempo constante; a chave pública só vale enquanto `CRON_API_KEY` não existe (`cron-auth.ts:28`).
- Webhook Shopify com HMAC em tempo constante + checagem de domínio.
- OAuth (Shopify, Zoho, Meta) com `state` de uso único e validade.
- Anexos do Atendimento exigem sessão + permissão + `owner_id` do e-mail.
- Rastreio público devolve só cidade/estado; busca por pedido exige contato e tem limite por IP.
- Cabeçalhos de segurança no `vercel.json` (HSTS, X-Frame-Options DENY, nosniff).
- Membros com acesso total são decisão do negócio (não reportado como falha).

## Segurança — achados

- **BUG-010 (P2)** — resposta automática da IA usa pedido citado por número sem conferir o remetente.
- **BUG-017 (P3, Hipótese)** — cadastro pode estar aberto (código tem `signUp` e login Google) e o middleware trata quem não tem papel como admin (`workspace-middleware.ts:15`). O isolamento por `user_id` segura o dano; não testei criando conta (seria escrita em produção). Conferir no painel: Auth → "Allow new users to sign up". Proteção contra senha vazada está desligada (advisor).
- **BUG-016 (P3)** — `/api/public/pixel` aceita qualquer evento para qualquer loja, sem limite.
- **BUG-026 (P3)** — limite de tentativas da busca pública não é atômico e libera tudo se o banco falhar (fail-open).
- Tokens de terceiros (Shopify, Meta) legíveis pelos membros via RLS — aceito pela regra "membros são confiáveis".

## Performance

- **Comprovado**: `shop_orders.raw` guarda o pedido inteiro (~20 KB/linha). Consultas que só precisam de 3 campos já usam `raw->>campo` (bom), mas toda gravação reescreve o JSON inteiro.
- **Comprovado**: lançamentos `shopify_auto_sync` são regravados a cada sync completo (upsert de todos os reembolsos/chargebacks das últimas 10 páginas) e nunca lidos (BUG-023).
- **Comprovado**: `ingestShopifyOrder` chama `recomputeOrderCostForecast` em **todo** `orders/updated` (inclusive edição de nota/tag) — recalcula o dia inteiro da loja a cada evento.
- **Hipótese (precisa medir)**: `cronHealthAlerts` lê até 5.000 linhas de `cron_runs` a cada 5 min (`cron-runs.server.ts:67`); `cron_runs` tem ~14 mil linhas e cresce ~7 mil/dia antes da limpeza de 30 dias.
- **Hipótese**: `fetchOrders` limita a 20 páginas × 250 = 5.000 pedidos por janela de 30 dias; acima disso avisa (`reportPaginationCap`), mas para de importar. Volume atual ~1.000/60 dias, longe do limite.

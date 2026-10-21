# Fase 1 — Reconhecimento

## Stack

- **Frontend + servidor**: TanStack Start (React, TanStack Router, server functions `createServerFn`), Vite 7, Tailwind/shadcn.
- **Hospedagem**: Vercel. Tudo passa por uma função só (`api/ssr.js`, `maxDuration` 300 s, Fluid) — `vercel.json` reescreve `/(.*)` para ela. Build roda `typecheck` + `test` antes (`vercel.json:2`).
- **Banco/Auth/Storage**: Supabase (projeto `evxisacsfdlyeuqyubqb`, Postgres 17). 206 migrações. 1 Edge Function (`meta-oauth-callback`).
- **Agendamentos**: `pg_cron` + `pg_net` chamando `https://lojas-one.vercel.app/api/public/hooks/*` com `x-api-key` do Vault.
- **Integrações externas**: Shopify Admin REST 2024-10 + GraphQL 2026-07, Shopify webhooks, Meta Graph API v19, 17track, Zoho Mail (OAuth), Anthropic (Claude) para Atendimento/Consultor/Inteligência, Web Push.

## Tamanho

~576 arquivos versionados; `src/lib` 145 arquivos, `src/components` 114, `src/routes` 61. 401 server functions.
Maiores: `shop-orders.functions.ts` (2291 linhas), `index.tsx` (Dashboard, 1013), `chargebacks.tsx` (979), `shops.sops.$processId.tsx` (983), `lg-cards.functions.ts` (933).

## Rotas (telas)

Dashboard (`/`), Metas, Tarefas, Projetos, Diário/Gratidão, SOPs, Banco de Lojas, Lojas e Grupos (+ card: dashboard, diário, caixa, pedidos, rastreamento, integrações), Caixa, Produtos, Concorrentes, Atendimento, Chargebacks, Notificações, Inteligência/Consultor, Academia, Configurações (geral, membros, notificações, rastreamento, segurança, integrações, feriados, templates, auditoria), Login/Convite, `/track` público.

## Endpoints públicos (sem sessão)

| Rota | Proteção |
|---|---|
| `/api/public/hooks/sync-shop-orders`, `sync-17track`, `zoho-mail-sync`, `notifications-refresh`, `order-notices-send`, `caixa-snapshot`, `estorno-daily`, `consultant-weekly` | `verifyCronApiKey` (`src/lib/cron-auth.ts`) |
| `/api/public/hooks/shopify/$storeId` | HMAC da Shopify + domínio |
| `/api/public/shopify/callback`, `/api/public/zoho/callback`, Edge `meta-oauth-callback` | `state` de uso único com validade (+ HMAC na Shopify) |
| `/api/public/track`, `/api/public/recent-deliveries`, `/track` | aberto; busca por pedido+contato com limite por IP |
| `/api/public/pixel` | aberto (pixel da Shopify não assina) |
| Server functions `getInvitationByToken`, `acceptInvitation`, `getPublicTracking`, `findPublicOrder` | token do convite / aberto |

Todas as outras 397 server functions usam `requireSupabaseAuth` ou `requireOwnerContext`.

## Agendamentos reais (cron.job no banco, 20/10/2026)

| Job | Quando (UTC) | Endpoint |
|---|---|---|
| sync-orders-light | */10 | sync-shop-orders (orders_only) |
| sync-ads | */10 | sync-shop-orders (costs_only=ads) |
| sync-fees | 5-55/10 | sync-shop-orders (costs_only=fees) |
| sync-payouts-midnight/noon/evening | 0, 12, 18 | sync-shop-orders (payouts_only) |
| sync-full-2x | 11, 23 | sync-shop-orders (completo) |
| zoho-mail-sync | */5 | zoho-mail-sync (+ cobrança de chargeback + lotes de IA) |
| notifications-refresh | */5 | notifications-refresh |
| seventeen-track-sync | :07, :37 | sync-17track |
| order-notices-send | * (todo minuto) | order-notices-send |
| caixa-snapshot-daily | 03:55 | caixa-snapshot |
| estorno-daily | 04:00 | estorno-daily |
| consultant-weekly | seg 12, 13 | consultant-weekly |
| cron-history-cleanup | 04:30 | limpeza de `cron.job_run_details` |

## Modelo de acesso

- `user_roles` (admin/member) + `workspace_members` (membro → dono) + `member_permissions` (seção + recurso opcional).
- RLS: tabelas antigas têm política `auth.uid() = user_id` + `has_workspace_access(...)`. 58 tabelas novas têm RLS **sem política** = só o servidor (service role) acessa; o código delas filtra por `ownerId` na mão.
- `resolveWorkspaceAccess` (`src/integrations/supabase/workspace-middleware.ts:9`) resolve dono, papel e permissões a cada chamada.
- Banco hoje: 4 usuários (2 admins, 2 membros).

## Mapa de dependências (núcleo financeiro)

```
Shopify ──orders/webhook──► shop_orders ──► Dashboard / Lojas e Grupos / Metas / Rastreamento / Chargebacks / Atendimento(IA)
   │                          │
   │                          └─► recomputeOrderCostForecast ─► shop_cash_entries (source=auto, "Fornecedor")
   ├─payouts──────────────────────► shop_cash_entries (shopify_sync / shopify_pending_sync) ─► Caixa, Simulador, Snapshot diário
   ├─balance tx (taxas)───────────► shop_cash_entries ("Taxas Shopify") ─► lucro
   ├─disputes(webhook/sync)───────► shop_order_disputes ─► lucro, taxa de estorno, sino, Chargebacks
Meta ─spend────────────────────────► shop_cash_entries / lg_card_ad_spend ─► lucro
17track ───────────────────────────► shop_order_tracking + shop_orders.delivery_status ─► Rastreamento, avisos, IA
Zoho ──────────────────────────────► support_messages/conversations ─► Atendimento, resposta automática, cobrança de chargeback
finance-rules.ts (funções puras + testes) ◄── usado por shop-orders.functions, sync-shop-orders, caixa
```

## Duplicações e código parcialmente abandonado identificados

- Lógica de gravar pedido + espelhar rastreio existe em **3 cópias**: `saveOrders` (`src/routes/api/public/hooks/sync-shop-orders.ts:61`), `ingestShopifyOrder` (`src/lib/shopify-order-ingest.server.ts:35`) e `syncShopifyOrders` (`src/lib/shop-orders.functions.ts:808`). Já divergem (ver BUG-004, BUG-011).
- Depósitos + "previsto" em **2 cópias**: `syncPayoutsForShop`/`syncPendingTransactionsForShop` (cron) e `syncShopifyPayouts` (`shop-orders.functions.ts:943`).
- Fetchers paginados da Shopify duplicados entre os dois arquivos acima.
- Lançamentos `source = shopify_auto_sync` (Reembolso/Chargeback no Caixa) são gravados a cada sync completo mas **excluídos de todas as leituras** (`shop-cash.functions.ts:31`, `shop-cash-consolidated.functions.ts:68`, `caixa-simulator.functions.ts:251`, `caixa-snapshot.server.ts:34`) — escrita sem uso.
- `GET` do sync (`sync-shop-orders.ts:673`) diz atender a "Vercel Cron", mas `vercel.json` não tem `crons`.
- Tabela `fix_rastreio_20261001_backup` (backup de correção manual) segue no schema `public`.
- Nomes legados `track123_*` (o provedor agora é 17track) — já registrado na memória do projeto.

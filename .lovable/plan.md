# Fase A — Mercury + Wise no módulo Financeiro (sync manual + revisão)

## Escopo desta fase
1. Conectar contas Mercury e Wise via API token.
2. Vincular **manualmente** cada conta externa a uma `accounts` existente no Hardya.
3. Botão **"Sincronizar agora"** que puxa transações novas e insere em `transactions`.
4. Marcar transações importadas que **não casaram com regra** como `needs_review = true` + ícone de alerta.
5. Filtro "Pendentes de categorização" em `/finance/transactions`.
6. CRUD básico de regras (palavra-chave → categoria) em `/finance/settings`.

Saldo diário consolidado, sync automático (cron), e melhorias de UX de transferência ficam para **Fase B**.

## Arquitetura

```text
[Mercury API]  ──┐
                 ├─► serverFn syncBankConnection ──► transactions (insert)
[Wise API]    ──┘                │
                                 └─► aplica category_rules → categoria ou needs_review
```

- Tokens armazenados em `bank_connections` criptografados (AES-GCM via `MAIL_ENCRYPTION_KEY` se já existir, senão criamos `BANK_ENCRYPTION_KEY`).
- Sync é **idempotente** por `external_id` (Mercury transaction id / Wise reference) — adicionar coluna `external_id` em `transactions`.

## Mudanças de banco (migration)

**Nova tabela `bank_connections`**
- `provider` (`mercury` | `wise`)
- `label` (ex.: "Mercury — Walkesty LLC")
- `access_token_encrypted`
- `wise_profile_id` (nullable, só Wise)
- `last_sync_at`, `last_sync_status`, `last_sync_error`
- `created_at`, `updated_at`, `user_id`

**Nova tabela `bank_account_links`** (vincula conta externa ↔ `accounts` do Hardya)
- `connection_id` → `bank_connections.id`
- `account_id` → `accounts.id`
- `external_account_id` (Mercury account id ou Wise balance id)
- `external_account_name`
- `last_external_uid` (último id sincronizado, para diff)
- unique(`connection_id`, `external_account_id`)

**Nova tabela `category_rules`**
- `match_value` (texto)
- `match_type` (`contains` | `equals` | `regex`)
- `category_id` → `categories.id`
- `position`, `enabled`

**Alterações em `transactions`**
- `external_id` text (nullable, unique por user_id + account_id)
- `needs_review` boolean default false
- `import_source` text (`manual` | `mercury` | `wise`)

GRANTs + RLS scoped por `auth.uid()` em todas.

## Server functions (`src/lib/banking.functions.ts`)

- `listConnections()`
- `addConnection({ provider, label, token, wise_profile_id? })` — chama API uma vez para validar e listar contas externas, retorna lista para o usuário vincular.
- `linkAccount({ connection_id, external_account_id, external_account_name, hardya_account_id })`
- `unlinkAccount({ link_id })`
- `deleteConnection({ id })`
- `syncConnection({ connection_id })` — busca transações novas de todas as `bank_account_links` daquela conexão, deduplica por `external_id`, aplica `category_rules`, insere em `transactions`.
- `listCategoryRules` / `upsertCategoryRule` / `deleteCategoryRule`
- `markReviewed({ transaction_id, category_id })` — sai do "pendentes".

## UI

**`/finance/settings`** — nova aba "Bancos":
- Lista de conexões com status do último sync + botão "Sincronizar agora".
- Modal "Adicionar conexão" → escolhe provider, cola token (Wise pede profile id), salva → mostra contas externas detectadas → cada linha tem um select "Vincular à conta…" com as `accounts` existentes.
- Aba "Regras de categorização": tabela editável (palavra-chave, tipo, categoria de destino).

**`/finance/transactions`**:
- Toggle no topo "Apenas pendentes de categorização".
- Linha com `needs_review = true` recebe ícone ⚠ amarelo + edição inline rápida da categoria.

## Endpoints externos consumidos

**Mercury** (`https://api.mercury.com/api/v1`)
- `GET /accounts` — lista contas
- `GET /accounts/{id}/transactions?start=YYYY-MM-DD&limit=500` — paginação
- Auth: `Authorization: Bearer <token>`

**Wise** (`https://api.wise.com`)
- `GET /v2/profiles` — perfis
- `GET /v4/profiles/{profileId}/balances?types=STANDARD` — saldos (= contas por moeda)
- `GET /v1/profiles/{profileId}/balance-statements/{balanceId}/statement.json?intervalStart=...&intervalEnd=...&type=COMPACT` — transações
- Auth: `Authorization: Bearer <token>`

## Segurança

- Tokens nunca expostos ao cliente; apenas serverFns leem.
- Criptografia AES-GCM com chave do secret `BANK_ENCRYPTION_KEY` (32 bytes hex).
- RLS: usuário só vê suas próprias conexões.

## O que preciso de você antes de codar

1. **Mercury API token**
   - Acesse: https://app.mercury.com/settings/tokens
   - Crie um token (recomendo nome "Hardya — read transactions")
   - **Permissões: Read-only** (não precisa de Send Money)
   - Me confirma quando criar — depois você cola na UI, não no chat.

2. **Wise API token**
   - Acesse: https://wise.com/user/settings → API tokens
   - Crie token tipo **"Read-only"**
   - Me confirma quando criar.

3. **Confirmação para eu adicionar o secret `BANK_ENCRYPTION_KEY`**
   - Eu gero a chave de 32 bytes via `add_secret` (você só clica em confirmar).

## Próximos passos

Se aprovar este plano, eu já executo na ordem:
1. Migration (tabelas + colunas + grants + RLS).
2. `add_secret BANK_ENCRYPTION_KEY`.
3. `banking.functions.ts` (clients Mercury/Wise + sync).
4. UI em `/finance/settings` e `/finance/transactions`.
5. Te aviso para colar os tokens e testar.

Posso prosseguir?

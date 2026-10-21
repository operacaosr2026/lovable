# Fase 4 — Integrações e banco

## Banco (Supabase, consultas SELECT em produção)

- RLS ligado em todas as tabelas `public`. Políticas existentes sempre amarradas a `auth.uid()` ou `has_workspace_access` — nenhuma aberta (`true`) e nenhuma para `anon`.
- 58 tabelas com RLS e **sem política** (acesso só pelo servidor). Correto, mas a segurança dessas tabelas depende 100% de cada server function filtrar por `ownerId` (verificado por amostragem na Fase 2).
- Advisor de segurança: `pg_net` no schema `public`; `shop_cash_entries_mark_balance_payout()` (função de trigger SECURITY DEFINER) executável por `anon`/`authenticated` via RPC — chamar uma função de trigger fora de trigger falha, risco baixo; proteção contra senha vazada desligada.
- Maior tabela: `shop_orders`, 43 MB para ~2.181 linhas (~20 KB/linha, quase tudo em `raw`). Coerente com o esgotamento de Disk IO de 20/10 (já corrigido em `f17bc38` evitando regravação).
- `cron.job_run_details`/`net._http_response`: o `pg_net` desiste em 5 s; ~90 chamadas com timeout nas últimas ~6 h. **Não é falha**: a função continua na Vercel e grava o resultado em `public.cron_runs` (2 dias: 0 falhas, 0 sem terminar; `sync:orders` média 36 s, máx. 148 s; `sync:full` máx. 193 s).

## Integrações

| Integração | Autenticação | Timeout/retry | Idempotência | Observações |
|---|---|---|---|---|
| Shopify REST/GraphQL | token por loja | 20 s, 2 retries em 429/5xx (`src/lib/http.ts`) | upsert por `shop_id,source,external_id` | retry também em mutações não idempotentes (BUG-008) |
| Shopify webhooks | HMAC + domínio | — | upsert, mas sem ordem (BUG-003, BUG-014) | link de rastreio diverge do sync (BUG-004) |
| Shopify OAuth | `state` + HMAC | — | state apagado após uso | ok |
| Meta Ads | token longo (60 d) | retry | upsert | aviso de expiração no sino existe; sem conversão de moeda (BUG-013) |
| 17track | API key | retry | — | cota esgotada vira aviso no sino |
| Zoho Mail | OAuth (state com validade) | POST sem retry (`zoho-mail.server.ts:110`) | trava de envio (`enviando`) | reenvio após timeout possível (BUG-009) |
| Anthropic | API key | fallback do servidor | trava por mensagem | dados de pedido citado sem checar remetente (BUG-010) |
| pg_cron → Vercel | `x-api-key` (Vault) | pg_net 5 s | rotinas toleram rodada sobreposta? parcialmente (BUG-007) | histórico em `cron_runs` + aviso "rotina parada" |

## Cenários simulados (conceitualmente)

1. **API externa fora**: sync registra erro por loja no sino (exceto no sync completo — BUG-005).
2. **Webhook duplicado**: idempotente (upsert). Push de "nova venda" pode sair 2x se `create` e `updated` chegarem juntos (corrida em `before`), menor.
3. **Webhook fora de ordem**: sobrescreve (BUG-003/014).
4. **Demora**: orçamento de 270 s por rodada, rodízio de lojas, aviso de "não terminou a tempo". Bom.
5. **Token expira**: Meta avisa antes; Shopify 401/403 vira aviso (`handleShopifyAccess`).
6. **Dados incompletos**: `Number(x ?? 0)` em todo lugar — campo ausente vira 0 sem aviso (ex.: `total_price` ausente = pedido de US$ 0).
7. **Processo interrompido**: "previsto" pode sumir até a próxima rodada (BUG-007); e-mail pode ficar preso em "enviando" (BUG-024).
8. **Banco confirma e resposta falha**: Shopify reenvia o webhook — idempotente. E-mail: ver BUG-009.
9. **Dois eventos no mesmo registro**: último a gravar vence, sem comparar versão (BUG-003).
10. **Sucesso sem persistência**: `saveOrders` ignora o erro do upsert e limpa o aviso (BUG-006).

# Fase 2 — Análise estática

## Ferramentas (todas só leitura)

| Comando | Resultado |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | Passou, 0 erros |
| `npm run test` (vitest) | 3 arquivos, 30 testes, todos passaram (`finance-rules`, `product-cost-match`, `product-page`) |
| `npx eslint .` | 19.342 problemas; 17.731 são formatação (prettier). Fora formatação: 1.510 `no-explicit-any`, 43 `react-refresh/only-export-components`, 38 `react-hooks/exhaustive-deps`, 7 `no-useless-escape`, 6 `prefer-const`, 5 `no-unused-expressions`, 4 `no-empty`, 2 `no-control-regex`, 1 `ban-ts-comment` |

Leitura: o lint não roda no build (`vercel.json:2` roda só typecheck + test), por isso acumulou. Os 38 `exhaustive-deps` são os únicos com chance real de bug de tela (dado velho após troca de filtro) — não foram verificados um a um (ver G).

## Varredura de autorização (401 server functions)

- 397 usam `requireSupabaseAuth`/`requireOwnerContext`. As 4 sem middleware são públicas de propósito (convite e rastreio público).
- Varredura heurística de consultas com `supabaseAdmin` (ignora RLS) filtrando por `id` vindo do cliente sem `user_id`/`owner_id`: 12 funções sinalizadas, **todas conferem a posse antes** (ex.: `updateLgCard` em `lg-cards.functions.ts:193`, `saveProductPricing` em `products.functions.ts:176`). Nenhum IDOR entre workspaces encontrado.
- Única ressalva menor: `deleteLgCard` (`lg-cards.functions.ts:254`) lê os vínculos de loja do card **antes** de conferir a posse e recalcula a automação dessas lojas mesmo quando o card não é do usuário (efeito idempotente, sem vazamento) — BUG-025.

## Fragilidades de código encontradas nesta fase

- Tipos do banco desatualizados: tabelas novas acessadas com `as any` (`"cron_runs" as any`, `"public_rate_limits" as any`, `(supabaseAdmin as any).from("product_funnel_events")`) — o `tsc` não pega coluna renomeada/removida nessas tabelas (BUG-022).
- Três cópias da gravação de pedido e duas do "previsto" (ver Fase 1) — já divergentes (BUG-004, BUG-011).
- Erros de escrita no banco ignorados em caminhos de sync (`await supabaseAdmin...upsert(...)` sem olhar `error`) — BUG-006.
- Escritas sem transação do tipo "apaga tudo e recria" — BUG-007, BUG-021.

// Chamadas a APIs externas (Shopify, Meta, Track123) com tempo limite e nova
// tentativa. Sem isso uma requisição travada consumia sozinha os 60s da função
// na Vercel (e as lojas seguintes da rodada ficavam sem sync), e um 429 ("muitas
// requisições") da Shopify virava erro direto em vez de esperar e tentar de novo.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_WAIT_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, retries = 2 } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!RETRY_STATUS.has(res.status) || attempt >= retries) return res;
      await res.body?.cancel().catch(() => {});
      // Shopify manda Retry-After (segundos) no 429; senão, espera 1s, 2s...
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, MAX_WAIT_MS)
        : Math.min(1000 * 2 ** attempt, MAX_WAIT_MS));
    } catch (e) {
      // Timeout ou falha de rede.
      if (attempt >= retries) throw e;
      await sleep(Math.min(1000 * 2 ** attempt, MAX_WAIT_MS));
    }
  }
}

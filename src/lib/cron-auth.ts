/**
 * Constant-time string comparison (length-leak aside). Use for any
 * secret/token comparison to avoid timing attacks.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Authentication for public cron/webhook endpoints under /api/public/hooks/*.
 *
 * Aceita:
 *  - CRON_API_KEY: chave própria do pg_cron (guardada no Supabase Vault como
 *    `cron_api_key`, enviada no header x-api-key — ver migration *_cron_api_key.sql);
 *  - CRON_SECRET: a Vercel Cron manda `Authorization: Bearer $CRON_SECRET`
 *    automaticamente quando essa variável existe no projeto.
 * A chave anon (SUPABASE_PUBLISHABLE_KEY) só é aceita enquanto CRON_API_KEY não
 * estiver configurada — ela é pública (vai no JS do navegador), então qualquer
 * um podia disparar os syncs com ela.
 */
export function verifyCronApiKey(request: Request): Response | null {
  const accepted = [process.env.CRON_API_KEY, process.env.CRON_SECRET].filter(Boolean) as string[];
  if (!process.env.CRON_API_KEY && process.env.SUPABASE_PUBLISHABLE_KEY) {
    accepted.push(process.env.SUPABASE_PUBLISHABLE_KEY);
  }
  if (!accepted.length) {
    return new Response(
      JSON.stringify({ error: "Server missing CRON_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const provided = [
    request.headers.get("apikey"),
    request.headers.get("x-api-key"),
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
  ].filter(Boolean) as string[];

  const ok = provided.some((p) => accepted.some((k) => timingSafeEqualString(p, k)));
  if (!ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

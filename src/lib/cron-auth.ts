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
 * Prefer a dedicated CRON_API_KEY (not exposed to the browser). Falls back
 * to SUPABASE_PUBLISHABLE_KEY for backwards compatibility with existing
 * pg_cron jobs, but that key is also the client-side anon key
 * (VITE_SUPABASE_PUBLISHABLE_KEY) and therefore not a real secret.
 * Set CRON_API_KEY in the server environment and update pg_cron job
 * definitions to send it as the `apikey`/`x-api-key` header.
 */
export function verifyCronApiKey(request: Request): Response | null {
  const expected = process.env.CRON_API_KEY || process.env.CRON_SECRET || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: "Server missing CRON_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const provided =
    request.headers.get("apikey") ||
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (!provided || !timingSafeEqualString(provided, expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

/**
 * Authentication for public cron/webhook endpoints under /api/public/hooks/*.
 *
 * pg_cron calls these endpoints with an `apikey` header containing the
 * Supabase anon/publishable key. We compare against the server-side
 * SUPABASE_PUBLISHABLE_KEY to ensure the caller is not an anonymous
 * actor on the internet.
 */
export function verifyCronApiKey(request: Request): Response | null {
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: "Server missing SUPABASE_PUBLISHABLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const provided =
    request.headers.get("apikey") ||
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  // constant-time-ish compare
  if (provided.length !== expected.length) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (diff !== 0) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

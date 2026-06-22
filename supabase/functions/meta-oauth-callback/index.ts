import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_ID            = Deno.env.get("META_APP_ID")!;
const APP_SECRET        = Deno.env.get("META_APP_SECRET")!;
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL           = Deno.env.get("META_APP_URL") ?? "https://lojas-one.vercel.app";

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/meta-oauth-callback`;

serve(async (req) => {
  const url    = new URL(req.url);
  const code   = url.searchParams.get("code");
  const state  = url.searchParams.get("state");
  const fbError = url.searchParams.get("error");

  if (fbError) {
    return redirect(`${APP_URL}?meta_error=${encodeURIComponent(fbError)}`);
  }
  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Verify & consume state (one-time use)
  const { data: stateRow } = await supabase
    .from("meta_oauth_states")
    .select("user_id, shop_id")
    .eq("id", state)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!stateRow) {
    return redirect(`${APP_URL}?meta_error=invalid_state`);
  }

  await supabase.from("meta_oauth_states").delete().eq("id", state);

  // Exchange code → short-lived token
  const shortRes  = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token` +
    `?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&client_secret=${APP_SECRET}&code=${code}`
  );
  const shortJson = await shortRes.json();
  if (shortJson.error) {
    return redirect(`${APP_URL}?meta_error=${encodeURIComponent(shortJson.error.message)}`);
  }

  // Exchange short-lived → long-lived token (~60 days)
  const longRes  = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token` +
    `?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}` +
    `&fb_exchange_token=${shortJson.access_token}`
  );
  const longJson = await longRes.json();
  const token     = longJson.access_token ?? shortJson.access_token;
  const expiresIn = longJson.expires_in   ?? 5_184_000; // 60 days fallback

  // Fetch FB user info
  const meRes  = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${token}`);
  const meJson = await meRes.json();

  // Fetch ad accounts
  const adRes  = await fetch(
    `https://graph.facebook.com/v19.0/me/adaccounts` +
    `?fields=id,name,account_id,account_status,currency&limit=50&access_token=${token}`
  );
  const adJson = await adRes.json();

  await supabase.from("shop_meta_tokens").upsert({
    user_id:          stateRow.user_id,
    shop_id:          stateRow.shop_id,
    access_token:     token,
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    fb_user_id:       meJson.id,
    fb_user_name:     meJson.name,
    ad_accounts:      adJson.data ?? [],
    updated_at:       new Date().toISOString(),
  }, { onConflict: "user_id,shop_id" });

  return new Response(
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Conectado</title>
    <style>
      body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
        background:#0f0f0f;font-family:system-ui,sans-serif;color:#fff;}
      .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;padding:40px;
        text-align:center;max-width:360px;}
      .icon{font-size:48px;margin-bottom:16px;}
      h1{font-size:20px;font-weight:600;margin:0 0 8px;}
      p{color:#888;font-size:14px;margin:0 0 24px;line-height:1.5;}
      button{background:#6366f1;color:#fff;border:none;border-radius:12px;
        padding:12px 24px;font-size:14px;font-weight:500;cursor:pointer;}
      button:hover{opacity:.9;}
    </style>
    </head><body>
    <div class="card">
      <div class="icon">✅</div>
      <h1>Facebook conectado!</h1>
      <p>Pode fechar esta aba e voltar ao SRX Growth para selecionar a conta de anúncios.</p>
      <button onclick="window.close()">Fechar aba</button>
    </div>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
});

function redirect(to: string) {
  return new Response(null, { status: 302, headers: { Location: to } });
}

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import crypto from "crypto";

function htmlMessage(title: string, message: string, ok: boolean) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#fafafa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#171719;padding:32px 40px;border-radius:12px;max-width:440px;text-align:center;border:1px solid #2a2a2e}
h1{margin:0 0 8px;font-size:18px;color:${ok ? "#22c55e" : "#ef4444"}}p{margin:0;color:#a1a1aa;font-size:14px}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p>
<script>setTimeout(()=>{try{window.opener&&window.opener.postMessage({type:"shopify-oauth",ok:${ok}},window.location.origin)}catch(e){}window.close();window.location.href="/shops"},1500)</script>
</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function verifyHmac(query: URLSearchParams, secret: string) {
  const hmac = query.get("hmac");
  if (!hmac) return false;
  const params: string[] = [];
  query.forEach((v, k) => { if (k !== "hmac" && k !== "signature") params.push(`${k}=${v}`); });
  params.sort();
  const message = params.join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(hmac, "hex"));
  } catch { return false; }
}

export const Route = createFileRoute("/api/public/shopify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = url.searchParams;
        const code = q.get("code");
        const shop = q.get("shop");
        const state = q.get("state");
        if (!code || !shop || !state) return htmlMessage("Erro", "Parâmetros ausentes", false);
        if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) return htmlMessage("Erro", "Shop inválido", false);

        const { data: st } = await supabaseAdmin.from("shopify_oauth_states")
          .select("*").eq("state", state).maybeSingle();
        if (!st) return htmlMessage("Erro", "State inválido ou expirado", false);
        if (st.shop_domain !== shop) return htmlMessage("Erro", "Shop não corresponde ao state", false);
        if (new Date(st.expires_at).getTime() < Date.now()) {
          await supabaseAdmin.from("shopify_oauth_states").delete().eq("state", state);
          return htmlMessage("Erro", "State expirado, tente novamente", false);
        }

        const clientId = st.client_id as string | null;
        const clientSecret = st.client_secret as string | null;
        if (!clientId || !clientSecret) {
          return htmlMessage("Erro", "Credenciais da loja ausentes. Reconecte a loja.", false);
        }
        if (!verifyHmac(q, clientSecret)) return htmlMessage("Erro", "HMAC inválido", false);

        const tokRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        });
        if (!tokRes.ok) {
          const txt = await tokRes.text();
          return htmlMessage("Erro", `Falha ao obter token (${tokRes.status}): ${txt.slice(0, 120)}`, false);
        }
        const tok: any = await tokRes.json();
        const accessToken = tok.access_token as string;
        const scope = tok.scope as string | undefined;

        const { data: existing } = await supabaseAdmin.from("shopify_stores")
          .select("id").eq("user_id", st.user_id).eq("shop_domain", shop).maybeSingle();
        const payload = {
          name: st.name, shop_domain: shop, access_token: accessToken,
          client_id: clientId, client_secret: clientSecret,
          scope: scope ?? null, installed_at: new Date().toISOString(),
          last_sync_status: "ok" as const, last_sync_error: null,
        };
        if (existing) {
          await supabaseAdmin.from("shopify_stores").update(payload).eq("id", existing.id);
        } else {
          await supabaseAdmin.from("shopify_stores").insert({ user_id: st.user_id, ...payload });
        }
        await supabaseAdmin.from("shopify_oauth_states").delete().eq("state", state);

        return htmlMessage("Loja conectada!", "Você já pode fechar esta janela.", true);
      },
    },
  },
});

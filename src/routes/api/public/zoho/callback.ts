import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  exchangeZohoCode, getZohoAccount, initZohoAccount, isZohoAccountsServer, mailApiBaseFor, syncZohoMailbox,
} from "@/lib/zoho-mail.server";

function htmlMessage(title: string, message: string, ok: boolean) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#fafafa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#171719;padding:32px 40px;border-radius:12px;max-width:440px;text-align:center;border:1px solid #2a2a2e}
h1{margin:0 0 8px;font-size:18px;color:${ok ? "#22c55e" : "#ef4444"}}p{margin:0;color:#a1a1aa;font-size:14px}</style>
</head><body><div class="card"><h1>${esc(title)}</h1><p>${esc(message)}</p>
<script>setTimeout(()=>{try{window.opener&&window.opener.postMessage({type:"zoho-oauth",ok:${ok}},window.location.origin)}catch(e){}window.close();window.location.href="/atendimento"},${ok ? 1500 : 6000})</script>
</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// Volta do login no Zoho (Atendimento > Conectar Zoho): troca o código pelos
// tokens, descobre a conta/pastas e faz a 1ª sincronização (últimos 30 dias).
export const Route = createFileRoute("/api/public/zoho/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams;
        if (q.get("error")) return htmlMessage("Conexão cancelada", `O Zoho respondeu: ${q.get("error")}`, false);
        const code = q.get("code");
        const state = q.get("state");
        if (!code || !state) return htmlMessage("Erro", "Parâmetros ausentes", false);

        const { data: st } = await supabaseAdmin.from("zoho_oauth_states").select("*").eq("state", state).maybeSingle();
        if (!st) return htmlMessage("Erro", "State inválido ou expirado — tente conectar de novo.", false);
        await supabaseAdmin.from("zoho_oauth_states").delete().eq("state", state);
        if (new Date(st.expires_at).getTime() < Date.now()) return htmlMessage("Erro", "Tempo esgotado — tente conectar de novo.", false);

        // Conta de outro data center (zoho.eu, .in…) manda o servidor certo aqui.
        const accountsServer = q.get("accounts-server") ?? "https://accounts.zoho.com";
        if (!isZohoAccountsServer(accountsServer)) return htmlMessage("Erro", "Servidor do Zoho inválido", false);

        try {
          const tok = await exchangeZohoCode({
            accountsServer, clientId: st.client_id, clientSecret: st.client_secret, code, redirectUri: st.redirect_uri,
          });
          const previous = await getZohoAccount(st.owner_id);
          const refreshToken = tok.refresh_token ?? previous?.refresh_token ?? null;
          if (!refreshToken) throw new Error("O Zoho não devolveu o token de acesso contínuo — tente de novo.");
          const now = new Date().toISOString();
          const { error } = await supabaseAdmin.from("zoho_mail_accounts").upsert({
            owner_id: st.owner_id, client_id: st.client_id, client_secret: st.client_secret,
            refresh_token: refreshToken, access_token: tok.access_token,
            access_token_expires_at: new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString(),
            accounts_server: accountsServer, mail_api_base: mailApiBaseFor(accountsServer),
            connected_at: now, updated_at: now, last_sync_error: null,
          }, { onConflict: "owner_id" });
          if (error) throw new Error(error.message);

          const acc = (await getZohoAccount(st.owner_id))!;
          await initZohoAccount(acc);
          try { await syncZohoMailbox(st.owner_id); } catch (e) { console.error("zoho first sync", e); }
          return htmlMessage("Zoho conectado!", `${acc.email ?? "Conta"} ligada ao Atendimento. Você já pode fechar esta janela.`, true);
        } catch (e: any) {
          console.error("zoho callback", e);
          return htmlMessage("Erro ao conectar", String(e?.message ?? e), false);
        }
      },
    },
  },
});

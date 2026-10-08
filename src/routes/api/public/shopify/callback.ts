import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncMirrorShop } from "@/lib/shop-orders.functions";
import crypto from "crypto";
import { startStoreSetupCheck } from "@/lib/store-policies.server";
import { fetchWithRetry } from "@/lib/http";

function htmlMessage(rawTitle: string, rawMessage: string, ok: boolean) {
  // Texto pode vir da resposta da Shopify (erro do token): escapa antes de pôr no HTML.
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const title = esc(rawTitle), message = esc(rawMessage);
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#fafafa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#171719;padding:32px 40px;border-radius:12px;max-width:440px;text-align:center;border:1px solid #2a2a2e}
h1{margin:0 0 8px;font-size:18px;color:${ok ? "#22c55e" : "#ef4444"}}p{margin:0;color:#a1a1aa;font-size:14px}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p>
<script>setTimeout(()=>{try{window.opener&&window.opener.postMessage({type:"shopify-oauth",ok:${ok}},window.location.origin)}catch(e){}window.close();window.location.href="/shops/banco-de-lojas"},1500)</script>
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

        const tokRes = await fetchWithRetry(`https://${shop}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        // `code` do OAuth é de uso único — sem nova tentativa, só tempo limite.
        }, { retries: 0 });
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
        const placeholderId = st.replace_placeholder_id as string | null;
        const { data: placeholder } = placeholderId
          ? await supabaseAdmin.from("shopify_stores").select("id,board_column_id,board_position,board_note")
            .eq("id", placeholderId).eq("user_id", st.user_id).eq("is_placeholder", true).maybeSingle()
          : { data: null };

        let storeId = existing?.id as string | undefined;
        if (existing) {
          await supabaseAdmin.from("shopify_stores").update(payload).eq("id", existing.id);
          // Domínio já conectado: leva Produção, acessos, nota e posição do card
          // provisório pra loja antes de apagá-lo (o delete apaga em cascata).
          if (placeholder && placeholder.id !== existing.id) {
            await movePlaceholderData(st.user_id, placeholder, existing.id);
            await supabaseAdmin.from("shopify_stores").delete().eq("id", placeholder.id).eq("user_id", st.user_id);
          }
        } else if (placeholder) {
          // O próprio card vira a loja conectada — mantém tudo que já foi preenchido.
          await supabaseAdmin.from("shopify_stores").update({ ...payload, is_placeholder: false }).eq("id", placeholder.id);
          storeId = placeholder.id;
        } else {
          const { data: inserted } = await supabaseAdmin.from("shopify_stores")
            .insert({ user_id: st.user_id, ...payload }).select("id").single();
          storeId = inserted?.id;
        }

        if (storeId) {
          await syncMirrorShop(st.user_id, storeId, st.name);
          // Loja nova: confere políticas, apps, e-mail, endereço e notificações com a loja base (aviso no sino se diferente).
          if (!existing) await startStoreSetupCheck(st.user_id, storeId).catch((e) => console.error("startStoreSetupCheck", e));
        }
        await supabaseAdmin.from("shopify_oauth_states").delete().eq("state", state);

        return htmlMessage("Loja conectada!", "Você já pode fechar esta janela.", true);
      },
    },
  },
});

type Placeholder = { id: string; board_column_id: string | null; board_position: number | null; board_note: string | null };

async function movePlaceholderData(userId: string, from: Placeholder, toId: string) {
  const { data: target } = await supabaseAdmin.from("shopify_stores").select("board_note").eq("id", toId).maybeSingle();
  await supabaseAdmin.from("shopify_stores").update({
    board_column_id: from.board_column_id,
    board_position: from.board_position ?? undefined,
    ...(target?.board_note?.trim() ? {} : { board_note: from.board_note }),
  }).eq("id", toId);

  for (const table of ["store_credentials", "store_production_tasks", "store_production_files", "store_production_policies"] as const) {
    const { error } = await supabaseAdmin.from(table).update({ shopify_store_id: toId })
      .eq("shopify_store_id", from.id).eq("user_id", userId);
    if (error) console.error(`[shopify callback] mover ${table}`, error.message);
  }

  // Ficha: campo já preenchido na loja de destino vence.
  const { data: rows } = await supabaseAdmin.from("store_production").select("shopify_store_id,values")
    .in("shopify_store_id", [from.id, toId]);
  const src = rows?.find((r) => r.shopify_store_id === from.id);
  if (src) {
    const dst = rows?.find((r) => r.shopify_store_id === toId);
    const dstValues = (dst?.values ?? {}) as Record<string, string>;
    const values = { ...(src.values as Record<string, string>) };
    for (const [k, v] of Object.entries(dstValues)) if (v?.trim()) values[k] = v;
    const { error } = await supabaseAdmin.from("store_production")
      .upsert({ shopify_store_id: toId, user_id: userId, values }, { onConflict: "shopify_store_id" });
    if (error) console.error("[shopify callback] mover ficha", error.message);
  }

  const [{ data: fromGroups }, { data: toGroups }] = await Promise.all([
    supabaseAdmin.from("shop_group_stores").select("id,group_id").eq("shopify_store_id", from.id),
    supabaseAdmin.from("shop_group_stores").select("group_id").eq("shopify_store_id", toId),
  ]);
  const have = new Set((toGroups ?? []).map((g) => g.group_id));
  const ids = (fromGroups ?? []).filter((g) => !have.has(g.group_id)).map((g) => g.id);
  if (ids.length > 0) await supabaseAdmin.from("shop_group_stores").update({ shopify_store_id: toId }).in("id", ids);
}

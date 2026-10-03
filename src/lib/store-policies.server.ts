import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { raiseNotification, resolveNotification } from "@/lib/notifications.server";

// Políticas da loja (reembolso, privacidade, termos, frete, contato, aviso legal)
// comparadas com as da loja base do workspace (shopify_stores.policy_base).
// Roda quando uma loja nova é conectada (shopify/callback) — sem rotina diária.
// Enquanto o aviso estiver aberto, o notifications-refresh reconfere a loja,
// e ele some sozinho quando as políticas ficarem iguais às da base.

const KEY_PREFIX = "shopify_policies:";
const LABEL: Record<string, string> = {
  "refund-policy": "Reembolso", "privacy-policy": "Privacidade", "terms-of-service": "Termos de serviço",
  "shipping-policy": "Frete", "contact-information": "Informações de contato", "legal-notice": "Aviso legal",
};
const label = (h: string) => LABEL[h] ?? h;

const normalize = (html: string) => html
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'")
  .replace(/\s+/g, " ").trim();

// handle → texto; null = sem acesso à loja (não dá pra conferir).
async function fetchPolicies(domain: string, token: string): Promise<Record<string, string> | null> {
  const res = await fetchWithRetry(`https://${domain}/admin/api/2024-10/policies.json`, { headers: { "X-Shopify-Access-Token": token } });
  if (!res.ok) return null;
  const j: any = await res.json();
  return Object.fromEntries(((j?.policies ?? []) as any[]).map((p) => [String(p.handle), normalize(String(p.body ?? ""))]).filter(([, t]) => t));
}

// Trecho que muda (do 1º ao último ponto diferente, por palavra), pra mostrar no aviso.
function changed(base: string, store: string) {
  const x = base.split(" "), y = store.split(" ");
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  const cut = (w: string[]) => { const s = w.join(" "); return s.length > 70 ? `${s.slice(0, 70)}…` : s || "(nada)"; };
  return { base: cut(x.slice(i, x.length - j)), store: cut(y.slice(i, y.length - j)) };
}

export async function checkStorePolicies(ownerId: string, storeId: string) {
  const { data: stores } = await supabaseAdmin.from("shopify_stores")
    .select("id,name,shop_domain,access_token,policy_base,is_placeholder").eq("user_id", ownerId);
  const base = (stores ?? []).find((s) => s.policy_base);
  const store = (stores ?? []).find((s) => s.id === storeId);
  const key = `${KEY_PREFIX}${storeId}`;
  if (!base || !store || store.id === base.id || store.is_placeholder) return { skipped: true };
  if (!base.shop_domain || !base.access_token || !store.shop_domain || !store.access_token) return { skipped: true };

  const [ref, pol] = await Promise.all([fetchPolicies(base.shop_domain, base.access_token), fetchPolicies(store.shop_domain, store.access_token)]);
  if (!ref || !pol) return { skipped: true };   // sem acesso agora: não acusa nem resolve

  const lines: string[] = [];
  for (const h of Object.keys(ref)) {
    if (!(h in pol)) lines.push(`${label(h)}: falta na loja`);
    else if (pol[h] !== ref[h]) {
      const c = changed(ref[h], pol[h]);
      lines.push(`${label(h)}: "${c.store}" (na base: "${c.base}")`);
    }
  }
  if (!lines.length) { await resolveNotification(ownerId, key); return { ok: true }; }
  await raiseNotification(ownerId, key, {
    level: "warning",
    title: `Políticas da ${store.name ?? store.shop_domain} diferentes da ${base.name ?? "loja base"}`,
    body: lines.join("\n"),
    link: "/shops/banco-de-lojas",
  });
  return { different: lines.length };
}

// Reconfere só as lojas com aviso de política aberto (resolve quando corrigir).
export async function recheckOpenStorePolicies(ownerId: string) {
  const { data } = await supabaseAdmin.from("app_notifications").select("key")
    .eq("user_id", ownerId).like("key", `${KEY_PREFIX}%`).is("resolved_at", null);
  for (const n of (data ?? []) as { key: string }[]) await checkStorePolicies(ownerId, n.key.slice(KEY_PREFIX.length));
}

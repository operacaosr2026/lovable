import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { raiseNotification, resolveNotification } from "@/lib/notifications.server";

// Conferência da loja nova contra a loja base do workspace (shopify_stores.policy_base):
// políticas, apps instalados, e-mail de atendimento, endereço, senha na loja e
// se a Shopify está mandando a confirmação do pedido e a de envio ao cliente.
// Roda quando uma loja nova é conectada (shopify/callback) — sem rotina diária.
// Depois, o notifications-refresh reconfere a loja enquanto o aviso estiver
// aberto (ele some sozinho quando tudo bater) e, de hora em hora, até os
// primeiros pedidos mostrarem as notificações ao cliente (setup_check_until).

const KEY_PREFIX = "shopify_setup:";
const NOTIF_WINDOW_DAYS = 21;
const LABEL: Record<string, string> = {
  "refund-policy": "Reembolso", "privacy-policy": "Privacidade", "terms-of-service": "Termos de serviço",
  "shipping-policy": "Frete", "contact-information": "Informações de contato", "legal-notice": "Aviso legal",
};
const label = (h: string) => LABEL[h] ?? h;

const normalize = (html: string) => html
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'")
  .replace(/\s+/g, " ").trim();

type Store = { id: string; name: string | null; shop_domain: string | null; access_token: string | null };
type Snapshot = {
  policies: Record<string, string>; apps: string[] | null;   // null = app sem permissão pra ler os apps
  email: string | null; address: string; addressKey: string; password: boolean;
};

async function api(s: Store, path: string) {
  const res = await fetchWithRetry(`https://${s.shop_domain}/admin/api/2024-10/${path}`, { headers: { "X-Shopify-Access-Token": s.access_token! } });
  return res.ok ? res.json() : null;
}
async function gql(s: Store, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetchWithRetry(`https://${s.shop_domain}/admin/api/2024-10/graphql.json`, {
    method: "POST", headers: { "X-Shopify-Access-Token": s.access_token!, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }),
  });
  return res.ok ? (await res.json())?.data : null;
}

// null = sem acesso à loja agora (não dá pra conferir).
async function snapshot(s: Store): Promise<Snapshot | null> {
  const [pol, shop, apps] = await Promise.all([
    api(s, "policies.json"), api(s, "shop.json"), gql(s, `{ appInstallations(first: 100) { nodes { app { title } } } }`),
  ]);
  if (!pol || !shop?.shop) return null;
  const sh = shop.shop;
  return {
    policies: Object.fromEntries(((pol.policies ?? []) as any[]).map((p) => [String(p.handle), normalize(String(p.body ?? ""))]).filter(([, t]) => t)),
    apps: apps?.appInstallations ? ((apps.appInstallations.nodes ?? []) as any[]).map((n) => String(n.app?.title ?? "")).filter(Boolean) : null,
    email: sh.customer_email || sh.email || null,
    address: [sh.address1, sh.address2, sh.city, sh.province_code, sh.zip].filter(Boolean).join(", "),
    addressKey: addressKey(sh.address1, sh.zip),
    password: !!sh.password_enabled,
  };
}

// Trecho que muda (do 1º ao último ponto diferente, por palavra), pra mostrar no aviso.
function changed(base: string, store: string) {
  const x = base.split(" "), y = store.split(" ");
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  const cut = (w: string[]) => { const s = w.join(" "); return s.length > 70 ? `${s.slice(0, 70)}…` : s || "(nada)"; };
  return { base: cut(x.slice(i, x.length - j)), store: cut(y.slice(i, y.length - j)) };
}
// Rua + CEP: o endereço às vezes vem todo na linha 1 ("412 W 7th St | Clovis, 88101 New Mexico").
const addressKey = (line1: string | null, zip: string | null) => {
  const street = String(line1 ?? "").split(/[|,]/)[0].trim().toLowerCase().replace(/\s+/g, " ");
  const z = String(zip ?? "").match(/\d{5}/)?.[0] ?? String(line1 ?? "").match(/\b\d{5}\b/)?.[0] ?? "";
  return `${street}|${z}`;
};
const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

// Notificações ao cliente: a API não mostra se estão ligadas, então confere nos
// eventos do pedido mais recente (confirmação) e do último enviado (envio).
// true = mandou, false = não mandou, null = ainda sem pedido pra conferir.
async function customerEmails(ownerId: string, s: Store) {
  const { data: set } = await supabaseAdmin.from("shop_order_settings").select("shop_id").eq("user_id", ownerId).eq("shopify_store_id", s.id).maybeSingle();
  if (!set?.shop_id) return { order: null, shipping: null };
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const [{ data: placed }, { data: shipped }] = await Promise.all([
    supabaseAdmin.from("shop_orders").select("external_id,order_number").eq("shop_id", set.shop_id).lt("order_date", ago(30)).order("order_date", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("shop_orders").select("external_id,order_number").eq("shop_id", set.shop_id).lt("shipped_at", ago(60)).order("shipped_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const sent = async (o: { external_id: string } | null, re: RegExp) => {
    if (!o) return null;
    const d = await gql(s, `query($id: ID!) { order(id: $id) { events(first: 100) { nodes { message ... on BasicEvent { action } } } } }`, { id: `gid://shopify/Order/${o.external_id}` });
    if (!d?.order) return null;
    return ((d.order.events?.nodes ?? []) as any[]).some((e) => e.action === "mail_sent" && re.test(String(e.message ?? "")));
  };
  const [order, shipping] = await Promise.all([sent(placed, /order confirmation/i), sent(shipped, /shipping confirmation/i)]);
  return { order, shipping, orderNumber: placed?.order_number ?? null, shippedNumber: shipped?.order_number ?? null };
}

export async function checkStoreSetup(ownerId: string, storeId: string) {
  const { data: stores } = await supabaseAdmin.from("shopify_stores")
    .select("id,name,shop_domain,access_token,policy_base,is_placeholder,setup_check_until").eq("user_id", ownerId);
  const base = (stores ?? []).find((s) => s.policy_base);
  const store = (stores ?? []).find((s) => s.id === storeId);
  const key = `${KEY_PREFIX}${storeId}`;
  if (!base || !store || store.id === base.id || store.is_placeholder) return { skipped: true };
  if (!base.shop_domain || !base.access_token || !store.shop_domain || !store.access_token) return { skipped: true };

  const [ref, cur] = await Promise.all([snapshot(base), snapshot(store)]);
  if (!ref || !cur) return { skipped: true };   // sem acesso agora: não acusa nem resolve

  const lines: string[] = [];
  for (const h of Object.keys(ref.policies)) {
    if (!(h in cur.policies)) lines.push(`${label(h)}: falta na loja`);
    else if (cur.policies[h] !== ref.policies[h]) {
      const c = changed(ref.policies[h], cur.policies[h]);
      lines.push(`${label(h)}: "${c.store}" (na base: "${c.base}")`);
    }
  }
  const missingApps = ref.apps && cur.apps ? ref.apps.filter((a) => !cur.apps!.some((b) => same(a, b))) : [];
  if (missingApps.length) lines.push(`Apps que faltam: ${missingApps.join(", ")}`);
  if (!same(cur.email, ref.email)) lines.push(`E-mail de atendimento: "${cur.email ?? "—"}" (na base: "${ref.email ?? "—"}")`);
  if (cur.addressKey !== ref.addressKey) lines.push(`Endereço da empresa: "${cur.address || "—"}" (na base: "${ref.address || "—"}")`);
  if (cur.password) lines.push("Loja com senha (fechada pro público)");

  // Notificações ao cliente: só enquanto a loja está na janela de conferência.
  if (store.setup_check_until && store.setup_check_until > new Date().toISOString()) {
    const n = await customerEmails(ownerId, store);
    if (n.order === false) lines.push(`Confirmação do pedido: a Shopify não mandou ao cliente (pedido ${n.orderNumber ?? ""}) — ligue em Configurações → Notificações`);
    if (n.shipping === false) lines.push(`Confirmação de envio: o cliente não recebeu o e-mail com o rastreio (pedido ${n.shippedNumber ?? ""}) — ligue em Configurações → Notificações ou no app de envio`);
    // As duas confirmadas: não precisa conferir mais.
    if (n.order === true && n.shipping === true) await supabaseAdmin.from("shopify_stores").update({ setup_check_until: null }).eq("id", store.id);
  }

  if (!lines.length) { await resolveNotification(ownerId, key); return { ok: true }; }
  await raiseNotification(ownerId, key, {
    level: "warning",
    title: `${store.name ?? store.shop_domain}: configuração diferente da ${base.name ?? "loja base"}`,
    body: lines.join("\n"),
    link: "/shops/banco-de-lojas",
  });
  return { different: lines.length };
}

// Loja nova: confere agora e abre a janela pra conferir as notificações nos primeiros pedidos.
export async function startStoreSetupCheck(ownerId: string, storeId: string) {
  await supabaseAdmin.from("shopify_stores")
    .update({ setup_check_until: new Date(Date.now() + NOTIF_WINDOW_DAYS * 86_400_000).toISOString() }).eq("id", storeId);
  return checkStoreSetup(ownerId, storeId);
}

// Reconfere as lojas com aviso aberto (a cada rodada) e, de hora em hora, as que
// ainda estão esperando os primeiros pedidos pra conferir as notificações.
export async function recheckStoreSetups(ownerId: string) {
  const [{ data: open }, { data: pending }] = await Promise.all([
    supabaseAdmin.from("app_notifications").select("key").eq("user_id", ownerId).like("key", `${KEY_PREFIX}%`).is("resolved_at", null),
    new Date().getUTCMinutes() < 5
      ? supabaseAdmin.from("shopify_stores").select("id").eq("user_id", ownerId).gt("setup_check_until", new Date().toISOString())
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const ids = new Set([...((open ?? []) as { key: string }[]).map((n) => n.key.slice(KEY_PREFIX.length)), ...((pending ?? []) as { id: string }[]).map((s) => s.id)]);
  for (const id of ids) await checkStoreSetup(ownerId, id);
}

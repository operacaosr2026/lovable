import { fetchWithRetry } from "@/lib/http";

// Webhooks da Shopify (pedido criado/alterado, disputa aberta/atualizada) apontando pro nosso endpoint
// /api/public/hooks/shopify/<id da loja>. Criados pela API com o token da
// integração — ficam vinculados ao app, não aparecem em Configurações →
// Notificações do admin, e a Shopify os remove se o app for desinstalado.
export const SHOPIFY_WEBHOOK_TOPICS = ["orders/create", "orders/updated", "disputes/create", "disputes/update"] as const;

const APP_ORIGIN = (process.env.SHOPIFY_WEBHOOK_ORIGIN || "https://lojas-one.vercel.app").replace(/\/+$/, "");
const API = "2024-10";

export const shopifyWebhookAddress = (storeId: string) => `${APP_ORIGIN}/api/public/hooks/shopify/${storeId}`;

type Store = { id: string; shop_domain: string; access_token: string };

// Confere se os webhooks existem na loja e cria os que faltarem. Roda no sync
// completo (de hora em hora), então também recria um webhook que a Shopify
// tenha desativado depois de falhas seguidas. Deploys de preview não
// cadastram nada (apontariam pra URL de produção por engano).
export async function ensureShopifyWebhooks(store: Store): Promise<{ created: string[]; skipped?: boolean }> {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return { created: [], skipped: true };
  const headers = { "X-Shopify-Access-Token": store.access_token, "Content-Type": "application/json" };
  const address = shopifyWebhookAddress(store.id);

  const res = await fetchWithRetry(`https://${store.shop_domain}/admin/api/${API}/webhooks.json?limit=250`, { headers });
  if (!res.ok) throw new Error(`Shopify webhooks ${res.status}`);
  const existing: any[] = (await res.json())?.webhooks ?? [];

  // Um tópico que falhe (ex.: loja sem Shopify Payments não aceita disputes/*)
  // não impede os outros de serem criados.
  const created: string[] = [];
  const errors: string[] = [];
  for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
    if (existing.some((w) => w.topic === topic && w.address === address)) continue;
    const r = await fetchWithRetry(`https://${store.shop_domain}/admin/api/${API}/webhooks.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
    }, { retries: 1 });
    if (!r.ok) { errors.push(`${topic} ${r.status}: ${(await r.text()).slice(0, 200)}`); continue; }
    created.push(topic);
  }
  if (errors.length && !created.length && errors.length === SHOPIFY_WEBHOOK_TOPICS.length) throw new Error(`Shopify criar webhooks: ${errors.join("; ")}`);
  if (errors.length) console.error("ensureShopifyWebhooks", store.shop_domain, errors.join("; "));
  return { created };
}

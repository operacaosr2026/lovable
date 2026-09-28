import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { raiseNotification, resolveNotification } from "@/lib/notifications.server";

// Shopify respondeu 403 (app sem a permissão/escopo) ou 404 (recurso não
// existe — ex.: loja sem Shopify Payments) numa sincronização. Antes isso
// virava "lista vazia" em silêncio (ex.: Woovah sem o escopo de disputas
// mostrava 0% de estorno); agora abre um aviso no sino, que some sozinho
// quando a mesma chamada volta a funcionar.

export type ShopifyFeature = "disputes" | "payouts" | "balance_transactions" | "balance";

const FEATURE_LABEL: Record<ShopifyFeature, string> = {
  disputes: "disputas/chargebacks",
  payouts: "depósitos (payouts)",
  balance_transactions: "transações do saldo",
  balance: "saldo do Shopify Payments",
};
const FEATURE_SCOPE: Record<ShopifyFeature, string> = {
  disputes: "read_shopify_payments_disputes",
  payouts: "read_shopify_payments_payouts",
  balance_transactions: "read_shopify_payments_payouts",
  balance: "read_shopify_payments_payouts",
};

type StoreRef = { id: string; user_id: string; name: string | null };
const storesByDomain = new Map<string, Promise<StoreRef[]>>();
function storesFor(domain: string) {
  let p = storesByDomain.get(domain);
  if (!p) {
    p = Promise.resolve(supabaseAdmin.from("shopify_stores").select("id,user_id,name").eq("shop_domain", domain))
      .then(({ data }) => (data ?? []) as StoreRef[]);
    storesByDomain.set(domain, p);
  }
  return p;
}
const keyFor = (storeId: string, feature: ShopifyFeature) => `shopify_access:${storeId}:${feature}`;

// Chamar quando a resposta for 403/404. Nunca lança (o aviso não pode
// derrubar a sincronização que o chamou).
export async function reportShopifyAccessDenied(domain: string, feature: ShopifyFeature, status: number, detail = "") {
  try {
    for (const s of await storesFor(domain)) {
      const why = status === 403
        ? `A Shopify negou acesso (403): o app não tem a permissão ${FEATURE_SCOPE[feature]}. Adicione a permissão no app da loja e aprove como dono.`
        : `A Shopify respondeu 404 (não encontrado) — normalmente a loja não usa Shopify Payments ou o recurso foi desativado.`;
      await raiseNotification(s.user_id, keyFor(s.id, feature), {
        level: "error",
        title: `${s.name ?? domain}: sem acesso a ${FEATURE_LABEL[feature]} na Shopify`,
        body: `${why} Enquanto isso, esses dados ficam zerados/desatualizados no sistema.${detail ? ` Detalhe: ${detail.slice(0, 160)}` : ""}`,
        link: null,
      });
    }
  } catch (e) {
    console.error("reportShopifyAccessDenied", domain, feature, e);
  }
}

// Chamar quando a mesma chamada der certo — fecha o aviso, se houver.
const cleared = new Set<string>();
export async function clearShopifyAccessDenied(domain: string, feature: ShopifyFeature) {
  const once = `${domain}:${feature}`;
  if (cleared.has(once)) return;   // 1x por processo basta
  cleared.add(once);
  try {
    for (const s of await storesFor(domain)) await resolveNotification(s.user_id, keyFor(s.id, feature));
  } catch (e) {
    console.error("clearShopifyAccessDenied", domain, feature, e);
  }
}

// Atalho pros fetch: 403/404 → avisa e devolve true (quem chamou segue com
// lista vazia, como antes); ok → fecha o aviso e devolve false.
export async function handleShopifyAccess(res: Response, domain: string, feature: ShopifyFeature): Promise<boolean> {
  if (res.status === 403 || res.status === 404) {
    const detail = await res.text().catch(() => "");
    cleared.delete(`${domain}:${feature}`);
    await reportShopifyAccessDenied(domain, feature, res.status, detail);
    return true;
  }
  if (res.ok) await clearShopifyAccessDenied(domain, feature);
  return false;
}

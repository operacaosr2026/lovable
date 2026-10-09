import { fetchWithRetry } from "@/lib/http";

// Permissões que o token tem de verdade, perguntando à Shopify. A lista salva
// na conexão (shopify_stores.scope) não traz as que vêm embutidas em outras
// (ex.: read_locations), então não serve pra decidir se falta permissão.
// null = não deu pra consultar.
export async function liveShopifyScopes(domain: string, token: string): Promise<string[] | null> {
  try {
    const res = await fetchWithRetry(`https://${domain}/admin/api/2026-07/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: "{ currentAppInstallation { accessScopes { handle } } }" }),
    }, { retries: 0 });
    if (!res.ok) return null;
    const json: any = await res.json();
    const scopes = json.data?.currentAppInstallation?.accessScopes;
    return Array.isArray(scopes) ? scopes.map((s: { handle: string }) => s.handle) : null;
  } catch {
    return null;
  }
}

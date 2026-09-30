import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";

// Análise de fraude da Shopify (o ⚠ "Este pedido pode ser fraudulento" da lista
// de pedidos): nível e recomendação da própria Shopify + os motivos. Guarda em
// shop_order_risks pra aba Chargebacks cruzar risco × chargeback/reembolso.
// A Shopify fecha a análise logo depois da compra, então o sync de hora em hora
// só relê os pedidos dos últimos dias.

const QUERY = `query($after: String, $q: String) {
  orders(first: 100, after: $after, query: $q) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      legacyResourceId name createdAt displayFinancialStatus
      risk { recommendation assessments { riskLevel provider { title } facts { description sentiment } } }
    } }
  }
}`;

export async function syncOrderRisks(shopId: string, userId: string, domain: string, token: string, sinceDays = 3) {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  let after: string | null = null;
  let saved = 0;
  for (let page = 0; page < 40; page++) {
    const res = await fetchWithRetry(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: QUERY, variables: { after, q: `created_at:>=${since}` } }),
    });
    if (!res.ok) throw new Error(`Shopify risco ${res.status}`);
    const json: any = await res.json();
    if (json.errors) throw new Error(`Shopify risco: ${JSON.stringify(json.errors).slice(0, 200)}`);
    const conn = json.data?.orders;
    const rows = ((conn?.edges ?? []) as any[]).map(({ node: n }) => {
      // Só a análise da própria Shopify (a de apps, ex. Disputifier, vem com provider).
      const own = ((n.risk?.assessments ?? []) as any[]).find((a) => !a.provider);
      return {
        shop_id: shopId, user_id: userId, order_external_id: String(n.legacyResourceId), order_name: n.name ?? null,
        order_created_at: n.createdAt ?? null, risk_level: own?.riskLevel ?? null, recommendation: n.risk?.recommendation ?? null,
        facts: ((own?.facts ?? []) as any[]).map((f) => ({ description: f.description, sentiment: f.sentiment })),
        financial_status: n.displayFinancialStatus ?? null,
        updated_at: new Date().toISOString(),
      };
    });
    if (rows.length) {
      const { error } = await supabaseAdmin.from("shop_order_risks").upsert(rows, { onConflict: "shop_id,order_external_id" });
      if (error) throw new Error(error.message);
      saved += rows.length;
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return { saved };
}

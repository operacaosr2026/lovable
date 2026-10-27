import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { normalizeLineItemTitle, type CostProduct } from "@/lib/product-cost-match";

export type ProductLinks = { shopify_product_ids: string[]; line_item_titles: string[] };

// Produtos da Shopify e títulos de item sem produto ligados a cada card
// (product_shopify_links).
export async function linksByProduct(ownerId: string): Promise<Map<string, ProductLinks>> {
  const { data, error } = await selectAll(supabaseAdmin.from("product_shopify_links")
    .select("product_id,shopify_product_id,line_item_title").eq("user_id", ownerId));
  if (error) throw new Error(error.message);
  const out = new Map<string, ProductLinks>();
  for (const r of (data ?? []) as { product_id: string; shopify_product_id: string | null; line_item_title: string | null }[]) {
    const l = out.get(r.product_id) ?? { shopify_product_ids: [], line_item_titles: [] };
    if (r.shopify_product_id) l.shopify_product_ids.push(r.shopify_product_id);
    if (r.line_item_title) l.line_item_titles.push(r.line_item_title);
    out.set(r.product_id, l);
  }
  return out;
}

const NO_LINKS: ProductLinks = { shopify_product_ids: [], line_item_titles: [] };

// Junta aos produtos o que está ligado a eles (matchLineItemProduct).
export async function withShopifyLinks<T extends { id: string }>(ownerId: string, products: T[]): Promise<(T & ProductLinks)[]> {
  const links = await linksByProduct(ownerId);
  return products.map((p) => ({ ...p, ...(links.get(p.id) ?? NO_LINKS) }));
}

// Produtos com o histórico de custo (product_cost_history) e o que está ligado
// a cada um: o custo de um pedido é o da data do pedido (productCostAt). Sem a
// tabela/histórico, usa o atual.
export async function costProductsFor(supabase: any, ownerId: string): Promise<CostProduct[]> {
  const [{ data }, hist, links] = await Promise.all([
    supabase.from("products").select("id,name,cost").eq("user_id", ownerId),
    supabase.from("product_cost_history").select("product_id,cost,valid_from").eq("user_id", ownerId)
      .order("valid_from", { ascending: false }),
    linksByProduct(ownerId),
  ]);
  const byProduct = new Map<string, { from: string; cost: number }[]>();
  if (!hist.error) {
    for (const h of (hist.data ?? []) as any[]) {
      const list = byProduct.get(h.product_id) ?? [];
      list.push({ from: h.valid_from as string, cost: Number(h.cost ?? 0) });
      byProduct.set(h.product_id, list);
    }
  }
  return (data ?? []).map((p: any) => ({ id: p.id, name: p.name, cost: p.cost, history: byProduct.get(p.id), ...(links.get(p.id) ?? NO_LINKS) }));
}

// Liga ao card um produto da Shopify ou um título de item sem produto (se já
// era de outro card, passa pra este).
export async function linkToCard(
  ownerId: string, productId: string, shopifyStoreId: string,
  target: { shopify_product_id: string } | { line_item_title: string }, title: string | null,
) {
  const byId = "shopify_product_id" in target;
  const { error } = await supabaseAdmin.from("product_shopify_links").upsert({
    user_id: ownerId, product_id: productId, shopify_store_id: shopifyStoreId, title,
    ...(byId ? { shopify_product_id: target.shopify_product_id } : { line_item_title: normalizeLineItemTitle(target.line_item_title) }),
  }, { onConflict: byId ? "user_id,shopify_product_id" : "user_id,line_item_title" });
  if (error) throw new Error(error.message);
}

export async function linkShopifyProduct(ownerId: string, productId: string, shopifyStoreId: string, shopifyProductId: string, title: string | null) {
  await linkToCard(ownerId, productId, shopifyStoreId, { shopify_product_id: shopifyProductId }, title);
}

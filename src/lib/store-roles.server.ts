import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Matriz ou subloja de cada loja: o papel mais usado nas publicações de
// produto (como o dono trabalha de fato); loja sem publicação usa o grupo
// (Lojas Grupos). Empate fica com subloja.
export async function matrizStoreIds(ownerId: string, storeIds: string[]): Promise<Set<string>> {
  if (storeIds.length === 0) return new Set();
  const [pubs, groups] = await Promise.all([
    supabaseAdmin.from("product_shopify_publications").select("shopify_store_id,role")
      .eq("user_id", ownerId).eq("status", "ok").in("shopify_store_id", storeIds),
    supabaseAdmin.from("shop_group_stores").select("shopify_store_id,role").in("shopify_store_id", storeIds),
  ]);
  const count = new Map<string, { matriz: number; subloja: number }>();
  for (const p of pubs.data ?? []) {
    if (p.role !== "matriz" && p.role !== "subloja") continue;
    const c = count.get(p.shopify_store_id) ?? { matriz: 0, subloja: 0 };
    c[p.role]++;
    count.set(p.shopify_store_id, c);
  }
  const groupMatriz = new Set((groups.data ?? []).filter((r) => r.role === "matriz").map((r) => r.shopify_store_id));
  return new Set(storeIds.filter((id) => {
    const c = count.get(id);
    return c ? c.matriz > c.subloja : groupMatriz.has(id);
  }));
}

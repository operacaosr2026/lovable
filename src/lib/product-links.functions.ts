import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { linkToCard } from "@/lib/product-links.server";
import { normalizeLineItemTitle } from "@/lib/product-cost-match";

// Botão "Sincronizar Card" (aba Informações do produto): em cada loja, os
// produtos da Shopify que são deste card. É por eles que o item do pedido vira
// o card (custo, vendas, dashboards) — substitui as palavras-chave. Item sem
// produto na Shopify (apagado, avulso, app) liga pelo título exato.

async function assertProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id,name,keywords")
    .eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
  return data as { id: string; name: string; keywords: string[] | null };
}

// Lojas da coluna "Ativas" do Banco de Lojas, conectadas à Shopify.
async function activeStores(ownerId: string) {
  const { data: columns } = await supabaseAdmin.from("store_board_columns").select("id,name").eq("user_id", ownerId);
  const activeIds = (columns ?? []).filter((c) => /^ativ/i.test(c.name.trim())).map((c) => c.id);
  if (!activeIds.length) return [];
  const { data } = await supabaseAdmin.from("shopify_stores").select("id,name,shop_domain")
    .eq("user_id", ownerId).eq("is_placeholder", false).in("board_column_id", activeIds).not("shop_domain", "is", null).order("name");
  return (data ?? []).map((s) => ({ id: s.id as string, name: (s.name || s.shop_domain) as string }));
}

export const getProductSync = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    await assertProduct(ownerId, data.product_id);
    const [stores, { data: links, error }] = await Promise.all([
      activeStores(ownerId),
      supabaseAdmin.from("product_shopify_links").select("shopify_store_id,shopify_product_id,title")
        .eq("user_id", ownerId).eq("product_id", data.product_id),
    ]);
    if (error) throw new Error(error.message);
    const byStore = new Map<string, { shopify_product_id: string | null; title: string | null }[]>();
    for (const l of links ?? []) {
      const list = byStore.get(l.shopify_store_id) ?? [];
      list.push({ shopify_product_id: l.shopify_product_id, title: l.title });
      byStore.set(l.shopify_store_id, list);
    }
    // Loja fora das Ativas que já tem produto ligado também aparece (não conta no total).
    const activeIds = new Set(stores.map((s) => s.id));
    const otherIds = [...byStore.keys()].filter((id) => !activeIds.has(id));
    const { data: others } = otherIds.length
      ? await supabaseAdmin.from("shopify_stores").select("id,name,shop_domain").in("id", otherIds)
      : { data: [] };
    const all = [
      ...stores.map((s) => ({ ...s, active: true })),
      ...(others ?? []).map((s) => ({ id: s.id as string, name: (s.name || s.shop_domain) as string, active: false })),
    ];
    return {
      stores: all.map((s) => ({ ...s, links: byStore.get(s.id) ?? [] })),
      linked: stores.filter((s) => byStore.has(s.id)).length,
      total: stores.length,
    };
  });

type LinkedTo = { product_id: string; name: string } | null;

export type StoreShopifyProduct = {
  id: string; title: string; image: string | null; status: string;
  linked_to: LinkedTo;
  suggested: boolean;
};

// Título de item sem produto na Shopify, com quantos pedidos da loja o têm.
export type LooseLineItem = { line_item_title: string; title: string; orders: number; linked_to: LinkedTo; suggested: boolean };

// Produtos da loja na Shopify e títulos de itens sem produto nos pedidos dela,
// com o card a que cada um já está ligado. "Sugerido": o nome ou uma
// palavra-chave antiga do card aparece no título.
export const listStoreShopifyProducts = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), shopify_store_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    const product = await assertProduct(ownerId, data.product_id);
    const { data: store } = await supabaseAdmin.from("shopify_stores").select("shop_domain,access_token")
      .eq("id", data.shopify_store_id).eq("user_id", ownerId).maybeSingle();
    if (!store?.shop_domain || !store.access_token) throw new Error("Loja sem conexão com a Shopify.");

    const raw: any[] = [];
    let url = `https://${store.shop_domain}/admin/api/2024-10/products.json?limit=250&fields=id,title,image,status`;
    for (let i = 0; i < 40 && url; i++) {
      const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": store.access_token } });
      if (!res.ok) throw new Error(res.status === 402 ? "Loja fechada na Shopify (402)." : `Shopify respondeu ${res.status}.`);
      const json: any = await res.json();
      raw.push(...(json.products ?? []));
      const m = (res.headers.get("link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : "";
    }

    // Lojas do sistema ligadas a esta loja da Shopify (pedidos sem product_id).
    const [{ data: sos }, { data: shopRows }] = await Promise.all([
      supabaseAdmin.from("shop_order_settings").select("shop_id").eq("user_id", ownerId).eq("shopify_store_id", data.shopify_store_id),
      supabaseAdmin.from("shops").select("id").eq("shopify_store_id", data.shopify_store_id),
    ]);
    const shopIds = [...new Set([...(sos ?? []).map((r) => r.shop_id as string), ...(shopRows ?? []).map((r) => r.id as string)])];
    const { data: looseRows, error: looseErr } = shopIds.length
      ? await supabaseAdmin.rpc("loose_line_item_titles", { p_user_id: ownerId, p_shop_ids: shopIds })
      : { data: [], error: null };
    if (looseErr) throw new Error(looseErr.message);

    const ids = raw.map((p) => String(p.id));
    const looseKeys = (looseRows ?? []).map((r) => r.line_item_title);
    const [{ data: byId }, { data: byTitle }] = await Promise.all([
      ids.length
        ? supabaseAdmin.from("product_shopify_links").select("shopify_product_id,product_id").eq("user_id", ownerId).in("shopify_product_id", ids)
        : Promise.resolve({ data: [] as { shopify_product_id: string | null; product_id: string }[] }),
      looseKeys.length
        ? supabaseAdmin.from("product_shopify_links").select("line_item_title,product_id").eq("user_id", ownerId).in("line_item_title", looseKeys)
        : Promise.resolve({ data: [] as { line_item_title: string | null; product_id: string }[] }),
    ]);
    const cardIds = [...new Set([...(byId ?? []), ...(byTitle ?? [])].map((l) => l.product_id))];
    const { data: cards } = cardIds.length
      ? await supabaseAdmin.from("products").select("id,name").in("id", cardIds)
      : { data: [] };
    const cardName = new Map((cards ?? []).map((c) => [c.id, c.name as string]));
    const linkedTo = (owner: string | undefined): LinkedTo => owner ? { product_id: owner, name: cardName.get(owner) ?? "Outro card" } : null;
    const ownerById = new Map((byId ?? []).map((l) => [l.shopify_product_id, l.product_id]));
    const ownerByTitle = new Map((byTitle ?? []).map((l) => [l.line_item_title, l.product_id]));

    const terms = [product.name, ...(product.keywords ?? [])].map((t) => t.trim().toLowerCase()).filter(Boolean);
    const suggests = (title: string) => terms.some((t) => title.toLowerCase().includes(t));
    const products: StoreShopifyProduct[] = raw.map((p) => {
      const id = String(p.id);
      const owner = ownerById.get(id);
      const title = String(p.title ?? "");
      return {
        id, title, image: p.image?.src ?? null, status: String(p.status ?? "active"),
        linked_to: linkedTo(owner),
        suggested: !owner && suggests(title),
      };
    });
    const loose: LooseLineItem[] = (looseRows ?? []).map((r) => {
      const owner = ownerByTitle.get(r.line_item_title);
      return { line_item_title: r.line_item_title, title: r.title, orders: Number(r.orders), linked_to: linkedTo(owner), suggested: !owner && suggests(r.title) };
    });
    const rank = (p: { linked_to: LinkedTo; suggested: boolean }) => (p.linked_to?.product_id === data.product_id ? 0 : p.suggested ? 1 : 2);
    products.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
    loose.sort((a, b) => rank(a) - rank(b) || b.orders - a.orders);
    return { products, loose };
  });

// Liga ou desliga deste card um produto da Shopify ou um título de item sem
// produto. Ligar um que era de outro card passa ele pra este.
export const setProductShopifyLink = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    shopify_store_id: z.string().uuid(),
    shopify_product_id: z.string().regex(/^\d+$/).optional(),
    line_item_title: z.string().trim().min(1).max(500).optional(),
    title: z.string().max(500).nullable(),
    linked: z.boolean(),
  }).refine((v) => !v.shopify_product_id !== !v.line_item_title, "Informe o produto ou o título").parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    await assertProduct(ownerId, data.product_id);
    const spid = data.shopify_product_id;
    const target = spid ? { shopify_product_id: spid } : { line_item_title: normalizeLineItemTitle(data.line_item_title) };
    if (data.linked) {
      const { data: store } = await supabaseAdmin.from("shopify_stores").select("id")
        .eq("id", data.shopify_store_id).eq("user_id", ownerId).maybeSingle();
      if (!store) throw new Error("Loja não encontrada");
      await linkToCard(ownerId, data.product_id, data.shopify_store_id, target, data.title);
    } else {
      let q = supabaseAdmin.from("product_shopify_links").delete().eq("user_id", ownerId).eq("product_id", data.product_id);
      q = spid ? q.eq("shopify_product_id", spid) : q.eq("line_item_title", normalizeLineItemTitle(data.line_item_title));
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createProductInStore, productExistsInStore, signedImageUrls, updateProductInStore } from "@/lib/product-shopify.server";
import { liveShopifyScopes } from "@/lib/shopify-scopes.server";
import {
  REQUIRED_SCOPES, UPDATE_PARTS, buildVariants, emptyListing, imagesFor,
  type ShopifyListing, type ShopifyOption, type StoreRole, type VariantTemplate,
} from "@/lib/product-shopify";

const ProductIdInput = z.object({ product_id: z.string().uuid() });
const priceStr = z.string().trim().max(20);

const ListingInput = z.object({
  title_matriz: z.string().trim().max(255),
  title_subloja: z.string().trim().max(255),
  description_html: z.string().max(100_000),
  image_ids: z.array(z.string().uuid()).max(100),
  image_ids_subloja: z.array(z.string().uuid()).max(100).nullable(),
  price: priceStr,
  compare_at_price: priceStr,
  sku: z.string().trim().max(100),
  weight_grams: z.number().min(0).max(1_000_000).nullable(),
  inventory: z.number().int().min(0).max(1_000_000),
  options: z.array(z.object({
    name: z.string().trim().max(60),
    values: z.array(z.string().trim().min(1).max(60)).max(50),
  })).max(3),
  variants: z.array(z.object({
    values: z.array(z.string().max(60)).max(3),
    price: priceStr,
    compare_at_price: priceStr,
    sku: z.string().trim().max(100),
    inventory: z.number().int().min(0).max(1_000_000),
  })).max(100),
  seo_title: z.string().trim().max(70),
  seo_description: z.string().trim().max(320),
  handle: z.string().trim().max(255),
});

async function loadProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id,name").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
  return data;
}

// Lojas da coluna "Ativas" do Banco de Lojas (só nelas se publica produto),
// com papel (matriz/subloja) vindo dos grupos e se a conexão já tem as
// permissões de criar produto.
async function loadStores(ownerId: string) {
  const { data: columns } = await supabaseAdmin.from("store_board_columns").select("id,name").eq("user_id", ownerId);
  const activeIds = (columns ?? []).filter((c) => /^ativ/i.test(c.name.trim())).map((c) => c.id);
  if (activeIds.length === 0) return [];
  const { data: stores } = await supabaseAdmin.from("shopify_stores")
    .select("id,name,shop_domain,scope,access_token,is_placeholder").eq("user_id", ownerId).eq("is_placeholder", false)
    .in("board_column_id", activeIds).order("name");
  const ids = (stores ?? []).map((s) => s.id);
  const { data: roles } = ids.length
    ? await supabaseAdmin.from("shop_group_stores").select("shopify_store_id,role").in("shopify_store_id", ids)
    : { data: [] as { shopify_store_id: string; role: string }[] };
  const matriz = new Set((roles ?? []).filter((r) => r.role === "matriz").map((r) => r.shopify_store_id));
  const list = (stores ?? []).filter((s) => s.shop_domain);
  const live = await Promise.all(list.map((s) => (s.access_token ? liveShopifyScopes(s.shop_domain!, s.access_token) : null)));
  return list.map((s, i) => {
    // Sem resposta da Shopify, cai na lista salva na conexão.
    const scopes = live[i] ?? (s.scope ?? "").split(",").map((x: string) => x.trim());
    return {
      id: s.id as string,
      name: (s.name || s.shop_domain) as string,
      shop_domain: s.shop_domain as string,
      role: (matriz.has(s.id) ? "matriz" : "subloja") as StoreRole,
      missing_scopes: REQUIRED_SCOPES.filter((x) => !scopes.includes(x)),
    };
  });
}

export const getProductShopify = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    const product = await loadProduct(ownerId, data.product_id);
    const [listing, images, stores, pubs] = await Promise.all([
      supabaseAdmin.from("product_shopify_listings").select("data").eq("product_id", product.id).maybeSingle(),
      supabaseAdmin.from("product_images").select("id,file_url,file_name,position").eq("product_id", product.id)
        .order("position", { ascending: true }),
      loadStores(ownerId),
      supabaseAdmin.from("product_shopify_publications")
        .select("shopify_store_id,status,shopify_product_id,handle,role,error,warnings,updated_at")
        .eq("user_id", ownerId).eq("product_id", product.id),
    ]);
    // Produto criado e depois apagado na Shopify volta a poder ser criado.
    const storeCreds = new Map<string, { shop_domain: string; access_token: string }>();
    {
      const okIds = (pubs.data ?? []).filter((p) => p.status === "ok" && p.shopify_product_id).map((p) => p.shopify_store_id);
      if (okIds.length) {
        const { data: creds } = await supabaseAdmin.from("shopify_stores").select("id,shop_domain,access_token")
          .eq("user_id", ownerId).in("id", okIds);
        for (const c of creds ?? []) if (c.shop_domain && c.access_token) storeCreds.set(c.id, { shop_domain: c.shop_domain, access_token: c.access_token });
      }
    }
    const publications = await Promise.all((pubs.data ?? []).map(async (p) => {
      const creds = storeCreds.get(p.shopify_store_id);
      const deleted = p.status === "ok" && p.shopify_product_id && creds
        ? (await productExistsInStore(creds, p.shopify_product_id)) === false
        : false;
      return { ...p, status: (deleted ? "deleted" : p.status) as "ok" | "error" | "deleted" };
    }));
    const saved = listing.data?.data as Partial<ShopifyListing> | undefined;
    const imgs = (images.data ?? []) as { id: string; file_url: string | null; file_name: string | null }[];
    // Ficha nova já vem com as variantes do template padrão.
    let fresh: ShopifyListing | null = null;
    if (!saved) {
      fresh = { ...emptyListing(product.name), image_ids: imgs.map((i) => i.id) };
      const { data: def } = await supabaseAdmin.from("product_variant_templates").select("options")
        .eq("user_id", ownerId).eq("is_default", true).maybeSingle();
      if (def?.options) {
        fresh.options = def.options as ShopifyOption[];
        fresh.variants = buildVariants(fresh);
      }
    }
    return {
      listing: saved ? { ...emptyListing(product.name), ...saved } : fresh!,
      images: imgs,
      stores,
      publications: publications as {
        shopify_store_id: string; status: "ok" | "error" | "deleted"; shopify_product_id: string | null; handle: string | null;
        role: string | null; error: string | null; warnings: string[]; updated_at: string;
      }[],
    };
  });

export const saveProductShopify = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductIdInput.extend({ listing: ListingInput }).parse(d))
  .handler(async ({ context, data }) => {
    await loadProduct(context.ownerId, data.product_id);
    const { error } = await supabaseAdmin.from("product_shopify_listings")
      .upsert({ product_id: data.product_id, user_id: context.ownerId, data: data.listing }, { onConflict: "product_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Cria o produto nas lojas escolhidas, uma por vez. Loja onde já foi criado
// fica de fora (cria uma vez só).
export const publishProductShopify = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductIdInput.extend({
    listing: ListingInput,
    stores: z.array(z.object({ shopify_store_id: z.string().uuid(), role: z.enum(["matriz", "subloja"]) })).min(1).max(50),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    await loadProduct(ownerId, data.product_id);
    const listing = data.listing as ShopifyListing;
    if (!listing.title_matriz.trim()) throw new Error("Preencha o nome do produto na matriz.");
    await supabaseAdmin.from("product_shopify_listings")
      .upsert({ product_id: data.product_id, user_id: ownerId, data: listing }, { onConflict: "product_id" });

    const { data: done } = await supabaseAdmin.from("product_shopify_publications").select("shopify_store_id,shopify_product_id")
      .eq("product_id", data.product_id).eq("status", "ok");
    const createdIn = new Map((done ?? []).map((r) => [r.shopify_store_id, r.shopify_product_id as string | null]));
    // Imagens por papel (matriz / subloja), geradas uma vez cada.
    const urlsByRole = new Map<StoreRole, Promise<string[]>>();
    const imageUrlsFor = (role: StoreRole) => {
      if (!urlsByRole.has(role)) urlsByRole.set(role, signedImageUrls(data.product_id, imagesFor(listing, role)));
      return urlsByRole.get(role)!;
    };

    const results: { shopify_store_id: string; ok: boolean; message: string }[] = [];
    for (const target of data.stores) {
      const { data: store } = await supabaseAdmin.from("shopify_stores").select("shop_domain,access_token")
        .eq("id", target.shopify_store_id).eq("user_id", ownerId).maybeSingle();
      // Já criado: só cria de novo se foi apagado na Shopify (na dúvida, não cria).
      const existingId = createdIn.get(target.shopify_store_id);
      if (createdIn.has(target.shopify_store_id)) {
        const exists = existingId && store?.shop_domain && store.access_token
          ? await productExistsInStore({ shop_domain: store.shop_domain, access_token: store.access_token }, existingId)
          : true;
        if (exists !== false) {
          results.push({ shopify_store_id: target.shopify_store_id, ok: true, message: "Já existe nesta loja" });
          continue;
        }
      }
      const base = { user_id: ownerId, product_id: data.product_id, shopify_store_id: target.shopify_store_id, role: target.role };
      try {
        if (!store?.shop_domain || !store.access_token) throw new Error("Loja sem conexão com a Shopify.");
        const r = await createProductInStore(
          { shop_domain: store.shop_domain, access_token: store.access_token }, listing, target.role, await imageUrlsFor(target.role),
        );
        await supabaseAdmin.from("product_shopify_publications").upsert({
          ...base, status: "ok", shopify_product_id: r.productId, handle: r.handle, error: null, warnings: r.warnings,
        }, { onConflict: "product_id,shopify_store_id" });
        results.push({ shopify_store_id: target.shopify_store_id, ok: true, message: r.warnings.length ? r.warnings.join(" ") : "Criado" });
      } catch (e: any) {
        const message = String(e?.message ?? e).slice(0, 500);
        await supabaseAdmin.from("product_shopify_publications").upsert({
          ...base, status: "error", error: message, warnings: [],
        }, { onConflict: "product_id,shopify_store_id" });
        results.push({ shopify_store_id: target.shopify_store_id, ok: false, message });
      }
    }
    return { results };
  });

// Reenvia partes escolhidas (Aprodrop, nome, preço...) às lojas onde o
// produto já foi criado. Não cria nem apaga nada.
export const updateProductShopify = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductIdInput.extend({
    listing: ListingInput,
    stores: z.array(z.object({ shopify_store_id: z.string().uuid(), role: z.enum(["matriz", "subloja"]) })).min(1).max(50),
    parts: z.array(z.enum(UPDATE_PARTS)).min(1),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    await loadProduct(ownerId, data.product_id);
    const listing = data.listing as ShopifyListing;
    await supabaseAdmin.from("product_shopify_listings")
      .upsert({ product_id: data.product_id, user_id: ownerId, data: listing }, { onConflict: "product_id" });

    const results: { shopify_store_id: string; ok: boolean; message: string }[] = [];
    for (const target of data.stores) {
      const [{ data: pub }, { data: store }] = await Promise.all([
        supabaseAdmin.from("product_shopify_publications").select("shopify_product_id")
          .eq("product_id", data.product_id).eq("shopify_store_id", target.shopify_store_id).eq("status", "ok").maybeSingle(),
        supabaseAdmin.from("shopify_stores").select("shop_domain,access_token")
          .eq("id", target.shopify_store_id).eq("user_id", ownerId).maybeSingle(),
      ]);
      try {
        if (!pub?.shopify_product_id) throw new Error("Produto ainda não foi criado nesta loja.");
        if (!store?.shop_domain || !store.access_token) throw new Error("Loja sem conexão com a Shopify.");
        const r = await updateProductInStore(
          { shop_domain: store.shop_domain, access_token: store.access_token }, pub.shopify_product_id, listing, target.role, data.parts,
        );
        // Avisos da criação dão lugar aos desta atualização.
        await supabaseAdmin.from("product_shopify_publications").update({ warnings: r.warnings, role: target.role })
          .eq("product_id", data.product_id).eq("shopify_store_id", target.shopify_store_id);
        results.push({
          shopify_store_id: target.shopify_store_id,
          ok: r.warnings.length === 0,
          message: [r.done.length ? `Atualizado: ${r.done.join(", ")}.` : "", r.warnings.join(" ")].filter(Boolean).join(" "),
        });
      } catch (e: any) {
        results.push({ shopify_store_id: target.shopify_store_id, ok: false, message: String(e?.message ?? e).slice(0, 500) });
      }
    }
    return { results };
  });

// ── Templates de variantes ──

const OptionsInput = z.array(z.object({
  name: z.string().trim().min(1).max(60),
  values: z.array(z.string().trim().min(1).max(60)).min(1).max(100),
})).min(1).max(3);

export const listVariantTemplates = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin.from("product_variant_templates").select("id,name,options,is_default")
      .eq("user_id", context.ownerId).order("position", { ascending: true }).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as VariantTemplate[];
  });

export const saveVariantTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(100),
    options: OptionsInput,
    is_default: z.boolean(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    const { id, ...row } = data;
    if (row.is_default) {
      let q = supabaseAdmin.from("product_variant_templates").update({ is_default: false }).eq("user_id", ownerId).eq("is_default", true);
      if (id) q = q.neq("id", id);
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
    if (id) {
      const { error } = await supabaseAdmin.from("product_variant_templates").update(row).eq("id", id).eq("user_id", ownerId);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { count } = await supabaseAdmin.from("product_variant_templates").select("id", { count: "exact", head: true }).eq("user_id", ownerId);
    const { data: created, error } = await supabaseAdmin.from("product_variant_templates")
      .insert({ ...row, user_id: ownerId, position: count ?? 0 }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const deleteVariantTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("product_variant_templates").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

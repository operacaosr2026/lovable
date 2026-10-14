import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildPagefly, builtInTemplate, parsePageflyZip, templateBlocks, templatePreview, templateTexts, uploadToShopifyFiles, uploadVideosToShopifyFiles,
  type PageTemplate, type RecCard,
} from "@/lib/product-page.server";
import { PRODUCTION_BUCKET, loadFields, safeFileName } from "@/lib/store-production.server";
import { emptyPage, isVideoMime, type CdnImage, type ProductPageData } from "@/lib/product-page";

const ProductIdInput = z.object({ product_id: z.string().uuid() });

const PageInput = z.object({
  store_id: z.string().uuid().nullable(),
  handle: z.string().trim().max(255),
  file_name: z.string().trim().max(150),
  carousel_ids: z.array(z.string().uuid()).max(30),
  final_ids: z.array(z.string().uuid()).max(3),
  finals: z.array(z.object({ id: z.string().uuid(), path: z.string().max(500), name: z.string().max(255) })).max(3).default([]),
  testimonials: z.array(z.object({ id: z.string().uuid(), path: z.string().max(500), name: z.string().max(255) })).max(30),
  title: z.string().max(500),
  text1: z.string().max(20000),
  text2: z.string().max(20000),
  details: z.string().max(20000),
  reviews_heading: z.string().max(300).default(""),
  reviews_rating: z.string().max(10).default(""),
  reviews_count: z.string().max(30).default(""),
  reviews: z.array(z.object({
    id: z.string().max(60), title: z.string().max(300), text: z.string().max(3000),
    author: z.string().max(120), rating: z.number().min(0).max(5),
  })).max(40).default([]),
  recs_title: z.string().max(300).default(""),
  recs: z.array(z.object({ product_id: z.string().uuid(), link: z.string().trim().max(2000) })).max(30).default([]),
});

// Link salvo no card do produto: campo de link da ficha (Informações) cujo
// nome fala em "página" (padrão: "Link da página do produto").
async function productLinks(ownerId: string): Promise<Map<string, string>> {
  const fields = await loadFields(ownerId, "product");
  const field = fields.find((f) => f.type === "link" && (f.id === "link_pagina" || /p[aá]gina/i.test(f.label)));
  if (!field) return new Map();
  const { data } = await (supabaseAdmin as any).from("product_production").select("product_id,values").eq("user_id", ownerId);
  return new Map(((data ?? []) as { product_id: string; values: Record<string, string> }[])
    .map((r) => [r.product_id, String(r.values?.[field.id] ?? "").trim()] as [string, string])
    .filter(([, v]) => v));
}

async function loadProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id,name").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
  return data;
}

async function loadPage(productId: string): Promise<ProductPageData | null> {
  const { data } = await supabaseAdmin.from("product_pages").select("data").eq("product_id", productId).maybeSingle();
  return data ? { ...emptyPage(), ...(data.data as Partial<ProductPageData>) } : null;
}

const pagesPrefix = (ownerId: string, productId: string) => `${ownerId}/product-pages/${productId}/`;

// Modelo .pagefly do workspace: o que o dono subiu na aba Página, ou o
// original (PG de Vendas 2) que vem no código.
const templatePath = (ownerId: string) => `${ownerId}/pagefly/template.pagefly`;

async function loadTemplate(ownerId: string): Promise<{ tpl: PageTemplate; custom: boolean }> {
  const { data: file } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).download(templatePath(ownerId));
  if (file) {
    try { return { tpl: parsePageflyZip(new Uint8Array(await file.arrayBuffer())), custom: true }; } catch { /* cai no original */ }
  }
  return { tpl: builtInTemplate(), custom: false };
}

export const getProductPage = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductIdInput.parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    const product = await loadProduct(ownerId, data.product_id);
    const { tpl, custom } = await loadTemplate(ownerId);
    const [saved, images, columns, roles, pubs] = await Promise.all([
      loadPage(product.id),
      supabaseAdmin.from("product_images").select("id,file_url,file_name,mime_type,position").eq("product_id", product.id).order("position", { ascending: true }),
      supabaseAdmin.from("store_board_columns").select("id,name").eq("user_id", ownerId),
      supabaseAdmin.from("shop_group_stores").select("shopify_store_id,role"),
      supabaseAdmin.from("product_shopify_publications").select("shopify_store_id,handle").eq("product_id", product.id).eq("status", "ok"),
    ]);
    const [allProducts, links] = await Promise.all([
      supabaseAdmin.from("products").select("id,name,main_image_url").eq("user_id", ownerId).eq("archived", false).order("name"),
      productLinks(ownerId),
    ]);
    // Lojas da coluna Ativas (a página vai pra matriz).
    const activeIds = (columns.data ?? []).filter((c) => /^ativ/i.test(c.name.trim())).map((c) => c.id);
    const { data: stores } = activeIds.length
      ? await supabaseAdmin.from("shopify_stores").select("id,name,shop_domain").eq("user_id", ownerId)
        .eq("is_placeholder", false).in("board_column_id", activeIds).order("name")
      : { data: [] as { id: string; name: string | null; shop_domain: string | null }[] };
    const matriz = new Set((roles.data ?? []).filter((r) => r.role === "matriz").map((r) => r.shopify_store_id));
    const storeList = (stores ?? []).filter((s) => s.shop_domain).map((s) => ({
      id: s.id, name: s.name || s.shop_domain!, is_matriz: matriz.has(s.id),
    }));
    const handleByStore = Object.fromEntries((pubs.data ?? []).filter((p) => p.handle).map((p) => [p.shopify_store_id, p.handle as string]));

    let page = saved;
    if (!page) {
      const store = storeList.find((s) => s.is_matriz) ?? storeList[0];
      page = {
        ...emptyPage(), ...templateTexts(tpl), ...templateBlocks(tpl),
        store_id: store?.id ?? null,
        handle: (store && handleByStore[store.id]) || "",
        file_name: product.name,
        carousel_ids: (images.data ?? []).map((i) => i.id),
      };
    }
    // Página salva antes dos blocos de depoimentos/recomendados: abre com os do modelo.
    else if (page.reviews.length === 0 && !page.reviews_heading && !page.recs_title) {
      page = { ...page, ...templateBlocks(tpl) };
    }
    // Carrossel = todas as imagens do produto: as já ordenadas primeiro, as que faltam no fim.
    const imageIds = (images.data ?? []).map((i) => i.id);
    const kept = page.carousel_ids.filter((id) => imageIds.includes(id));
    page = { ...page, carousel_ids: [...kept, ...imageIds.filter((id) => !kept.includes(id))] };
    // Links temporários pra mostrar as fotos de depoimento.
    const thumbs: Record<string, string> = {};
    for (const t of [...page.testimonials, ...page.finals]) {
      const { data: s } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).createSignedUrl(t.path, 60 * 60);
      if (s?.signedUrl) thumbs[t.id] = s.signedUrl;
    }
    const { cdn: _cdn, ...pageNoCdn } = page;
    return {
      page: pageNoCdn, images: images.data ?? [], stores: storeList, handleByStore, thumbs,
      products: (allProducts.data ?? []).filter((p) => p.id !== product.id)
        .map((p) => ({ id: p.id, name: p.name, image: p.main_image_url, link: links.get(p.id) ?? "" })),
      template: { custom, ...templatePreview(tpl) },
    };
  });

export const saveProductPage = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductIdInput.extend({ page: PageInput }).parse(d))
  .handler(async ({ context, data }) => {
    await loadProduct(context.ownerId, data.product_id);
    await savePage(context.ownerId, data.product_id, data.page);
    return { ok: true };
  });

async function savePage(ownerId: string, productId: string, page: z.infer<typeof PageInput>, cdn?: ProductPageData["cdn"]) {
  const prev = await loadPage(productId);
  const files = [...page.testimonials, ...page.finals];
  for (const t of files) {
    if (!t.path.startsWith(pagesPrefix(ownerId, productId))) throw new Error("Caminho inválido");
  }
  // Foto de depoimento / imagem final tirada da lista sai também do armazenamento.
  const removed = [...(prev?.testimonials ?? []), ...(prev?.finals ?? [])].filter((t) => !files.some((x) => x.id === t.id));
  if (removed.length) await supabaseAdmin.storage.from(PRODUCTION_BUCKET).remove(removed.map((t) => t.path));
  const { error } = await supabaseAdmin.from("product_pages").upsert({
    product_id: productId, user_id: ownerId, data: { ...page, cdn: cdn ?? prev?.cdn ?? {} },
  }, { onConflict: "product_id" });
  if (error) throw new Error(error.message);
  await syncMainImage(productId, page.carousel_ids);
}

// A 1ª imagem do carrossel (vídeo não conta) é a principal do produto.
async function syncMainImage(productId: string, carouselIds: string[]) {
  const { data: imgs } = await supabaseAdmin.from("product_images").select("id,file_url,mime_type,is_main").eq("product_id", productId);
  const byId = new Map((imgs ?? []).map((i) => [i.id, i]));
  const first = carouselIds.map((id) => byId.get(id)).find((i) => i && !isVideoMime(i.mime_type));
  if (!first || first.is_main) return;
  await supabaseAdmin.from("product_images").update({ is_main: false }).eq("product_id", productId);
  await supabaseAdmin.from("product_images").update({ is_main: true }).eq("id", first.id);
  await supabaseAdmin.from("products").update({ main_image_url: first.file_url }).eq("id", productId);
}

export const createTestimonialUpload = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductIdInput.extend({ name: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    await loadProduct(context.ownerId, data.product_id);
    const id = crypto.randomUUID();
    const path = `${pagesPrefix(context.ownerId, data.product_id)}${id}-${safeFileName(data.name)}`;
    const { data: signed, error } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível preparar o envio");
    const { data: view } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).createSignedUrl(path, 60 * 60);
    return { id, path, token: signed.token, viewUrl: view?.signedUrl ?? null };
  });

// Salva, sobe nos Arquivos da Shopify (da loja escolhida) só as imagens que
// ainda não foram, monta o .pagefly e devolve em base64 pra baixar.
export const generatePagefly = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => ProductIdInput.extend({ page: PageInput }).parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    await loadProduct(ownerId, data.product_id);
    const page = data.page;
    if (!page.store_id) throw new Error("Escolha a loja onde as imagens vão ser guardadas.");
    if (page.carousel_ids.length === 0) throw new Error("Escolha pelo menos uma imagem pro carrossel.");

    const { data: store } = await supabaseAdmin.from("shopify_stores").select("shop_domain,access_token")
      .eq("id", page.store_id).eq("user_id", ownerId).maybeSingle();
    if (!store?.shop_domain || !store.access_token) throw new Error("Loja sem conexão com a Shopify.");

    const prev = await loadPage(data.product_id);
    const cdn = { ...(prev?.cdn ?? {}) };
    const done: Record<string, CdnImage> = { ...(cdn[page.store_id] ?? {}) };

    // O que precisa estar no CDN: imagens do produto (carrossel/finais) e depoimentos.
    // Imagens finais: as enviadas na aba; sem nenhuma, as escolhidas antes entre as imagens do produto.
    const legacyFinals = page.finals.length ? [] : page.final_ids;
    const imgIds = [...new Set([...page.carousel_ids, ...legacyFinals])];
    const { data: imgs } = await supabaseAdmin.from("product_images").select("id,file_path,file_name,mime_type")
      .eq("product_id", data.product_id).in("id", imgIds.length ? imgIds : ["00000000-0000-0000-0000-000000000000"]);
    const sources: { key: string; url: string; name: string }[] = [];
    const videos: { key: string; blob: Blob; name: string; mime: string }[] = [];
    for (const img of imgs ?? []) {
      const key = `img:${img.id}`;
      if (done[key]) continue;
      if (isVideoMime(img.mime_type)) {
        const { data: blob } = await supabaseAdmin.storage.from("project-attachments").download(img.file_path);
        if (blob) videos.push({ key, blob, name: img.file_name ?? "video.mp4", mime: img.mime_type! });
        continue;
      }
      const { data: s } = await supabaseAdmin.storage.from("project-attachments").createSignedUrl(img.file_path, 60 * 60);
      if (s?.signedUrl) sources.push({ key, url: s.signedUrl, name: img.file_name ?? "imagem" });
    }
    // Recomendados: foto principal de cada produto também vai pro CDN da loja.
    const recIds = page.recs.map((r) => r.product_id);
    const none = ["00000000-0000-0000-0000-000000000000"];
    const [recProducts, recListings, recImages] = await Promise.all([
      supabaseAdmin.from("products").select("id,name,sale_price").eq("user_id", ownerId).in("id", recIds.length ? recIds : none),
      supabaseAdmin.from("product_shopify_listings").select("product_id,data").in("product_id", recIds.length ? recIds : none),
      supabaseAdmin.from("product_images").select("id,product_id,file_path,file_name").eq("is_main", true).in("product_id", recIds.length ? recIds : none),
    ]);
    const recImageByProduct = new Map((recImages.data ?? []).map((i) => [i.product_id, i]));
    for (const img of recImages.data ?? []) {
      const key = `img:${img.id}`;
      if (done[key]) continue;
      const { data: s } = await supabaseAdmin.storage.from("project-attachments").createSignedUrl(img.file_path, 60 * 60);
      if (s?.signedUrl) sources.push({ key, url: s.signedUrl, name: img.file_name ?? "imagem" });
    }
    for (const [prefix, list] of [["t", page.testimonials], ["f", page.finals]] as const) {
      for (const t of list) {
        const key = `${prefix}:${t.id}`;
        if (done[key]) continue;
        const { data: s } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).createSignedUrl(t.path, 60 * 60);
        if (s?.signedUrl) sources.push({ key, url: s.signedUrl, name: t.name });
      }
    }
    const shop = { shop_domain: store.shop_domain, access_token: store.access_token };
    Object.assign(done, await uploadToShopifyFiles(shop, sources));
    Object.assign(done, await uploadVideosToShopifyFiles(shop, videos));
    cdn[page.store_id] = done;
    await savePage(ownerId, data.product_id, page, cdn);

    const pick = (keys: string[]) => keys.map((k) => done[k]).filter(Boolean);
    const num = (v: unknown) => { const n = Number(String(v ?? "").replace(",", ".")); return n > 0 ? n : null; };
    const productById = new Map((recProducts.data ?? []).map((p) => [p.id, p]));
    const listingById = new Map((recListings.data ?? []).map((l) => [l.product_id, (l.data ?? {}) as any]));
    const recs: RecCard[] = page.recs.flatMap((r) => {
      const p = productById.get(r.product_id);
      if (!p) return [];
      const l = listingById.get(r.product_id) ?? {};
      const img = recImageByProduct.get(r.product_id);
      return [{
        link: r.link,
        name: (l.title_matriz || p.name) as string,
        image: img ? done[`img:${img.id}`]?.url ?? null : null,
        price: num(l.price) ?? num(l.variants?.[0]?.price) ?? num(p.sale_price),
        compare: num(l.compare_at_price) ?? num(l.variants?.[0]?.compare_at_price),
      }];
    });
    const { tpl } = await loadTemplate(ownerId);
    const built = buildPagefly(tpl, { ...emptyPage(), ...page, cdn }, {
      carousel: pick(page.carousel_ids.map((id) => `img:${id}`)),
      testimonials: pick(page.testimonials.map((t) => `t:${t.id}`)),
      finals: page.finals.length ? pick(page.finals.map((f) => `f:${f.id}`)) : pick(legacyFinals.map((id) => `img:${id}`)),
      recs,
    });
    return { fileName: built.fileName, base64: Buffer.from(built.bytes).toString("base64"), warnings: built.warnings, uploaded: sources.length + videos.length };
  });

// ── Modelo .pagefly ──

export const createTemplateUpload = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const path = `${context.ownerId}/pagefly/upload-${crypto.randomUUID()}.pagefly`;
    const { data: signed, error } = await supabaseAdmin.storage.from(PRODUCTION_BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível preparar o envio");
    return { path, token: signed.token };
  });

// Confere o arquivo enviado e, se der pra achar os blocos, vira o modelo do
// workspace (o anterior é substituído). Arquivo inválido é descartado.
export const activateTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ path: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const ownerId = context.ownerId;
    if (!data.path.startsWith(`${ownerId}/pagefly/upload-`)) throw new Error("Caminho inválido");
    const bucket = supabaseAdmin.storage.from(PRODUCTION_BUCKET);
    const { data: file, error } = await bucket.download(data.path);
    if (error || !file) throw new Error("Arquivo não encontrado — envie de novo.");
    let tpl: PageTemplate;
    try {
      tpl = parsePageflyZip(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      await bucket.remove([data.path]);
      throw e;
    }
    const preview = templatePreview(tpl);
    if (!tpl.targets.mainImage && !tpl.targets.button && !tpl.targets.title) {
      await bucket.remove([data.path]);
      throw new Error("Não achei nesse arquivo nenhum dos blocos da página (carrossel, botão, títulos). Confira se é a página certa.");
    }
    await bucket.remove([templatePath(ownerId)]);
    const { error: moveErr } = await bucket.move(data.path, templatePath(ownerId));
    if (moveErr) throw new Error(moveErr.message);
    return { custom: true, ...preview };
  });

export const resetTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    await supabaseAdmin.storage.from(PRODUCTION_BUCKET).remove([templatePath(context.ownerId)]);
    return { custom: false, ...templatePreview(builtInTemplate()) };
  });

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import type { ShopifyListing, StoreRole } from "@/lib/product-shopify";

const API = "2026-07";

async function gql(domain: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetchWithRetry(`https://${domain}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  // Criar produto não é idempotente: sem nova tentativa, só tempo limite.
  }, { retries: 0 });
  if (res.status === 401 || res.status === 403) throw new Error("Loja sem permissão — reconecte com os escopos novos (write_products, write_inventory, write_publications, read_locations).");
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  if (json.errors) {
    const msg = JSON.stringify(json.errors);
    if (/access denied|ACCESS_DENIED/i.test(msg)) throw new Error("Loja sem permissão — reconecte com os escopos novos (write_products, write_inventory, write_publications, read_locations).");
    throw new Error(`Shopify: ${msg.slice(0, 300)}`);
  }
  return json.data;
}

const SETUP = `query {
  locations(first: 50) { nodes { id name isActive fulfillmentService { serviceName handle } } }
  publications(first: 25) { nodes { id name } }
}`;

const PRODUCT_SET = `mutation($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) {
    product { id handle variants(first: 100) { nodes { id inventoryItem { id } } } }
    userErrors { field message }
  }
}`;

const ACTIVATE = `mutation($item: ID!, $loc: ID!) {
  inventoryActivate(inventoryItemId: $item, locationId: $loc) { userErrors { message } }
}`;

const PUBLISH = `mutation($id: ID!, $pub: ID!) {
  publishablePublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { message } }
}`;

const money = (v: string) => {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
};

export type PublishResult = { productId: string; handle: string; warnings: string[] };

// Cria o produto na loja: Ativo, estoque no local do endereço da loja,
// disponível no local da Aprodrop (estoque controlado pelo app), continuar
// vendendo sem estoque, publicado na loja online.
export async function createProductInStore(
  store: { shop_domain: string; access_token: string },
  listing: ShopifyListing,
  role: StoreRole,
  imageUrls: string[],
): Promise<PublishResult> {
  const { shop_domain: domain, access_token: token } = store;
  const warnings: string[] = [];

  const setup = await gql(domain, token, SETUP);
  const locations = ((setup.locations?.nodes ?? []) as any[]).filter((l) => l.isActive);
  const storeLoc = locations.find((l) => !l.fulfillmentService);
  const aprodropLoc = locations.find((l) => /aprodrop/i.test(`${l.name} ${l.fulfillmentService?.serviceName ?? ""} ${l.fulfillmentService?.handle ?? ""}`));
  const onlineStore = ((setup.publications?.nodes ?? []) as any[]).find((p) => /online store|loja virtual|loja online/i.test(p.name ?? ""));
  if (!storeLoc) warnings.push("Local do endereço da loja não encontrado — estoque não foi lançado.");
  if (!aprodropLoc) warnings.push("Local da Aprodrop não encontrado nesta loja.");

  const title = (role === "subloja" && listing.title_subloja.trim()) || listing.title_matriz.trim();
  const basePrice = money(listing.price);
  if (!basePrice) throw new Error("Preço do produto não preenchido.");
  const baseCompare = money(listing.compare_at_price);
  const weight = listing.weight_grams && listing.weight_grams > 0 ? { weight: { value: listing.weight_grams, unit: "GRAMS" } } : undefined;

  const options = listing.options.filter((o) => o.name.trim() && o.values.length > 0);
  const productOptions = options.length > 0
    ? options.map((o) => ({ name: o.name.trim(), values: o.values.map((v) => ({ name: v })) }))
    : [{ name: "Title", values: [{ name: "Default Title" }] }];
  const rows = options.length > 0
    ? listing.variants.map((v) => ({
        optionValues: v.values.map((name, i) => ({ optionName: options[i].name.trim(), name })),
        price: money(v.price) ?? basePrice,
        compareAtPrice: money(v.compare_at_price) ?? baseCompare,
        sku: v.sku.trim() || null,
        inventory: v.inventory,
      }))
    : [{
        optionValues: [{ optionName: "Title", name: "Default Title" }],
        price: basePrice, compareAtPrice: baseCompare, sku: listing.sku.trim() || null, inventory: listing.inventory,
      }];

  const input: Record<string, unknown> = {
    title,
    descriptionHtml: listing.description_html,
    status: "ACTIVE",
    productOptions,
    variants: rows.map((r) => ({
      optionValues: r.optionValues,
      price: r.price,
      ...(r.compareAtPrice ? { compareAtPrice: r.compareAtPrice } : {}),
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: true, ...(r.sku ? { sku: r.sku } : {}), ...(weight ? { measurement: weight } : {}) },
      ...(storeLoc ? { inventoryQuantities: [{ locationId: storeLoc.id, name: "available", quantity: Math.max(0, Math.round(r.inventory || 0)) }] } : {}),
    })),
    ...(imageUrls.length > 0 ? { files: imageUrls.map((url) => ({ originalSource: url, contentType: "IMAGE" })) } : {}),
    ...(listing.handle.trim() ? { handle: listing.handle.trim() } : {}),
    ...(listing.seo_title.trim() || listing.seo_description.trim()
      ? { seo: { title: listing.seo_title.trim() || null, description: listing.seo_description.trim() || null } }
      : {}),
  };

  const created = await gql(domain, token, PRODUCT_SET, { input });
  const errors = (created.productSet?.userErrors ?? []) as { message: string }[];
  const product = created.productSet?.product;
  if (errors.length > 0 || !product) throw new Error(errors.map((e) => e.message).join("; ") || "A Shopify não criou o produto.");

  // Daqui pra frente o produto já existe: falha vira aviso, não erro.
  if (aprodropLoc) {
    for (const v of (product.variants?.nodes ?? []) as any[]) {
      try {
        const r = await gql(domain, token, ACTIVATE, { item: v.inventoryItem.id, loc: aprodropLoc.id });
        const errs = (r.inventoryActivate?.userErrors ?? []) as { message: string }[];
        if (errs.length > 0) { warnings.push(`Aprodrop: ${errs[0].message}`); break; }
      } catch (e: any) {
        warnings.push(`Aprodrop: ${e.message}`);
        break;
      }
    }
  }
  if (onlineStore) {
    try {
      const r = await gql(domain, token, PUBLISH, { id: product.id, pub: onlineStore.id });
      const errs = (r.publishablePublish?.userErrors ?? []) as { message: string }[];
      if (errs.length > 0) warnings.push(`Loja online: ${errs[0].message}`);
    } catch (e: any) {
      warnings.push(`Loja online: ${e.message}`);
    }
  } else {
    warnings.push("Canal Loja online não encontrado — produto criado, mas não publicado.");
  }

  return { productId: String(product.id).split("/").pop()!, handle: product.handle, warnings };
}

// Links temporários das imagens escolhidas pra Shopify baixar. Quem chama já
// conferiu que o produto é do workspace.
export async function signedImageUrls(productId: string, imageIds: string[]): Promise<string[]> {
  if (imageIds.length === 0) return [];
  const { data } = await supabaseAdmin.from("product_images").select("id,file_path")
    .eq("product_id", productId).in("id", imageIds);
  const byId = new Map((data ?? []).map((r) => [r.id, r.file_path as string]));
  const urls: string[] = [];
  for (const id of imageIds) {
    const path = byId.get(id);
    if (!path) continue;
    const { data: signed } = await supabaseAdmin.storage.from("project-attachments").createSignedUrl(path, 60 * 60);
    if (signed?.signedUrl) urls.push(signed.signedUrl);
  }
  return urls;
}

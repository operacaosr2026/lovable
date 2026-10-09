import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { UPDATE_PART_LABELS, variantSku, type ShopifyListing, type StoreRole, type UpdatePart } from "@/lib/product-shopify";

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

// includeLegacy: sem ele a Shopify esconde o local de app de fulfillment
// antigo (ex.: "Aprodrop Fulfillment").
const SETUP = `query {
  locations(first: 50, includeLegacy: true) { nodes { id name isActive fulfillmentService { serviceName handle } } }
  publications(first: 25) { nodes { id name } }
}`;

const PRODUCT_SET = `mutation($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) {
    product { id handle variants(first: 100) { nodes { id inventoryItem { id } } } }
    userErrors { field message }
  }
}`;

// Mutações de estoque exigem @idempotent (chave única por chamada) desde a
// API 2026-07.
const ACTIVATE = `mutation($item: ID!, $loc: ID!, $key: String!) {
  inventoryActivate(inventoryItemId: $item, locationId: $loc) @idempotent(key: $key) { userErrors { message } }
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

  const options = listing.options.filter((o) => o.name.trim() && o.values.length > 0);
  const productOptions = options.length > 0
    ? options.map((o) => ({ name: o.name.trim(), values: o.values.map((v) => ({ name: v })) }))
    : [{ name: "Title", values: [{ name: "Default Title" }] }];
  const rows = options.length > 0
    ? listing.variants.map((v) => ({
        optionValues: v.values.map((name, i) => ({ optionName: options[i].name.trim(), name })),
        price: money(v.price) ?? basePrice,
        compareAtPrice: money(v.compare_at_price) ?? baseCompare,
        sku: v.sku.trim() || variantSku(listing.sku, v.values) || null,
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
      inventoryItem: { tracked: true, ...(r.sku ? { sku: r.sku } : {}) },
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
        const r = await gql(domain, token, ACTIVATE, { item: v.inventoryItem.id, loc: aprodropLoc.id, key: crypto.randomUUID() });
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

// O produto criado ainda existe na loja? false = apagado na Shopify;
// null = não deu pra conferir (aí trata como existente, pra nunca duplicar).
export async function productExistsInStore(
  store: { shop_domain: string; access_token: string }, shopifyProductId: string,
): Promise<boolean | null> {
  try {
    const data = await gql(store.shop_domain, store.access_token, `query($id: ID!) { product(id: $id) { id } }`, {
      id: `gid://shopify/Product/${shopifyProductId}`,
    });
    return !!data.product;
  } catch {
    return null;
  }
}

// ── Atualizar produto já criado (só as partes escolhidas) ──

const GET_PRODUCT = `query($id: ID!) {
  product(id: $id) { id variants(first: 100) { nodes { id selectedOptions { name value } inventoryItem { id } } } }
}`;
const PRODUCT_UPDATE = `mutation($product: ProductUpdateInput!) {
  productUpdate(product: $product) { userErrors { message } }
}`;
const VARIANTS_UPDATE = `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } }
}`;
const SET_QUANTITIES = `mutation($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { message } }
}`;

const firstError = (errs: { message: string }[] | undefined) => (errs && errs.length > 0 ? errs[0].message : null);

const GET_OPTIONS = `query($id: ID!) {
  product(id: $id) {
    options { id name position optionValues { id name hasVariants } }
    variants(first: 250) { nodes { id selectedOptions { name value } } }
  }
}`;
const OPTION_UPDATE = `mutation($productId: ID!, $option: OptionUpdateInput!, $update: [OptionValueUpdateInput!]) {
  productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $update, variantStrategy: LEAVE_AS_IS) { userErrors { message } }
}`;
const BULK_CREATE = `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) { productVariants { id } userErrors { message } }
}`;
const BULK_DELETE = `mutation($productId: ID!, $ids: [ID!]!) {
  productVariantsBulkDelete(productId: $productId, variantsIds: $ids) { userErrors { message } }
}`;

// Deixa a grade da Shopify igual à da ficha, sem recriar o que já existe:
// valor renomeado continua a mesma variante (casa pela posição entre os que
// mudaram), valor novo vira variante nova, valor que saiu da ficha apaga a
// variante. Mudar o número de opções (ex.: Size → Size + Cor) não entra.
// Devolve os ids das variantes criadas (precisam de estoque e Aprodrop).
async function syncVariants(domain: string, token: string, gid: string, listing: ShopifyListing, warnings: string[]): Promise<string[] | null> {
  const options = listing.options.filter((o) => o.name.trim() && o.values.length > 0);
  const data = await gql(domain, token, GET_OPTIONS, { id: gid });
  const shopOptions = ((data.product?.options ?? []) as { id: string; name: string; position: number; optionValues: { id: string; name: string; hasVariants: boolean }[] }[])
    .sort((a, b) => a.position - b.position);
  const isDefault = shopOptions.length === 1 && shopOptions[0].name === "Title";
  if (options.length === 0 && isDefault) return [];
  if (options.length !== shopOptions.length || isDefault) {
    warnings.push(`Variantes: a loja tem ${isDefault ? 0 : shopOptions.length} opção(ões) e a ficha ${options.length} — mudar o número de opções não é atualizado (apague e crie de novo).`);
    return null;
  }

  // 1) Renomeia opções e valores.
  for (let i = 0; i < options.length; i++) {
    const so = shopOptions[i];
    const want = options[i].values;
    const have = so.optionValues.filter((v) => v.hasVariants);
    const shopOnly = have.filter((v) => !want.includes(v.name));
    const sheetOnly = want.filter((v) => !have.some((h) => h.name === v));
    const renames = shopOnly.slice(0, sheetOnly.length).map((v, k) => ({ id: v.id, name: sheetOnly[k] }));
    const rename = options[i].name.trim() !== so.name;
    if (renames.length === 0 && !rename) continue;
    const r = await gql(domain, token, OPTION_UPDATE, {
      productId: gid,
      option: { id: so.id, ...(rename ? { name: options[i].name.trim() } : {}) },
      update: renames.length ? renames : null,
    });
    const err = firstError(r.productOptionUpdate?.userErrors);
    if (err) { warnings.push(`Variantes: ${err}`); return null; }
  }

  // 2) Cria as combinações que faltam e 3) apaga as que saíram da ficha.
  const after = await gql(domain, token, GET_OPTIONS, { id: gid });
  const nodes = (after.product?.variants?.nodes ?? []) as { id: string; selectedOptions: { name: string; value: string }[] }[];
  const keyOf = (v: (typeof nodes)[number]) => v.selectedOptions.map((o) => o.value).join(" / ");
  const shopKeys = new Map(nodes.map((v) => [keyOf(v), v.id]));
  const sheetKeys = new Set(listing.variants.map((v) => v.values.join(" / ")));
  const basePrice = money(listing.price);
  const baseCompare = money(listing.compare_at_price);

  const toCreate = listing.variants.filter((v) => !shopKeys.has(v.values.join(" / ")));
  let created: string[] = [];
  if (toCreate.length > 0) {
    if (!basePrice) { warnings.push("Variantes: preço do produto não preenchido — variantes novas não criadas."); return null; }
    const r = await gql(domain, token, BULK_CREATE, {
      productId: gid,
      variants: toCreate.map((v) => {
        const sku = v.sku.trim() || variantSku(listing.sku, v.values);
        const compare = money(v.compare_at_price) ?? baseCompare;
        return {
          optionValues: v.values.map((name, i) => ({ optionName: options[i].name.trim(), name })),
          price: money(v.price) ?? basePrice,
          ...(compare ? { compareAtPrice: compare } : {}),
          inventoryPolicy: "CONTINUE",
          inventoryItem: { tracked: true, ...(sku ? { sku } : {}) },
        };
      }),
    });
    const err = firstError(r.productVariantsBulkCreate?.userErrors);
    if (err) { warnings.push(`Variantes: ${err}`); return null; }
    created = ((r.productVariantsBulkCreate?.productVariants ?? []) as { id: string }[]).map((v) => v.id);
  }

  const toDelete = [...shopKeys.entries()].filter(([k]) => !sheetKeys.has(k)).map(([, id]) => id);
  if (toDelete.length > 0) {
    const r = await gql(domain, token, BULK_DELETE, { productId: gid, ids: toDelete });
    const err = firstError(r.productVariantsBulkDelete?.userErrors);
    if (err) warnings.push(`Variantes: ${err}`);
  }
  return created;
}

// Atualiza na loja só o que foi pedido. Variante da Shopify casa com a da
// ficha pelos valores das opções (ex.: "Women / 5"). Cada parte é
// independente: erro numa vira aviso e as outras seguem.
export async function updateProductInStore(
  store: { shop_domain: string; access_token: string },
  shopifyProductId: string,
  listing: ShopifyListing,
  role: StoreRole,
  parts: UpdatePart[],
): Promise<{ done: string[]; warnings: string[] }> {
  const { shop_domain: domain, access_token: token } = store;
  const gid = `gid://shopify/Product/${shopifyProductId}`;
  const done: string[] = [];
  const warnings: string[] = [];
  const want = new Set(parts);

  // Variantes primeiro: o resto (preço, SKU, estoque, Aprodrop) já usa a grade nova.
  let createdVariants: string[] = [];
  if (want.has("variantes")) {
    try {
      const created = await syncVariants(domain, token, gid, listing, warnings);
      if (created) {
        createdVariants = created;
        done.push(UPDATE_PART_LABELS.variantes);
      }
    } catch (e: any) { warnings.push(`Variantes: ${e.message}`); }
  }

  const data = await gql(domain, token, GET_PRODUCT, { id: gid });
  if (!data.product) throw new Error("Produto não encontrado na loja (foi apagado na Shopify?).");
  const variants = (data.product.variants?.nodes ?? []) as { id: string; selectedOptions: { name: string; value: string }[]; inventoryItem: { id: string } }[];
  const options = listing.options.filter((o) => o.name.trim() && o.values.length > 0);
  const byKey = new Map(listing.variants.map((v) => [v.values.join(" / "), v]));
  const sheetFor = (v: (typeof variants)[number]) =>
    options.length === 0 ? null : byKey.get(v.selectedOptions.filter((o) => o.name !== "Title").map((o) => o.value).join(" / ")) ?? null;

  // Nome, descrição e SEO: um productUpdate só.
  const product: Record<string, unknown> = { id: gid };
  if (want.has("nome")) product.title = (role === "subloja" && listing.title_subloja.trim()) || listing.title_matriz.trim();
  if (want.has("descricao")) product.descriptionHtml = listing.description_html;
  if (want.has("seo")) product.seo = { title: listing.seo_title.trim() || null, description: listing.seo_description.trim() || null };
  if (Object.keys(product).length > 1) {
    try {
      const r = await gql(domain, token, PRODUCT_UPDATE, { product });
      const err = firstError(r.productUpdate?.userErrors);
      if (err) warnings.push(err);
      else done.push(...(["nome", "descricao", "seo"] as const).filter((x) => want.has(x)).map((x) => UPDATE_PART_LABELS[x]));
    } catch (e: any) { warnings.push(e.message); }
  }

  // Preço e SKU: productVariantsBulkUpdate.
  if (want.has("preco") || want.has("sku")) {
    const basePrice = money(listing.price);
    const baseCompare = money(listing.compare_at_price);
    if (want.has("preco") && !basePrice) warnings.push("Preço do produto não preenchido — preço não atualizado.");
    const rows = variants.map((v) => {
      const sheet = sheetFor(v);
      const row: Record<string, unknown> = { id: v.id };
      if (want.has("preco") && basePrice) {
        row.price = (sheet && money(sheet.price)) || basePrice;
        row.compareAtPrice = (sheet && money(sheet.compare_at_price)) || baseCompare;
      }
      if (want.has("sku")) {
        const sku = sheet ? (sheet.sku.trim() || variantSku(listing.sku, sheet.values)) : listing.sku.trim();
        if (sku) row.inventoryItem = { sku };
      }
      return row;
    }).filter((r) => Object.keys(r).length > 1);
    if (rows.length > 0) {
      try {
        const r = await gql(domain, token, VARIANTS_UPDATE, { productId: gid, variants: rows });
        const err = firstError(r.productVariantsBulkUpdate?.userErrors);
        if (err) warnings.push(err);
        else done.push(...(["preco", "sku"] as const).filter((x) => want.has(x)).map((x) => UPDATE_PART_LABELS[x]));
      } catch (e: any) { warnings.push(e.message); }
    }
  }

  // Variante criada agora já ganha estoque e Aprodrop, mesmo sem marcar essas
  // partes — e aí só ela (o estoque das que já existiam não é tocado).
  const fresh = new Set(createdVariants);
  const chose = new Set(parts);
  if (fresh.size > 0) { want.add("estoque"); want.add("aprodrop"); }
  const stockTargets = chose.has("estoque") ? variants : variants.filter((v) => fresh.has(v.id));
  const aprodropTargets = chose.has("aprodrop") ? variants : variants.filter((v) => fresh.has(v.id));

  if (want.has("estoque") || want.has("aprodrop")) {
    const setup = await gql(domain, token, SETUP);
    const locations = ((setup.locations?.nodes ?? []) as any[]).filter((l) => l.isActive);
    const storeLoc = locations.find((l) => !l.fulfillmentService);
    const aprodropLoc = locations.find((l) => /aprodrop/i.test(`${l.name} ${l.fulfillmentService?.serviceName ?? ""} ${l.fulfillmentService?.handle ?? ""}`));

    if (want.has("estoque")) {
      if (!storeLoc) warnings.push("Local do endereço da loja não encontrado — estoque não atualizado.");
      else {
        const quantities = stockTargets.map((v) => {
          const sheet = sheetFor(v);
          return { inventoryItemId: v.inventoryItem.id, locationId: storeLoc.id, quantity: Math.max(0, Math.round((sheet ? sheet.inventory : listing.inventory) || 0)), changeFromQuantity: null };
        });
        try {
          const r = await gql(domain, token, SET_QUANTITIES, { input: { name: "available", reason: "correction", quantities }, key: crypto.randomUUID() });
          const err = firstError(r.inventorySetQuantities?.userErrors);
          if (err) warnings.push(`Estoque: ${err}`); else if (chose.has("estoque")) done.push(UPDATE_PART_LABELS.estoque);
        } catch (e: any) { warnings.push(`Estoque: ${e.message}`); }
      }
    }

    if (want.has("aprodrop")) {
      if (!aprodropLoc) warnings.push("Local da Aprodrop não encontrado nesta loja.");
      else {
        let failed = false;
        for (const v of aprodropTargets) {
          try {
            const r = await gql(domain, token, ACTIVATE, { item: v.inventoryItem.id, loc: aprodropLoc.id, key: crypto.randomUUID() });
            const err = firstError(r.inventoryActivate?.userErrors);
            if (err) { warnings.push(`Aprodrop: ${err}`); failed = true; break; }
          } catch (e: any) { warnings.push(`Aprodrop: ${e.message}`); failed = true; break; }
        }
        if (!failed && chose.has("aprodrop")) done.push(UPDATE_PART_LABELS.aprodrop);
      }
    }
  }

  return { done, warnings };
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

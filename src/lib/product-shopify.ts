// Ficha Shopify do produto (aba "Publicar nas lojas"). Compartilhado entre
// tela e servidor.

export type ShopifyOption = { name: string; values: string[] };
export type ShopifyVariant = {
  // Valores das opções, na ordem de options (ex.: ["Azul", "M"]).
  values: string[];
  price: string;
  compare_at_price: string;
  sku: string;
  inventory: number;
};
export type ShopifyListing = {
  title_matriz: string;
  title_subloja: string;     // vazio = usa o da matriz
  description_html: string;
  image_ids: string[];       // product_images, na ordem
  price: string;
  compare_at_price: string;
  sku: string;
  weight_grams: number | null;
  inventory: number;         // estoque no local do endereço da loja
  options: ShopifyOption[];  // vazio = produto sem variantes
  variants: ShopifyVariant[];
  seo_title: string;
  seo_description: string;
  handle: string;
};

export type StoreRole = "matriz" | "subloja";

export const emptyListing = (name = ""): ShopifyListing => ({
  title_matriz: name, title_subloja: "", description_html: "", image_ids: [],
  price: "", compare_at_price: "", sku: "", weight_grams: null, inventory: 0,
  options: [], variants: [], seo_title: "", seo_description: "", handle: "",
});

// Todas as combinações das opções (Cor × Tamanho...), mantendo preço, SKU e
// estoque das que já existiam.
export function buildVariants(listing: ShopifyListing): ShopifyVariant[] {
  const opts = listing.options.filter((o) => o.name.trim() && o.values.length > 0);
  if (opts.length === 0) return [];
  let combos: string[][] = [[]];
  for (const o of opts) combos = combos.flatMap((c) => o.values.map((v) => [...c, v]));
  const prev = new Map(listing.variants.map((v) => [v.values.join(" / "), v]));
  return combos.map((values) => prev.get(values.join(" / ")) ?? {
    values, price: "", compare_at_price: "", sku: "", inventory: listing.inventory,
  });
}

export const REQUIRED_SCOPES = ["write_products", "write_inventory", "write_publications", "read_locations"];

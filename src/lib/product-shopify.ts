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
  image_ids: string[];       // product_images, na ordem (matriz)
  image_ids_subloja: string[] | null; // null = sublojas usam as da matriz
  price: string;
  compare_at_price: string;
  sku: string;
  weight_grams: number | null;
  inventory: number;         // estoque no local do endereço da loja
  options: ShopifyOption[];  // vazio = produto sem variantes
  variants: ShopifyVariant[];
  // Imagem (product_images) de cada valor da opção de cor, ex.: { Azul: "<id>" }.
  value_images: Record<string, string>;
  seo_title: string;
  seo_description: string;
  handle: string;
};

export type StoreRole = "matriz" | "subloja";

export const emptyListing = (name = ""): ShopifyListing => ({
  title_matriz: name, title_subloja: "", description_html: "", image_ids: [], image_ids_subloja: null,
  price: "", compare_at_price: "", sku: "", weight_grams: null, inventory: 0,
  options: [], variants: [], value_images: {}, seo_title: "", seo_description: "", handle: "",
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

// SKU da variante: SKU base + "-" + valores das opções, na ordem. O "-" só
// separa as partes; o valor vai como está (ex.: "size" + ["4.5W / 3M", "Azul"]
// → "size-4.5W / 3M-Azul").
export function variantSku(baseSku: string, values: string[]): string {
  const base = baseSku.trim();
  if (!base) return "";
  return [base, ...values.map((v) => v.trim())].join("-");
}

// Opção que leva foto por valor: a primeira chamada Cor/Color. Índice nas
// opções preenchidas (mesma ordem de ShopifyVariant.values), ou -1.
export function colorOptionIndex(options: ShopifyOption[]): number {
  return options.filter((o) => o.name.trim() && o.values.length > 0).findIndex((o) => /^(cor|cores|colou?rs?)$/i.test(o.name.trim()));
}

// Imagem da variante pela cor dela.
export function variantImageId(listing: ShopifyListing, values: string[]): string | undefined {
  const i = colorOptionIndex(listing.options);
  return i === -1 ? undefined : listing.value_images[values[i]];
}

export type VariantTemplate = { id: string; name: string; options: ShopifyOption[]; is_default: boolean };

// Partes que dá pra reenviar a um produto já criado na loja.
export const UPDATE_PARTS = ["aprodrop", "nome", "descricao", "variantes", "fotos_cores", "preco", "sku", "estoque", "seo"] as const;
export type UpdatePart = (typeof UPDATE_PARTS)[number];
export const UPDATE_PART_LABELS: Record<UpdatePart, string> = {
  aprodrop: "Disponível na Aprodrop",
  nome: "Nome",
  descricao: "Descrição",
  variantes: "Variantes",
  fotos_cores: "Fotos das cores",
  preco: "Preço",
  sku: "SKU",
  estoque: "Estoque",
  seo: "SEO",
};

export const imagesFor = (listing: ShopifyListing, role: StoreRole) =>
  role === "subloja" && listing.image_ids_subloja ? listing.image_ids_subloja : listing.image_ids;

export const REQUIRED_SCOPES = ["write_products", "write_inventory", "write_publications", "read_locations"];

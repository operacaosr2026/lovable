import { zipSync, strToU8 } from "fflate";
import { fetchWithRetry } from "@/lib/http";
import { TEMPLATE_FILE_NAME, TEMPLATE_IDS, TEMPLATE_JSON } from "@/lib/pagefly/pgvendas2.template";
import { textToHtml, type CdnImage, type ProductPageData } from "@/lib/product-page";

const API = "2026-07";

async function gql(domain: string, token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetchWithRetry(`https://${domain}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  }, { retries: 0 });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  if (json.errors) throw new Error(`Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

const FILE_CREATE = `mutation($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files { id fileStatus ... on MediaImage { image { url width height } } }
    userErrors { message }
  }
}`;
const FILE_STATUS = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on MediaImage { id fileStatus image { url width height } } }
}`;

// Sobe as imagens nos Arquivos da Shopify (a Shopify baixa do link temporário)
// e espera ficarem prontas pra ter o link do CDN. Devolve { chave: imagem }.
export async function uploadToShopifyFiles(
  store: { shop_domain: string; access_token: string },
  sources: { key: string; url: string; name: string }[],
): Promise<Record<string, CdnImage>> {
  const out: Record<string, CdnImage> = {};
  if (sources.length === 0) return out;
  const { shop_domain: domain, access_token: token } = store;

  const created = await gql(domain, token, FILE_CREATE, {
    files: sources.map((s) => ({ originalSource: s.url, contentType: "IMAGE", alt: s.name })),
  });
  const errs = (created.fileCreate?.userErrors ?? []) as { message: string }[];
  if (errs.length > 0) throw new Error(`Arquivos da Shopify: ${errs[0].message}`);
  const files = (created.fileCreate?.files ?? []) as { id: string }[];
  const keyById = new Map(files.map((f, i) => [f.id, sources[i].key]));

  let pending = files.map((f) => f.id);
  for (let attempt = 0; attempt < 30 && pending.length > 0; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 2000));
    const st = await gql(domain, token, FILE_STATUS, { ids: pending });
    for (const n of (st.nodes ?? []) as any[]) {
      if (!n?.id) continue;
      if (n.fileStatus === "READY" && n.image?.url) {
        out[keyById.get(n.id)!] = { url: n.image.url, width: n.image.width ?? null, height: n.image.height ?? null };
        pending = pending.filter((id) => id !== n.id);
      } else if (n.fileStatus === "FAILED") {
        throw new Error("A Shopify não conseguiu processar uma das imagens.");
      }
    }
  }
  if (pending.length > 0) throw new Error("A Shopify demorou pra processar as imagens — tente gerar de novo.");
  return out;
}

type Item = { id: string; type: string; children?: string[]; data?: Record<string, any>; [k: string]: unknown };
type Style = { id: string; [k: string]: unknown };

const setImage = (item: Item | undefined, img: CdnImage) => {
  if (!item?.data) return;
  item.data.src = img.url;
  if (img.width) item.data.naturalWidth = img.width;
  if (img.height) item.data.naturalHeight = img.height;
};

// Deixa o carrossel com `count` slides (tira os que sobram; duplica o último
// com ids novos — bloco e estilo — quando faltam) e devolve, em ordem, a
// imagem de cada slide.
function resizeSlideshow(items: Item[], styles: Style[], slideshowId: string, count: number): Item[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const show = byId.get(slideshowId)!;
  const slides = [...(show.children ?? [])];
  const subtree = (id: string): string[] => [id, ...((byId.get(id)?.children ?? []).flatMap(subtree))];

  while (slides.length > count && slides.length > 0) {
    const gone = new Set(subtree(slides.pop()!));
    for (let i = items.length - 1; i >= 0; i--) if (gone.has(items[i].id)) items.splice(i, 1);
    for (let i = styles.length - 1; i >= 0; i--) if (gone.has(styles[i].id)) styles.splice(i, 1);
  }
  while (slides.length < count && slides.length > 0) {
    const sourceIds = subtree(slides[slides.length - 1]);
    const newId = new Map(sourceIds.map((id) => [id, crypto.randomUUID()]));
    for (const id of sourceIds) {
      const copy = structuredClone(byId.get(id)!) as Item;
      copy.id = newId.get(id)!;
      copy.children = (copy.children ?? []).map((c) => newId.get(c) ?? c);
      if (copy.type === "SlideshowSlide" && copy.data) copy.data.name = `Slide ${slides.length + 2}`;
      items.push(copy);
      byId.set(copy.id, copy);
      const st = styles.find((s) => s.id === id);
      if (st) styles.push({ ...structuredClone(st), id: copy.id });
    }
    slides.push(newId.get(sourceIds[0])!);
  }
  show.children = slides;
  // Imagem de cada slide (primeira imagem da subárvore).
  return slides.map((sid) => subtree(sid).map((id) => byId.get(id)!).find((i) => i.type.startsWith("Image"))!);
}

export function buildPagefly(page: ProductPageData, images: {
  carousel: CdnImage[]; testimonials: CdnImage[]; finals: CdnImage[];
}): { bytes: Uint8Array; fileName: string; warnings: string[] } {
  const doc = JSON.parse(TEMPLATE_JSON) as { items: Item[]; styles: Style[]; [k: string]: unknown };
  const warnings: string[] = [];
  const byId = () => new Map(doc.items.map((i) => [i.id, i]));
  let map = byId();

  // Textos (vazio = mantém o do modelo).
  const texts: [string, string][] = [
    [TEMPLATE_IDS.title, page.title], [TEMPLATE_IDS.text1, page.text1],
    [TEMPLATE_IDS.text2, page.text2], [TEMPLATE_IDS.details, page.details],
  ];
  for (const [id, text] of texts) {
    const item = map.get(id);
    if (item?.data && text.trim()) item.data.value = textToHtml(text);
  }

  // Botão: troca o handle no fim do link.
  const button = map.get(TEMPLATE_IDS.button);
  if (button?.data?.link && page.handle.trim()) {
    const url = new URL(String(button.data.link));
    url.searchParams.set("handle", page.handle.trim());
    button.data.link = url.toString();
  }

  // Carrossel: 1ª = imagem principal; as outras = slides.
  if (images.carousel.length > 0) {
    setImage(map.get(TEMPLATE_IDS.mainImage), images.carousel[0]);
    const rest = images.carousel.slice(1);
    const slideImages = resizeSlideshow(doc.items, doc.styles, TEMPLATE_IDS.gallerySlideshow, rest.length);
    rest.forEach((img, i) => setImage(slideImages[i], img));
    map = byId();
  }

  if (images.testimonials.length > 0) {
    const slideImages = resizeSlideshow(doc.items, doc.styles, TEMPLATE_IDS.testimonialsSlideshow, images.testimonials.length);
    images.testimonials.forEach((img, i) => setImage(slideImages[i], img));
    map = byId();
  }

  images.finals.slice(0, 3).forEach((img, i) => setImage(map.get(TEMPLATE_IDS.finalImages[i]), img));
  if (images.finals.length > 0 && images.finals.length < 3) {
    warnings.push(`Imagens finais: ${images.finals.length} de 3 — as outras ficaram as do modelo.`);
  }

  const base = (page.file_name.trim() || TEMPLATE_FILE_NAME.replace(/\.json$/i, "")).replace(/[\\/:*?"<>|]+/g, "-");
  const bytes = zipSync({ [`${base}.json`]: strToU8(JSON.stringify(doc)) }, { level: 6 });
  return { bytes, fileName: `${base}.pagefly`, warnings };
}

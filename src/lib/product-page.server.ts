import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { fetchWithRetry } from "@/lib/http";
import { TEMPLATE_FILE_NAME, TEMPLATE_JSON } from "@/lib/pagefly/pgvendas2.template";
import { htmlToText, textToHtml, type CdnImage, type ProductPageData } from "@/lib/product-page";

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
type Doc = { items: Item[]; styles: Style[]; [k: string]: unknown };

// Onde ficam, no modelo, os blocos que a aba troca. Achados pelo papel na
// página (não pelo id), pra um modelo exportado de novo do PageFly continuar
// funcionando mesmo com ids novos.
export type TemplateTargets = {
  title: string | null; text1: string | null; text2: string | null; details: string | null;
  button: string | null; mainImage: string | null; gallerySlideshow: string | null;
  testimonialsSlideshow: string | null; finalImages: string[];
};
export type PageTemplate = { doc: Doc; jsonName: string; targets: TemplateTargets };

export const TARGET_LABELS: Record<keyof TemplateTargets, string> = {
  title: "Título (penúltima seção)", text1: "Texto 1 (penúltima seção)", text2: "Texto 2 (penúltima seção)",
  details: 'Acordeão "Product Details"', button: "Botão com handle=", mainImage: "Imagem principal",
  gallerySlideshow: "Carrossel do produto", testimonialsSlideshow: "Carrossel de depoimentos", finalImages: "3 imagens finais",
};

export function findTargets(doc: Doc): TemplateTargets {
  const byId = new Map(doc.items.map((i) => [i.id, i]));
  const subtree = (id: string): Item[] => {
    const it = byId.get(id);
    return it ? [it, ...((it.children ?? []).flatMap(subtree))] : [];
  };
  const isImage = (i: Item) => /^Image\d*$/.test(i.type);
  const isParagraph = (i: Item) => /^Paragraph\d*$/.test(i.type);
  const isHeading = (i: Item) => /^Heading\d*$/.test(i.type);

  const body = doc.items.find((i) => i.type === "Body");
  const all = body ? subtree(body.id) : doc.items;
  const box = all.find((i) => i.type === "ProductBox");
  const inBox = new Set(box ? subtree(box.id).map((i) => i.id) : []);
  const slideshows = all.filter((i) => i.type === "Slideshow");
  const inSlides = new Set(slideshows.flatMap((s) => subtree(s.id).map((i) => i.id)));

  const gallery = slideshows.find((s) => inBox.has(s.id)) ?? null;
  const main = box ? subtree(box.id).find((i) => isImage(i) && !inSlides.has(i.id)) ?? null : null;
  const testimonials = slideshows.find((s) => !inBox.has(s.id)) ?? null;

  const button = all.find((i) => /^ProductATC/.test(i.type) && /handle=/.test(String(i.data?.link ?? "")))
    ?? all.find((i) => /^ProductATC/.test(i.type) && i.data?.action === "link") ?? null;

  let details: Item | null = null;
  for (const w of all.filter((i) => i.type === "Accordion.Content.Wrapper")) {
    const nodes = subtree(w.id);
    const header = nodes.find((n) => n.type === "Accordion.Header");
    if (!/product\s*details/i.test(String(header?.data?.label ?? ""))) continue;
    const content = nodes.find((n) => n.type === "Accordion.Content");
    details = content ? subtree(content.id).find(isParagraph) ?? null : null;
    break;
  }

  // Penúltima seção da página.
  const layout = all.find((i) => i.type === "Layout");
  const sections = (layout?.children ?? []).map((id) => byId.get(id)!).filter((i) => i?.type === "Section");
  const penult = sections.length >= 2 ? subtree(sections[sections.length - 2].id) : [];
  const paragraphs = penult.filter(isParagraph);

  return {
    title: penult.find(isHeading)?.id ?? null,
    text1: paragraphs[0]?.id ?? null,
    text2: paragraphs[1]?.id ?? null,
    details: details?.id ?? null,
    button: button?.id ?? null,
    mainImage: main?.id ?? null,
    gallerySlideshow: gallery?.id ?? null,
    testimonialsSlideshow: testimonials?.id ?? null,
    finalImages: penult.filter((i) => isImage(i) && !inSlides.has(i.id)).slice(0, 3).map((i) => i.id),
  };
}

export const missingTargets = (t: TemplateTargets) =>
  (Object.keys(TARGET_LABELS) as (keyof TemplateTargets)[])
    .filter((k) => (k === "finalImages" ? t.finalImages.length < 3 : !t[k]))
    .map((k) => TARGET_LABELS[k]);

// Lê um .pagefly (ZIP com um JSON). Erro se não for o formato esperado.
export function parsePageflyZip(bytes: Uint8Array): PageTemplate {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error("Não é um arquivo .pagefly válido (esperado um ZIP)."); }
  const jsonName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".json"));
  if (!jsonName) throw new Error("O .pagefly não tem o JSON da página dentro.");
  let doc: Doc;
  try { doc = JSON.parse(strFromU8(files[jsonName])); } catch { throw new Error("O JSON dentro do .pagefly está corrompido."); }
  if (!Array.isArray(doc.items) || !Array.isArray(doc.styles)) throw new Error("O arquivo não parece uma página exportada do PageFly.");
  return { doc, jsonName, targets: findTargets(doc) };
}

export function builtInTemplate(): PageTemplate {
  const doc = JSON.parse(TEMPLATE_JSON) as Doc;
  return { doc, jsonName: TEMPLATE_FILE_NAME, targets: findTargets(doc) };
}

// Textos atuais do modelo, em formato simples (os campos abrem com eles).
export function templateTexts(tpl: PageTemplate) {
  const byId = new Map(tpl.doc.items.map((i) => [i.id, i]));
  const val = (id: string | null) => (id ? htmlToText(String(byId.get(id)?.data?.value ?? "")) : "");
  const t = tpl.targets;
  return { title: val(t.title), text1: val(t.text1), text2: val(t.text2), details: val(t.details) };
}

// Resumo pra tela: o que foi achado no modelo.
export function templatePreview(tpl: PageTemplate) {
  const byId = new Map(tpl.doc.items.map((i) => [i.id, i]));
  const t = tpl.targets;
  const slides = (id: string | null) => (id ? (byId.get(id)?.children ?? []).length : 0);
  return {
    name: tpl.jsonName.replace(/\.json$/i, ""),
    title: t.title ? htmlToText(String(byId.get(t.title)?.data?.value ?? "")) : null,
    carousel: (t.mainImage ? 1 : 0) + slides(t.gallerySlideshow),
    testimonials: slides(t.testimonialsSlideshow),
    finals: t.finalImages.length,
    buttonLink: t.button ? String(byId.get(t.button)?.data?.link ?? "") : null,
    missing: missingTargets(t),
  };
}

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

export function buildPagefly(tpl: PageTemplate, page: ProductPageData, images: {
  carousel: CdnImage[]; testimonials: CdnImage[]; finals: CdnImage[];
}): { bytes: Uint8Array; fileName: string; warnings: string[] } {
  const doc = structuredClone(tpl.doc);
  const t = tpl.targets;
  const warnings: string[] = [];
  const byId = () => new Map(doc.items.map((i) => [i.id, i]));
  let map = byId();

  // Textos (vazio = mantém o do modelo).
  const texts: [string | null, string][] = [[t.title, page.title], [t.text1, page.text1], [t.text2, page.text2], [t.details, page.details]];
  for (const [id, text] of texts) {
    const item = id ? map.get(id) : undefined;
    if (item?.data && text.trim()) item.data.value = textToHtml(text);
  }

  // Botão: troca o handle no fim do link.
  const button = t.button ? map.get(t.button) : undefined;
  if (button?.data?.link && page.handle.trim()) {
    const url = new URL(String(button.data.link));
    url.searchParams.set("handle", page.handle.trim());
    button.data.link = url.toString();
  }

  // Carrossel: 1ª = imagem principal; as outras = slides.
  if (images.carousel.length > 0 && t.mainImage) {
    setImage(map.get(t.mainImage), images.carousel[0]);
    if (t.gallerySlideshow) {
      const rest = images.carousel.slice(1);
      const slideImages = resizeSlideshow(doc.items, doc.styles, t.gallerySlideshow, rest.length);
      rest.forEach((img, i) => setImage(slideImages[i], img));
      map = byId();
    }
  }

  if (images.testimonials.length > 0 && t.testimonialsSlideshow) {
    const slideImages = resizeSlideshow(doc.items, doc.styles, t.testimonialsSlideshow, images.testimonials.length);
    images.testimonials.forEach((img, i) => setImage(slideImages[i], img));
    map = byId();
  }

  images.finals.slice(0, t.finalImages.length).forEach((img, i) => setImage(map.get(t.finalImages[i]), img));
  if (images.finals.length > 0 && images.finals.length < t.finalImages.length) {
    warnings.push(`Imagens finais: ${images.finals.length} de ${t.finalImages.length} — as outras ficaram as do modelo.`);
  }
  const missing = missingTargets(t);
  if (missing.length) warnings.push(`Não achei no modelo (ficou como está): ${missing.join(", ")}.`);

  const base = (page.file_name.trim() || tpl.jsonName.replace(/\.json$/i, "")).replace(/[\\/:*?"<>|]+/g, "-");
  const bytes = zipSync({ [`${base}.json`]: strToU8(JSON.stringify(doc)) }, { level: 6 });
  return { bytes, fileName: `${base}.pagefly`, warnings };
}

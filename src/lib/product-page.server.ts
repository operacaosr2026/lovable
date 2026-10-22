import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { fetchWithRetry } from "@/lib/http";
import { TEMPLATE_FILE_NAME, TEMPLATE_JSON } from "@/lib/pagefly/pgvendas2.template";
import { GALLERY_VIDEO_MARKER, SRX_GALLERY_CODE } from "@/lib/pagefly/srx-gallery";
import { htmlToText, textToHtml, type CdnImage, type PageReview, type PageStory, type ProductPageData } from "@/lib/product-page";

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

const STAGED_UPLOADS = `mutation($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { message }
  }
}`;
const VIDEO_STATUS = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Video { id fileStatus originalSource { url width height } sources { url mimeType height width } } }
}`;

// Vídeo não pode vir de link externo: sobe pro armazenamento temporário da
// Shopify (staged upload) e cria o arquivo. Usa o .mp4 processado (maior
// versão até 1080p) se já estiver pronto; senão o arquivo original, que fica
// no CDN segundos após o envio — sem esperar o processamento.
export async function uploadVideosToShopifyFiles(
  store: { shop_domain: string; access_token: string },
  sources: { key: string; blob: Blob; name: string; mime: string }[],
): Promise<Record<string, CdnImage>> {
  const out: Record<string, CdnImage> = {};
  if (sources.length === 0) return out;
  const { shop_domain: domain, access_token: token } = store;

  const staged = await gql(domain, token, STAGED_UPLOADS, {
    input: sources.map((s) => ({ resource: "VIDEO", filename: s.name, mimeType: s.mime, fileSize: String(s.blob.size), httpMethod: "POST" })),
  });
  const stErrs = (staged.stagedUploadsCreate?.userErrors ?? []) as { message: string }[];
  if (stErrs.length > 0) throw new Error(`Arquivos da Shopify: ${stErrs[0].message}`);
  const targets = (staged.stagedUploadsCreate?.stagedTargets ?? []) as { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];

  for (const [i, target] of targets.entries()) {
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", sources[i].blob, sources[i].name);
    const res = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`Falha ao enviar o vídeo "${sources[i].name}" pra Shopify (${res.status})`);
  }

  const created = await gql(domain, token, FILE_CREATE, {
    files: targets.map((t, i) => ({ originalSource: t.resourceUrl, contentType: "VIDEO", alt: sources[i].name })),
  });
  const errs = (created.fileCreate?.userErrors ?? []) as { message: string }[];
  if (errs.length > 0) throw new Error(`Arquivos da Shopify: ${errs[0].message}`);
  const files = (created.fileCreate?.files ?? []) as { id: string }[];
  const keyById = new Map(files.map((f, i) => [f.id, sources[i].key]));

  let pending = files.map((f) => f.id);
  // Para assim que cada vídeo tiver um link: o processado, se já estiver
  // pronto, ou o original (sai em segundos). Limite de 1 min.
  const original = new Map<string, CdnImage>();
  for (let attempt = 0; attempt < 30 && pending.some((id) => !original.has(id)); attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await gql(domain, token, VIDEO_STATUS, { ids: pending });
    for (const n of (st.nodes ?? []) as any[]) {
      if (!n?.id) continue;
      if (n.fileStatus === "FAILED") throw new Error("A Shopify não conseguiu processar um dos vídeos.");
      if (n.originalSource?.url) original.set(n.id, { url: n.originalSource.url, width: n.originalSource.width ?? null, height: n.originalSource.height ?? null });
      const mp4s = ((n.sources ?? []) as { url: string; mimeType: string; height: number | null; width: number | null }[])
        .filter((v) => v.mimeType === "video/mp4" && v.url)
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
      const best = mp4s.find((v) => (v.height ?? 0) <= 1080) ?? mp4s[mp4s.length - 1];
      if (n.fileStatus === "READY" && best) {
        out[keyById.get(n.id)!] = { url: best.url, width: best.width ?? null, height: best.height ?? null };
        pending = pending.filter((id) => id !== n.id);
      }
    }
  }
  for (const id of pending) {
    const src = original.get(id);
    if (!src) throw new Error("A Shopify ainda não liberou um dos vídeos — tente gerar de novo daqui a pouco.");
    out[keyById.get(id)!] = src;
  }
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
  // Galeria em código (bloco HTML com a lista de links em .srx-gallery-data):
  // quando existe, o carrossel é ela, não o Slideshow do PageFly.
  galleryHtml: string | null;
  testimonialsSlideshow: string | null; finalImages: string[];
  // Blocos em código: depoimentos em texto (#srx-reviews) e produtos recomendados (#srx-recommendations).
  reviewsHtml: string | null; recsHtml: string | null;
  // Carrossel de vídeos (data-srx-stories) e o título da seção dele.
  storiesHtml: string | null; storiesHeading: string | null;
};
export type PageTemplate = { doc: Doc; jsonName: string; targets: TemplateTargets };

const GALLERY_DATA_RE = /(<script[^>]*class=["'][^"']*srx-gallery-data[^"']*["'][^>]*>)([\s\S]*?)(<\/script>)/i;

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

  const galleryHtml = all.find((i) => i.type === "Custom.HTML" && GALLERY_DATA_RE.test(String(i.data?.code ?? ""))) ?? null;
  const gallery = galleryHtml ? null : slideshows.find((s) => inBox.has(s.id)) ?? null;
  // Imagem principal do carrossel antigo: só existe junto com ele (senão
  // pegaria outra imagem do bloco, ex.: a do "As seen on...").
  const main = gallery && box ? subtree(box.id).find((i) => isImage(i) && !inSlides.has(i.id)) ?? null : null;
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

  // Última seção com conteúdo do PageFly (título/texto/imagem) — as seções
  // só com bloco em código (depoimentos, recomendados...) no fim não contam.
  const layout = all.find((i) => i.type === "Layout");
  const sections = (layout?.children ?? []).map((id) => byId.get(id)!).filter((i) => i?.type === "Section");
  const withContent = sections.filter((s) => subtree(s.id).some((i) => isHeading(i) || isParagraph(i) || isImage(i)));
  const penult = withContent.length >= 2 ? subtree(withContent[withContent.length - 1].id) : [];
  const htmlWith = (re: RegExp) => all.find((i) => i.type === "Custom.HTML" && re.test(String(i.data?.code ?? ""))) ?? null;
  const paragraphs = penult.filter(isParagraph);
  const stories = htmlWith(/data-srx-stories/);
  const storiesSection = stories ? sections.find((s) => subtree(s.id).some((i) => i.id === stories.id)) : undefined;

  return {
    title: penult.find(isHeading)?.id ?? null,
    text1: paragraphs[0]?.id ?? null,
    text2: paragraphs[1]?.id ?? null,
    details: details?.id ?? null,
    button: button?.id ?? null,
    mainImage: main?.id ?? null,
    gallerySlideshow: gallery?.id ?? null,
    galleryHtml: galleryHtml?.id ?? null,
    testimonialsSlideshow: testimonials?.id ?? null,
    finalImages: penult.filter((i) => isImage(i) && !inSlides.has(i.id)).slice(0, 3).map((i) => i.id),
    reviewsHtml: htmlWith(/id=["']srx-reviews["']/)?.id ?? null,
    recsHtml: htmlWith(/id=["']srx-recommendations["']/)?.id ?? null,
    storiesHtml: stories?.id ?? null,
    storiesHeading: storiesSection ? subtree(storiesSection.id).find(isHeading)?.id ?? null : null,
  };
}

export function missingTargets(t: TemplateTargets): string[] {
  const out: string[] = [];
  if (!t.galleryHtml && !(t.mainImage && t.gallerySlideshow)) out.push("Carrossel do produto");
  if (!t.details) out.push('Acordeão "Product Details"');
  if (!t.title) out.push("Título (penúltima seção)");
  if (!t.text1) out.push("Texto 1 (penúltima seção)");
  if (!t.text2) out.push("Texto 2 (penúltima seção)");
  if (!t.testimonialsSlideshow) out.push("Carrossel de depoimentos");
  if (t.finalImages.length < 3) out.push("3 imagens finais");
  if (!t.button) out.push("Botão com handle=");
  return out;
}

const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) || /cdn\.shopify\.com\/videos\//i.test(url);

function galleryUrls(code: string): string[] {
  const m = code.match(GALLERY_DATA_RE);
  try { return m ? (JSON.parse(m[2]) as unknown[]).filter((u): u is string => typeof u === "string") : []; } catch { return []; }
}

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

// ── Depoimentos em texto (#srx-reviews) ──

const REVIEW_CARD_RE = /<div class=["']srx-card["'][^>]*data-rating=["']([\d.]+)["'][^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>[\s\S]*?<span class=["']srx-author["']>([\s\S]*?)<\/span>/gi;
const REVIEWS_CAROUSEL_RE = /(<div class=["']srx-carousel["'][^>]*>)[\s\S]*?(<\/div>\s*<button[^>]*class=["'][^"']*srx-next)/i;
const REVIEWS_HEADING_RE = /(<div class=["']srx-reviews-header["'][^>]*>\s*<h2[^>]*>)([\s\S]*?)(<\/h2>)/i;
const REVIEWS_RATING_RE = /(<div class=["']srx-rating["'][^>]*>[\s\S]*?<strong>)([^<]*)(<\/strong>)/i;
const REVIEWS_COUNT_RE = /(<p class=["']srx-review-count["'][^>]*>[\s\S]*?<u>)([^<]*)(<\/u>)/i;
const REVIEWS_MAIN_STARS_RE = /(createStars\(\s*mainStars\s*,\s*)[\d.]+(\s*\))/;

const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const oneLine = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function codeOf(tpl: PageTemplate, id: string | null) {
  return id ? String(tpl.doc.items.find((i) => i.id === id)?.data?.code ?? "") : "";
}

// Depoimentos e título dos recomendados como estão no modelo (o formulário abre com eles).
export function templateBlocks(tpl: PageTemplate) {
  const rev = codeOf(tpl, tpl.targets.reviewsHtml);
  const recs = codeOf(tpl, tpl.targets.recsHtml);
  const reviews: PageReview[] = [...rev.matchAll(REVIEW_CARD_RE)].map((m) => ({
    id: crypto.randomUUID(), rating: Number(m[1]) || 5, title: oneLine(m[2]), text: oneLine(m[3]), author: oneLine(m[4]),
  }));
  return {
    reviews_heading: oneLine(rev.match(REVIEWS_HEADING_RE)?.[2] ?? ""),
    reviews_rating: oneLine(rev.match(REVIEWS_RATING_RE)?.[2] ?? ""),
    reviews_count: oneLine(rev.match(REVIEWS_COUNT_RE)?.[2] ?? ""),
    reviews,
    stories_heading: tpl.targets.storiesHeading ? htmlToText(String(tpl.doc.items.find((i) => i.id === tpl.targets.storiesHeading)?.data?.value ?? "")) : "",
    recs_title: oneLine(recs.match(/<h2 class=["']srx-rec-title["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ""),
  };
}

function buildReviewsCode(code: string, page: ProductPageData): string {
  let out = code;
  if (page.reviews.length > 0) {
    const cards = page.reviews.map((r, i) => `
      <!-- REVIEW ${i + 1} -->
      <div class="srx-card" data-rating="${Math.min(5, Math.max(0, r.rating || 5))}">
        <div>
          <div class="srx-stars"></div>
          <h3>${esc(r.title)}</h3>
          <p>${esc(r.text).replace(/\r?\n/g, "<br>")}</p>
        </div>
        <span class="srx-author">${esc(r.author)}</span>
      </div>
`).join("");
    out = out.replace(REVIEWS_CAROUSEL_RE, (_m, open, close) => `${open}\n${cards}\n    ${close}`);
  }
  if (page.reviews_heading.trim()) out = out.replace(REVIEWS_HEADING_RE, (_m, a, _v, b) => `${a}${esc(page.reviews_heading.trim())}${b}`);
  const rating = Number(page.reviews_rating.replace(",", "."));
  if (rating > 0 && rating <= 5) {
    out = out.replace(REVIEWS_RATING_RE, (_m, a, _v, b) => `${a}${rating}${b}`);
    out = out.replace(REVIEWS_MAIN_STARS_RE, (_m, a, b) => `${a}${rating}${b}`);
  }
  if (page.reviews_count.trim()) out = out.replace(REVIEWS_COUNT_RE, (_m, a, _v, b) => `${a}${esc(page.reviews_count.trim())}${b}`);
  return out;
}

// ── Produtos recomendados (#srx-recommendations) ──

export type RecCard = { link: string; name: string; image: string | null; price: number | null; compare: number | null };

const RECS_TRACK_RE = /(<div class=["']srx-rec-track["'][^>]*>)[\s\S]*?(<\/div>\s*<\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div class=["']srx-rec-navigation)/i;
const money = (n: number) => `$${n.toFixed(2)}`;

function buildRecsCode(code: string, page: ProductPageData, cards: RecCard[]): string {
  let out = code;
  if (page.recs_title.trim()) out = out.replace(/(<h2 class=["']srx-rec-title["'][^>]*>)([\s\S]*?)(<\/h2>)/i, (_m, a, _v, b) => `${a}${esc(page.recs_title.trim())}${b}`);
  if (cards.length === 0) return out;
  const html = cards.map((c, i) => {
    const off = c.price && c.compare && c.compare > c.price ? Math.round((1 - c.price / c.compare) * 100) : 0;
    return `
      <!-- PRODUTO ${i + 1} -->
      <a href="${esc(c.link || "#")}" class="srx-product-card">
        <div class="srx-product-image">
          ${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy">` : ""}
          ${off > 0 ? `<span class="srx-discount">◆ Save ${off}%</span>` : ""}
        </div>
        <div class="srx-product-info">
          <h3>${esc(c.name)}</h3>
          <div class="srx-prices">
            ${c.price ? `<strong>${money(c.price)}</strong>` : ""}
            ${off > 0 ? `<del>${money(c.compare!)}</del>` : ""}
          </div>
        </div>
      </a>
`;
  }).join("");
  out = out.replace(RECS_TRACK_RE, (_m, open, close) => `${open}\n${html}\n    ${close}`);
  return out.replace(/(<span id=["']srxTotal["']>)\d*(<\/span>)/, (_m, a, b) => `${a}${cards.length}${b}`);
}

// ── Vídeos em stories (data-srx-stories) ──

const STORIES_LIST_RE = /(const\s+VIDEOS\s*=\s*)\[[\s\S]*?\];/;

function storiesCount(code: string) {
  return code.match(STORIES_LIST_RE)?.[0].match(/\bvideo\s*:/g)?.length ?? 0;
}

function buildStoriesCode(code: string, stories: PageStory[], urls: (CdnImage | undefined)[]): string {
  const list = stories.flatMap((s, i) => (urls[i] ? [{
    video: urls[i].url, name: s.person.trim(), product: s.product.trim(), link: s.link.trim() || "#", verified: s.verified,
  }] : []));
  if (list.length === 0) return code;
  return code.replace(STORIES_LIST_RE, (_m, open) => `${open}${JSON.stringify(list, null, 2).replace(/</g, "\\u003c").replace(/\n/g, "\n  ")};`);
}

// Ordem das partes editáveis como aparecem na página (o formulário segue).
export type PageSectionKey = "carousel" | "details" | "stories" | "testimonials" | "reviews" | "final" | "recs";
function sectionOrder(tpl: PageTemplate): PageSectionKey[] {
  const t = tpl.targets;
  const byId = new Map(tpl.doc.items.map((i) => [i.id, i]));
  const body = tpl.doc.items.find((i) => i.type === "Body");
  const pos = new Map<string, number>();
  const walk = (id: string) => { pos.set(id, pos.size); for (const c of byId.get(id)?.children ?? []) walk(c); };
  if (body) walk(body.id);
  const anchors: [PageSectionKey, string | null | undefined][] = [
    ["carousel", t.galleryHtml ?? t.mainImage], ["details", t.details], ["stories", t.storiesHtml], ["testimonials", t.testimonialsSlideshow],
    ["reviews", t.reviewsHtml], ["final", t.title ?? t.text1 ?? t.finalImages[0]], ["recs", t.recsHtml],
  ];
  const at = (id: string | null | undefined) => (id && pos.has(id) ? pos.get(id)! : Number.MAX_SAFE_INTEGER);
  return anchors.filter(([k, id]) => id || (k !== "reviews" && k !== "recs" && k !== "stories"))
    .map(([k, id], i) => ({ k, p: at(id), i }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.k);
}

// Resumo pra tela: o que foi achado no modelo.
export function templatePreview(tpl: PageTemplate) {
  const byId = new Map(tpl.doc.items.map((i) => [i.id, i]));
  const t = tpl.targets;
  const slides = (id: string | null) => (id ? (byId.get(id)?.children ?? []).length : 0);
  return {
    name: tpl.jsonName.replace(/\.json$/i, ""),
    title: t.title ? htmlToText(String(byId.get(t.title)?.data?.value ?? "")) : null,
    carousel: t.galleryHtml ? galleryUrls(String(byId.get(t.galleryHtml)?.data?.code ?? "")).length : (t.mainImage ? 1 : 0) + slides(t.gallerySlideshow),
    carouselKind: t.galleryHtml ? "galeria em código" : "carrossel do PageFly",
    testimonials: slides(t.testimonialsSlideshow),
    finals: t.finalImages.length,
    reviews: t.reviewsHtml ? [...codeOf(tpl, t.reviewsHtml).matchAll(REVIEW_CARD_RE)].length : null,
    recs: !!t.recsHtml,
    stories: t.storiesHtml ? storiesCount(codeOf(tpl, t.storiesHtml)) : null,
    order: sectionOrder(tpl),
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
  carousel: CdnImage[]; testimonials: CdnImage[]; finals: CdnImage[]; recs?: RecCard[]; stories?: (CdnImage | undefined)[];
}): { bytes: Uint8Array; fileName: string; warnings: string[] } {
  const doc = structuredClone(tpl.doc);
  const t = tpl.targets;
  const warnings: string[] = [];
  const byId = () => new Map(doc.items.map((i) => [i.id, i]));
  let map = byId();

  // Textos (vazio = mantém o do modelo).
  const texts: [string | null, string][] = [
    [t.title, page.title], [t.text1, page.text1], [t.text2, page.text2], [t.details, page.details], [t.storiesHeading, page.stories_heading],
  ];
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

  // Carrossel. Galeria em código: troca a lista de links (qualquer quantidade;
  // a 1ª é a imagem grande). Carrossel do PageFly: 1ª = imagem principal, as
  // outras = slides.
  // Vídeo só na galeria em código; no carrossel do PageFly fica de fora.
  const galleryItem = t.galleryHtml ? map.get(t.galleryHtml) : undefined;
  const hasVideo = images.carousel.some((i) => isVideoUrl(i.url));
  if (images.carousel.length > 0 && galleryItem?.data) {
    if (hasVideo && !String(galleryItem.data.code).includes(GALLERY_VIDEO_MARKER)) {
      galleryItem.data.code = SRX_GALLERY_CODE;
      warnings.push("O código da galeria foi trocado pela versão que toca vídeo (mesmo visual do PGdeVendas3).");
    }
    const urls = JSON.stringify(images.carousel.map((i) => i.url), null, 4);
    galleryItem.data.code = String(galleryItem.data.code).replace(GALLERY_DATA_RE, (_m, open, _list, close) => `${open}\n  ${urls}\n  ${close}`);
  } else if (images.carousel.length > 0 && t.mainImage) {
    const onlyImages = images.carousel.filter((i) => !isVideoUrl(i.url));
    if (hasVideo) warnings.push("Este modelo usa o carrossel do PageFly, que não aceita vídeo — os vídeos ficaram de fora.");
    if (onlyImages[0]) setImage(map.get(t.mainImage), onlyImages[0]);
    if (t.gallerySlideshow && onlyImages.length > 0) {
      const rest = onlyImages.slice(1);
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
  const reviewsItem = t.reviewsHtml ? map.get(t.reviewsHtml) : undefined;
  if (reviewsItem?.data) reviewsItem.data.code = buildReviewsCode(String(reviewsItem.data.code), page);
  const recsItem = t.recsHtml ? map.get(t.recsHtml) : undefined;
  if (recsItem?.data) recsItem.data.code = buildRecsCode(String(recsItem.data.code), page, images.recs ?? []);
  const storiesItem = t.storiesHtml ? map.get(t.storiesHtml) : undefined;
  if (storiesItem?.data) storiesItem.data.code = buildStoriesCode(String(storiesItem.data.code), page.stories, images.stories ?? []);

  const missing = missingTargets(t);
  if (missing.length) warnings.push(`Não achei no modelo (ficou como está): ${missing.join(", ")}.`);

  const base = (page.file_name.trim() || tpl.jsonName.replace(/\.json$/i, "")).replace(/[\\/:*?"<>|]+/g, "-");
  const bytes = zipSync({ [`${base}.json`]: strToU8(JSON.stringify(doc)) }, { level: 6 });
  return { bytes, fileName: `${base}.pagefly`, warnings };
}

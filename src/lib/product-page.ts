// Aba "Página" do produto (gera o .pagefly). Compartilhado entre tela e servidor.

export type PageTestimonial = { id: string; path: string; name: string };
// Depoimento em texto (bloco srx-reviews do modelo).
export type PageReview = { id: string; title: string; text: string; author: string; rating: number };
// Produto recomendado (bloco srx-recommendations): nome, foto e preço vêm do
// produto na hora de gerar; o link é o do card (editável).
export type PageRec = { product_id: string; link: string };
// Vídeo do carrossel de stories (bloco data-srx-stories): arquivo enviado na
// aba + nome da pessoa, produto, link do "Get product" e selo de verificado.
export type PageStory = PageTestimonial & { person: string; product: string; link: string; verified: boolean };
export type CdnImage = { url: string; width: number | null; height: number | null };

// O carrossel do produto também aceita vídeos: entram na galeria em código,
// mas nunca como imagem principal, imagem final ou foto do produto na Shopify.
export const isVideoMime = (mime: string | null | undefined) => !!mime && mime.startsWith("video/");

export type ProductPageData = {
  store_id: string | null;       // loja onde as imagens sobem (matriz)
  handle: string;                // handle do produto no link do botão
  file_name: string;             // nome do arquivo/página no PageFly
  carousel_ids: string[];        // product_images, na ordem (1ª imagem = principal do produto)
  final_ids: string[];           // antigo: product_images como imagens finais (vale enquanto finals estiver vazio)
  finals: PageTestimonial[];     // imagens finais enviadas na própria aba, até 3
  testimonials: PageTestimonial[];
  title: string;                 // textos em formato simples (Enter = linha, **negrito**)
  text1: string;
  text2: string;
  details: string;
  // Depoimentos em texto: lista vazia = mantém os do modelo.
  reviews_heading: string;
  reviews_rating: string;        // ex.: "4.6"
  reviews_count: string;         // ex.: "1,467"
  reviews: PageReview[];
  // Vídeos (stories): lista vazia = mantém os do modelo.
  stories_heading: string;
  stories: PageStory[];
  // Produtos recomendados: lista vazia = mantém os do modelo.
  recs_title: string;
  recs: PageRec[];
  // Links do CDN já enviados, por loja e origem ("img:<id>" / "t:<id>" / "f:<id>" / "s:<id>").
  cdn: Record<string, Record<string, CdnImage>>;
};

export const emptyPage = (): ProductPageData => ({
  store_id: null, handle: "", file_name: "", carousel_ids: [], final_ids: [], finals: [], testimonials: [],
  title: "", text1: "", text2: "", details: "",
  reviews_heading: "", reviews_rating: "", reviews_count: "", reviews: [], stories_heading: "", stories: [], recs_title: "", recs: [], cdn: {},
});

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Texto simples → HTML do PageFly: Enter vira <br>, **x** vira <strong>x</strong>.
export function textToHtml(text: string): string {
  return escapeHtml(text.trim())
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\r?\n/g, "<br>");
}

// HTML do modelo → texto simples (pra já abrir os campos com o texto atual).
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ── Depoimentos colados de uma vez (texto organizado por uma IA) ──

export type ParsedReviews = { heading?: string; rating?: string; count?: string; reviews: PageReview[] };

const REVIEW_KEYS: Record<string, "heading" | "rating_all" | "count" | "title" | "rating" | "author" | "text"> = {
  section_title: "heading", "título da seção": "heading", "titulo da secao": "heading",
  overall_rating: "rating_all", "nota geral": "rating_all",
  review_count: "count", "avaliações": "count", avaliacoes: "count",
  title: "title", "título": "title", titulo: "title",
  rating: "rating", nota: "rating", stars: "rating", estrelas: "rating",
  author: "author", autor: "author", name: "author", nome: "author",
  text: "text", texto: "text", review: "text", depoimento: "text",
};
const KEY_LINE_RE = /^[\s>*_-]*([A-Za-zÀ-ú_ ]{3,20}?)[\s*_]*:[\s*_]*(.*)$/;

// Blocos separados por "---"; cada linha "CHAVE: valor" (aceita negrito de
// markdown e nomes em português). Linha sem chave continua o campo anterior.
export function parseReviewsText(raw: string): ParsedReviews {
  const out: ParsedReviews = { reviews: [] };
  for (const block of raw.replace(/\r/g, "").split(/^\s*-{3,}\s*$/m)) {
    const fields: Partial<Record<string, string>> = {};
    let last: string | null = null;
    for (const line of block.split("\n")) {
      const m = line.match(KEY_LINE_RE);
      const key = m ? REVIEW_KEYS[m[1].trim().toLowerCase()] : undefined;
      if (key) { last = key; fields[key] = m![2].trim(); }
      else if (last && line.trim()) fields[last] = `${fields[last] ?? ""}\n${line.trim()}`.trim();
    }
    const clean = (s?: string) => (s ?? "").replace(/\*\*/g, "").replace(/^["“]|["”]$/g, "").trim();
    if (fields.heading) out.heading = clean(fields.heading);
    if (fields.rating_all) out.rating = clean(fields.rating_all).replace(",", ".");
    if (fields.count) out.count = clean(fields.count);
    if (fields.text || fields.title) {
      const rating = Number(clean(fields.rating).replace(",", ".").replace(/[^\d.]/g, ""));
      out.reviews.push({
        id: crypto.randomUUID(),
        title: clean(fields.title),
        text: clean(fields.text),
        author: clean(fields.author),
        rating: rating >= 1 && rating <= 5 ? Math.round(rating * 2) / 2 : 5,
      });
    }
  }
  return out;
}

export function reviewsPrompt(productName: string): string {
  return `Organize os depoimentos abaixo no formato EXATO do exemplo, sem nenhum texto antes ou depois e sem markdown.

Regras:
- Um bloco por depoimento, separados por uma linha só com ---
- Idioma: inglês americano, tom natural de cliente real (a página é em inglês).
- TITLE: frase curta (3 a 6 palavras), em minúsculas, resumindo o depoimento.
- RATING: 5, 4.5 ou 4 (use 5 quando não houver nota).
- AUTHOR: primeiro nome, às vezes com a inicial do sobrenome (ex.: Liam H.).
- TEXT: 2 a 4 frases, sem emojis e sem aspas.
- Não invente fatos; só organize e ajuste o que eu mandar. Se eu pedir uma quantidade, gere essa quantidade sobre o produto.
- No topo, antes do primeiro ---, coloque SECTION_TITLE, OVERALL_RATING (entre 4.5 e 4.9) e REVIEW_COUNT (número com vírgula de milhar).

Produto: ${productName || "(nome do produto)"}

Exemplo do formato:
SECTION_TITLE: Our customers say it better than we do!
OVERALL_RATING: 4.6
REVIEW_COUNT: 1,467
---
TITLE: better than I expected honestly
RATING: 5
AUTHOR: Jordan
TEXT: Copped these on a whim and honestly they exceeded expectations. The stitching feels way more premium than I expected. True to size for me.
---
TITLE: size up if you have wide feet
RATING: 4
AUTHOR: Tyler
TEXT: Solid shoe, no complaints on quality. They run a touch narrow so I'd size up half a size if you have wide feet.

Depoimentos:
[cole aqui os depoimentos, ou peça: "gere 8 depoimentos"]`;
}

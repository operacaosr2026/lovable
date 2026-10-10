// Aba "Página" do produto (gera o .pagefly). Compartilhado entre tela e servidor.

export type PageTestimonial = { id: string; path: string; name: string };
export type CdnImage = { url: string; width: number | null; height: number | null };

export type ProductPageData = {
  store_id: string | null;       // loja onde as imagens sobem (matriz)
  handle: string;                // handle do produto no link do botão
  file_name: string;             // nome do arquivo/página no PageFly
  carousel_ids: string[];        // product_images, na ordem (1ª = imagem principal)
  final_ids: string[];           // product_images, até 3
  testimonials: PageTestimonial[];
  title: string;                 // textos em formato simples (Enter = linha, **negrito**)
  text1: string;
  text2: string;
  details: string;
  // Links do CDN já enviados, por loja e origem ("img:<id>" / "t:<id>").
  cdn: Record<string, Record<string, CdnImage>>;
};

export const emptyPage = (): ProductPageData => ({
  store_id: null, handle: "", file_name: "", carousel_ids: [], final_ids: [], testimonials: [],
  title: "", text1: "", text2: "", details: "", cdn: {},
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

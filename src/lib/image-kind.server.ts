import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withAiCredit } from "@/lib/ai-credit.server";

// Banco de imagens: a IA olha a miniatura (400px) e diz se é FOTO tirada pelo
// cliente (tênis, caixa, etiqueta, pé, pacote) ou PRINT (captura de tela,
// e-mail, site, rastreio, recibo, texto). Só foto aparece na grade.

const MODEL = process.env.SUPPORT_AI_MODEL || "claude-haiku-5-5";
const LOW_EFFORT = /haiku-4/.test(MODEL) ? {} : { effort: "low" as const };

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const SYSTEM = `You classify images that customers of an online sneaker/clothing store attached to support e-mails.
Answer "foto" if it is a photograph taken with a camera of something physical: a product, shoe, label, box, package, shipping label on a package, person wearing the item, damage, etc.
Answer "print" if it is a screenshot or digital image: a phone/computer screen capture, e-mail, website, order confirmation, tracking page, receipt, chat, document, text, logo or banner — even if it shows a product picture inside the screen.
Reply with exactly one word: foto or print.`;

export async function imageKind(bucket: string, path: string): Promise<"foto" | "print" | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { data } = await supabaseAdmin.storage.from(bucket)
    .createSignedUrl(path, 600, { transform: { width: 400, height: 400, resize: "contain", quality: 70 } });
  if (!data?.signedUrl) return null;
  const response = await withAiCredit(() => anthropic().messages.create({
    model: MODEL,
    max_tokens: 16,
    system: SYSTEM,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: data.signedUrl } }, { type: "text", text: "foto or print?" }] }],
    output_config: { ...LOW_EFFORT },
  }), "atendimento_imagens");
  const out = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim().toLowerCase();
  return out.startsWith("print") ? "print" : out.startsWith("foto") ? "foto" : null;
}

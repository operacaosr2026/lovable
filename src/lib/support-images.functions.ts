import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SUPPORT_IMAGES_BUCKET } from "@/lib/support-images.server";

// Atendimento › Imagens: lista do banco de imagens dos clientes (mais novas
// primeiro, de 60 em 60), com busca por cliente/assunto/pedido e filtro de loja.

export type SupportImage = {
  id: string; conversationId: string; source: "anexo" | "inline"; fileName: string | null; mime: string | null; size: number;
  customerEmail: string | null; customerName: string | null; subject: string | null; shopId: string | null; sentAt: string;
  url: string | null;
};

const db = (table: string) => (supabaseAdmin as any).from(table);
const PAGE = 60;

export const listSupportImages = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    q: z.string().trim().max(100).default(""),
    shopId: z.string().uuid().nullable().default(null),
    // Cursor "sent_at|id" da última da página anterior (mesmo e-mail = mesmo horário).
    before: z.string().regex(/^[\d\-T:.+Z ]+\|[0-9a-f-]{36}$/i).nullable().default(null),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const ok = context.role === "admin" || (
      context.permissions.some((p) => p.section === "atendimento") && context.permissions.some((p) => p.section === "at_imagens"));
    if (!ok) throw new Error("Sem acesso às Imagens do Atendimento");

    let query = db("support_images")
      .select("id,conversation_id,source,file_name,mime,size,storage_path,customer_email,customer_name,subject,shop_id,sent_at")
      .eq("owner_id", context.ownerId).order("sent_at", { ascending: false }).order("id").limit(PAGE + 1);
    if (data.shopId) query = query.eq("shop_id", data.shopId);
    if (data.before) {
      const [at, id] = data.before.split("|");
      query = query.or(`sent_at.lt."${at}",and(sent_at.eq."${at}",id.gt.${id})`);
    }
    if (data.q) {
      const like = `%${data.q.replace(/[%_,()]/g, " ")}%`;
      query = query.or(`customer_email.ilike.${like},customer_name.ilike.${like},subject.ilike.${like}`);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const page = ((rows ?? []) as any[]).slice(0, PAGE);

    const signed = page.length
      ? (await supabaseAdmin.storage.from(SUPPORT_IMAGES_BUCKET).createSignedUrls(page.map((r) => r.storage_path), 60 * 60)).data ?? []
      : [];
    const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));

    // E-mails de clientes ainda não olhados (histórico entrando aos poucos).
    const { count: pending } = await db("support_messages").select("id", { count: "exact", head: true })
      .eq("owner_id", context.ownerId).eq("direction", "in").is("images_scanned_at", null).lt("images_attempts", 3);

    return {
      items: page.map((r): SupportImage => ({
        id: r.id, conversationId: r.conversation_id, source: r.source, fileName: r.file_name, mime: r.mime, size: r.size,
        customerEmail: r.customer_email, customerName: r.customer_name, subject: r.subject, shopId: r.shop_id, sentAt: r.sent_at,
        url: urlByPath.get(r.storage_path) ?? null,
      })),
      nextBefore: (rows ?? []).length > PAGE ? `${page[page.length - 1].sent_at}|${page[page.length - 1].id}` : null,
      pending: pending ?? 0,
    };
  });

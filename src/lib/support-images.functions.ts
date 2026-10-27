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
  products: string[]; downloadedAt: string | null;
  url: string | null;      // original (Baixar)
  thumb: string | null;    // 400px (grade)
  large: string | null;    // 1400px (foto aberta)
};

const db = (table: string) => (supabaseAdmin as any).from(table);
const PAGE = 60;

export const listSupportImages = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    q: z.string().trim().max(100).default(""),
    shopId: z.string().uuid().nullable().default(null),
    product: z.string().trim().max(300).nullable().default(null),
    downloaded: z.boolean().default(false),   // false = a usar; true = já baixadas
    // Cursor "sent_at|id" da última da página anterior (mesmo e-mail = mesmo horário).
    before: z.string().regex(/^[\d\-T:.+Z ]+\|[0-9a-f-]{36}$/i).nullable().default(null),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertImagesAccess(context);

    let query = db("support_images")
      .select("id,conversation_id,source,file_name,mime,size,storage_path,thumb_path,large_path,customer_email,customer_name,subject,shop_id,sent_at,products,downloaded_at")
      .eq("owner_id", context.ownerId).or("kind.is.null,kind.eq.foto")   // print de tela/e-mail fica de fora
      .order("sent_at", { ascending: false }).order("id").limit(PAGE + 1);
    query = data.downloaded ? query.not("downloaded_at", "is", null) : query.is("downloaded_at", null);
    if (data.shopId) query = query.eq("shop_id", data.shopId);
    if (data.product) query = query.contains("products", [data.product]);
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

    // Foto de celular tem ~1,5 MB: a grade usa as miniaturas feitas quando a
    // foto entrou (400px e 1400px, JPEG). Sem miniatura (HEIC, ou ainda não
    // feita), a tela cai pro original.
    const paths = page.flatMap((r) => [r.storage_path, r.thumb_path, r.large_path].filter(Boolean) as string[]);
    const signed = paths.length
      ? (await supabaseAdmin.storage.from(SUPPORT_IMAGES_BUCKET).createSignedUrls(paths, 60 * 60)).data ?? []
      : [];
    const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
    const urlOf = (p: string | null) => (p ? urlByPath.get(p) ?? null : null);

    // E-mails de clientes ainda não olhados (histórico entrando aos poucos).
    const { count: pending } = await db("support_messages").select("id", { count: "exact", head: true })
      .eq("owner_id", context.ownerId).eq("direction", "in").is("images_scanned_at", null).lt("images_attempts", 3);

    return {
      items: page.map((r): SupportImage => ({
        id: r.id, conversationId: r.conversation_id, source: r.source, fileName: r.file_name, mime: r.mime, size: r.size,
        customerEmail: r.customer_email, customerName: r.customer_name, subject: r.subject, shopId: r.shop_id, sentAt: r.sent_at,
        products: r.products ?? [], downloadedAt: r.downloaded_at,
        url: urlOf(r.storage_path),
        thumb: urlOf(r.thumb_path), large: urlOf(r.large_path),
      })),
      nextBefore: (rows ?? []).length > PAGE ? `${page[page.length - 1].sent_at}|${page[page.length - 1].id}` : null,
      pending: pending ?? 0,
    };
  });

function assertImagesAccess(context: { role: string; permissions: { section: string }[] }) {
  const ok = context.role === "admin" || (
    context.permissions.some((p) => p.section === "atendimento") && context.permissions.some((p) => p.section === "at_imagens"));
  if (!ok) throw new Error("Sem acesso às Imagens do Atendimento");
}

// Produtos das fotos (pro filtro), com quantas fotos a usar e já baixadas.
export const listSupportImageProducts = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertImagesAccess(context);
    const { data, error } = await db("support_images").select("products,downloaded_at")
      .eq("owner_id", context.ownerId).or("kind.is.null,kind.eq.foto");
    if (error) throw new Error(error.message);
    const by = new Map<string, number>();
    let downloaded = 0;
    for (const r of (data ?? []) as { products: string[] | null; downloaded_at: string | null }[]) {
      if (r.downloaded_at) { downloaded++; continue; }
      for (const p of r.products ?? []) by.set(p, (by.get(p) ?? 0) + 1);
    }
    return {
      products: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      downloaded,
    };
  });

// Baixou = já usou a foto: sai da grade (vai pra "Baixadas"). Desfazer volta.
export const setSupportImageDownloaded = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), downloaded: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    assertImagesAccess(context);
    const { error } = await db("support_images")
      .update(data.downloaded ? { downloaded_at: new Date().toISOString(), downloaded_by: context.userId } : { downloaded_at: null, downloaded_by: null })
      .eq("owner_id", context.ownerId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

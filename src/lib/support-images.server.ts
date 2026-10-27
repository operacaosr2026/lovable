import crypto from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dhash, imagePhash, phashDistance, SAME_PHOTO_MAX_DISTANCE } from "@/lib/image-phash.server";
import { makePreviews, type Previews } from "@/lib/image-resize.server";
import { imageKind } from "@/lib/image-kind.server";
import { imageOrderProducts } from "@/lib/support-image-products.server";
import { fetchAttachmentInfo, fetchMessageContent, getZohoAccount, zohoRaw, type ZohoAccount } from "@/lib/zoho-mail.server";

// Banco de imagens do Atendimento: a cada rodada do cron do Zoho, olha os
// e-mails de clientes ainda não vistos (mais novos primeiro — o histórico entra
// aos poucos) e copia as imagens (anexo e coladas no corpo) pro bucket
// support-images. Ícone pequeno (assinatura, logo, pixel) fica de fora; foto
// repetida na mesma conversa entra uma vez só (hash).

export const SUPPORT_IMAGES_BUCKET = "support-images";

const db = (table: string) => (supabaseAdmin as any).from(table);

const PER_RUN = 15;                 // e-mails por rodada (o cron roda a cada 5 min)
const BUDGET_MS = 25_000;
const MIN_BYTES = 5 * 1024;         // menor que isso é ícone de assinatura/logo
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  bmp: "image/bmp", heic: "image/heic", heif: "image/heif",
};
const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

// Mesma regra da tela (EmailFrame): "/mail/ImageDisplay?...&cid=X&f=nome".
const INLINE_SRC = /src="(\/mail\/ImageDisplay\?[^"]*)"/g;
const param = (src: string, k: string) => new URLSearchParams(src.replace(/&amp;/g, "&").split("?")[1] ?? "").get(k) ?? "";

type Msg = { id: string; conversation_id: string; message_id: string; folder_id: string | null; has_attachment: boolean; content_html: string | null; sent_at: string; images_attempts: number };
type Conv = { customer_email: string | null; customer_name: string | null; subject: string | null; shop_id: string | null };

async function download(acc: ZohoAccount, path: string): Promise<Buffer | null> {
  const res = await zohoRaw(acc, path);
  if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
  return Buffer.from(await res.arrayBuffer());
}

// Miniaturas feitas aqui (JPEG/PNG) e guardadas do lado do original — a grade
// não usa o Image Transformations do Supabase (cobrado por imagem acima de
// 100/mês). HEIC e afins: sem miniatura, a tela mostra o original.
function previewsOf(bytes: Uint8Array): Previews | null {
  try { return makePreviews(bytes); }
  catch (e) { console.error("support images previews", e instanceof Error ? e.message : e); return null; }
}

async function uploadPreviews(path: string, pv: Previews) {
  const base = path.replace(/\.[a-z0-9]+$/i, "");
  const thumb = `${base}-400.jpg`, large = `${base}-1400.jpg`;
  const bucket = supabaseAdmin.storage.from(SUPPORT_IMAGES_BUCKET);
  for (const [p, b] of [[thumb, pv.thumb], [large, pv.large]] as const) {
    const up = await bucket.upload(p, b, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(`storage: ${up.error.message}`);
  }
  return { thumb, large };
}

// Fotos que entraram antes das miniaturas: faz as delas aos poucos.
const BACKFILL_PER_RUN = 10;
const BACKFILL_BUDGET_MS = 20_000;

async function backfillPreviews() {
  const { data: rows, error } = await db("support_images").select("id,storage_path")
    .is("thumb_path", null).eq("previews_failed", false)
    .order("sent_at", { ascending: false }).limit(BACKFILL_PER_RUN);
  if (error) throw new Error(error.message);
  const started = Date.now();
  let done = 0, failed = 0;
  for (const r of (rows ?? []) as { id: string; storage_path: string }[]) {
    if (Date.now() - started > BACKFILL_BUDGET_MS) break;
    const { data: blob } = await supabaseAdmin.storage.from(SUPPORT_IMAGES_BUCKET).download(r.storage_path);
    const pv = blob ? previewsOf(new Uint8Array(await blob.arrayBuffer())) : null;
    if (!pv) { await db("support_images").update({ previews_failed: true }).eq("id", r.id); failed++; continue; }
    const saved = await uploadPreviews(r.storage_path, pv);
    // Impressão digital refeita pelo mesmo método das novas (a do Supabase usa
    // outro filtro e dá até ~18 bits de diferença pra mesma foto).
    await db("support_images").update({ thumb_path: saved.thumb, large_path: saved.large, phash: dhash(pv.hashGrid) }).eq("id", r.id);
    done++;
  }
  return { done, failed };
}

async function saveImage(ownerId: string, m: Msg, conv: Conv, source: "anexo" | "inline", ref: string, name: string, bytes: Buffer) {
  if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) return false;
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const { data: dup } = await db("support_images").select("id").eq("conversation_id", m.conversation_id).eq("content_hash", hash).maybeSingle();
  if (dup) return false;
  // iPhone às vezes anexa a mesma foto 2x com metadados diferentes (hash muda,
  // nome e tamanho não): mesmo nome + mesmo tamanho na conversa = repetida.
  if (name) {
    const { data: twin } = await db("support_images").select("id").eq("conversation_id", m.conversation_id)
      .eq("file_name", name).eq("size", bytes.length).limit(1);
    if (twin?.length) return false;
  }
  const ext = extOf(name) || "png";
  const mime = MIME[ext] ?? "image/png";
  const path = `${ownerId}/${m.conversation_id}/${hash.slice(0, 32)}.${ext}`;
  const pv = previewsOf(bytes);
  const up = await supabaseAdmin.storage.from(SUPPORT_IMAGES_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) throw new Error(`storage: ${up.error.message}`);
  // Mesma foto reenviada comprimida / com outro nome (o arquivo muda, a imagem
  // não): compara a impressão digital visual com as da conversa.
  const phash = pv ? dhash(pv.hashGrid) : await imagePhash(SUPPORT_IMAGES_BUCKET, path).catch(() => null);
  if (phash) {
    const { data: seen } = await db("support_images").select("phash").eq("conversation_id", m.conversation_id).not("phash", "is", null);
    if (((seen ?? []) as { phash: string }[]).some((s) => phashDistance(s.phash, phash) <= SAME_PHOTO_MAX_DISTANCE)) {
      await supabaseAdmin.storage.from(SUPPORT_IMAGES_BUCKET).remove([path]);
      return false;
    }
  }
  const saved = pv ? await uploadPreviews(path, pv) : null;
  // Print de tela / e-mail fica guardado, mas fora da grade (só foto aparece).
  const kind = await imageKind(SUPPORT_IMAGES_BUCKET, path, pv?.small).catch(() => null);
  const { orderId, products } = await imageOrderProducts(ownerId, conv.customer_email, conv.subject, m.sent_at)
    .catch(() => ({ orderId: null, products: [] as string[] }));
  const { error } = await db("support_images").insert({
    owner_id: ownerId, conversation_id: m.conversation_id, message_id: m.id, source, ref,
    file_name: name || null, mime, size: bytes.length, content_hash: hash, phash, kind, storage_path: path,
    thumb_path: saved?.thumb ?? null, large_path: saved?.large ?? null, previews_failed: !pv,
    order_id: orderId, products,
    customer_email: conv.customer_email, customer_name: conv.customer_name, subject: conv.subject, shop_id: conv.shop_id,
    sent_at: m.sent_at,
  });
  // Outra rodada salvou a mesma foto ao mesmo tempo: o índice único barra, tudo bem.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
  return !error;
}

async function scanMessage(acc: ZohoAccount, ownerId: string, m: Msg, conv: Conv) {
  let saved = 0;
  const base = `/api/accounts/${acc.account_id}/folders/${m.folder_id}/messages/${m.message_id}`;

  if (m.has_attachment) {
    const atts = await fetchAttachmentInfo(acc, m.folder_id ?? "", m.message_id);
    for (const a of atts) {
      if (!IMG_EXT.test(a.name) || a.size > MAX_BYTES || (a.size && a.size < MIN_BYTES)) continue;
      const bytes = await download(acc, `${base}/attachments/${a.id}`);
      if (bytes && await saveImage(ownerId, m, conv, "anexo", a.id, a.name, bytes)) saved++;
    }
  }

  // O corpo só é buscado quando alguém abre a conversa; aqui busca e guarda
  // (a tela reaproveita).
  let html = m.content_html;
  if (html == null) {
    html = await fetchMessageContent(acc, m.folder_id ?? "", m.message_id);
    await supabaseAdmin.from("support_messages").update({ content_html: html }).eq("id", m.id);
  }
  const cids = [...new Set([...(html ?? "").matchAll(INLINE_SRC)].map((x) => `${param(x[1], "cid")}|${param(x[1], "f")}`))];
  for (const key of cids) {
    const [cid, name] = key.split("|");
    if (!cid) continue;
    if (name && !IMG_EXT.test(name)) continue;
    // Imagem só citada (histórico do iPhone, nossa resposta) dá erro no Zoho —
    // ela entra pela mensagem original.
    const bytes = await download(acc, `${base}/inline?contentId=${encodeURIComponent(cid)}`);
    if (bytes && await saveImage(ownerId, m, conv, "inline", cid, name || `${cid}.png`, bytes)) saved++;
  }
  return saved;
}

export async function collectSupportImages(ownerId: string) {
  const acc = await getZohoAccount(ownerId);
  if (!acc?.refresh_token || !acc.account_id) return { skipped: "not_connected" as const };
  const { data: msgs, error } = await db("support_messages")
    .select("id,conversation_id,message_id,folder_id,has_attachment,content_html,sent_at,images_attempts")
    .eq("owner_id", ownerId).eq("direction", "in").is("images_scanned_at", null).lt("images_attempts", MAX_ATTEMPTS)
    .order("sent_at", { ascending: false }).limit(PER_RUN);
  if (error) throw new Error(error.message);
  if (!msgs?.length) return { scanned: 0, saved: 0 };

  const convIds = [...new Set((msgs as Msg[]).map((m) => m.conversation_id))];
  const { data: convs } = await supabaseAdmin.from("support_conversations")
    .select("id,customer_email,customer_name,subject,shop_id").in("id", convIds);
  const convById = new Map((convs ?? []).map((c) => [c.id, c as Conv]));

  const started = Date.now();
  let scanned = 0, saved = 0, failed = 0;
  for (const m of msgs as Msg[]) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      saved += await scanMessage(acc, ownerId, m, convById.get(m.conversation_id) ?? { customer_email: null, customer_name: null, subject: null, shop_id: null });
      await db("support_messages").update({ images_scanned_at: new Date().toISOString() }).eq("id", m.id);
      scanned++;
    } catch (e) {
      console.error("support images", m.id, e instanceof Error ? e.message : e);
      await db("support_messages").update({ images_attempts: m.images_attempts + 1 }).eq("id", m.id);
      failed++;
    }
  }
  return { scanned, saved, failed };
}

export async function collectAllSupportImages() {
  const { data: accs } = await supabaseAdmin.from("zoho_mail_accounts").select("owner_id");
  const out: Record<string, unknown> = {};
  for (const a of accs ?? []) {
    try { out[a.owner_id] = await collectSupportImages(a.owner_id); }
    catch (e: any) { out[a.owner_id] = { error: String(e?.message ?? e).slice(0, 200) }; }
  }
  try { out.previews = await backfillPreviews(); }
  catch (e: any) { out.previews = { error: String(e?.message ?? e).slice(0, 200) }; }
  return out;
}

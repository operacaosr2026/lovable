import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { supportAiAvailable } from "@/lib/support-ai.server";
import type { Database } from "@/integrations/supabase/types";
import {
  ZOHO_SCOPES, getZohoAccount, resolveAppOrigin, syncZohoMailbox, recomputeConversations,
  fetchMessageContent, fetchAttachmentInfo, markZohoRead, zohoApi, uploadZohoAttachment, sendZohoMail,
} from "@/lib/zoho-mail.server";

// Aba Atendimento: e-mails de clientes do Zoho Mail. Uma conta por workspace.
// Acesso: admin, ou membro com a permissão "atendimento".

export const SUPPORT_STATUSES = ["em_atendimento", "aguardando_cliente", "resolvido"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

type Ctx = { role: "admin" | "member"; ownerId: string; permissions: { section: string }[] };

function assertAccess(ctx: Ctx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "atendimento")) {
    throw new Error("Sem acesso ao Atendimento");
  }
}
function assertAdmin(ctx: Ctx) {
  if (ctx.role !== "admin") throw new Error("Só o administrador pode conectar o Zoho");
}
async function requireAccount(ownerId: string) {
  const acc = await getZohoAccount(ownerId);
  if (!acc?.refresh_token || !acc.account_id) throw new Error("Zoho Mail não conectado");
  return acc;
}

const redirectUri = () => `${resolveAppOrigin()}/api/public/zoho/callback`;

// ─── Conexão ──────────────────────────────────────────────────────────────────

export const getZohoStatus = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAccess(context);
    const acc = await getZohoAccount(context.ownerId);
    return {
      connected: !!acc?.refresh_token && !!acc.account_id,
      email: acc?.email ?? null,
      displayName: acc?.display_name ?? null,
      lastSyncAt: acc?.last_sync_at ?? null,
      lastSyncError: acc?.last_sync_error ?? null,
      mailWebBase: acc?.mail_api_base ?? "https://mail.zoho.com",
      redirectUri: redirectUri(),
      isAdmin: context.role === "admin",
    };
  });

export const startZohoOAuth = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    client_id: z.string().trim().min(5).max(200),
    client_secret: z.string().trim().min(5).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAdmin(context);
    const state = crypto.randomBytes(24).toString("hex");
    await supabaseAdmin.from("zoho_oauth_states").delete().lt("expires_at", new Date().toISOString());
    const { error } = await supabaseAdmin.from("zoho_oauth_states").insert({
      state, owner_id: context.ownerId, client_id: data.client_id, client_secret: data.client_secret,
      redirect_uri: redirectUri(), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    if (error) throw new Error(error.message);
    const qs = new URLSearchParams({
      scope: ZOHO_SCOPES, client_id: data.client_id, response_type: "code", access_type: "offline",
      prompt: "consent", redirect_uri: redirectUri(), state,
    });
    return { url: `https://accounts.zoho.com/oauth/v2/auth?${qs}` };
  });

export const disconnectZoho = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAdmin(context);
    await supabaseAdmin.from("zoho_mail_accounts").delete().eq("owner_id", context.ownerId);
    return { ok: true };
  });

export const syncSupportInbox = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ force: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const acc = await getZohoAccount(context.ownerId);
    if (!acc?.refresh_token) return { skipped: true };
    // Várias abas abertas: no máximo uma sincronização a cada 45s.
    if (!data.force && acc.last_sync_at && Date.now() - new Date(acc.last_sync_at).getTime() < 45_000) return { skipped: true };
    return syncZohoMailbox(context.ownerId);
  });

// ─── Lista + indicadores ──────────────────────────────────────────────────────

export type SupportConversation = {
  id: string; customer_email: string; customer_name: string | null; subject: string | null; summary: string | null;
  last_message_at: string | null; last_inbound_at: string | null; last_outbound_at: string | null;
  message_count: number; unread_count: number; status: SupportStatus; favorite: boolean; tags: string[];
  note: string | null; resolved_at: string | null; ai_tags: string[];
};

const CONV_COLS = "id,customer_email,customer_name,subject,summary,last_message_at,last_inbound_at,last_outbound_at,message_count,unread_count,status,favorite,tags,note,resolved_at,ai_tags";

export const listSupportConversations = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ from: z.string().datetime(), to: z.string().datetime() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { ownerId } = context;
    const [convRes, openRes, msgRes] = await Promise.all([
      selectAll<SupportConversation>(supabaseAdmin.from("support_conversations").select(CONV_COLS)
        .eq("owner_id", ownerId).gte("last_message_at", data.from).lte("last_message_at", data.to)),
      // Status atuais (independem do período): em aberto, aguardando, não lidos.
      selectAll<{ status: string; unread_count: number }>(supabaseAdmin.from("support_conversations")
        .select("status,unread_count").eq("owner_id", ownerId).or("status.neq.resolvido,unread_count.gt.0")),
      selectAll<{ conversation_id: string; direction: string; sent_at: string }>(supabaseAdmin.from("support_messages")
        .select("conversation_id,direction,sent_at").eq("owner_id", ownerId)
        .gte("sent_at", data.from).lte("sent_at", new Date(new Date(data.to).getTime() + 7 * 86_400_000).toISOString())),
    ]);
    if (convRes.error) throw new Error(convRes.error.message);

    const open = openRes.data;
    const to = new Date(data.to).getTime();
    const received = msgRes.data.filter((m) => m.direction === "in" && new Date(m.sent_at).getTime() <= to);

    // Tempo de resposta: da 1ª mensagem do cliente sem resposta até a nossa resposta.
    const byConv = new Map<string, { direction: string; t: number }[]>();
    for (const m of msgRes.data) {
      (byConv.get(m.conversation_id) ?? byConv.set(m.conversation_id, []).get(m.conversation_id)!)
        .push({ direction: m.direction, t: new Date(m.sent_at).getTime() });
    }
    const waits: number[] = [];
    for (const list of byConv.values()) {
      list.sort((a, b) => a.t - b.t);
      let pending: number | null = null;
      for (const m of list) {
        if (m.direction === "in") { if (pending == null) pending = m.t; }
        else if (pending != null) { if (pending <= to) waits.push(m.t - pending); pending = null; }
      }
    }

    const conversations = convRes.data.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
    return {
      conversations,
      kpis: {
        received: received.length,
        unread: open.filter((c) => c.unread_count > 0).length,
        inProgress: open.filter((c) => c.status === "em_atendimento").length,
        waiting: open.filter((c) => c.status === "aguardando_cliente").length,
        resolved: conversations.filter((c) => c.status === "resolvido" && c.resolved_at && c.resolved_at >= data.from && c.resolved_at <= data.to).length,
        avgResponseMs: waits.length ? Math.round(waits.reduce((s, x) => s + x, 0) / waits.length) : null,
        responses: waits.length,
      },
    };
  });

// Busca por pedido: "#4532" ou "4532" → e-mails dos compradores.
export const findEmailsByOrder = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ q: z.string().trim().min(2).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const num = data.q.replace(/^#/, "");
    if (!/^[A-Za-z0-9-]+$/.test(num)) return [];
    const { data: rows } = await supabaseAdmin.from("shop_orders")
      .select("email:raw->>email,cust:raw->customer->>email")
      .eq("user_id", context.ownerId).in("order_number", [num, `#${num}`]).limit(20);
    return [...new Set((rows ?? []).map((r: any) => String(r.email ?? r.cust ?? "").toLowerCase()).filter(Boolean))];
  });

// ─── Conversa ─────────────────────────────────────────────────────────────────

export type SupportMessage = {
  id: string; message_id: string; folder_id: string; direction: "in" | "out"; from_email: string | null;
  from_name: string | null; to_emails: string | null; subject: string | null; summary: string | null;
  sent_at: string; is_read: boolean; has_attachment: boolean; content_html: string | null;
  attachments: { id: string; name: string; size: number }[];
};

export const getSupportConversation = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { ownerId } = context;
    const { data: conv } = await supabaseAdmin.from("support_conversations").select(CONV_COLS)
      .eq("id", data.id).eq("owner_id", ownerId).maybeSingle();
    if (!conv) throw new Error("Conversa não encontrada");
    const { data: rows } = await supabaseAdmin.from("support_messages")
      .select("id,message_id,folder_id,direction,from_email,from_name,to_emails,subject,summary,sent_at,is_read,has_attachment,content_html")
      .eq("conversation_id", data.id).eq("owner_id", ownerId).order("sent_at", { ascending: false }).limit(30);
    const msgs = (rows ?? []).reverse();

    // Corpo (1ª vez: busca no Zoho e guarda) e anexos, 4 por vez.
    const acc = await getZohoAccount(ownerId);
    const out: SupportMessage[] = msgs.map((m) => ({ ...(m as any), attachments: [] }));
    if (acc?.refresh_token && acc.account_id) {
      const queue = [...out];
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let m = queue.shift(); m; m = queue.shift()) {
          try {
            if (m.content_html == null) {
              m.content_html = await fetchMessageContent(acc, m.folder_id, m.message_id);
              await supabaseAdmin.from("support_messages").update({ content_html: m.content_html }).eq("id", m.id);
            }
            if (m.has_attachment) m.attachments = await fetchAttachmentInfo(acc, m.folder_id, m.message_id);
          } catch (e: any) {
            m.content_html ??= `<p style="color:#b91c1c">Não foi possível carregar este e-mail (${String(e?.message ?? e).replace(/</g, "&lt;")}).</p>`;
          }
        }
      }));
    }
    return { conversation: conv as SupportConversation, messages: out };
  });

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).min(1).max(200), read: z.boolean().default(true) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { ownerId } = context;
    // Lido: todas as mensagens do cliente. Não lido: só a última de cada conversa.
    const { data: inbound } = await supabaseAdmin.from("support_messages").select("id,message_id,conversation_id,is_read")
      .eq("owner_id", ownerId).in("conversation_id", data.ids).eq("direction", "in").order("sent_at", { ascending: false });
    let msgs = inbound ?? [];
    if (data.read) msgs = msgs.filter((m) => !m.is_read);
    else {
      const seen = new Set<string>();
      msgs = msgs.filter((m) => !seen.has(m.conversation_id) && seen.add(m.conversation_id) && m.is_read);
    }
    const acc = await getZohoAccount(ownerId);
    if (msgs.length && acc?.refresh_token && acc.account_id) {
      const ids = msgs.map((m) => m.message_id);
      if (data.read) await markZohoRead(acc, ids);
      else {
        await zohoApi(acc, `/api/accounts/${acc.account_id}/updatemessage`, {
          method: "PUT", body: JSON.stringify({ mode: "markAsUnread", messageId: ids }),
        });
      }
      await supabaseAdmin.from("support_messages").update({ is_read: data.read }).in("id", msgs.map((m) => m.id));
    }
    await recomputeConversations(ownerId, data.ids);
    return { ok: true };
  });

export const updateSupportConversations = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    patch: z.object({
      status: z.enum(SUPPORT_STATUSES).optional(),
      favorite: z.boolean().optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      note: z.string().max(5000).nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const patch: typeof data.patch & { updated_at: string; resolved_at?: string | null } = { ...data.patch, updated_at: new Date().toISOString() };
    if (data.patch.status) patch.resolved_at = data.patch.status === "resolvido" ? new Date().toISOString() : null;
    const { error } = await supabaseAdmin.from("support_conversations").update(patch)
      .eq("owner_id", context.ownerId).in("id", data.ids);
    if (error) throw new Error(error.message);
    // Tag tirada à mão deixa de contar como "posta pela IA".
    if (data.patch.tags) {
      const kept = data.patch.tags;
      const { data: convs } = await supabaseAdmin.from("support_conversations").select("id,ai_tags")
        .eq("owner_id", context.ownerId).in("id", data.ids);
      await Promise.all((convs ?? []).filter((c) => c.ai_tags.some((t) => !kept.includes(t))).map((c) =>
        supabaseAdmin.from("support_conversations").update({ ai_tags: c.ai_tags.filter((t) => kept.includes(t)) }).eq("id", c.id)));
    }
    return { ok: true };
  });

// ─── Envio ────────────────────────────────────────────────────────────────────

const AttachmentRef = z.object({ storeName: z.string(), attachmentPath: z.string(), attachmentName: z.string() });

export const uploadSupportAttachment = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    fileName: z.string().trim().min(1).max(200),
    // Base64; a Vercel aceita no máximo 4,5 MB por requisição.
    base64: z.string().max(4_300_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const acc = await requireAccount(context.ownerId);
    return uploadZohoAttachment(acc, data.fileName, Buffer.from(data.base64, "base64"));
  });

function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc.replace(/\r?\n/g, "<br>")}</div>`;
}

async function senderName(userId: string) {
  const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  if (prof?.full_name?.trim()) return prof.full_name.trim();
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email?.split("@")[0] ?? "";
}

// Texto digitado + assinatura do workspace ({nome} = quem está respondendo).
async function buildBody(ownerId: string, userId: string, text: string, withSignature: boolean) {
  let html = textToHtml(text);
  if (!withSignature) return html;
  const { data: st } = await supabaseAdmin.from("support_settings").select("signature,signature_enabled").eq("owner_id", ownerId).maybeSingle();
  if (st?.signature_enabled && st.signature?.trim()) {
    const sig = st.signature.replace(/\{nome\}/gi, await senderName(userId));
    html += `<br><div style="color:#555">${textToHtml(sig)}</div>`;
  }
  return html;
}

// ─── Configurações (assinatura) ───────────────────────────────────────────────

export const getSupportSettings = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAccess(context);
    const { data } = await supabaseAdmin.from("support_settings").select("signature,signature_enabled,tags,ai_tags_enabled").eq("owner_id", context.ownerId).maybeSingle();
    return {
      signature: data?.signature ?? "",
      signatureEnabled: data?.signature_enabled ?? true,
      tags: data?.tags ?? [...DEFAULT_TAGS],
      aiTagsEnabled: data?.ai_tags_enabled ?? true,
      aiAvailable: supportAiAvailable(),
      senderName: await senderName(context.userId),
    };
  });

const DEFAULT_TAGS = ["Reembolso", "Defeito", "Troca", "Rastreamento"];
const TagName = z.string().trim().min(1).max(40);

// Salva só o que veio (assinatura e/ou lista de tags).
export const saveSupportSettings = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    signature: z.string().max(2000).optional(),
    signatureEnabled: z.boolean().optional(),
    tags: z.array(TagName).max(100).optional(),
    aiTagsEnabled: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const row: Database["public"]["Tables"]["support_settings"]["Insert"] = { owner_id: context.ownerId, updated_at: new Date().toISOString() };
    if (data.signature !== undefined) row.signature = data.signature.trim() || null;
    if (data.signatureEnabled !== undefined) row.signature_enabled = data.signatureEnabled;
    if (data.aiTagsEnabled !== undefined) row.ai_tags_enabled = data.aiTagsEnabled;
    if (data.tags) row.tags = [...new Map(data.tags.map((t) => [t.toLowerCase(), t])).values()];
    const { error } = await supabaseAdmin.from("support_settings").upsert(row, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Renomeia (to) ou apaga (to = null) uma tag: na lista fixa e em todas as conversas.
export const changeSupportTag = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ from: TagName, to: TagName.nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { ownerId } = context;
    const { data: st } = await supabaseAdmin.from("support_settings").select("tags").eq("owner_id", ownerId).maybeSingle();
    const replace = (list: string[]) => {
      const out = list.flatMap((t) => (t === data.from ? (data.to ? [data.to] : []) : [t]));
      return [...new Map(out.map((t) => [t.toLowerCase(), t])).values()];
    };
    await supabaseAdmin.from("support_settings").upsert(
      { owner_id: ownerId, tags: replace(st?.tags ?? [...DEFAULT_TAGS]), updated_at: new Date().toISOString() },
      { onConflict: "owner_id" },
    );
    const { data: convs } = await selectAll<{ id: string; tags: string[]; ai_tags: string[] }>(
      supabaseAdmin.from("support_conversations").select("id,tags,ai_tags").eq("owner_id", ownerId).contains("tags", [data.from]),
    );
    await Promise.all(convs.map((c) => supabaseAdmin.from("support_conversations").update({ tags: replace(c.tags), ai_tags: replace(c.ai_tags) }).eq("id", c.id)));
    return { conversations: convs.length };
  });

export const sendSupportReply = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    conversationId: z.string().uuid(),
    text: z.string().trim().min(1).max(20_000),
    attachments: z.array(AttachmentRef).max(10).optional(),
    status: z.enum(SUPPORT_STATUSES).default("aguardando_cliente"),
    signature: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { ownerId } = context;
    const acc = await requireAccount(ownerId);
    const { data: conv } = await supabaseAdmin.from("support_conversations").select("id,customer_email,subject")
      .eq("id", data.conversationId).eq("owner_id", ownerId).maybeSingle();
    if (!conv) throw new Error("Conversa não encontrada");
    // Responde a última mensagem do cliente (mantém a conversa no Zoho e no
    // e-mail dele); sem mensagem dele, manda um e-mail novo.
    const { data: lastIn } = await supabaseAdmin.from("support_messages")
      .select("message_id,folder_id,subject,sent_at,from_name,from_email,content_html")
      .eq("conversation_id", conv.id).eq("direction", "in").order("sent_at", { ascending: false }).limit(1).maybeSingle();

    const baseSubject = (lastIn?.subject ?? conv.subject ?? "").trim();
    const subject = /^(re|res|aw)\s*:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject || "Seu contato"}`;
    let html = await buildBody(ownerId, context.userId, data.text, data.signature);
    if (lastIn) {
      const when = new Date(lastIn.sent_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const who = lastIn.from_name ? `${lastIn.from_name} &lt;${lastIn.from_email}&gt;` : lastIn.from_email;
      const quoted = lastIn.content_html ?? "";
      html += `<br><div>Em ${when}, ${who} escreveu:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${quoted}</blockquote>`;
    }
    await sendZohoMail(acc, {
      to: conv.customer_email, subject, html, replyToMessageId: lastIn?.message_id, attachments: data.attachments,
    });

    await supabaseAdmin.from("support_conversations").update({
      status: data.status, resolved_at: data.status === "resolvido" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", conv.id);
    // Traz o enviado pro histórico (pasta Enviados, só a 1ª página).
    try { await syncZohoMailbox(ownerId, { quick: true }); } catch { /* aparece na próxima sincronização */ }
    // A sincronização não pode puxar o status de volta pra "aguardando" se foi marcado resolvido.
    if (data.status !== "aguardando_cliente") {
      await supabaseAdmin.from("support_conversations").update({ status: data.status }).eq("id", conv.id);
    }
    return { ok: true };
  });

export const sendSupportNewMessage = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    to: z.string().trim().email().max(200),
    subject: z.string().trim().min(1).max(300),
    text: z.string().trim().min(1).max(20_000),
    attachments: z.array(AttachmentRef).max(10).optional(),
    signature: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const acc = await requireAccount(context.ownerId);
    const html = await buildBody(context.ownerId, context.userId, data.text, data.signature);
    await sendZohoMail(acc, { to: data.to, subject: data.subject, html, attachments: data.attachments });
    try { await syncZohoMailbox(context.ownerId, { quick: true }); } catch { /* próxima sincronização */ }
    const { data: conv } = await supabaseAdmin.from("support_conversations").select("id")
      .eq("owner_id", context.ownerId).eq("customer_email", data.to.toLowerCase()).maybeSingle();
    return { conversationId: conv?.id ?? null };
  });

// ─── Painel do cliente (pedidos da Shopify pelo e-mail) ───────────────────────

export const getSupportCustomer = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ email: z.string().trim().email() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const email = data.email.toLowerCase();
    // Função SQL usa o índice por e-mail (shop_orders_user_email_idx).
    const { data: ids, error: idsError } = await supabaseAdmin.rpc("shop_order_ids_by_email", { p_user_id: context.ownerId, p_email: email });
    if (idsError) throw new Error(idsError.message);
    const idList = (ids ?? []) as string[];
    let orders: any[] = [];
    if (idList.length) {
      const { data: rows, error } = await supabaseAdmin.from("shop_orders")
        .select("id,shop_id,order_number,created_at_shopify,revenue,currency,shopify_financial_status,delivery_status,tracking_code,tracking_url,carrier,phone:raw->customer->>phone,ship_phone:raw->shipping_address->>phone,first_name:raw->customer->>first_name,last_name:raw->customer->>last_name,cancelled_at:raw->>cancelled_at")
        .eq("user_id", context.ownerId).in("id", idList)
        .order("created_at_shopify", { ascending: false });
      if (error) throw new Error(error.message);
      orders = rows ?? [];
    }
    const shopIds = [...new Set(orders.map((o) => o.shop_id))];
    const { data: shops } = shopIds.length
      ? await supabaseAdmin.from("shops").select("id,name").in("id", shopIds)
      : { data: [] as { id: string; name: string }[] };
    const shopName = new Map((shops ?? []).map((s) => [s.id, s.name]));
    // URL de rastreio da página da própria loja (Lojas e Grupos > Integrações:
    // "URL padrão de rastreio" com [CODE]); sem modelo, o link que veio da Shopify.
    const { data: integs } = shopIds.length
      ? await supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds)
      : { data: [] as { shop_id: string; tracking_link_template: string | null }[] };
    const templateByShop = new Map((integs ?? []).map((i) => [i.shop_id, i.tracking_link_template]));
    const valid = orders.filter((o) => !o.cancelled_at);
    const totals: Record<string, number> = {};
    for (const o of valid) totals[o.currency ?? "USD"] = (totals[o.currency ?? "USD"] ?? 0) + Number(o.revenue ?? 0);
    const first = orders[orders.length - 1];
    return {
      name: orders[0] ? [orders[0].first_name, orders[0].last_name].filter(Boolean).join(" ") || null : null,
      phone: orders.find((o) => o.phone || o.ship_phone)?.phone ?? orders.find((o) => o.ship_phone)?.ship_phone ?? null,
      firstOrderAt: first?.created_at_shopify ?? null,
      ordersCount: valid.length,
      totals,
      stores: [...new Set(orders.map((o) => shopName.get(o.shop_id)).filter(Boolean))] as string[],
      orders: orders.map((o) => ({
        id: o.id, number: o.order_number, date: o.created_at_shopify, revenue: Number(o.revenue ?? 0), currency: o.currency ?? "USD",
        store: shopName.get(o.shop_id) ?? null, financial: o.shopify_financial_status, delivery: o.delivery_status,
        tracking: o.tracking_code, trackingUrl: buildTrackingUrl(templateByShop.get(o.shop_id), o.tracking_code) ?? o.tracking_url, carrier: o.carrier, cancelled: !!o.cancelled_at,
      })),
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { companyShopIdsForMonth } from "@/lib/company-goals.server";
import { orderNumberVariants, orderNumbersInText } from "@/lib/order-numbers";
import { US_TIME_ZONE } from "@/lib/timezone";
import {
  DEFAULT_GOALS, DEFAULT_BUSINESS_HOURS, BUSINESS_TIMEZONES, businessMs, computeSupportKpis, monthRange,
  type BusinessHours, type KpiConversation, type KpiMessage,
} from "@/lib/support-kpis";
import { supportAiAvailable, translateEmailHtml, translateReplyToEnglish, translateToPortuguese } from "@/lib/support-ai.server";
import { AUTO_REPLY_SCRIPT } from "@/lib/support-autoreply.server";
import { supportExtraKpis } from "@/lib/support-kpis-extra.server";
import type { Database } from "@/integrations/supabase/types";
import {
  ZOHO_SCOPES, getZohoAccount, resolveAppOrigin, syncZohoMailbox, recomputeConversations,
  fetchMessageContent, fetchAttachmentInfo, markZohoRead, zohoApi, trashZohoMessage, assignConversationShops, uploadZohoAttachment, sendZohoMail,
} from "@/lib/zoho-mail.server";

// Aba Atendimento: e-mails de clientes do Zoho Mail. Uma conta por workspace.
// Acesso: admin, ou membro com a permissão "atendimento".

export const SUPPORT_STATUSES = ["novo", "em_atendimento", "resolvido"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

type Ctx = { role: "admin" | "member"; ownerId: string; permissions: { section: string }[] };

function assertAccess(ctx: Ctx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "atendimento")) {
    throw new Error("Sem acesso ao Atendimento");
  }
}
// Subabas (Configurações > Membros): at_caixa, at_kpi, at_config.
function assertSub(ctx: Ctx, section: "at_caixa" | "at_kpi" | "at_config") {
  assertAccess(ctx);
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === section)) {
    throw new Error("Sem acesso a esta parte do Atendimento");
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
      // Remetente das respostas e as opções que a conta permite.
      sendAs: acc?.send_as ?? acc?.email ?? null,
      sendAsOptions: acc?.send_as_options ?? [],
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

// Configurações > Integração: por qual endereço as respostas saem.
export const setZohoSendAs = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ send_as: z.string().trim().toLowerCase().email() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAdmin(context);
    const acc = await requireAccount(context.ownerId);
    if (!(acc.send_as_options ?? []).includes(data.send_as)) {
      throw new Error("Esse endereço não está liberado para envio nessa conta do Zoho");
    }
    const { error } = await supabaseAdmin.from("zoho_mail_accounts")
      .update({ send_as: data.send_as, updated_at: new Date().toISOString() }).eq("owner_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectZoho = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAdmin(context);
    await supabaseAdmin.from("zoho_mail_accounts").delete().eq("owner_id", context.ownerId);
    // Limpa o espelho dos e-mails (as mensagens vão junto, ON DELETE CASCADE):
    // as conversas apontam pras pastas da conta desconectada e, se ficassem,
    // misturavam com a próxima conta conectada. Nada é apagado no Zoho.
    const { error } = await supabaseAdmin.from("support_conversations").delete().eq("owner_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const syncSupportInbox = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ force: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const acc = await getZohoAccount(context.ownerId);
    if (!acc?.refresh_token) return { skipped: true };
    // Várias abas abertas: no máximo uma sincronização a cada 45s — contando
    // também a última que deu erro (senão cada aba tenta de novo todo minuto).
    const lastTry = acc.last_sync_error ? acc.updated_at : acc.last_sync_at;
    if (!data.force && lastTry && Date.now() - new Date(lastTry).getTime() < 45_000) return { skipped: true };
    return syncZohoMailbox(context.ownerId, { refreshAccount: data.force });
  });

// ─── Lista + indicadores ──────────────────────────────────────────────────────

export type SupportConversation = {
  id: string; customer_email: string; customer_name: string | null; subject: string | null; summary: string | null;
  last_message_at: string | null; last_inbound_at: string | null; last_outbound_at: string | null;
  message_count: number; unread_count: number; status: SupportStatus; favorite: boolean; tags: string[];
  note: string | null; resolved_at: string | null; ai_tags: string[]; shop_id: string | null;
  // Resposta automática do último e-mail do cliente (support-autoreply.server.ts).
  auto_reply?: "enviado" | "equipe" | null;
};

// Horário comercial salvo (Configurações > Metas); sem linha, o padrão.
const BH_COLS = "bh_start,bh_end,bh_days,bh_timezone";
function toBusinessHours(r: { bh_start?: number | null; bh_end?: number | null; bh_days?: number[] | null; bh_timezone?: string | null } | null | undefined): BusinessHours {
  return {
    timeZone: r?.bh_timezone ?? DEFAULT_BUSINESS_HOURS.timeZone,
    start: r?.bh_start ?? DEFAULT_BUSINESS_HOURS.start,
    end: r?.bh_end ?? DEFAULT_BUSINESS_HOURS.end,
    days: r?.bh_days ?? DEFAULT_BUSINESS_HOURS.days,
  };
}

const CONV_COLS = "id,customer_email,customer_name,subject,summary,last_message_at,last_inbound_at,last_outbound_at,message_count,unread_count,status,favorite,tags,note,resolved_at,ai_tags,shop_id";

export const listSupportConversations = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ from: z.string().datetime(), to: z.string().datetime() }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const { ownerId } = context;
    const [convRes, openRes, msgRes, bhRes] = await Promise.all([
      selectAll<SupportConversation>(supabaseAdmin.from("support_conversations").select(CONV_COLS)
        .eq("owner_id", ownerId).gte("last_message_at", data.from).lte("last_message_at", data.to)),
      // Status atuais (independem do período): em aberto, aguardando, não lidos.
      selectAll<{ status: string; unread_count: number }>(supabaseAdmin.from("support_conversations")
        .select("status,unread_count").eq("owner_id", ownerId).or("status.neq.resolvido,unread_count.gt.0")),
      selectAll<{ conversation_id: string; direction: string; sent_at: string }>(supabaseAdmin.from("support_messages")
        .select("conversation_id,direction,sent_at").eq("owner_id", ownerId)
        .gte("sent_at", data.from).lte("sent_at", new Date(new Date(data.to).getTime() + 7 * 86_400_000).toISOString())),
      supabaseAdmin.from("support_settings").select(BH_COLS).eq("owner_id", ownerId).maybeSingle(),
    ]);
    if (convRes.error) throw new Error(convRes.error.message);
    const hours = toBusinessHours(bhRes.data);

    const open = openRes.data;
    const to = new Date(data.to).getTime();
    const received = msgRes.data.filter((m) => m.direction === "in" && new Date(m.sent_at).getTime() <= to);

    // Tempo de resposta: da 1ª mensagem do cliente sem resposta até a nossa
    // resposta, contando só o horário comercial.
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
        else if (pending != null) { if (pending <= to) waits.push(businessMs(pending, m.t, hours)); pending = null; }
      }
    }

    // "aguardando_cliente" (status antigo, foi juntado a "em atendimento").
    for (const c of convRes.data) if (!SUPPORT_STATUSES.includes(c.status)) c.status = "em_atendimento";
    // Resposta automática do último e-mail do cliente avaliado (selo na lista).
    const { data: autos, error: autoErr } = await supabaseAdmin.from("support_messages")
      .select("conversation_id,auto_reply,sent_at").eq("owner_id", ownerId).eq("direction", "in")
      .not("auto_reply", "is", null).not("auto_reply", "like", "fora:%").gte("sent_at", data.from);
    if (!autoErr) {
      const last = new Map<string, { r: string; t: string }>();
      for (const a of (autos ?? []) as any[]) { const p = last.get(a.conversation_id); if (!p || a.sent_at > p.t) last.set(a.conversation_id, { r: a.auto_reply, t: a.sent_at }); }
      for (const c of convRes.data) { const a = last.get(c.id); if (a) c.auto_reply = a.r === "enviado" ? "enviado" : "equipe"; }
    }
    const conversations = convRes.data.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
    return {
      conversations,
      kpis: {
        received: received.length,
        unread: open.filter((c) => c.unread_count > 0).length,
        inProgress: open.filter((c) => c.status === "em_atendimento").length,
        resolved: conversations.filter((c) => c.status === "resolvido" && c.resolved_at && c.resolved_at >= data.from && c.resolved_at <= data.to).length,
        avgResponseMs: waits.length ? Math.round(waits.reduce((s, x) => s + x, 0) / waits.length) : null,
        responses: waits.length,
        hours,
      },
    };
  });

// Aba KPI: números do mês (comparados com o mesmo trecho do mês anterior).
export const getSupportKpis = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_kpi");
    const { ownerId } = context;
    const range = monthRange(data.month);
    // Conversas que ainda não têm loja: tenta descobrir antes de contar.
    try { await assignConversationShops(ownerId); } catch (e) { console.error("assign shops", e); }
    // Folga de 7 dias depois do fim pra achar respostas que vieram depois.
    const until = new Date(new Date(range.to).getTime() + 7 * 86_400_000).toISOString();
    const [msgs, convs, shops, settings, activeShops] = await Promise.all([
      selectAll<KpiMessage>(supabaseAdmin.from("support_messages").select("conversation_id,direction,sent_at")
        .eq("owner_id", ownerId).gte("sent_at", range.prevFrom).lte("sent_at", until)),
      selectAll<KpiConversation>(supabaseAdmin.from("support_conversations")
        .select("id,status,tags,resolved_at,last_message_at,last_inbound_at,last_outbound_at,shop_id")
        .eq("owner_id", ownerId).or(`last_message_at.gte.${range.prevFrom},status.eq.em_atendimento`)),
      supabaseAdmin.from("shops").select("id,name").eq("user_id", ownerId),
      supabaseAdmin.from("support_settings").select(`tags,goal_first_response_min,goal_resolution_min,${BH_COLS}`).eq("owner_id", ownerId).maybeSingle(),
      // Lojas dos grupos ativos: aparecem na tabela por loja mesmo zeradas.
      companyShopIdsForMonth(ownerId, `${data.month}-01`).catch(() => [] as string[]),
    ]);
    if (msgs.error) throw new Error(msgs.error.message);
    if (convs.error) throw new Error(convs.error.message);
    // Efeito no dinheiro (contato → banco, contatos por 100 pedidos, recontato); não derruba a tela se falhar.
    const extra = await supportExtraKpis(ownerId, range, activeShops).catch((e) => { console.error("support extra kpis", e); return null; });
    return {
      extra,
      ...computeSupportKpis(msgs.data, convs.data, shops.data ?? [], settings.data?.tags ?? [...DEFAULT_TAGS], range, toBusinessHours(settings.data), activeShops),
      partial: range.partial,
      goals: {
        firstResponseMin: settings.data?.goal_first_response_min ?? DEFAULT_GOALS.firstResponseMin,
        resolutionMin: settings.data?.goal_resolution_min ?? DEFAULT_GOALS.resolutionMin,
      },
    };
  });

// Lojas do workspace (seletor de loja no painel do cliente).
export const listSupportShops = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAccess(context);
    const { data } = await supabaseAdmin.from("shops").select("id,name,archived").eq("user_id", context.ownerId).order("name");
    return (data ?? []).filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name }));
  });

// Busca por pedido: "#L4-1508", "L4-1508" ou só "1508" → e-mails dos compradores.
export const findEmailsByOrder = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ q: z.string().trim().min(2).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const hits = await ordersByNumber(context.ownerId, data.q);
    return [...new Set(hits.map((h) => h.email))];
  });

// Mesmo, com o nº do pedido junto (Nova mensagem: escolher quando o número
// existe em mais de uma loja).
export const findOrderCustomers = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ q: z.string().trim().min(2).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    return ordersByNumber(context.ownerId, data.q);
  });

// ─── Mensagens salvas ─────────────────────────────────────────────────────────

export type SupportTemplate = { id: string; title: string; body: string };

export const listSupportTemplates = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<SupportTemplate[]> => {
    assertSub(context, "at_caixa");
    const { data, error } = await supabaseAdmin.from("support_templates").select("id,title,body")
      .eq("owner_id", context.ownerId).order("title");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// Sem id: cria. Com id: edita.
export const saveSupportTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(20_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const row = { title: data.title, body: data.body, updated_at: new Date().toISOString() };
    const { error } = data.id
      ? await supabaseAdmin.from("support_templates").update(row).eq("id", data.id).eq("owner_id", context.ownerId)
      : await supabaseAdmin.from("support_templates").insert({ ...row, owner_id: context.ownerId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSupportTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const { error } = await supabaseAdmin.from("support_templates").delete().eq("id", data.id).eq("owner_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function ordersByNumber(ownerId: string, q: string): Promise<{ order: string; email: string }[]> {
  const num = q.replace(/^#/, "");
  if (!/^[A-Za-z0-9-]+$/.test(num)) return [];
  // Só o número: casa com o fim do pedido ("1508" → "#L4-1508", "#WV1508"),
  // sem pegar "#L4-11508".
  const onlyDigits = /^\d+$/.test(num);
  const base = supabaseAdmin.from("shop_orders")
    .select("order_number,email:raw->>email,cust:raw->customer->>email")
    .eq("user_id", ownerId);
  const { data: rows } = await (onlyDigits
    ? base.ilike("order_number", `%${num}`).order("created_at_shopify", { ascending: false }).limit(50)
    : base.in("order_number", [num, `#${num}`]).limit(20));
  return ((rows ?? []) as any[])
    .filter((r) => !onlyDigits || new RegExp(`(^|[^0-9])${num}$`).test(String(r.order_number ?? "")))
    .map((r) => ({ order: String(r.order_number ?? ""), email: String(r.email ?? r.cust ?? "").toLowerCase() }))
    .filter((r) => r.email);
}

// ─── Conversa ─────────────────────────────────────────────────────────────────

export type SupportMessage = {
  id: string; message_id: string; folder_id: string; direction: "in" | "out"; from_email: string | null;
  from_name: string | null; to_emails: string | null; subject: string | null; summary: string | null;
  sent_at: string; is_read: boolean; has_attachment: boolean; content_html: string | null; content_pt?: string | null;
  attachments: { id: string; name: string; size: number }[];
  // E-mail do cliente: "enviado" (respondido automaticamente) ou "pulado: motivo" (ficou pra equipe).
  auto_reply?: string | null; auto_reply_at?: string | null;
  // Treino da IA (support-learning.server.ts): o que a IA responderia e a comparação com a resposta da equipe.
  ai_draft?: string | null; ai_draft_pt?: string | null;
  ai_draft_eval?: { pendente?: boolean; confianca?: string; observacao?: string; semelhanca?: string; o_que_mudou?: string; licoes?: string[] } | null;
};

export const getSupportConversation = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const { ownerId } = context;
    const { data: conv } = await supabaseAdmin.from("support_conversations").select(CONV_COLS)
      .eq("id", data.id).eq("owner_id", ownerId).maybeSingle();
    if (!conv) throw new Error("Conversa não encontrada");
    const { data: rows } = await supabaseAdmin.from("support_messages")
      .select("id,message_id,folder_id,direction,from_email,from_name,to_emails,subject,summary,sent_at,is_read,has_attachment,content_html,content_pt")
      .eq("conversation_id", data.id).eq("owner_id", ownerId).order("sent_at", { ascending: false }).limit(30);
    const msgs = (rows ?? []).reverse();
    // Resposta automática de cada e-mail do cliente (coluna nova: sem a migration, segue sem).
    const ids = msgs.map((m: any) => m.id);
    let { data: autos, error: autoErr } = await supabaseAdmin.from("support_messages").select("id,auto_reply,auto_reply_at,ai_draft,ai_draft_pt,ai_draft_eval").in("id", ids);
    if (autoErr) ({ data: autos } = await supabaseAdmin.from("support_messages").select("id,auto_reply,auto_reply_at").in("id", ids) as any);
    const autoBy = new Map(((autos ?? []) as any[]).map((a) => [a.id, a]));

    // Corpo (1ª vez: busca no Zoho e guarda) e anexos, 4 por vez.
    const acc = await getZohoAccount(ownerId);
    const out: SupportMessage[] = msgs.map((m: any) => ({ ...m, attachments: [], auto_reply: autoBy.get(m.id)?.auto_reply ?? null, auto_reply_at: autoBy.get(m.id)?.auto_reply_at ?? null,
      ai_draft: autoBy.get(m.id)?.ai_draft ?? null, ai_draft_pt: autoBy.get(m.id)?.ai_draft_pt ?? null, ai_draft_eval: autoBy.get(m.id)?.ai_draft_eval ?? null }));
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
    const conversation = conv as SupportConversation;
    if (!SUPPORT_STATUSES.includes(conversation.status)) conversation.status = "em_atendimento";
    return { conversation, messages: out };
  });

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).min(1).max(200), read: z.boolean().default(true) }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
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
      shop_id: z.string().uuid().nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const patch: typeof data.patch & { updated_at: string; resolved_at?: string | null; shop_manual?: boolean } = { ...data.patch, updated_at: new Date().toISOString() };
    // Loja escolhida à mão: a descoberta automática não troca mais (limpar volta pro automático).
    if (data.patch.shop_id !== undefined) patch.shop_manual = data.patch.shop_id !== null;
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

// Tradução pro português (botão 🌐). Com id: e-mail salvo (tradução guardada
// no banco). Com text: texto solto (modo de exemplo).
const TRANSLATE_LIMIT = 20_000;
export const translateSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    text: z.string().max(TRANSLATE_LIMIT).optional(),
  }).refine((v) => v.id || v.text, "Informe o e-mail").parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    if (!supportAiAvailable()) throw new Error("Tradução indisponível: falta a chave da IA (ANTHROPIC_API_KEY)");
    if (!data.id) return { text: await translateToPortuguese(data.text!) };

    const { ownerId } = context;
    const { data: m } = await supabaseAdmin.from("support_messages")
      .select("id,message_id,folder_id,content_html,content_pt").eq("id", data.id).eq("owner_id", ownerId).maybeSingle();
    if (!m) throw new Error("E-mail não encontrado");
    if (m.content_pt) return { text: m.content_pt, truncated: false };
    let html = m.content_html;
    if (html == null) {
      const acc = await requireAccount(ownerId);
      html = await fetchMessageContent(acc, m.folder_id, m.message_id);
      await supabaseAdmin.from("support_messages").update({ content_html: html }).eq("id", m.id);
    }
    const text = await translateEmailHtml(html);
    await supabaseAdmin.from("support_messages").update({ content_pt: text }).eq("id", m.id);
    return { text };
  });

// Caixa de resposta: texto em português → inglês (o atendente revisa e envia).
export const translateSupportReply = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ text: z.string().trim().min(1).max(TRANSLATE_LIMIT) }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    if (!supportAiAvailable()) throw new Error("Tradução indisponível: falta a chave da IA (ANTHROPIC_API_KEY)");
    return { text: await translateReplyToEnglish(data.text) };
  });

// Exclui conversas: e-mails (do cliente e nossas respostas) vão pra Lixeira do
// Zoho e a conversa sai daqui. Se o Zoho falhar num e-mail, aquela conversa
// fica (senão a próxima sincronização traria de volta). Usado também pelo botão
// Spam (e-mails que não são atendimento), que só muda o texto na tela.
export const deleteSupportConversations = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const { ownerId } = context;
    const acc = await getZohoAccount(ownerId);
    const { data: msgs } = await selectAll<{ conversation_id: string; message_id: string; folder_id: string }>(
      supabaseAdmin.from("support_messages").select("conversation_id,message_id,folder_id").eq("owner_id", ownerId).in("conversation_id", data.ids),
    );
    const failed = new Set<string>();
    if (msgs.length) {
      if (!acc?.refresh_token || !acc.account_id) throw new Error("Zoho Mail não conectado");
      const queue = [...msgs];
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let m = queue.shift(); m; m = queue.shift()) {
          if (failed.has(m.conversation_id)) continue;
          try { await trashZohoMessage(acc, m.folder_id, m.message_id); }
          catch (e) { console.error("trash zoho", m.message_id, e); failed.add(m.conversation_id); }
        }
      }));
    }
    const ok = data.ids.filter((id) => !failed.has(id));
    if (ok.length) {
      const { error } = await supabaseAdmin.from("support_conversations").delete().eq("owner_id", ownerId).in("id", ok);
      if (error) throw new Error(error.message);
    }
    if (failed.size && !ok.length) throw new Error("Não foi possível excluir no Zoho — tente de novo");
    return { deleted: ok.length, failed: failed.size };
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
    assertSub(context, "at_caixa");
    const acc = await requireAccount(context.ownerId);
    return uploadZohoAttachment(acc, data.fileName, Buffer.from(data.base64, "base64"));
  });

// URL vira link; a de rastreio aparece como "Track your order here" (igual à resposta automática).
function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => {
    const label = /track/i.test(u) ? "Track your order here" : u;
    return `<a href="${u.replace(/"/g, "&quot;")}" style="color:#2563eb${label === u ? "" : ";font-weight:bold"}">${label}</a>`;
  });
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${linked.replace(/\r?\n/g, "<br>")}</div>`;
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
    const { data } = await supabaseAdmin.from("support_settings").select(`signature,signature_enabled,tags,ai_tags_enabled,auto_reply_tracking,goal_first_response_min,goal_resolution_min,${BH_COLS}`).eq("owner_id", context.ownerId).maybeSingle();
    return {
      signature: data?.signature ?? "",
      signatureEnabled: data?.signature_enabled ?? true,
      autoReplyTracking: (data as any)?.auto_reply_tracking ?? false,
      autoReplyScript: AUTO_REPLY_SCRIPT,
      tags: data?.tags ?? [...DEFAULT_TAGS],
      aiTagsEnabled: data?.ai_tags_enabled ?? true,
      goals: {
        firstResponseMin: data?.goal_first_response_min ?? DEFAULT_GOALS.firstResponseMin,
        resolutionMin: data?.goal_resolution_min ?? DEFAULT_GOALS.resolutionMin,
      },
      businessHours: toBusinessHours(data),
      aiAvailable: supportAiAvailable(),
      senderName: await senderName(context.userId),
    };
  });

const DEFAULT_TAGS = ["Reembolso", "Defeito", "Troca", "Rastreio"];
const TagName = z.string().trim().min(1).max(40);

// Salva só o que veio (assinatura e/ou lista de tags).
export const saveSupportSettings = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    signature: z.string().max(2000).optional(),
    signatureEnabled: z.boolean().optional(),
    tags: z.array(TagName).max(100).optional(),
    aiTagsEnabled: z.boolean().optional(),
    autoReplyTracking: z.boolean().optional(),
    goals: z.object({
      firstResponseMin: z.number().int().min(1).max(60 * 24 * 30),
      resolutionMin: z.number().int().min(1).max(60 * 24 * 90),
    }).optional(),
    businessHours: z.object({
      start: z.number().int().min(0).max(23),
      end: z.number().int().min(1).max(24),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      timeZone: z.string().refine((tz) => BUSINESS_TIMEZONES.some((t) => t.value === tz), "Fuso inválido"),
    }).refine((h) => h.end > h.start, "O fim precisa ser depois do início").optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_config");
    const row: Database["public"]["Tables"]["support_settings"]["Insert"] = { owner_id: context.ownerId, updated_at: new Date().toISOString() };
    if (data.signature !== undefined) row.signature = data.signature.trim() || null;
    if (data.signatureEnabled !== undefined) row.signature_enabled = data.signatureEnabled;
    if (data.aiTagsEnabled !== undefined) row.ai_tags_enabled = data.aiTagsEnabled;
    if (data.autoReplyTracking !== undefined) row.auto_reply_tracking = data.autoReplyTracking;
    if (data.goals) {
      row.goal_first_response_min = data.goals.firstResponseMin;
      row.goal_resolution_min = data.goals.resolutionMin;
    }
    if (data.businessHours) {
      row.bh_start = data.businessHours.start;
      row.bh_end = data.businessHours.end;
      row.bh_days = [...new Set(data.businessHours.days)].sort((a, b) => a - b);
      row.bh_timezone = data.businessHours.timeZone;
    }
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
    assertSub(context, "at_config");
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
    status: z.enum(SUPPORT_STATUSES).default("em_atendimento"),
    signature: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
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
    const subject = /^(re|res|aw)\s*:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject || "Your inquiry"}`;
    let html = await buildBody(ownerId, context.userId, data.text, data.signature);
    if (lastIn) {
      // Clientes escrevem em inglês: cabeçalho da citação no padrão do Gmail em inglês.
      const when = new Date(lastIn.sent_at).toLocaleString("en-US", {
        timeZone: US_TIME_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      });
      const who = lastIn.from_name ? `${lastIn.from_name} &lt;${lastIn.from_email}&gt;` : lastIn.from_email;
      const quoted = lastIn.content_html ?? "";
      html += `<br><div>On ${when}, ${who} wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${quoted}</blockquote>`;
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
    return { ok: true };
  });

// Rastreamento > "Avisar cliente": manda a mensagem salva NOTIFY_TEMPLATE pro
// cliente de cada pedido marcado ({nome} = primeiro nome, {rastreio} = link do
// pedido), com a assinatura. Pedido sem e-mail ou sem rastreio fica de fora.
export const NOTIFY_TEMPLATE = "ATUALIZAÇÃO DO PEDIDO (A CAMINHO)";
export const notifyOrderCustomers = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderIds: z.array(z.string().uuid()).min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const ownerId = context.ownerId;
    const acc = await requireAccount(ownerId);
    const { data: tpl } = await supabaseAdmin.from("support_templates").select("body")
      .eq("owner_id", ownerId).eq("title", NOTIFY_TEMPLATE).maybeSingle();
    if (!tpl) throw new Error(`Mensagem salva "${NOTIFY_TEMPLATE}" não encontrada (Atendimento → Mensagens salvas).`);
    const { data: orders, error } = await supabaseAdmin.from("shop_orders")
      .select("id,shop_id,order_number,tracking_code,tracking_url,email:raw->>email,cust:raw->customer->>email,first_name:raw->customer->>first_name,ship_first:raw->shipping_address->>first_name,cancelled_at:raw->>cancelled_at")
      .eq("user_id", ownerId).in("id", data.orderIds);
    if (error) throw new Error(error.message);
    const shopIds = [...new Set((orders ?? []).map((o: any) => o.shop_id))];
    const { data: integs } = shopIds.length
      ? await supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds)
      : { data: [] as { shop_id: string; tracking_link_template: string | null }[] };
    const templateByShop = new Map((integs ?? []).map((i) => [i.shop_id, i.tracking_link_template]));

    const sent: string[] = [];
    const skipped: { order: string; motivo: string }[] = [];
    for (const o of (orders ?? []) as any[]) {
      const order = String(o.order_number ?? o.id.slice(0, 8));
      const to = String(o.email ?? o.cust ?? "").trim().toLowerCase();
      const link = buildTrackingUrl(templateByShop.get(o.shop_id), o.tracking_code) ?? o.tracking_url;
      if (o.cancelled_at) { skipped.push({ order, motivo: "pedido cancelado" }); continue; }
      if (!z.string().email().safeParse(to).success) { skipped.push({ order, motivo: "sem e-mail do cliente" }); continue; }
      if (!link) { skipped.push({ order, motivo: "sem link de rastreio" }); continue; }
      const name = String(o.first_name || o.ship_first || "").trim().split(/\s+/)[0] ?? "";
      const text = tpl.body.replace(/\{nome\}/gi, name).replace(/^Hi ,/m, "Hi,").replace(/\{rastreio\}/gi, link);
      try {
        const html = await buildBody(ownerId, context.userId, text, true);
        await sendZohoMail(acc, { to, subject: "Update on your order 📦", html });
        sent.push(order);
        // Rastreamento mostra "Cliente avisado em …" (e a confirmação avisa se já foi).
        await supabaseAdmin.from("shop_orders").update({ customer_notified_at: new Date().toISOString() }).eq("id", o.id);
      } catch (e: any) {
        skipped.push({ order, motivo: String(e?.message ?? e).slice(0, 120) });
      }
    }
    if (sent.length) { try { await syncZohoMailbox(ownerId, { quick: true }); } catch { /* próxima sincronização */ } }
    return { sent, skipped };
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
    assertSub(context, "at_caixa");
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
  .inputValidator((d) => z.object({ email: z.string().trim().email(), conversationId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    assertSub(context, "at_caixa");
    const email = data.email.toLowerCase();
    // Função SQL usa o índice por e-mail (shop_orders_user_email_idx).
    const { data: ids, error: idsError } = await supabaseAdmin.rpc("shop_order_ids_by_email", { p_user_id: context.ownerId, p_email: email });
    if (idsError) throw new Error(idsError.message);
    const idList = [...((ids ?? []) as string[])];
    // Pedido citado na conversa ("#L2-1131" no assunto): entra mesmo feito com
    // outro e-mail (ex.: comprado pelo marido, cliente escreve do dela).
    if (data.conversationId) {
      const { data: msgs } = await supabaseAdmin.from("support_messages").select("subject,summary")
        .eq("owner_id", context.ownerId).eq("conversation_id", data.conversationId).limit(50);
      const nums = [...new Set((msgs ?? []).flatMap((m) => [...orderNumbersInText(m.subject), ...orderNumbersInText(m.summary)]))];
      if (nums.length) {
        const { data: cited } = await supabaseAdmin.from("shop_orders").select("id")
          .eq("user_id", context.ownerId).in("order_number", orderNumberVariants(nums)).limit(20);
        for (const o of cited ?? []) if (!idList.includes(o.id)) idList.push(o.id);
      }
    }
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

// Treino da IA: placar por tag (rascunho × resposta da equipe) e o manual aprendido.
// Teste da resposta automática com os últimos e-mails de rastreio (nada é enviado).
export const previewSupportAutoReply = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertSub(context, "at_config");
    if (!supportAiAvailable()) throw new Error("Falta a chave da IA (ANTHROPIC_API_KEY)");
    const acc = await requireAccount(context.ownerId);
    const { previewSupportAutoReply: run } = await import("@/lib/support-autoreply.server");
    return run(acc);
  });

export const getSupportTraining = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertSub(context, "at_config");
    const { supportTrainingStats } = await import("@/lib/support-learning.server");
    return supportTrainingStats(context.ownerId);
  });

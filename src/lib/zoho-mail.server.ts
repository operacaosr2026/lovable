import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import type { Database } from "@/integrations/supabase/types";
import { selectAll, selectAllIn } from "@/lib/select-all";

// Atendimento: conversa com a API do Zoho Mail (OAuth, listar, ler, responder)
// e espelha os cabeçalhos dos e-mails em support_messages / support_conversations.
// Uma conta por workspace (owner_id). Só roda no servidor.

export type ZohoAccount = Database["public"]["Tables"]["zoho_mail_accounts"]["Row"];

export const ZOHO_SCOPES = "ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.ALL";

// Data center do Zoho: accounts.zoho.com → mail.zoho.com (.eu, .in, .com.au…).
export function isZohoAccountsServer(url: string) {
  return /^https:\/\/accounts\.zoho\.[a-z.]+$/.test(url);
}
export function mailApiBaseFor(accountsServer: string) {
  return accountsServer.replace("://accounts.", "://mail.");
}

export function resolveAppOrigin(): string {
  const explicit = process.env.SHOPIFY_REDIRECT_ORIGIN;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (process.env.VERCEL_ENV === "production") return "https://lojas-one.vercel.app";
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173";
}

export async function getZohoAccount(ownerId: string) {
  const { data } = await supabaseAdmin.from("zoho_mail_accounts").select("*").eq("owner_id", ownerId).maybeSingle();
  return data as ZohoAccount | null;
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export async function exchangeZohoCode(opts: {
  accountsServer: string; clientId: string; clientSecret: string; code: string; redirectUri: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code", client_id: opts.clientId, client_secret: opts.clientSecret,
    code: opts.code, redirect_uri: opts.redirectUri,
  });
  // `code` é de uso único — sem nova tentativa.
  const res = await fetchWithRetry(`${opts.accountsServer}/oauth/v2/token`, { method: "POST", body }, { retries: 0 });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(`Zoho recusou o código (${json.error ?? res.status})`);
  }
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

async function accessToken(acc: ZohoAccount, force = false): Promise<string> {
  const exp = acc.access_token_expires_at ? new Date(acc.access_token_expires_at).getTime() : 0;
  if (!force && acc.access_token && exp - Date.now() > 60_000) return acc.access_token;
  if (!acc.refresh_token) throw new Error("Zoho desconectado — conecte a conta de novo.");
  const body = new URLSearchParams({
    grant_type: "refresh_token", client_id: acc.client_id, client_secret: acc.client_secret, refresh_token: acc.refresh_token,
  });
  const res = await fetchWithRetry(`${acc.accounts_server}/oauth/v2/token`, { method: "POST", body });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.error === "invalid_code" || json.error === "invalid_client"
      ? "Acesso ao Zoho revogado — conecte a conta de novo."
      : `Falha ao renovar acesso ao Zoho (${json.error ?? res.status})`);
  }
  const expiresAt = new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000).toISOString();
  await supabaseAdmin.from("zoho_mail_accounts")
    .update({ access_token: json.access_token, access_token_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("owner_id", acc.owner_id);
  acc.access_token = json.access_token;
  acc.access_token_expires_at = expiresAt;
  return json.access_token;
}

// Chamada à API do Mail. Renova o token uma vez se o Zoho responder 401.
export async function zohoApi<T = any>(acc: ZohoAccount, path: string, init: RequestInit = {}): Promise<T> {
  const res = await zohoRaw(acc, path, init);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || (json.status && json.status.code >= 400)) {
    const msg = json?.data?.moreInfo || json?.status?.description || `HTTP ${res.status}`;
    throw new Error(`Zoho Mail: ${msg}`);
  }
  return json.data as T;
}

export async function zohoRaw(acc: ZohoAccount, path: string, init: RequestInit = {}): Promise<Response> {
  const call = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Zoho-oauthtoken ${token}`);
    if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetchWithRetry(`${acc.mail_api_base}${path}`, { ...init, headers }, { retries: init.method && init.method !== "GET" ? 0 : 2 });
  };
  let res = await call(await accessToken(acc));
  if (res.status === 401) {
    await res.body?.cancel().catch(() => {});
    res = await call(await accessToken(acc, true));
  }
  return res;
}

// Depois do OAuth: descobre o id da conta e as pastas Entrada/Enviados.
export async function initZohoAccount(acc: ZohoAccount) {
  const accounts = await zohoApi<any[]>(acc, "/api/accounts");
  const a = accounts?.[0];
  if (!a) throw new Error("Nenhuma conta de e-mail encontrada no Zoho.");
  const accountId = String(a.accountId);
  const email = String(a.primaryEmailAddress ?? a.mailboxAddress ?? a.emailAddress?.[0]?.mailId ?? "").toLowerCase();
  acc.account_id = accountId;
  const folders = await zohoApi<any[]>(acc, `/api/accounts/${accountId}/folders`);
  const byType = (t: string) => folders.find((f) => String(f.folderType).toLowerCase() === t)?.folderId;
  const inbox = byType("inbox") ?? folders.find((f) => /^(inbox|entrada|caixa de entrada)$/i.test(f.folderName))?.folderId;
  const sent = byType("sent") ?? folders.find((f) => /^(sent|enviados?)$/i.test(f.folderName))?.folderId;
  if (!inbox) throw new Error("Pasta de entrada não encontrada no Zoho.");
  const patch = {
    account_id: accountId, email, display_name: a.displayName ?? a.accountDisplayName ?? null,
    inbox_folder_id: String(inbox), sent_folder_id: sent ? String(sent) : null, updated_at: new Date().toISOString(),
  };
  await supabaseAdmin.from("zoho_mail_accounts").update(patch).eq("owner_id", acc.owner_id);
  Object.assign(acc, patch);
}

// ─── Endereços ────────────────────────────────────────────────────────────────

export function unescapeHtml(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// "Camila Lopes" <camila@x.com>, outro@y.com → [{ email, name }]
export function parseAddresses(raw: string | null | undefined): { email: string; name: string | null }[] {
  if (!raw || raw === "Not Provided") return [];
  const s = unescapeHtml(raw);
  const out: { email: string; name: string | null }[] = [];
  // "Nome" <email> | Nome <email> | email
  const re = /(?:"([^"]*)"|([^",<]*?))\s*<\s*([^<>\s]+@[^<>\s]+)\s*>|([A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const email = (m[3] ?? m[4]).toLowerCase();
    const name = (m[1] ?? m[2] ?? "").trim();
    out.push({ email, name: name && !name.includes("@") ? name : null });
  }
  return out;
}

// ─── Sincronização ────────────────────────────────────────────────────────────

type ZohoListItem = {
  messageId: string; threadId?: string; folderId: string; subject?: string; summary?: string;
  fromAddress?: string; sender?: string; toAddress?: string; receivedTime?: string; sentDateInGMT?: string;
  status?: string; hasAttachment?: string;
};

const PAGE = 100;

async function listFolder(acc: ZohoAccount, folderId: string, sinceMs: number, maxPages: number) {
  const items: ZohoListItem[] = [];
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      folderId, start: String(page * PAGE + 1), limit: String(PAGE), sortorder: "false", includeto: "true",
    });
    const data = await zohoApi<ZohoListItem[]>(acc, `/api/accounts/${acc.account_id}/messages/view?${qs}`);
    const rows = data ?? [];
    items.push(...rows);
    const oldest = rows.length ? Number(rows[rows.length - 1].receivedTime ?? 0) : 0;
    if (rows.length < PAGE || oldest < sinceMs) break;
  }
  return items.filter((i) => Number(i.receivedTime ?? 0) >= sinceMs);
}

const FIRST_SYNC_DAYS = 30;

// Puxa Entrada + Enviados desde a última sincronização (com folga de 2 dias pra
// pegar mudança de lido/não lido) e recalcula as conversas afetadas.
export async function syncZohoMailbox(ownerId: string, opts: { quick?: boolean } = {}) {
  const acc = await getZohoAccount(ownerId);
  if (!acc?.refresh_token) return { skipped: "not_connected" as const };
  try {
    if (!acc.account_id || !acc.inbox_folder_id) await initZohoAccount(acc);
    const firstSync = !acc.last_sync_at;
    const sinceMs = firstSync
      ? Date.now() - FIRST_SYNC_DAYS * 86_400_000
      : new Date(acc.last_sync_at!).getTime() - 2 * 86_400_000;
    const maxPages = opts.quick ? 1 : firstSync ? 10 : 4;
    const own = (acc.email ?? "").toLowerCase();

    const [inbox, sent] = await Promise.all([
      listFolder(acc, acc.inbox_folder_id!, sinceMs, maxPages),
      acc.sent_folder_id ? listFolder(acc, acc.sent_folder_id, sinceMs, maxPages) : Promise.resolve([]),
    ]);

    type Parsed = {
      customer: string; customerName: string | null; direction: "in" | "out"; item: ZohoListItem;
    };
    const parsed: Parsed[] = [];
    for (const item of inbox) {
      const from = parseAddresses(item.fromAddress)[0];
      if (!from || from.email === own) continue;
      parsed.push({ customer: from.email, customerName: item.sender && !item.sender.includes("@") ? unescapeHtml(item.sender) : from.name, direction: "in", item });
    }
    for (const item of sent) {
      const to = parseAddresses(item.toAddress).find((a) => a.email !== own);
      if (!to) continue;
      parsed.push({ customer: to.email, customerName: to.name, direction: "out", item });
    }

    const touched = await upsertMessages(ownerId, own, parsed);
    await recomputeConversations(ownerId, touched, { firstSync });
    try { await assignConversationShops(ownerId, touched); } catch (e) { console.error("assign shops", e); }

    // IA nos e-mails novos: tags automáticas + tradução pro português (falha aqui não derruba a sincronização).
    try {
      const { runSupportAiTagging, runSupportAutoTranslate } = await import("@/lib/support-ai.server");
      await Promise.all([runSupportAiTagging(acc), runSupportAutoTranslate(acc)]);
    } catch (e) {
      console.error("support ai tagging", e);
    }

    await supabaseAdmin.from("zoho_mail_accounts")
      .update({ last_sync_at: new Date().toISOString(), last_sync_error: null, updated_at: new Date().toISOString() })
      .eq("owner_id", ownerId);
    return { messages: parsed.length, conversations: touched.length };
  } catch (e: any) {
    await supabaseAdmin.from("zoho_mail_accounts")
      .update({ last_sync_error: String(e?.message ?? e).slice(0, 500), updated_at: new Date().toISOString() })
      .eq("owner_id", ownerId);
    throw e;
  }
}

async function upsertMessages(
  ownerId: string, own: string,
  parsed: { customer: string; customerName: string | null; direction: "in" | "out"; item: ZohoListItem }[],
) {
  if (!parsed.length) return [] as string[];
  // Conversa por e-mail do cliente (cria se não existe; não mexe em status/tags).
  const customers = [...new Set(parsed.map((p) => p.customer))];
  const { data: existing, error: exErr } = await selectAllIn<{ id: string; customer_email: string }>(customers, (c) =>
    supabaseAdmin.from("support_conversations").select("id,customer_email").eq("owner_id", ownerId).in("customer_email", c));
  if (exErr) throw new Error(exErr.message);
  const idByEmail = new Map(existing.map((c) => [c.customer_email, c.id]));
  const missing = customers.filter((c) => !idByEmail.has(c));
  if (missing.length) {
    const { data: created, error } = await supabaseAdmin.from("support_conversations")
      .upsert(missing.map((customer_email) => ({ owner_id: ownerId, customer_email })), { onConflict: "owner_id,customer_email" })
      .select("id,customer_email");
    if (error) throw new Error(error.message);
    for (const c of created ?? []) idByEmail.set(c.customer_email, c.id);
  }

  const rows = parsed.map(({ customer, customerName, direction, item }) => {
    const from = parseAddresses(item.fromAddress)[0];
    const time = Number(item.receivedTime ?? item.sentDateInGMT ?? Date.now());
    return {
      owner_id: ownerId,
      conversation_id: idByEmail.get(customer)!,
      message_id: String(item.messageId),
      folder_id: String(item.folderId),
      thread_id: item.threadId ? String(item.threadId) : null,
      direction,
      from_email: from?.email ?? (direction === "out" ? own : null),
      from_name: direction === "in" ? customerName : null,
      to_emails: item.toAddress ? unescapeHtml(item.toAddress).slice(0, 1000) : null,
      subject: item.subject ? unescapeHtml(item.subject).slice(0, 500) : null,
      summary: item.summary ? unescapeHtml(item.summary).slice(0, 500) : null,
      sent_at: new Date(time).toISOString(),
      is_read: direction === "out" ? true : String(item.status) === "1",
      has_attachment: String(item.hasAttachment) === "1",
    };
  });
  const { error } = await supabaseAdmin.from("support_messages").upsert(rows, { onConflict: "owner_id,message_id" });
  if (error) throw new Error(error.message);
  return [...new Set(rows.map((r) => r.conversation_id))];
}

// Recalcula contadores/datas da conversa a partir das mensagens e aplica a
// regra de status: cliente escreveu → em atendimento; respondemos → aguardando.
export async function recomputeConversations(ownerId: string, ids: string[], opts: { firstSync?: boolean } = {}) {
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const [{ data: convs }, { data: msgs, error }] = await Promise.all([
      supabaseAdmin.from("support_conversations").select("*").in("id", batch),
      selectAll<{ conversation_id: string; direction: string; from_name: string | null; subject: string | null; summary: string | null; sent_at: string; is_read: boolean }>(
        supabaseAdmin.from("support_messages")
          .select("id,conversation_id,direction,from_name,subject,summary,sent_at,is_read")
          .in("conversation_id", batch).order("sent_at", { ascending: true })),
    ]);
    if (error) throw new Error(error.message);
    const byConv = new Map<string, any[]>();
    for (const m of msgs) (byConv.get(m.conversation_id) ?? byConv.set(m.conversation_id, []).get(m.conversation_id)!).push(m);

    await Promise.all((convs ?? []).map(async (c) => {
      const list = byConv.get(c.id) ?? [];
      if (!list.length) return;
      const last = list[list.length - 1];
      const lastIn = [...list].reverse().find((m) => m.direction === "in");
      const lastOut = [...list].reverse().find((m) => m.direction === "out");
      const newIn = lastIn?.sent_at ?? null;
      const newOut = lastOut?.sent_at ?? null;
      const t = (s: string | null) => (s ? new Date(s).getTime() : 0);

      // Só dois status: em atendimento e resolvido. Cliente escreveu de novo
      // numa conversa resolvida → volta pra em atendimento.
      let status = c.status === "resolvido" ? "resolvido" : "em_atendimento";
      let resolvedAt = c.resolved_at;
      if (t(newIn) > t(c.last_inbound_at) && t(newIn) >= t(newOut)) {
        status = "em_atendimento"; resolvedAt = null;
      }
      // 1ª sincronização: o que está parado há mais de 7 dias entra como resolvido.
      if (opts.firstSync && t(last.sent_at) < Date.now() - 7 * 86_400_000) {
        status = "resolvido"; resolvedAt = last.sent_at;
      }

      await supabaseAdmin.from("support_conversations").update({
        customer_name: lastIn?.from_name ?? c.customer_name,
        subject: last.subject, summary: last.summary,
        last_message_at: last.sent_at, last_inbound_at: newIn, last_outbound_at: newOut,
        message_count: list.length,
        unread_count: list.filter((m) => m.direction === "in" && !m.is_read).length,
        status, resolved_at: resolvedAt, updated_at: new Date().toISOString(),
      }).eq("id", c.id).eq("owner_id", ownerId);
    }));
  }
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

export async function fetchMessageContent(acc: ZohoAccount, folderId: string, messageId: string) {
  const data = await zohoApi<{ content?: string }>(
    acc, `/api/accounts/${acc.account_id}/folders/${folderId}/messages/${messageId}/content?includeBlockContent=true`,
  );
  return data?.content ?? "";
}

export async function fetchAttachmentInfo(acc: ZohoAccount, folderId: string, messageId: string) {
  const data = await zohoApi<{ attachments?: any[] }>(
    acc, `/api/accounts/${acc.account_id}/folders/${folderId}/messages/${messageId}/attachmentinfo`,
  );
  return (data?.attachments ?? []).map((a) => ({
    id: String(a.attachmentId), name: String(a.attachmentName ?? "anexo"), size: Number(a.attachmentSize ?? 0),
  }));
}

export async function markZohoRead(acc: ZohoAccount, messageIds: string[]) {
  if (!messageIds.length) return;
  await zohoApi(acc, `/api/accounts/${acc.account_id}/updatemessage`, {
    method: "PUT", body: JSON.stringify({ mode: "markAsRead", messageId: messageIds }),
  });
}

export async function uploadZohoAttachment(acc: ZohoAccount, fileName: string, bytes: Buffer) {
  const data = await zohoApi<any>(
    acc, `/api/accounts/${acc.account_id}/messages/attachments?fileName=${encodeURIComponent(fileName)}`,
    { method: "POST", body: bytes as any, headers: { "Content-Type": "application/octet-stream" } },
  );
  const a = Array.isArray(data) ? data[0] : data;
  return { storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName ?? fileName };
}

export type ZohoAttachmentRef = { storeName: string; attachmentPath: string; attachmentName: string };

export async function sendZohoMail(acc: ZohoAccount, opts: {
  to: string; subject: string; html: string; replyToMessageId?: string; attachments?: ZohoAttachmentRef[];
}) {
  const body: Record<string, unknown> = {
    fromAddress: acc.display_name ? `"${acc.display_name}" <${acc.email}>` : acc.email,
    toAddress: opts.to, subject: opts.subject, content: opts.html, mailFormat: "html", askReceipt: "no",
  };
  if (opts.attachments?.length) body.attachments = opts.attachments;
  if (opts.replyToMessageId) {
    body.action = "reply";
    return zohoApi(acc, `/api/accounts/${acc.account_id}/messages/${opts.replyToMessageId}`, { method: "POST", body: JSON.stringify(body) });
  }
  return zohoApi(acc, `/api/accounts/${acc.account_id}/messages`, { method: "POST", body: JSON.stringify(body) });
}

// Manda o e-mail pra Lixeira do Zoho (recuperável por 30 dias). Já apagado
// no Zoho (404) conta como feito.
export async function trashZohoMessage(acc: ZohoAccount, folderId: string, messageId: string) {
  const res = await zohoRaw(acc, `/api/accounts/${acc.account_id}/folders/${folderId}/messages/${messageId}`, { method: "DELETE" });
  if (res.ok || res.status === 404) { await res.body?.cancel().catch(() => {}); return; }
  const json: any = await res.json().catch(() => ({}));
  throw new Error(`Zoho Mail: ${json?.data?.moreInfo || json?.status?.description || `HTTP ${res.status}`}`);
}

// Cron: sincroniza todas as contas conectadas.
export async function syncAllZohoMailboxes() {
  const { data } = await supabaseAdmin.from("zoho_mail_accounts").select("owner_id").not("refresh_token", "is", null);
  const out: Record<string, unknown> = {};
  for (const a of data ?? []) {
    try { out[a.owner_id] = await syncZohoMailbox(a.owner_id); }
    catch (e: any) { out[a.owner_id] = { error: String(e?.message ?? e) }; }
  }
  return out;
}

// ─── Loja de cada conversa (KPI por loja) ─────────────────────────────────────

// Descobre a loja das conversas ainda sem loja: 1) pedido mais recente com o
// mesmo e-mail; 2) nº de pedido citado no assunto ("#4532"). Loja escolhida à
// mão (shop_manual) nunca é trocada.
export async function assignConversationShops(ownerId: string, ids?: string[]) {
  const base = () => supabaseAdmin.from("support_conversations").select("id,customer_email")
    .eq("owner_id", ownerId).is("shop_id", null).eq("shop_manual", false);
  const { data: convs } = ids
    ? await selectAllIn<{ id: string; customer_email: string }>(ids, (c) => base().in("id", c))
    : await selectAll<{ id: string; customer_email: string }>(base());
  if (!convs.length) return { assigned: 0 };

  const shopByConv = new Map<string, string>();
  const emails = [...new Set(convs.map((c) => c.customer_email.toLowerCase()))];
  for (let i = 0; i < emails.length; i += 200) {
    const { data } = await supabaseAdmin.rpc("shop_by_customer_emails", { p_user_id: ownerId, p_emails: emails.slice(i, i + 200) });
    const byEmail = new Map(((data ?? []) as { email: string; shop_id: string }[]).map((r) => [r.email, r.shop_id]));
    for (const c of convs) {
      const shop = byEmail.get(c.customer_email.toLowerCase());
      if (shop) shopByConv.set(c.id, shop);
    }
  }

  // Sem pedido com esse e-mail: procura "#1234" nos assuntos dos e-mails da conversa.
  const rest = convs.filter((c) => !shopByConv.has(c.id)).map((c) => c.id);
  if (rest.length) {
    const { data: msgs } = await selectAllIn<{ conversation_id: string; subject: string | null }>(rest, (c) =>
      supabaseAdmin.from("support_messages").select("conversation_id,subject").in("conversation_id", c));
    const numsByConv = new Map<string, Set<string>>();
    for (const m of msgs) {
      for (const [, n] of (m.subject ?? "").matchAll(/#\s?(\d{3,8})\b/g)) {
        (numsByConv.get(m.conversation_id) ?? numsByConv.set(m.conversation_id, new Set()).get(m.conversation_id)!).add(n);
      }
    }
    const allNums = [...new Set([...numsByConv.values()].flatMap((s) => [...s]))];
    if (allNums.length) {
      const { data: orders } = await selectAllIn<{ shop_id: string; order_number: string | null }>(
        allNums.flatMap((n) => [n, `#${n}`]),
        (c) => supabaseAdmin.from("shop_orders").select("shop_id,order_number").eq("user_id", ownerId).in("order_number", c),
      );
      const shopsByNum = new Map<string, Set<string>>();
      for (const o of orders) {
        const n = String(o.order_number ?? "").replace(/^#/, "");
        (shopsByNum.get(n) ?? shopsByNum.set(n, new Set()).get(n)!).add(o.shop_id);
      }
      for (const [convId, nums] of numsByConv) {
        const shops = new Set([...nums].flatMap((n) => [...(shopsByNum.get(n) ?? [])]));
        if (shops.size === 1) shopByConv.set(convId, [...shops][0]);   // só se não for ambíguo
      }
    }
  }

  await Promise.all([...shopByConv].map(([id, shop_id]) =>
    supabaseAdmin.from("support_conversations").update({ shop_id }).eq("id", id).is("shop_id", null).eq("shop_manual", false)));
  return { assigned: shopByConv.size };
}

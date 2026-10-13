import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";

// Avisos da aba Notificações no Atendimento: o e-mail enviado volta pela
// sincronização do Zoho como mensagem nossa. Ele não é atendimento — a conversa
// vai direto pra Resolvido e fica fora dos KPIs até o cliente responder.
// Reconhecido pelo cliente + assunto do que a fila mandou (order_notices).

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 500);
const key = (email: string | null | undefined, subject: string | null | undefined) => `${(email ?? "").trim().toLowerCase()}\n${norm(subject)}`;

export type IsNotice = (customerEmail: string | null | undefined, direction: string, subject: string | null | undefined) => boolean;

// Sem `emails`: todos os avisos do workspace (KPIs).
export async function loadNoticeMatcher(ownerId: string, emails?: string[]): Promise<IsNotice> {
  const base = () => supabaseAdmin.from("order_notices").select("to_email,subject")
    .eq("owner_id", ownerId).in("status", ["enviado", "enviando"]);
  const { data, error } = emails
    ? await selectAllIn<{ to_email: string; subject: string }>([...new Set(emails.map((e) => e.toLowerCase()))], (c) => base().in("to_email", c))
    : await selectAll<{ to_email: string; subject: string }>(base());
  if (error) throw new Error(error.message);
  const keys = new Set(data.map((n) => key(n.to_email, n.subject)));
  return (email, direction, subject) => direction === "out" && keys.size > 0 && keys.has(key(email, subject));
}

// Conversas abertas por aviso (as que já estavam na caixa antes desta regra, ou
// que a sincronização pegou antes do envio ser marcado): e-mails com aviso
// enviado nos últimos 30 dias e conversa ainda aberta.
export async function openNoticeConversationIds(ownerId: string): Promise<string[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: notices, error } = await selectAll<{ to_email: string }>(supabaseAdmin.from("order_notices")
    .select("to_email").eq("owner_id", ownerId).eq("status", "enviado").gte("sent_at", since));
  if (error) throw new Error(error.message);
  const emails = [...new Set(notices.map((n) => n.to_email.toLowerCase()))];
  if (!emails.length) return [];
  const { data: convs, error: cErr } = await selectAllIn<{ id: string }>(emails, (c) => supabaseAdmin.from("support_conversations")
    .select("id").eq("owner_id", ownerId).in("status", ["novo", "em_atendimento"]).in("customer_email", c));
  if (cErr) throw new Error(cErr.message);
  return convs.map((c) => c.id);
}

// KPIs: tira as mensagens de aviso; conversa que no período só teve aviso sai inteira.
export function withoutNotices<
  M extends { conversation_id: string; direction: string; subject: string | null },
  C extends { id: string; customer_email: string },
>(messages: M[], conversations: C[], isNotice: IsNotice) {
  const emailOf = new Map(conversations.map((c) => [c.id, c.customer_email]));
  const kept: M[] = [];
  const withNotice = new Set<string>();
  const withReal = new Set<string>();
  for (const m of messages) {
    if (isNotice(emailOf.get(m.conversation_id), m.direction, m.subject)) withNotice.add(m.conversation_id);
    else { kept.push(m); withReal.add(m.conversation_id); }
  }
  return {
    messages: kept,
    conversations: conversations.filter((c) => !withNotice.has(c.id) || withReal.has(c.id)),
    noticeOnly: new Set([...withNotice].filter((id) => !withReal.has(id))),
  };
}

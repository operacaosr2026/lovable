import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emitEvent } from "@/lib/notify.server";

// Pedidos do Atendimento que dependem da aprovação do dono do workspace (Gerar
// troca, Reembolsar): quem pode pedir, quem aprova, o pedido de origem, nomes e o
// push com o resultado pra quem pediu.

export const db = (table: string) => (supabaseAdmin as any).from(table);

export type SupportCtx = { role: "admin" | "member"; ownerId: string; userId: string; permissions: { section: string }[] };

export function assertSupportAccess(ctx: SupportCtx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "atendimento")) {
    throw new Error("Sem acesso ao Atendimento");
  }
}

const has = (ctx: SupportCtx, section: string) => ctx.permissions.some((p) => p.section === section);

// Quem aprova: dono e admins, ou membro com "Pode aprovar trocas e reembolsos"
// (Configurações › Membros › Atendimento).
export const isApprover = (ctx: SupportCtx) =>
  ctx.userId === ctx.ownerId || ctx.role === "admin" || (has(ctx, "atendimento") && has(ctx, "at_aprovar"));

// Quem vê a aba Aprovações: quem aprova, ou membro com "Aprovações (ver a fila)".
export const canSeeApprovals = (ctx: SupportCtx) => isApprover(ctx) || (has(ctx, "atendimento") && has(ctx, "at_aprovacoes"));

export async function loadSupportOrder(ownerId: string, orderId: string) {
  const { data: o } = await supabaseAdmin.from("shop_orders")
    .select("id,shop_id,order_number,raw").eq("id", orderId).eq("user_id", ownerId).maybeSingle();
  if (!o) throw new Error("Pedido não encontrado");
  return o as { id: string; shop_id: string; order_number: string | null; raw: any };
}

export function customerOf(raw: any) {
  return {
    email: (raw?.email ?? raw?.customer?.email ?? null) as string | null,
    name: ([raw?.customer?.first_name, raw?.customer?.last_name].filter(Boolean).join(" ") || raw?.shipping_address?.name || null) as string | null,
  };
}

export async function personName(userId: string) {
  const { data } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name?.trim() || "Equipe";
}

export async function personNames(ids: (string | null)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  if (!list.length) return new Map<string, string | null>();
  const { data } = await supabaseAdmin.from("profiles").select("id,full_name").in("id", list);
  return new Map((data ?? []).map((p) => [p.id, p.full_name]));
}

export const conversationLink = (conversationId: string | null) => (conversationId ? `/atendimento?c=${conversationId}` : "/atendimento");
// Notificação "para aprovar" abre a fila de Aprovações do Atendimento.
export const APPROVALS_LINK = "/atendimento?v=aprovacoes";

// Push só pra quem pediu (quem decidiu a própria solicitação não recebe).
export async function tellRequester(
  ctx: SupportCtx, prefix: string, r: { id: string; requested_by: string; conversation_id: string | null }, title: string, body: string,
) {
  if (r.requested_by === ctx.userId) return;
  await emitEvent(ctx.ownerId, {
    key: `${prefix}:${r.id}:${Date.now()}`, title, body, link: conversationLink(r.conversation_id), targetUserId: r.requested_by,
  });
}

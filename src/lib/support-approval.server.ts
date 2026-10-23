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

// Quem aprova: o dono do workspace.
export const isApprover = (ctx: SupportCtx) => ctx.role === "admin" && ctx.userId === ctx.ownerId;

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

// Push só pra quem pediu (quem decidiu a própria solicitação não recebe).
export async function tellRequester(
  ctx: SupportCtx, prefix: string, r: { id: string; requested_by: string; conversation_id: string | null }, title: string, body: string,
) {
  if (r.requested_by === ctx.userId) return;
  await emitEvent(ctx.ownerId, {
    key: `${prefix}:${r.id}:${Date.now()}`, title, body, link: conversationLink(r.conversation_id), targetUserId: r.requested_by,
  });
}

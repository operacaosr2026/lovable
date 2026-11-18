import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAllIn } from "@/lib/select-all";

// Pedidos (shop_orders.id) com reembolso do fornecedor confirmado (Atendimento ›
// Reembolso). Pacote não entregue desses pedidos não é mais problema de
// logística: sai do Rastreamento, dos avisos do Gerencial e das notificações
// de rastreio parado. supplier_refunds ainda não está nos tipos gerados.
export async function supplierRefundedIds(ownerId: string, orderIds: string[]): Promise<Set<string>> {
  if (!orderIds.length) return new Set();
  const { data } = await selectAllIn<any>(orderIds, (ids) => (supabaseAdmin as any)
    .from("supplier_refunds").select("order_id").eq("owner_id", ownerId).eq("status", "confirmado").in("order_id", ids));
  return new Set(((data ?? []) as any[]).map((r) => r.order_id as string));
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAllIn } from "@/lib/select-all";
import { isoDateUS } from "@/lib/timezone";

// Relógio do "sem postagem" (prazo de 3 dias úteis): conta do PAGAMENTO AO
// FORNECEDOR — data do lote (a que se ajusta em "Alterar data de pagamento"),
// senão paid_at —, não da compra. Reenvio conta da troca do código (o
// fornecedor reenvia sem novo pagamento). Pedido ainda não pago ao fornecedor:
// null — needsAttention conta da compra (aviso "Não pago ao fornecedor").
// Colunas necessárias no select: POSTING_CLOCK_COLS.
export const POSTING_CLOCK_COLS = "payment_status,payment_batch_id,paid_at,tracking_code_history,tracking_code_manual_at";

export async function withPostingFrom<T extends Record<string, any>>(rows: T[]): Promise<(T & { posting_from: string | null })[]> {
  const batchIds = [...new Set(rows.filter((o) => o.payment_status === "paid" && o.payment_batch_id).map((o) => o.payment_batch_id as string))];
  const { data: batches } = batchIds.length
    ? await selectAllIn<{ id: string; payment_date: string | null }>(batchIds, (c) =>
        supabaseAdmin.from("shop_order_payment_batches").select("id,payment_date").in("id", c))
    : { data: [] as { id: string; payment_date: string | null }[] };
  const batchDate = new Map((batches ?? []).map((b) => [b.id, b.payment_date ? String(b.payment_date).slice(0, 10) : null]));
  return rows.map((o) => {
    const history = Array.isArray(o.tracking_code_history) ? o.tracking_code_history : [];
    const resentAt: string | null = history[history.length - 1]?.until ?? o.tracking_code_manual_at ?? null;
    const paidOn = o.payment_status === "paid"
      ? (batchDate.get(o.payment_batch_id) ?? (o.paid_at ? isoDateUS(o.paid_at) : null))
      : null;
    return { ...o, posting_from: resentAt ? isoDateUS(resentAt) : paidOn };
  });
}

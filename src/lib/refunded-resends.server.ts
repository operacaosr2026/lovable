import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAllIn } from "@/lib/select-all";

// Reenvio (pedido de $0 com tag REENVIO-EMPRESA/REENVIO-FORNECEDOR, ver
// support-exchange.functions.ts) cujo pedido original foi reembolsado por
// inteiro: o cliente já recebeu o dinheiro de volta, então o rastreio do
// reenvio não é mais problema (ex.: #L2-1296 → #L2-1180, #L3-1132 → #L3-1061;
// pedido do usuário em 10/11/2026). Pedido reembolsado ele mesmo já sai pelo
// shopify_financial_status — aqui é só o reenvio, que fica "paid" ($0).
//
// O reenvio não guarda o número do original: o original é o último pedido do
// mesmo e-mail, na mesma loja, de antes do reenvio, que não seja outro reenvio.
const RESEND_TAG = /\bREENVIO-(EMPRESA|FORNECEDOR)\b/i;
const FULL_REFUND = new Set(["refunded", "voided"]);

export async function refundedResendIds(ownerId: string, orderIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!orderIds.length) return out;
  const { data: rows, error } = await selectAllIn<any>(orderIds, (c) => supabaseAdmin.from("shop_orders")
    .select("id,shop_id,order_date,email:raw->>email,cemail:raw->customer->>email,tags:raw->>tags").in("id", c));
  if (error) throw new Error(error.message);
  const emailOf = (r: any) => String(r.email ?? r.cemail ?? "").trim().toLowerCase();
  const resends = (rows ?? []).filter((r: any) => RESEND_TAG.test(String(r.tags ?? "")) && emailOf(r));
  if (!resends.length) return out;

  // Pedidos dos mesmos clientes nas mesmas lojas (candidatos a original).
  const shopIds = [...new Set(resends.map((r: any) => r.shop_id as string))];
  const emails = [...new Set(resends.map(emailOf))];
  const { data: others, error: othersErr } = await selectAllIn<any>(emails, (c) => supabaseAdmin.from("shop_orders")
    .select("id,shop_id,order_date,created:raw->>created_at,email:raw->>email,cemail:raw->customer->>email,tags:raw->>tags,shopify_financial_status,cancelled:raw->>cancelled_at")
    .eq("user_id", ownerId).in("shop_id", shopIds).or(`raw->>email.in.(${c.map((e) => `"${e}"`).join(",")}),raw->customer->>email.in.(${c.map((e) => `"${e}"`).join(",")})`));
  if (othersErr) throw new Error(othersErr.message);

  for (const r of resends) {
    const original = ((others ?? []) as any[])
      .filter((o) => o.id !== r.id && o.shop_id === r.shop_id && emailOf(o) === emailOf(r)
        && !RESEND_TAG.test(String(o.tags ?? "")) && String(o.order_date) <= String(r.order_date))
      .sort((a, b) => String(b.created ?? b.order_date).localeCompare(String(a.created ?? a.order_date)))[0];
    if (original && (FULL_REFUND.has(String(original.shopify_financial_status ?? "")) || original.cancelled)) out.add(r.id);
  }
  return out;
}

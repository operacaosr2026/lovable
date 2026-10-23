import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { raiseNotification } from "@/lib/notifications.server";
import { selectAllIn } from "@/lib/select-all";

// Resultado de disputa no sino: um aviso por chargeback/inquiry ganho ou perdido,
// na hora em que o sync/webhook vê a mudança de status. Só lojas ativas. (O
// resumo diário dos decididos de ontem saiu a pedido — só o aviso de cada um.)

const FINAL = new Set(["won", "lost"]);

type DisputeRow = { shopify_dispute_id: string; order_external_id: string | null; type: string; status: string | null; amount: number; currency: string | null };

const money = (v: number, currency?: string | null) =>
  `${!currency || currency === "USD" ? "US$" : currency} ${v.toFixed(2).replace(".", ",")}`;

async function activeShop(shopId: string) {
  const { data } = await supabaseAdmin.from("shops").select("name,status,archived").eq("id", shopId).maybeSingle();
  return data && data.status === "ativa" && !data.archived ? (data.name as string) : null;
}

// Status de antes do upsert — pra saber quem acabou de ser decidido.
export async function disputeStatusesBefore(shopId: string, ids: string[]) {
  const { data } = await selectAllIn<{ shopify_dispute_id: string; status: string | null }>(ids, (c) =>
    supabaseAdmin.from("shop_order_disputes").select("shopify_dispute_id,status").eq("shop_id", shopId).in("shopify_dispute_id", c));
  return new Map(data.map((d) => [d.shopify_dispute_id, d.status]));
}

// Disputa que já existia em aberto e agora veio ganha/perdida. Disputa que já
// chega decidida (loja nova, 1º sync) não avisa — é histórico.
export async function notifyDisputeResults(userId: string, shopId: string, before: Map<string, string | null>, rows: DisputeRow[]) {
  const decided = rows.filter((r) => FINAL.has(r.status ?? "") && before.has(r.shopify_dispute_id) && !FINAL.has(before.get(r.shopify_dispute_id) ?? ""));
  if (!decided.length) return;
  const shopName = await activeShop(shopId);
  if (!shopName) return;
  const extIds = decided.map((d) => d.order_external_id).filter(Boolean) as string[];
  const { data: orders } = await selectAllIn<{ external_id: string; order_number: string }>(extIds, (c) =>
    supabaseAdmin.from("shop_orders").select("external_id,order_number").eq("shop_id", shopId).in("external_id", c));
  const num = new Map(orders.map((o) => [o.external_id, o.order_number]));
  for (const d of decided) {
    const won = d.status === "won";
    const kind = d.type === "inquiry" ? "Inquiry" : "Chargeback";
    const order = (d.order_external_id && num.get(d.order_external_id)) || "pedido";
    await raiseNotification(userId, `dispute_result:${d.shopify_dispute_id}`, {
      level: won ? "info" : "warning",
      title: `${kind} ${won ? "ganho" : "perdido"} — ${order} (${shopName})`,
      body: won ? `${money(Number(d.amount), d.currency)} voltam pra loja.` : `${money(Number(d.amount), d.currency)} ficam com o cliente.`,
      link: "/chargebacks",
    });
  }
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { raiseNotification } from "@/lib/notifications.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { addDaysIso, isoTodayUS, nyParts } from "@/lib/timezone";

// Resultado de disputa no sino: um aviso por chargeback/inquiry ganho ou perdido
// (na hora em que o sync/webhook vê a mudança de status) + um resumo diário com
// os decididos de ontem. Só lojas ativas.

const FINAL = new Set(["won", "lost"]);
const SUMMARY_HOUR_NY = 9;   // depois do sync completo das 7h (NY)

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

// Resumo de ontem (NY), 1x por dia a partir das 9h. Chamado a cada 5 min pelo
// notifications-refresh; a chave do dia impede repetir.
export async function checkDisputeDailySummary(ownerId: string) {
  if (nyParts(Date.now()).hour < SUMMARY_HOUR_NY) return;
  const day = addDaysIso(isoTodayUS(), -1);
  const key = `dispute_daily:${day}`;
  const { data: done } = await supabaseAdmin.from("app_notifications").select("id").eq("user_id", ownerId).eq("key", key).maybeSingle();
  if (done) return;
  const { data: shops } = await supabaseAdmin.from("shops").select("id").eq("user_id", ownerId).eq("status", "ativa").eq("archived", false);
  const shopIds = ((shops ?? []) as { id: string }[]).map((s) => s.id);
  if (!shopIds.length) return;
  const { data: rows, error } = await selectAll<{ status: string; amount: number }>(supabaseAdmin.from("shop_order_disputes")
    .select("status,amount").eq("user_id", ownerId).in("shop_id", shopIds).eq("finalized_on", day).in("status", ["won", "lost"]));
  if (error) throw new Error(error.message);
  if (!rows.length) return;   // dia sem decisão: sem aviso
  const sum = (s: string) => rows.filter((r) => r.status === s);
  const total = (xs: { amount: number }[]) => money(xs.reduce((a, r) => a + Number(r.amount ?? 0), 0));
  const won = sum("won"), lost = sum("lost");
  const parts = [
    lost.length ? `${lost.length} perdido${lost.length > 1 ? "s" : ""} (${total(lost)})` : null,
    won.length ? `${won.length} ganho${won.length > 1 ? "s" : ""} (${total(won)})` : null,
  ].filter(Boolean);
  const [, m, d] = day.split("-");
  await raiseNotification(ownerId, key, {
    level: lost.length ? "warning" : "info",
    title: `Chargebacks decididos ontem (${d}/${m}): ${parts.join(", ")}`,
    body: "Detalhes na aba Chargebacks.",
    link: "/chargebacks",
  });
}

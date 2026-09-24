import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { isoTodayUS } from "@/lib/timezone";

function addDaysISO(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Taxa de estorno por loja — igual à fórmula do Shopify: pedidos com
// chargeback real (shop_order_disputes) sobre o total de pedidos, numa janela
// rolante de 30 dias (estorno demora semanas pra acontecer depois da compra).
export async function computeEstornoByShop(ownerId: string, shopIds: string[], to = isoTodayUS()) {
  const from = addDaysISO(to, -30);
  const [ordersRes, disputesRes] = await Promise.all([
    selectAll(supabaseAdmin.from("shop_orders").select("shop_id")
      .eq("user_id", ownerId).in("shop_id", shopIds)
      .gte("order_date", from).lte("order_date", to)),
    selectAll(supabaseAdmin.from("shop_order_disputes").select("shop_id, order_external_id")
      .eq("user_id", ownerId).in("shop_id", shopIds).eq("type", "chargeback")
      .gte("initiated_at", from).lte("initiated_at", to)),
  ]);
  const orders = new Map<string, number>();
  for (const o of (ordersRes.data ?? []) as any[]) orders.set(o.shop_id, (orders.get(o.shop_id) ?? 0) + 1);
  const estornos = new Map<string, Set<string>>();
  for (const d of (disputesRes.data ?? []) as any[]) {
    if (d.order_external_id == null) continue;
    if (!estornos.has(d.shop_id)) estornos.set(d.shop_id, new Set());
    estornos.get(d.shop_id)!.add(d.order_external_id);
  }
  return new Map(shopIds.map((id) => [id, { pedidos: orders.get(id) ?? 0, estornos: estornos.get(id)?.size ?? 0 }]));
}

// 1x por dia, à meia-noite de Nova York (pg_cron, ver *_estorno_daily.sql):
// grava a taxa de estorno de 30 dias em shop_order_settings, pro card de
// Lojas e Grupos só ler em vez de recalcular a cada abertura.
export async function runEstornoDaily() {
  const { data: settings, error } = await supabaseAdmin.from("shop_order_settings").select("user_id,shop_id");
  if (error) throw new Error(error.message);
  const byOwner = new Map<string, string[]>();
  for (const s of (settings ?? []) as any[]) {
    if (!byOwner.has(s.user_id)) byOwner.set(s.user_id, []);
    byOwner.get(s.user_id)!.push(s.shop_id);
  }
  const now = new Date().toISOString();
  let saved = 0;
  for (const [ownerId, shopIds] of byOwner) {
    const stats = await computeEstornoByShop(ownerId, shopIds);
    await Promise.all([...stats.entries()].map(async ([shopId, st]) => {
      const { error: upErr } = await supabaseAdmin.from("shop_order_settings")
        .update({ chargeback_orders_30d: st.pedidos, chargeback_count_30d: st.estornos, chargeback_stats_at: now })
        .eq("user_id", ownerId).eq("shop_id", shopId);
      if (upErr) console.error("estorno-daily: falha ao gravar", shopId, upErr.message);
      else saved++;
    }));
  }
  return { saved };
}

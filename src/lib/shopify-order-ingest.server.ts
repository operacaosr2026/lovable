import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPausedShopifyStoreIds } from "@/lib/sync-pause.server";

// Grava em shop_orders um pedido que chegou pelo webhook da Shopify — mesmos
// campos e mesma regra de rastreio do sync de 10 em 10 min (sync-shop-orders
// syncOrdersOnlyForShop), que continua rodando como rede de segurança.
// Devolve os donos (workspaces) em que algo relevante mudou, pra avisar as
// telas abertas.
export async function ingestShopifyOrder(storeId: string, o: any): Promise<{ changedOwners: string[] }> {
  if (!o?.id || !o?.created_at) return { changedOwners: [] };

  const paused = await getPausedShopifyStoreIds();
  if (paused.has(storeId)) return { changedOwners: [] };

  const { data: settingsRows } = await supabaseAdmin.from("shop_order_settings")
    .select("shop_id,user_id,cashflow_start_date")
    .eq("shopify_store_id", storeId).eq("automation_enabled", true);

  const changedOwners = new Set<string>();
  const externalId = String(o.id);
  const orderDate = (o.created_at as string).slice(0, 10);
  const financial = o.financial_status ?? null;
  const cancelledAt = o.cancelled_at ?? null;

  for (const s of (settingsRows ?? []) as any[]) {
    // Corte de data da integração ("pedidos a partir de 01/09"): pedido
    // anterior não entra (ex.: reembolso de um pedido antigo).
    if (s.cashflow_start_date && orderDate < s.cashflow_start_date) continue;

    const { data: before } = await supabaseAdmin.from("shop_orders")
      .select("id,shopify_financial_status,carrier,tracking_code,tracking_url,delivery_status,cancelled_at:raw->>cancelled_at")
      .eq("shop_id", s.shop_id).eq("source", "shopify").eq("external_id", externalId).maybeSingle();

    const { error: upErr } = await supabaseAdmin.from("shop_orders").upsert({
      user_id: s.user_id, shop_id: s.shop_id, source: "shopify",
      external_id: externalId, order_number: o.name ?? null,
      created_at_shopify: o.created_at,
      order_date: orderDate,
      items_count: (o.line_items ?? []).reduce((x: number, li: any) => x + Number(li.quantity ?? 0), 0),
      revenue: Number(o.total_price ?? 0), currency: o.currency ?? null, raw: o,
      shopify_financial_status: financial,
    }, { onConflict: "shop_id,source,external_id" });
    if (upErr) throw new Error(upErr.message);

    let trackingChanged = false;
    const fulfillments = (o.fulfillments ?? []) as any[];
    const fWithTrack = [...fulfillments].reverse()
      .find((f) => f.tracking_number || (f.tracking_numbers && f.tracking_numbers.length));
    const trackingNumber = fWithTrack ? (fWithTrack.tracking_number ?? fWithTrack.tracking_numbers?.[0] ?? null) : null;
    if (fWithTrack && trackingNumber) {
      const { data: row } = await supabaseAdmin.from("shop_orders")
        .select("id,carrier,tracking_code,tracking_url,delivery_status")
        .eq("shop_id", s.shop_id).eq("source", "shopify").eq("external_id", externalId).maybeSingle();
      if (row) {
        const { data: integ } = await supabaseAdmin.from("track123_integrations")
          .select("tracking_link_template").eq("shop_id", s.shop_id).maybeSingle();
        const template: string | null = integ?.tracking_link_template ?? null;
        const patch: { carrier?: string | null; tracking_code?: string; tracking_url?: string; delivery_status?: string; shipped_at?: string } = {};
        if (!row.carrier) patch.carrier = fWithTrack.tracking_company ?? null;
        if (!row.tracking_code) patch.tracking_code = String(trackingNumber);
        if (template) {
          const url = template.replace("[CODE]", encodeURIComponent(String(trackingNumber)));
          if (url !== row.tracking_url) patch.tracking_url = url;
        } else if (!row.tracking_url) {
          const url = fWithTrack.tracking_url ?? fWithTrack.tracking_urls?.[0] ?? null;
          if (url) patch.tracking_url = url;
        }
        if (!row.delivery_status || row.delivery_status === "pending_shipment") {
          patch.delivery_status = "shipped";
          patch.shipped_at = fWithTrack.created_at ? String(fWithTrack.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
        }
        if (Object.keys(patch).length) {
          await supabaseAdmin.from("shop_orders").update(patch).eq("id", row.id);
          trackingChanged = true;
        }
      }
    }

    // Só avisa as telas quando muda algo que aparece nelas — orders/updated
    // chega várias vezes por pedido (edição de nota, tag, etc.).
    const relevant = !before
      || before.shopify_financial_status !== financial
      || (before as any).cancelled_at !== cancelledAt
      || trackingChanged;
    if (relevant) changedOwners.add(s.user_id);
  }

  return { changedOwners: [...changedOwners] };
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPausedShopifyStoreIds } from "@/lib/sync-pause.server";
import { orderDateFor } from "@/lib/order-date";
import { recomputeOrderCostForecast } from "@/lib/shop-orders.functions";
import { emitEvent } from "@/lib/notify.server";
import { isRecoveryOrder } from "@/lib/recovery-order";
import { tracked } from "@/lib/system-errors.server";
import { isoTodayUS } from "@/lib/timezone";
import { beforeCashflowStart, shopifyOrderRow, shopifyTrackingPatch } from "@/lib/shopify-order-apply";

// Push "Nova venda": loja + número + valor; o toque abre os pedidos do grupo
// da loja. Só pedido que acabou de entrar (não reprocessamento de antigo).
async function notifyNewSale(ownerId: string, shopId: string, o: any) {
  if (Date.now() - Date.parse(o.created_at) > 24 * 3600_000) return;
  const [{ data: shop }, { data: link }] = await Promise.all([
    supabaseAdmin.from("shops").select("name").eq("id", shopId).maybeSingle(),
    supabaseAdmin.from("lg_card_shops").select("card_id").eq("shop_id", shopId).limit(1).maybeSingle(),
  ]);
  let valor = `${o.currency ?? ""} ${o.total_price ?? ""}`.trim();
  try {
    valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: o.currency || "USD" }).format(Number(o.total_price ?? 0));
  } catch { /* moeda desconhecida: fica o texto cru */ }
  await emitEvent(ownerId, {
    key: `sale:${shopId}:${o.id}`,
    title: `🎉 Nova venda — ${shop?.name ?? "Loja"}`,
    body: `${o.name ?? "Pedido"} · ${valor}`,
    link: link?.card_id ? `/shops/lojas-grupos/${link.card_id}?tab=pedidos` : "/",
  });
}

// Grava em shop_orders um pedido que chegou pelo webhook da Shopify — mesmas
// regras do sync de 10 em 10 min e do botão (shopify-order-apply.ts); o sync
// continua rodando como rede de segurança.
// Devolve os donos (workspaces) em que algo relevante mudou, pra avisar as
// telas abertas.
export async function ingestShopifyOrder(storeId: string, o: any): Promise<{ changedOwners: string[] }> {
  if (!o?.id || !o?.created_at) return { changedOwners: [] };
  // Pedido de cobrança dos Alertas (tag recuperacao-alerta) não é venda: fica fora de shop_orders.
  if (isRecoveryOrder(o)) return { changedOwners: [] };

  const paused = await getPausedShopifyStoreIds();
  if (paused.has(storeId)) return { changedOwners: [] };

  const { data: settingsRows } = await supabaseAdmin.from("shop_order_settings")
    .select("shop_id,user_id,cashflow_start_date")
    .eq("shopify_store_id", storeId).eq("automation_enabled", true);

  const changedOwners = new Set<string>();
  const externalId = String(o.id);
  const orderDate = orderDateFor(o.created_at as string);
  const financial = o.financial_status ?? null;
  const cancelledAt = o.cancelled_at ?? null;

  for (const s of (settingsRows ?? []) as any[]) {
    // Pedido anterior ao início do Caixa não entra (mesma regra do cron e do botão).
    if (beforeCashflowStart(o, s.cashflow_start_date)) continue;

    const { data: before } = await supabaseAdmin.from("shop_orders")
      .select("id,shopify_financial_status,carrier,tracking_code,tracking_url,delivery_status,cancelled_at:raw->>cancelled_at,shopify_updated_at:raw->>updated_at")
      .eq("shop_id", s.shop_id).eq("source", "shopify").eq("external_id", externalId).maybeSingle();
    // A Shopify não garante a ordem dos webhooks: um orders/updated de antes do
    // reembolso chegando depois devolvia o pedido pra "paid" (o reembolso sumia
    // do lucro) — e pedido com mais de 30 dias o sync não corrige mais.
    const storedAt = Date.parse((before as any)?.shopify_updated_at ?? "");
    if (Number.isFinite(storedAt) && Date.parse(o.updated_at ?? "") < storedAt) continue;

    const { error: upErr } = await supabaseAdmin.from("shop_orders")
      .upsert(shopifyOrderRow(o, s), { onConflict: "shop_id,source,external_id" });
    if (upErr) throw new Error(upErr.message);
    // Pedido novo (não existia) e não cancelado → push de venda (nunca derruba o webhook).
    if (!before && !cancelledAt) await notifyNewSale(s.user_id, s.shop_id, o).catch((e) => console.error("push venda", e));

    // Previsão de pagamento ao fornecedor no Caixa (dia do pedido + D+N) na hora,
    // em vez de só quando alguém abre a aba Pedidos. Falha aqui não derruba o webhook.
    await tracked(s.user_id, `cost_forecast:${s.shop_id}`, "Previsão de pagamento ao fornecedor (Caixa) não recalculou",
      () => recomputeOrderCostForecast(s.user_id, s.shop_id, orderDate));

    // Rastreio do envio (mesmas regras do cron e do botão — shopify-order-apply.ts).
    let trackingChanged = false;
    if ((o.fulfillments ?? []).length) {
      const { data: row } = await supabaseAdmin.from("shop_orders")
        .select("id,carrier,tracking_code,tracking_url,delivery_status")
        .eq("shop_id", s.shop_id).eq("source", "shopify").eq("external_id", externalId).maybeSingle();
      if (row) {
        const { data: integ } = await supabaseAdmin.from("track123_integrations")
          .select("tracking_link_template").eq("shop_id", s.shop_id).maybeSingle();
        const patch = shopifyTrackingPatch(o, row, integ?.tracking_link_template ?? null, isoTodayUS());
        if (patch) {
          const { error: trErr } = await supabaseAdmin.from("shop_orders").update(patch).eq("id", row.id);
          if (trErr) throw new Error(trErr.message);
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

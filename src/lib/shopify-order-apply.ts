import { orderDateFor } from "@/lib/order-date";
import { isoDateUS } from "@/lib/timezone";

// Regras de como um pedido da Shopify entra em shop_orders — usadas pelos três
// caminhos que gravam pedido: o cron de 10 em 10 min (sync-shop-orders), o
// webhook (shopify-order-ingest) e o botão Sincronizar (syncShopifyOrders).
// Antes cada um tinha a sua cópia e elas tinham se separado (data de postagem
// em UTC num, link sem o template da loja noutro).

// Pedido anterior ao início do Caixa (cashflow_start_date) não entra por nenhum
// dos três caminhos.
export function beforeCashflowStart(o: { created_at?: string | null }, cutoff: string | null | undefined): boolean {
  return !!cutoff && !!o.created_at && orderDateFor(o.created_at) < cutoff;
}

// Linha de shop_orders (upsert por shop_id,source,external_id).
export function shopifyOrderRow(o: any, s: { user_id: string; shop_id: string }) {
  return {
    user_id: s.user_id, shop_id: s.shop_id, source: "shopify",
    external_id: String(o.id), order_number: o.name ?? null,
    created_at_shopify: o.created_at,
    order_date: orderDateFor(o.created_at as string),
    items_count: (o.line_items ?? []).reduce((x: number, li: any) => x + Number(li.quantity ?? 0), 0),
    revenue: Number(o.total_price ?? 0), currency: o.currency ?? null, raw: o,
    shopify_financial_status: o.financial_status ?? null,
  };
}

export type OrderLogistics = { carrier?: string | null; tracking_code?: string | null; tracking_url?: string | null; delivery_status?: string | null };
export type TrackingPatch = { carrier?: string | null; tracking_code?: string; tracking_url?: string; delivery_status?: string; shipped_at?: string };

// O que o envio da Shopify muda no pedido, sem desfazer ajuste manual:
//  - transportadora e código só preenchem se estiverem vazios (código trocado à
//    mão fica);
//  - com template de link da loja, o link é sempre o do template com o código
//    DO PEDIDO (pode ser o trocado à mão) — o link que a Shopify manda pode vir
//    com o domínio de outra loja. Só grava quando muda, então não fica regravando;
//  - sem template, o link da Shopify só preenche se estiver vazio;
//  - pedido ainda sem envio vira "enviado", com a data de postagem no dia de NY.
// Devolve null quando o pedido não tem envio com código ou nada mudou.
export function shopifyTrackingPatch(o: any, existing: OrderLogistics, template: string | null, today: string): TrackingPatch | null {
  const f = [...((o.fulfillments ?? []) as any[])].reverse()
    .find((x) => x.tracking_number || (x.tracking_numbers && x.tracking_numbers.length));
  const trackingNumber = f ? (f.tracking_number ?? f.tracking_numbers?.[0] ?? null) : null;
  if (!f || !trackingNumber) return null;
  const patch: TrackingPatch = {};
  if (!existing.carrier && f.tracking_company) patch.carrier = f.tracking_company;
  if (!existing.tracking_code) patch.tracking_code = String(trackingNumber);
  if (template) {
    const url = template.replace("[CODE]", encodeURIComponent(String(existing.tracking_code ?? trackingNumber)));
    if (url !== existing.tracking_url) patch.tracking_url = url;
  } else if (!existing.tracking_url) {
    const url = f.tracking_url ?? f.tracking_urls?.[0] ?? null;
    if (url) patch.tracking_url = url;
  }
  if (!existing.delivery_status || existing.delivery_status === "pending_shipment") {
    patch.delivery_status = "shipped";
    patch.shipped_at = f.created_at ? isoDateUS(String(f.created_at)) : today;
  }
  return Object.keys(patch).length ? patch : null;
}

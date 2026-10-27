// `history`: custos com a data de início (product_cost_history), mais recente
// primeiro. Mudar o custo de um produto vale da data da mudança pra frente —
// pedidos antigos continuam com o custo da época.
export type CostProduct = LinkedProduct & {
  id?: string; name: string; cost: number;
  history?: { from: string; cost: number }[];
};

// Custo do produto na data do pedido (YYYY-MM-DD). Sem data ou sem histórico: o atual.
export function productCostAt(p: CostProduct, date?: string | null): number {
  if (date && p.history?.length) {
    const h = p.history.find((r) => r.from <= date);
    if (h) return h.cost;
  }
  return Number(p.cost ?? 0);
}

// `li`: item do pedido como a Shopify manda (product_id).
export function matchLineItemCost(li: any, products: CostProduct[], date?: string | null): number | null {
  const p = matchLineItemProduct(li, products);
  return p ? productCostAt(p, date) : null;
}

// Tag do pedido na Shopify que zera o custo do fornecedor: reenvio que o
// fornecedor manda sem cobrar.
export const SUPPLIER_FREE_TAG = "reenvio-fornecedor";

export function isSupplierFree(tags: string | null | undefined): boolean {
  return !!tags && tags.split(",").some((t) => t.trim().toLowerCase() === SUPPLIER_FREE_TAG);
}

// Quantas unidades do item têm custo de fornecedor:
//  - o que foi enviado (item "fulfilled"/"partial" na Shopify) tem custo, mesmo
//    que o pedido tenha sido reembolsado depois — o produto saiu;
//  - o que não foi enviado conta pela quantidade atual (current_quantity): item
//    removido por edição, pedido reembolsado ou cancelado antes do envio sai do
//    custo (a Shopify zera a quantidade atual nesses casos).
// `hasTracking`: código de rastreio lançado à mão, sem envio na Shopify — conta
// como enviado.
export function lineItemCostQty(li: any, hasTracking = false): number {
  const qty = Number(li.quantity ?? 0);
  const current = li.current_quantity != null ? Number(li.current_quantity) : qty;
  const shipped = li.fulfillment_status === "fulfilled" ? qty
    : li.fulfillment_status === "partial" ? Math.max(0, qty - Number(li.fulfillable_quantity ?? 0))
    : 0;
  if (hasTracking && shipped === 0 && current === 0) return qty;
  return Math.max(shipped, current);
}

export type OrderCostOpts = { date?: string | null; hasTracking?: boolean };

// `tags` = tags do pedido (raw->>tags); com "reenvio-fornecedor" o custo é 0.
// `opts.date` = data do pedido (custo da época); `opts.hasTracking` = tem código de rastreio.
export function orderLineItemsCost(rawLineItems: any[] | undefined, products: CostProduct[], fallbackUnitCost: number, tags?: string | null, opts: OrderCostOpts = {}): number {
  if (isSupplierFree(tags)) return 0;
  let total = 0;
  for (const li of rawLineItems ?? []) {
    const qty = lineItemCostQty(li, opts.hasTracking);
    if (!qty) continue;
    const matched = matchLineItemCost(li, products, opts.date);
    total += qty * (matched ?? fallbackUnitCost);
  }
  return total;
}

// Opções a partir de uma linha de shop_orders (order_date + tracking_code no select).
export const costOpts = (o: { order_date?: string | null; tracking_code?: string | null }): OrderCostOpts =>
  ({ date: o.order_date ?? null, hasTracking: !!o.tracking_code });

// Card de Produto do item do pedido (product_shopify_links, botão "Sincronizar
// Card"): o card ligado ao produto da Shopify do item; item sem product_id
// (produto apagado na Shopify, item avulso, app) vai pelo título exato ligado.
// Sem ligação: null.
export type LinkedProduct = { shopify_product_ids?: string[] | null; line_item_titles?: string[] | null };

// Mesma normalização de normalize_line_item_title no banco.
export function normalizeLineItemTitle(title: string | null | undefined): string {
  return (title ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function lineItemShopifyProductId(li: any): string | null {
  const id = li?.product_id;
  return id == null || id === "" ? null : String(id);
}

type LinkIndex = { byId: Map<string, LinkedProduct>; byTitle: Map<string, LinkedProduct> };
const linkIndexes = new WeakMap<readonly LinkedProduct[], LinkIndex>();

export function matchLineItemProduct<P extends LinkedProduct>(li: any, products: P[]): P | null {
  let index = linkIndexes.get(products);
  if (!index) {
    index = { byId: new Map(), byTitle: new Map() };
    for (const p of products) {
      for (const s of p.shopify_product_ids ?? []) index.byId.set(s, p);
      for (const t of p.line_item_titles ?? []) index.byTitle.set(t, p);
    }
    linkIndexes.set(products, index);
  }
  const id = lineItemShopifyProductId(li);
  const p = id ? index.byId.get(id) : index.byTitle.get(normalizeLineItemTitle(li?.title ?? li?.name));
  return (p as P | undefined) ?? null;
}

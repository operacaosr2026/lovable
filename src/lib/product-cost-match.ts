// `history`: custos com a data de início (product_cost_history), mais recente
// primeiro. Mudar o custo de um produto vale da data da mudança pra frente —
// pedidos antigos continuam com o custo da época.
export type CostProduct = {
  name: string; keywords: string[] | null; cost: number;
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

export function matchLineItemCost(title: string, products: CostProduct[], date?: string | null): number | null {
  const t = (title || "").toLowerCase();
  let best: { p: CostProduct; len: number } | null = null;
  for (const p of products) {
    const candidates = [p.name, ...(p.keywords ?? [])];
    for (const c of candidates) {
      const cLower = c.trim().toLowerCase();
      if (cLower && t.includes(cLower)) {
        if (!best || cLower.length > best.len) best = { p, len: cLower.length };
      }
    }
  }
  return best ? productCostAt(best.p, date) : null;
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
    const matched = matchLineItemCost(li.title ?? li.name ?? "", products, opts.date);
    total += qty * (matched ?? fallbackUnitCost);
  }
  return total;
}

// Opções a partir de uma linha de shop_orders (order_date + tracking_code no select).
export const costOpts = (o: { order_date?: string | null; tracking_code?: string | null }): OrderCostOpts =>
  ({ date: o.order_date ?? null, hasTracking: !!o.tracking_code });

// Produto do catálogo que casa com o título do item (mesma regra do custo:
// nome ou palavra-chave contida no título, vence o trecho mais longo).
export function matchLineItemProduct<P extends { name: string; keywords: string[] | null }>(title: string, products: P[]): P | null {
  const t = (title || "").toLowerCase();
  let best: { p: P; len: number } | null = null;
  for (const p of products) {
    for (const c of [p.name, ...(p.keywords ?? [])]) {
      const cLower = c.trim().toLowerCase();
      if (cLower && t.includes(cLower) && (!best || cLower.length > best.len)) best = { p, len: cLower.length };
    }
  }
  return best ? best.p : null;
}

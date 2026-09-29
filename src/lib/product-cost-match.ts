export type CostProduct = { name: string; keywords: string[] | null; cost: number };

export function matchLineItemCost(title: string, products: CostProduct[]): number | null {
  const t = (title || "").toLowerCase();
  let best: { cost: number; len: number } | null = null;
  for (const p of products) {
    const candidates = [p.name, ...(p.keywords ?? [])];
    for (const c of candidates) {
      const cLower = c.trim().toLowerCase();
      if (cLower && t.includes(cLower)) {
        if (!best || cLower.length > best.len) best = { cost: Number(p.cost ?? 0), len: cLower.length };
      }
    }
  }
  return best ? best.cost : null;
}

// Tag do pedido na Shopify que zera o custo do fornecedor: reenvio que o
// fornecedor manda sem cobrar.
export const SUPPLIER_FREE_TAG = "reenvio-fornecedor";

export function isSupplierFree(tags: string | null | undefined): boolean {
  return !!tags && tags.split(",").some((t) => t.trim().toLowerCase() === SUPPLIER_FREE_TAG);
}

// `tags` = tags do pedido (raw->>tags); com "reenvio-fornecedor" o custo é 0.
export function orderLineItemsCost(rawLineItems: any[] | undefined, products: CostProduct[], fallbackUnitCost: number, tags?: string | null): number {
  if (isSupplierFree(tags)) return 0;
  let total = 0;
  for (const li of rawLineItems ?? []) {
    const qty = Number(li.quantity ?? 0);
    const matched = matchLineItemCost(li.title ?? li.name ?? "", products);
    total += qty * (matched ?? fallbackUnitCost);
  }
  return total;
}

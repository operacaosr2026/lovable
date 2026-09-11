function stripMyshopifyDomain(domain: string | null | undefined): string | null {
  return domain ? domain.replace(/\.myshopify\.com$/i, "") : null;
}

function trailingOrderNumber(label: string): number {
  const m = label.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

export type SupplierMessageBlock = { shopName: string; shopDomain: string | null; orderLabels: string[] };

export function buildSupplierMessage(blocks: SupplierMessageBlock[]): string {
  return blocks
    .filter((b) => b.orderLabels.length > 0)
    .map((b) => {
      const sorted = [...b.orderLabels].sort((a, c) => trailingOrderNumber(a) - trailingOrderNumber(c));
      const range = sorted.length > 1 ? `${sorted[0]} a ${sorted[sorted.length - 1]}` : sorted[0];
      const domain = stripMyshopifyDomain(b.shopDomain);
      const header = domain ? `Loja ${domain} - ${b.shopName}` : `Loja ${b.shopName}`;
      return `${header}\nEnviar os pedidos abaixo, já pago:\n${range}`;
    })
    .join("\n\n");
}

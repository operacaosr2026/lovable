function stripMyshopifyDomain(domain: string | null | undefined): string | null {
  return domain ? domain.replace(/\.myshopify\.com$/i, "") : null;
}

function trailingOrderNumber(label: string): number {
  const m = label.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

// supplierResends: pedidos com a tag reenvio-fornecedor (custo $0,00 pra nós —
// o fornecedor reenvia por conta dele) — vão juntos numa Obs. no fim.
// total: custo de produto já formatado, no começo. Os dois em negrito (*…*, WhatsApp).
export type SupplierMessageBlock = { shopName: string; shopDomain: string | null; orderLabels: string[]; supplierResends?: string[] };

export function buildSupplierMessage(blocks: SupplierMessageBlock[], total?: string): string {
  const live = blocks.filter((b) => b.orderLabels.length > 0);
  const body = live
    .map((b) => {
      const sorted = [...b.orderLabels].sort((a, c) => trailingOrderNumber(a) - trailingOrderNumber(c));
      const range = sorted.length > 1 ? `${sorted[0]} a ${sorted[sorted.length - 1]}` : sorted[0];
      const domain = stripMyshopifyDomain(b.shopDomain);
      const header = domain ? `Loja ${domain} - ${b.shopName}` : `Loja ${b.shopName}`;
      return `${header}\n${range}`;
    })
    .join("\n\n");
  if (!body) return "";
  const resends = live.flatMap((b) => [...(b.supplierResends ?? [])].sort((a, c) => trailingOrderNumber(a) - trailingOrderNumber(c)));
  const head = `Enviar os pedidos abaixo, já pagos! Favor enviar imediatamente:${total ? `\n\n*Valor total: ${total}*` : ""}`;
  const obs = resends.length ? `\n\n*Obs.: reenvio fornecedor (custo $0.00): ${resends.join(", ")}*` : "";
  return `${head}\n\n${body}${obs}`;
}

// Rastreamento: os pedidos selecionados não são sequenciais, então cada um vai
// numa linha própria com o código de rastreio e o status.
export type TrackingMessageLine = { orderLabel: string; trackingCode: string | null; status: string };
export type TrackingMessageBlock = { shopName: string; shopDomain: string | null; lines: TrackingMessageLine[] };

export function buildTrackingMessage(blocks: TrackingMessageBlock[]): string {
  const body = blocks
    .filter((b) => b.lines.length > 0)
    .map((b) => {
      const sorted = [...b.lines].sort((a, c) => trailingOrderNumber(a.orderLabel) - trailingOrderNumber(c.orderLabel));
      const domain = stripMyshopifyDomain(b.shopDomain);
      const header = domain ? `Loja ${domain} - ${b.shopName}` : `Loja ${b.shopName}`;
      const lines = sorted.map((l) => [l.orderLabel, l.trackingCode ?? "sem rastreio", l.status].join(" - "));
      return `${header}\n${lines.join("\n")}`;
    })
    .join("\n\n");
  return body ? `Verificar os pedidos abaixo, por favor:\n\n${body}` : "";
}

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

// Gerencial › Alertas › gaveta: mensagem pro fornecedor (WhatsApp) cobrando o
// que está acontecendo com os pedidos do alerta — o pedido do topo muda conforme
// o tipo do alerta; cada pedido numa linha com código e situação.
export type AlertSupplierLine = {
  number: string; shop: string; shopDomain: string | null; code: string | null; reason: string;
  lastEvent: string | null; lastEventAt: string | null; daysStopped: number | null;
  oldCode: string | null; oldDeliveredAt: string | null;
};
const ddmmMsg = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

function alertSupplierHead(key: string): string {
  if (key === "rastreio:reenvio_entregue") return "Os pedidos abaixo foram reenviados, mas o pacote antigo já foi entregue ao cliente. Favor *cancelar o reenvio*:";
  if (key.startsWith("rastreio:nao_postado")) return "Os pedidos abaixo estão com etiqueta gerada mas *ainda não foram postados*. Favor despachar com urgência:";
  if (key === "rastreio:repassado") return "Os pedidos abaixo foram repassados à transportadora local dos EUA e estão *sem movimento*. Favor verificar e passar o código de rastreio local:";
  if (key === "rastreio:cliente") return "Os pedidos abaixo tiveram *problema na entrega* (endereço / devolução / falha). Favor verificar com a transportadora:";
  if (key.startsWith("track123:alfandega:")) return "Os pacotes abaixo estão *parados na alfândega dos EUA*. Favor verificar com a transportadora e dar retorno:";
  if (key.startsWith("track123:lote:")) return "Os pacotes abaixo estão *parados* (mesmo lote). Favor verificar com a transportadora e dar retorno:";
  if (key === "fora:sem_evento") return "Os códigos abaixo *não mostram nenhuma movimentação* no rastreio. Favor conferir se o código está certo:";
  return "Verificar os pedidos abaixo, por favor:";
}

export function buildAlertSupplierMessage(key: string, orders: AlertSupplierLine[]): string {
  if (!orders.length) return "";
  const byShop = new Map<string, AlertSupplierLine[]>();
  for (const o of orders) {
    const k = `${o.shopDomain ?? ""}|${o.shop}`;
    if (!byShop.has(k)) byShop.set(k, []);
    byShop.get(k)!.push(o);
  }
  const line = (o: AlertSupplierLine) => {
    if (key === "rastreio:reenvio_entregue") {
      const old = o.oldCode ? `antigo ${o.oldCode} entregue${o.oldDeliveredAt ? ` em ${ddmmMsg(o.oldDeliveredAt)}` : ""}` : "pacote antigo entregue";
      return `${o.number} - reenvio ${o.code ?? "sem código"} - ${old}`;
    }
    const last = o.lastEvent ? ` (último: ${o.lastEvent}${o.lastEventAt ? ` em ${ddmmMsg(o.lastEventAt)}` : ""})` : "";
    return `${o.number} - ${o.code ?? "sem rastreio"} - ${o.reason}${last}`;
  };
  const body = [...byShop.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR", { numeric: true }))
    .map(([, list]) => {
      const domain = stripMyshopifyDomain(list[0].shopDomain);
      const header = domain ? `Loja ${domain} - ${list[0].shop}` : `Loja ${list[0].shop}`;
      const sorted = [...list].sort((a, c) => trailingOrderNumber(a.number) - trailingOrderNumber(c.number));
      return `${header}\n${sorted.map(line).join("\n")}`;
    })
    .join("\n\n");
  return `${alertSupplierHead(key)}\n\n${body}`;
}

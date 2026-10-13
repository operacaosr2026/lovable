// Código do Custom Pixel da Shopify (Configurações → Eventos de clientes →
// Adicionar pixel personalizado) que alimenta o funil por produto. Matriz:
// visualização do produto (sessões). Sublojas: checkout iniciado. Recebido
// em /api/public/pixel.
export type FunnelPixelRole = "matriz" | "subloja";

export function funnelPixelCode(origin: string, role: FunnelPixelRole) {
  const send = `const SRX_URL = "${origin}/api/public/pixel";
function srxSend(step, clientId, products) {
  const list = products.filter((p) => p && p.id).map((p) => ({ id: String(p.id), title: String(p.title || "") }));
  if (!list.length || !clientId) return;
  fetch(SRX_URL, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ shop: init.data.shop.myshopifyDomain, step, client_id: clientId, products: list }),
  }).catch(() => {});
}`;
  if (role === "matriz") {
    return `${send}

analytics.subscribe("product_viewed", (event) => {
  srxSend("session", event.clientId, [event.data?.productVariant?.product]);
});
`;
  }
  return `${send}

analytics.subscribe("checkout_started", (event) => {
  const items = event.data?.checkout?.lineItems || [];
  srxSend("checkout", event.clientId, items.map((li) => li?.variant?.product));
});
`;
}

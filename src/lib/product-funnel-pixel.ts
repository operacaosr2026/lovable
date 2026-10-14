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
  // Matriz: a página do produto é do PageFly em rascunho (/apps/pagefly?id=...),
  // que não dispara product_viewed — vai o id da página ("pf:<id>", ligado ao
  // produto no card do funil) e o título da aba. Página de produto do tema
  // conta pelo product_viewed e pela URL /products/<handle> ("h:<handle>").
  // O servidor junta tudo por visitante.
  if (role === "matriz") {
    return `${send}

analytics.subscribe("product_viewed", (event) => {
  srxSend("session", event.clientId, [event.data?.productVariant?.product]);
});

analytics.subscribe("page_viewed", (event) => {
  const doc = event.context?.document || {};
  const loc = doc.location || {};
  const path = loc.pathname || "";
  const pf = path.startsWith("/apps/pagefly") ? new URLSearchParams(loc.search || "").get("id") : null;
  if (pf) return srxSend("session", event.clientId, [{ id: "pf:" + pf, title: doc.title || "" }]);
  const m = path.match(/\\/products\\/([^/?#]+)/);
  if (m) srxSend("session", event.clientId, [{ id: "h:" + decodeURIComponent(m[1]), title: decodeURIComponent(m[1]).replace(/-/g, " ") }]);
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

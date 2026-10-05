import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { shopifyGql } from "@/lib/chargeback-recovery.server";

// Manda o status do rastreio pro envio do pedido na Shopify (evento de
// fulfillment: em trânsito, saiu pra entrega, entregue…). Com isso o pedido
// aparece como entregue na Shopify, a página de status da loja acompanha e a
// Shopify pode mandar os e-mails "Out for delivery"/"Delivered" sozinha.
// Vai só o status (+ previsão oficial, se tiver) — nunca o texto do histórico,
// então nada de alfândega/China chega à Shopify por aqui.
// Precisa do escopo write_fulfillments (loja reautorizada); sem ele a Shopify
// recusa e o erro volta como "reautorize a loja".
//
// AINDA NÃO É CHAMADO AUTOMATICAMENTE — vai ser ligado junto com o sync do 17track.

// Status do 17track → status de evento da Shopify. InfoReceived/NotFound/Expired
// não viram evento; Exception também não (costuma ser passageiro, e "FAILURE"
// na Shopify parece definitivo pro cliente).
const SHOPIFY_STATUS: Record<string, string> = {
  InTransit: "IN_TRANSIT",
  AvailableForPickup: "READY_FOR_PICKUP",
  OutForDelivery: "OUT_FOR_DELIVERY",
  DeliveryFailure: "ATTEMPTED_DELIVERY",
  Delivered: "DELIVERED",
};
// Ordem de avanço: nunca manda um status "pra trás" do que a Shopify já tem.
const RANK: Record<string, number> = {
  LABEL_PRINTED: 0, LABEL_PURCHASED: 0, CONFIRMED: 0, READY_FOR_PICKUP: 3,
  IN_TRANSIT: 1, CARRIER_PICKED_UP: 1, OUT_FOR_DELIVERY: 2, ATTEMPTED_DELIVERY: 3, DELIVERED: 4,
};

export type PushResult =
  | { sent: true; status: string }
  | { sent: false; reason: string };

export async function pushFulfillmentStatusToShopify(opts: {
  orderId: string;                 // shop_orders.id
  trackingNumber: string;
  status: string | null;           // chave do 17track (InTransit, Delivered…)
  happenedAt?: string | null;      // quando aconteceu (ISO)
  estimatedDeliveryAt?: string | null; // previsão oficial da transportadora
}): Promise<PushResult> {
  const target = opts.status ? SHOPIFY_STATUS[opts.status] : undefined;
  if (!target) return { sent: false, reason: `status ${opts.status ?? "vazio"} não vai pra Shopify` };

  const { data: order } = await supabaseAdmin.from("shop_orders")
    .select("shop_id,order_number,fulfillments:raw->fulfillments").eq("id", opts.orderId).maybeSingle();
  if (!order) return { sent: false, reason: "pedido não encontrado" };
  const f = ((order as any).fulfillments as any[] ?? []).find((x) =>
    x?.tracking_number === opts.trackingNumber || (x?.tracking_numbers ?? []).includes(opts.trackingNumber));
  const fulfillmentId: string | undefined = f?.admin_graphql_api_id ?? (f?.id ? `gid://shopify/Fulfillment/${f.id}` : undefined);
  if (!fulfillmentId) return { sent: false, reason: "envio com esse código não está no pedido" };

  // O que a Shopify já tem nesse envio (pode ter vindo de outro app, ex. Track123).
  const cur = await shopifyGql((order as any).shop_id, `query FulfillmentEvents($id: ID!) {
    fulfillment(id: $id) { displayStatus events(first: 50) { nodes { status } } }
  }`, { id: fulfillmentId });
  const existing: string[] = (cur?.fulfillment?.events?.nodes ?? []).map((n: any) => n.status);
  if (existing.includes(target)) return { sent: false, reason: `Shopify já tem ${target}` };
  const best = Math.max(-1, ...existing.map((s) => RANK[s] ?? -1));
  if (best >= RANK[target]) return { sent: false, reason: `Shopify já está mais adiantada (${existing.join(", ")})` };

  const out = await shopifyGql((order as any).shop_id, `mutation FulfillmentEvent($e: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $e) { fulfillmentEvent { id status } userErrors { field message } }
  }`, {
    e: {
      fulfillmentId,
      status: target,
      ...(opts.happenedAt ? { happenedAt: opts.happenedAt } : {}),
      ...(opts.estimatedDeliveryAt ? { estimatedDeliveryAt: opts.estimatedDeliveryAt } : {}),
    },
  });
  const errs = out?.fulfillmentEventCreate?.userErrors ?? [];
  if (errs.length) return { sent: false, reason: errs.map((e: any) => e.message).join("; ").slice(0, 200) };
  return { sent: true, status: target };
}

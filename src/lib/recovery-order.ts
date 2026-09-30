// Pedido de cobrança dos Alertas de chargeback ("Payment for order #X"): criado
// pelo sistema como rascunho na Shopify, com esta tag. Depois de pago ele NÃO
// entra em shop_orders (Pedidos, Logística, Rastreio, custo, push de venda) — o
// valor recuperado abate o reembolso no lucro (getGroupRefundsAndChargebacks).
export const RECOVERY_ORDER_TAG = "recuperacao-alerta";

export function isRecoveryOrder(o: { tags?: string | null } | null | undefined): boolean {
  const tags = o?.tags;
  return !!tags && tags.split(",").some((t) => t.trim().toLowerCase() === RECOVERY_ORDER_TAG);
}

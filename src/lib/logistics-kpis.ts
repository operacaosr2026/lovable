// Regras dos indicadores de logística — usadas pela aba Rastreamento
// (LgLogistica) e pelo Dashboard, pra os dois mostrarem sempre os mesmos
// números a partir dos mesmos pedidos (listLogisticsOrders).

// Agrupa os status brutos do Shopify/Track123 nos 4 buckets exibidos nos cards de KPI.
export function inBucket(o: any, key: string): boolean {
  const s = o.delivery_status;
  if (key === "pending")   return s === "pending_shipment" || !s;
  if (key === "shipped")   return s === "shipped" || s === "in_transit";
  if (key === "delivered") return s === "delivered";
  if (key === "problem")   return s === "problem" || s === "returned";
  if (key === "waiting_customer") return s === "waiting_customer";
  return true;
}
export function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  return (nowMs - new Date(iso).getTime()) / 86_400_000;
}
// Dias úteis (seg-sex) entre a data do pedido e agora — não conta a data do
// pedido em si, só os dias que já se passaram desde então.
export function businessDaysSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const cur = new Date(iso + "T00:00:00Z");
  const now = new Date(nowMs);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let count = 0;
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
// Motivo extra (além do que o badge de status já mostra) pra sinalizar um pedido
// parado: enviado há +7 dias sem atualização, ou pedido feito há +28 dias e ainda
// sem entrega. Não cobre "pendente de envio"/"problema", que o badge já deixa claro,
// nem "esperando cliente" — a ação nesse caso já não é da loja.
export function attentionReason(o: any, nowMs: number): string | null {
  const status = o.delivery_status ?? "pending_shipment";
  if (status === "waiting_customer") return null;
  if (status === "shipped" || status === "in_transit") {
    // last_event_at (Track123) reflete o último evento real de rastreio; sem
    // integração ativa, cai pra shipped_at (data da postagem) como referência.
    const d = daysSince(o.last_event_at ?? o.shipped_at, nowMs);
    if (d != null && d >= 7) return `${Math.floor(d)}d sem atualização`;
  }
  if (status !== "delivered" && status !== "returned") {
    const d = daysSince(o.order_date, nowMs);
    if (d != null && d >= 25) return `${Math.floor(d)}d sem entrega`;
  }
  return null;
}
// Precisa de atenção: pendente de envio há mais de 3 dias úteis, marcado como
// problema, parado sem atualização de rastreio há +7 dias, ou feito há +25
// dias e ainda não entregue. "Esperando cliente" fica de fora — a bola já não
// está com a loja. Pendente de envio recente (até 3 dias úteis) é normal, não
// precisa aparecer aqui ainda.
export function needsAttention(o: any, nowMs: number): boolean {
  const status = o.delivery_status ?? "pending_shipment";
  if (status === "pending_shipment") return businessDaysSince(o.order_date, nowMs) > 3;
  return status === "problem" || attentionReason(o, nowMs) != null;
}

// Indicadores exibidos no topo do Rastreamento (e no Dashboard). `orders` é o
// retorno de listLogisticsOrders, já no recorte desejado (período/loja/busca).
// Contagens usam todos os pedidos; tempos médios ignoram os marcados "fora do
// KPI" (ex.: pedido parado esperando cliente não infla a média).
export function computeLogisticsKpis(orders: any[], nowMs: number) {
  const kpiOrders = orders.filter((o) => !o.kpi_excluded);

  // Tempo médio de postagem: dias entre o pedido (order_date) e a etiqueta (shipped_at)
  const postingDurations = kpiOrders
    .filter((o) => o.order_date && o.shipped_at)
    .map((o) => (new Date(o.shipped_at).getTime() - new Date(o.order_date).getTime()) / 86_400_000)
    .filter((d) => d >= 0);

  // Tempo médio de entrega: dias entre postagem (shipped_at) e entrega (delivered_at)
  const deliveryDurations = kpiOrders
    .filter((o) => o.shipped_at && o.delivered_at)
    .map((o) => (new Date(o.delivered_at).getTime() - new Date(o.shipped_at).getTime()) / 86_400_000)
    .filter((d) => d >= 0);

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    pending:   orders.filter((o) => inBucket(o, "pending")).length,
    shipped:   orders.filter((o) => inBucket(o, "shipped")).length,
    delivered: orders.filter((o) => inBucket(o, "delivered")).length,
    problem:   orders.filter((o) => inBucket(o, "problem")).length,
    waitingCustomer: orders.filter((o) => inBucket(o, "waiting_customer")).length,
    attention: orders.filter((o) => needsAttention(o, nowMs)).length,
    avgPostingDays: avg(postingDurations),
    avgDeliveryDays: avg(deliveryDurations),
  };
}

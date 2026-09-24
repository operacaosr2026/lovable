import { US_TIME_ZONE } from "@/lib/timezone";

// Data do pedido (shop_orders.order_date).
//
// O sistema conta os dias pelo horário de Nova York ("hoje", períodos,
// Dashboard), mas as lojas podem estar em outro fuso na Shopify (4 lojas do
// Route estão em America/Halifax, 1h à frente). Datando pelo fuso da loja, o
// pedido feito entre 23h e meia-noite de NY ganhava a data do dia seguinte e
// sumia das telas até virar o dia em NY.
//
// A partir de NY_ORDER_DATE_SINCE todo pedido é datado pelo horário de NY,
// qualquer que seja o fuso da loja (loja nova em outro fuso já entra certa).
// Pedidos anteriores mantêm a data que já tinham (fuso da loja) — combinado em
// 24/09/2026 pra não mexer em lotes de pagamento e fechamentos antigos. O corte
// fica no código porque o sync regrava os pedidos dos últimos 30 dias.
export const NY_ORDER_DATE_SINCE = "2026-09-23T04:00:00Z"; // 23/09/2026 00:00 em Nova York

const nyDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: US_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));

// `createdAt` = created_at da Shopify (vem com o offset do fuso da loja).
export function orderDateFor(createdAt: string): string {
  const t = Date.parse(createdAt);
  if (Number.isFinite(t) && t >= Date.parse(NY_ORDER_DATE_SINCE)) return nyDate(createdAt);
  return createdAt.slice(0, 10);
}

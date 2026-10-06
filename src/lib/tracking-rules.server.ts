import { isoDateUS } from "@/lib/timezone";

// Regras do rastreio usadas pelo sync (seventeen-track.server.ts): quando um
// pedido conta como entregue, a data de postagem e eventos fora de ordem.
// O histórico fica gravado como { event_time_utc: "2026-09-23 03:36:37" (UTC,
// sem fuso), event_detail, event_location } em shop_order_tracking.timeline.

// "2026-09-23 03:36:37" (UTC sem fuso) → instante ISO; sem isso, o fallback.
export function eventUtc(utc: string | null | undefined, fallback: string | null | undefined): string | null {
  const m = utc?.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return `${m[1]}T${m[2]}Z`;
  return fallback ?? null;
}

// Dia do evento em Nova York (fuso do negócio). Instante com fuso → converte;
// só data ("2026-09-23") → usa como está.
export function eventDateUS(eventAt: string | null | undefined): string | null {
  if (!eventAt || !/^\d{4}-\d{2}-\d{2}/.test(eventAt)) return null;
  if (!/[T ]\d{2}:\d{2}/.test(eventAt)) return eventAt.slice(0, 10);
  const ms = Date.parse(eventAt);
  return Number.isFinite(ms) ? isoDateUS(ms) : eventAt.slice(0, 10);
}

// "Entregue" vem do status geral do rastreio, não do texto do histórico: regra
// "delivered" casando por trecho pegava "Delivered to local carrier" (repasse
// entre transportadoras) e o pedido saía da fila como entregue, ainda em
// trânsito (#WV1330). Exceção: evento que COMEÇA com "Delivered" é entrega ao
// cliente ("Delivered, Front Door/Porch", "Delivered, In/At Mailbox"…) — o
// status geral às vezes fica dias em "Out for delivery" depois disso (#L2-1050).
export function labelSaysDelivered(label: string | null | undefined): boolean {
  if (!label) return false;
  const t = label.trim().toLowerCase();
  if (!/^delivered\b/.test(t)) return false;
  if (/^delivered\s+to\b/.test(t)) return false;
  if (/\b(not|un|attempt\w*|fail\w*)\s*(to be\s*)?deliver/.test(t)) return false;
  return true;
}

function statusSaysDelivered(transitStatus: string | null | undefined, lastLabel: string | null | undefined): boolean {
  const ts = (transitStatus ?? "").toLowerCase().replace(/\s+/g, "");
  if (ts.includes("delivered") && !ts.includes("undelivered")) return true;
  return labelSaysDelivered(lastLabel);
}

// Alvo final depois das regras da loja: entregue só com o status geral dizendo
// entregue; regra "delivered" sem isso = pacote andando (shipped).
export function finalTrackingTarget(
  target: string | null, transitStatus: string | null | undefined, lastLabel: string | null | undefined, hasTrackingNumber: boolean,
): string | null {
  if (statusSaysDelivered(transitStatus, lastLabel)) return "delivered";
  if (target === "delivered") return hasTrackingNumber ? "shipped" : null;
  return target;
}

// Evento que é só a transportadora recebendo a info eletrônica / etiqueta
// criada — o pacote ainda não foi postado.
const INFO_ONLY_EVENT = /information received|info received|信息已收到|label created|pre-shipment|electronic information|order created/i;

// Dia (Nova York) da 1ª movimentação real do pacote no histórico — postagem
// (definição do TM Postagem), pulando "informação eletrônica recebida".
export function firstCarrierEventDateUS(events: any[] | null | undefined): string | null {
  let first: string | null = null;
  for (const e of events ?? []) {
    const detail = String(e?.event_detail ?? e?.description ?? "");
    if (!detail || INFO_ONLY_EVENT.test(detail)) continue;
    const at = eventUtc(e?.event_time_utc, e?.time_utc ?? e?.event_time);
    if (at && Number.isFinite(Date.parse(at)) && (!first || Date.parse(at) < Date.parse(first))) first = at;
  }
  return eventDateUS(first);
}

// Evento mais antigo que o já gravado = chegou fora de ordem — não pode
// sobrescrever um status mais novo.
export function isOlderEvent(incoming: string | null | undefined, stored: string | null | undefined): boolean {
  if (!incoming || !stored) return false;
  const a = Date.parse(incoming), b = Date.parse(stored);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

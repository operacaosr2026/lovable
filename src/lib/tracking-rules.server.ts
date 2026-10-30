import { cleanEventText } from "@/lib/tracking-display";
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
  // "Delivered, To Original Sender" = devolvido ao remetente (#WV1294).
  if (/sender|return/.test(t)) return false;
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
// "Order received" e "Preparing shipment" também são só aviso (postagem
// adiantada em 9 pedidos, out/2026).
const INFO_ONLY_EVENT = /information received|info received|信息已收到|label created|etiqueta de envio|criada da etiqueta|pre-shipment|electronic information|order created|order received|preparing shipment/i;

// Dia (Nova York) da 1ª movimentação real do pacote no histórico — postagem
// (definição do TM Postagem), pulando "informação eletrônica recebida".
export function firstCarrierEventDateUS(events: any[] | null | undefined): string | null {
  let first: string | null = null;
  for (const e of events ?? []) {
    const detail = String(e?.event_detail ?? e?.description ?? "");
    // Evento vazio ("(中文:)", só com local) não é movimentação.
    if (!cleanEventText(detail) || INFO_ONLY_EVENT.test(detail)) continue;
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

// Parado na alfândega: último evento é de alfândega há 15+ dias. Vale pro aviso
// "Alfândega" do sino e pro status Problema do pedido (sync do 17track).
export const CUSTOMS_STUCK_DAYS = 15;

// Evento de pacote retido na alfândega do destino (ainda não liberado).
const CUSTOMS_HOLD = /customs clearance in progress|under clearance|inbound into customs|started the customs clearance|clearance in progress|customs.*(inspection|exception|abnormal|hold|delay)|clearance.*(exception|abnormal|failed|delay)|海关查验|等待清关|清关异常|目的国清关|进口海关|清关中/i;
const CUSTOMS_RELEASED = /import released|inbound out of customs|clearance to release|clearance processing completed|released by customs|customs released|海关允许进口|已放行|清关完成/i;
export function isCustomsHold(detail: string) {
  return CUSTOMS_HOLD.test(detail) && !CUSTOMS_RELEASED.test(detail);
}
// Nome legível do evento (o 17track manda muito em chinês).
export function customsLabel(detail: string) {
  if (/海关查验|inspection/i.test(detail)) return "inspeção da alfândega";
  if (/清关异常|exception|abnormal|failed/i.test(detail)) return "erro no desembaraço aduaneiro";
  if (/等待清关|拆板|delay/i.test(detail)) return "aguardando liberação da alfândega";
  return "desembaraço aduaneiro em andamento";
}

// ─── Problema do pedido ───────────────────────────────────────────────────────
// Uma regra só pra todas as telas (Rastreamento, Notificações, Atendimento,
// Dashboard): o sync do 17track grava problem_at + motivo na Obs, e tira
// sozinho quando a causa some (problema marcado à mão fica). Ordem do motivo:
//   1. rastreio diz problema (status do 17track ou regra de evento da loja);
//   2. pacote enviado sem movimento há PROBLEM_STALLED_DAYS+ (alfândega ou outro);
//   3. PROBLEM_LATE_DAYS+ da compra (ou do reenvio) sem entregar.
export const PROBLEM_STALLED_DAYS = 7;
export const PROBLEM_LATE_DAYS = 25;

const ddmm = (iso: string) => {
  const d = eventDateUS(iso) ?? iso.slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
};

export function problemReason(p: {
  nowMs: number; clockFrom: string; trackingProblem: string | null;
  shipped: boolean; lastEventAt: string | null; lastEventLabel: string | null;
}): string | null {
  if (p.trackingProblem) return p.trackingProblem;
  if (p.shipped && p.lastEventAt && p.nowMs - Date.parse(p.lastEventAt) >= PROBLEM_STALLED_DAYS * 86_400_000) {
    const label = String(p.lastEventLabel ?? "");
    return isCustomsHold(label)
      ? `Parado na alfândega desde ${ddmm(p.lastEventAt)} (${customsLabel(label)})`
      : `Sem movimento no rastreio desde ${ddmm(p.lastEventAt)}`;
  }
  if ((p.nowMs - Date.parse(`${p.clockFrom.slice(0, 10)}T12:00:00Z`)) / 86_400_000 >= PROBLEM_LATE_DAYS) {
    return `Tempo de entrega demorado (${PROBLEM_LATE_DAYS}+ dias)`;
  }
  return null;
}

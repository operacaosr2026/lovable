import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { isoDateUS, isoTodayUS } from "@/lib/timezone";

const TRACK123_API_BASE = "https://api.track123.com/gateway/open-api/tk/v2.1";

// Aplica em shop_orders o status que veio do rastreio. Regras (iguais ao sync
// via MCP):
//  - nunca mexe em payment_status — isso é o pagamento ao FORNECEDOR (pendente
//    → pago → enviado), não logística; marcar "shipped" aqui fazia pedido não
//    pago aparecer como "Pago" e sumir do custo pendente;
//  - só preenche datas vazias (filtro .is(null)), pra reprocessar o mesmo
//    evento — webhook repetido, sync de novo — não empurrar a data pra "hoje";
//  - entrega usa a data do evento real e marca delivery_status = delivered.
//  - postagem = 1ª movimentação real da transportadora, pulando "informação
//    eletrônica recebida"/etiqueta criada (definição do TM Postagem). Substitui
//    a data da etiqueta que a Shopify grava (sempre anterior); data posterior
//    (ajuste à mão) fica. Sem movimentação ainda, não preenche — antes gravava
//    o dia em que o sync percebia, e como a fila do Track123 leva dias pra
//    passar por todo mundo a postagem caía depois da entrega.
export async function applyTrackingTargetToOrder(
  supabase: typeof supabaseAdmin,
  orderId: string,
  target: string | null,
  eventAt: string | null,
  events?: any[] | null,
) {
  const nowDate = isoTodayUS();
  const eventDate = eventDateUS(eventAt) ?? nowDate;
  const postedDate = firstCarrierEventDateUS(events);
  if (postedDate) {
    await supabase.from("shop_orders").update({ shipped_at: postedDate })
      .eq("id", orderId).or(`shipped_at.is.null,shipped_at.lt.${postedDate}`);
  }
  if (target === "delivered") {
    await supabase.from("shop_orders").update({ delivered_at: eventDate, delivery_status: "delivered" })
      .eq("id", orderId).is("delivered_at", null);
  } else if (target === "problem") {
    await supabase.from("shop_orders").update({ problem_at: eventDate }).eq("id", orderId).is("problem_at", null);
  }
}

// Hora do evento do Track123 como instante UTC de verdade. O `event_time` /
// `last_event_time` vem no horário LOCAL da transportadora (China = +8h) mas
// marcado como "Z" — gravar isso deslocava tudo em até 12h. O `event_time_utc`
// ("2026-09-23 03:36:37", sem fuso) é o certo.
export function track123EventUtc(utc: string | null | undefined, fallback: string | null | undefined): string | null {
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

// "Entregue" vem do status geral do Track123 (o "Entregue" no topo da página
// de rastreio), não do texto do histórico: regra "delivered" casando por
// trecho pegava "Delivered to local carrier" (repasse entre transportadoras)
// e o pedido saía da fila do sync como entregue, ainda em trânsito (#WV1330).
// Exceção: evento que COMEÇA com "Delivered" é entrega ao cliente ("Delivered,
// Front Door/Porch", "Delivered, In/At Mailbox"…) — o status geral às vezes
// fica dias em "Out for delivery" depois disso (#L2-1050).
export function labelSaysDelivered(label: string | null | undefined): boolean {
  if (!label) return false;
  const t = label.trim().toLowerCase();
  if (!/^delivered\b/.test(t)) return false;
  if (/^delivered\s+to\b/.test(t)) return false;
  if (/\b(not|un|attempt\w*|fail\w*)\s*(to be\s*)?deliver/.test(t)) return false;
  return true;
}

export function track123SaysDelivered(transitStatus: string | null | undefined, lastLabel: string | null | undefined): boolean {
  const ts = (transitStatus ?? "").toLowerCase().replace(/\s+/g, "");
  if (ts.includes("delivered") && !ts.includes("undelivered")) return true;
  return labelSaysDelivered(lastLabel);
}

// Alvo final depois das regras do usuário: entregue só com o status geral
// dizendo entregue; regra "delivered" sem isso = pacote andando (shipped).
export function finalTrackingTarget(
  target: string | null, transitStatus: string | null | undefined, lastLabel: string | null | undefined, hasTrackingNumber: boolean,
): string | null {
  if (track123SaysDelivered(transitStatus, lastLabel)) return "delivered";
  if (target === "delivered") return hasTrackingNumber ? "shipped" : null;
  return target;
}

// Evento que é só a transportadora recebendo a info eletrônica / etiqueta
// criada — o pacote ainda não foi postado.
const INFO_ONLY_EVENT = /information received|info received|信息已收到|label created|pre-shipment|electronic information|order created/i;

// Dia (Nova York) da 1ª movimentação real do pacote no histórico do Track123.
// Aceita os formatos do MCP (event_detail/event_time_utc), da Open API
// (eventDetail/eventTimeZeroUTC) e do webhook (statusDescription/date).
export function firstCarrierEventDateUS(events: any[] | null | undefined): string | null {
  let first: string | null = null;
  for (const e of events ?? []) {
    const detail = String(e?.event_detail ?? e?.eventDetail ?? e?.statusDescription ?? e?.context ?? e?.description ?? "");
    if (!detail || INFO_ONLY_EVENT.test(detail)) continue;
    const at = track123EventUtc(e?.event_time_utc, e?.eventTimeZeroUTC ?? e?.date ?? e?.eventTime ?? e?.time ?? e?.event_time);
    if (at && Number.isFinite(Date.parse(at)) && (!first || Date.parse(at) < Date.parse(first))) first = at;
  }
  return eventDateUS(first);
}

// Evento mais antigo que o já gravado = chegou fora de ordem (webhook atrasado
// ou reentregue) — não pode sobrescrever um status mais novo.
export function isOlderEvent(incoming: string | null | undefined, stored: string | null | undefined): boolean {
  if (!incoming || !stored) return false;
  const a = Date.parse(incoming), b = Date.parse(stored);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

export async function runTrack123Sync(shopId: string, apiKey: string, supabase: typeof supabaseAdmin) {
    // Get tracking numbers from existing tracking rows
    const { data: trackings } = await supabase.from("shop_order_tracking")
      .select("id,order_id,tracking_number,timeline,last_event_at,shipped_at,delivered_at,problem_at").eq("shop_id", shopId)
      .not("tracking_number", "is", null).limit(1000);

    const { data: rules } = await supabase.from("track123_event_rules")
      .select("event_key,event_label,target_status,enabled")
      .eq("shop_id", shopId).eq("enabled", true);

    const ruleMap = new Map<string, string>();
    for (const r of rules ?? []) {
      ruleMap.set(r.event_key.toLowerCase(), r.target_status);
      ruleMap.set(r.event_label.toLowerCase(), r.target_status);
    }
    function matchRule(text: string | null | undefined): string | null {
      if (!text) return null;
      const t = text.toLowerCase().trim();
      if (ruleMap.has(t)) return ruleMap.get(t)!;
      for (const [k, v] of ruleMap.entries()) {
        if (t.includes(k) || k.includes(t)) return v;
      }
      return null;
    }

    const numbers = (trackings ?? []).map((t) => t.tracking_number).filter((n): n is string => !!n);

    let updated = 0;
    let lastError: string | null = null;
    const byTrackNo = new Map<string, any>();

    const track123Headers = {
      "Content-Type": "application/json",
      "accept": "application/json",
      "Track123-Api-Secret": apiKey,
    };

    let importError: string | null = null;
    if (numbers.length) {
      // Best-effort registration: numbers already registered just come back as "duplicate" rejects, which is fine.
      // Small batches so a low remaining credit balance only blocks the numbers that don't fit.
      for (let i = 0; i < numbers.length; i += 25) {
        const chunk = numbers.slice(i, i + 25);
        try {
          const r = await fetchWithRetry(`${TRACK123_API_BASE}/track/import`, {
            method: "POST",
            headers: track123Headers,
            body: JSON.stringify(chunk.map((n) => ({ trackNo: n }))),
          });
          const text = await r.text();
          let j: any;
          try { j = JSON.parse(text); } catch { continue; }
          if (j?.code && j.code !== "00000") {
            importError = `Registro (${j.code}): ${j.msg ?? text.slice(0, 200)}`;
            if (j.code === "101107") break; // out of credit — further chunks will fail too
          }
        } catch {/* ignore — querying below will surface real errors */}
      }

      for (let i = 0; i < numbers.length; i += 100) {
        const chunk = numbers.slice(i, i + 100);
        try {
          const r = await fetchWithRetry(`${TRACK123_API_BASE}/track/query`, {
            method: "POST",
            headers: track123Headers,
            body: JSON.stringify({ trackNoInfos: chunk.map((trackNo) => ({ trackNo })), queryPageSize: 100 }),
          });
          const text = await r.text();
          if (!r.ok) { lastError = `Falha (${r.status}): ${text.slice(0, 200)}`; continue; }
          let j: any;
          try { j = JSON.parse(text); } catch { lastError = `Resposta inválida: ${text.slice(0, 200)}`; continue; }
          if (j?.code && j.code !== "00000" && !j?.data) { lastError = `${j.code}: ${j.msg ?? text.slice(0, 200)}`; continue; }

          const content = j?.data?.accepted?.content ?? j?.data?.list ?? j?.data?.content ?? [];
          for (const item of content) {
            if (item?.trackNo) byTrackNo.set(item.trackNo, item);
          }
          const rejected = j?.data?.rejected?.content ?? j?.data?.rejected ?? [];
          for (const rej of rejected) {
            const reason = rej.error?.msg ?? rej.msg ?? rej.message ?? "rejeitado";
            lastError = `${rej.trackNo ?? "?"}: ${reason}`.slice(0, 200);
          }
        } catch (e: any) {
          lastError = String(e?.message ?? e).slice(0, 500);
        }
      }
    }

    for (const t of trackings ?? []) {
      if (!t.tracking_number) continue;
      const item = byTrackNo.get(t.tracking_number);
      if (!item) { lastError = lastError ?? `Sem dados para ${t.tracking_number}`; continue; }

      const logistics = item.localLogisticsInfo ?? item;
      const events = logistics.trackingDetails ?? [];
      const last = events[0] ?? null;
      const lastLabel: string | null = last?.eventDetail ?? null;
      // eventTimeZeroUTC = instante em UTC; eventTime é o horário local da transportadora.
      const lastAt: string | null = last?.eventTimeZeroUTC ?? last?.eventTime ?? null;

      if (isOlderEvent(lastAt, t.last_event_at)) { updated++; continue; }

      const update: any = {
        tracking_status: item.transitStatus ?? null,
        last_event_at: lastAt,
        last_event_label: lastLabel,
        timeline: events.length ? events : t.timeline,
      };
      if (logistics.courierCode) update.carrier = logistics.courierCode;

      const target = finalTrackingTarget(
        matchRule(lastLabel) ?? matchRule(item.transitStatus) ?? matchRule(item.transitSubStatus),
        item.transitStatus, lastLabel, true);
      const nowIso = new Date().toISOString();
      if (target === "shipped" && !t.shipped_at) update.shipped_at = nowIso;
      else if (target === "delivered" && !t.delivered_at) update.delivered_at = lastAt ?? nowIso;
      else if (target === "problem" && !t.problem_at) update.problem_at = lastAt ?? nowIso;

      await supabase.from("shop_order_tracking").update(update).eq("id", t.id);
      await applyTrackingTargetToOrder(supabase, t.order_id, target, lastAt, events);
      updated++;
    }

    const total = trackings?.length ?? 0;
    let status: string;
    let errorMsg: string | null;
    if (total === 0) {
      status = "ok";
      errorMsg = "Nenhum pedido com código de rastreio para sincronizar.";
    } else if (updated === 0) {
      status = "error";
      errorMsg = importError ?? lastError ?? "Falha ao sincronizar rastreios.";
    } else {
      status = "ok";
      const err = importError ?? lastError;
      errorMsg = err ? `${updated}/${total} sincronizados. Último erro: ${err}` : null;
    }

    await supabaseAdmin.from("track123_integrations")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: status, last_sync_error: errorMsg })
      .eq("shop_id", shopId);

    return { updated, total, status, errorMsg };
}

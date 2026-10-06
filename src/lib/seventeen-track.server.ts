import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { getPausedShopifyStoreIds } from "@/lib/sync-pause.server";
import { isoTodayUS } from "@/lib/timezone";
import { eventDateUS, finalTrackingTarget, firstCarrierEventDateUS, isOlderEvent, labelSaysDelivered } from "@/lib/tracking-rules.server";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { pushFulfillmentStatusToShopify, updateFulfillmentTrackingUrl } from "@/lib/shopify-fulfillment-status.server";
import { officialEdd } from "@/lib/tracking-display";

// Rastreio pelo 17track (substituiu o Track123 em out/2026). Uma conta só pra
// todas as lojas (SEVENTEEN_TRACK_API_KEY); a tabela track123_integrations
// (nome antigo) guarda por loja o modelo do link e o status do último sync.
// Cada rodada:
//  1. cadastra no 17track os códigos novos dos pedidos em aberto (1 crédito por
//     código, uma vez só — já cadastrado não cobra de novo);
//  2. busca o rastreio de todos os cadastrados, de 40 em 40 (não gasta crédito);
//  3. grava em shop_order_tracking/shop_orders (timeline com
//     event_time_utc/event_detail/event_location, status tipo "In transit" —
//     o formato que as telas já liam);
//  4. na Shopify: manda o status pro envio quando ele muda (em trânsito, saiu
//     pra entrega, entregue…) e troca o link de rastreio do envio pro modelo da
//     loja — sem avisar o cliente.
const API_BASE = "https://api.17track.net/track/v2.4";
const BATCH = 40;                 // máximo por chamada no 17track
const MIN_INTERVAL_MS = 400;      // limite deles: 3 chamadas/s
const ALREADY_REGISTERED = -18019901;
const OUT_OF_QUOTA = /quota|insufficient|balance/i;

export const seventeenTrackConfigured = () => !!process.env.SEVENTEEN_TRACK_API_KEY;

let nextSlot = 0;
async function call17(path: string, body: unknown): Promise<any> {
  const key = process.env.SEVENTEEN_TRACK_API_KEY;
  if (!key) throw new Error("Falta a chave do 17track (SEVENTEEN_TRACK_API_KEY) na Vercel.");
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_INTERVAL_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "17token": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`17track ${path} (${r.status}): ${text.slice(0, 200)}`); }
  if (j?.code !== 0) throw new Error(`17track ${path} ${j?.code}: ${j?.data?.errors?.[0]?.message ?? text.slice(0, 200)}`);
  return j.data;
}

// Status geral do 17track → texto que o resto do sistema lê (formato herdado
// do Track123: "Info received" = etiqueta criada, "No record" = código sem registro…).
const STATUS_LABEL: Record<string, string> = {
  NotFound: "NO_RECORD",
  InfoReceived: "Info received",
  InTransit: "In transit",
  Expired: "Expired",
  AvailableForPickup: "Available for pickup",
  OutForDelivery: "Out for delivery",
  DeliveryFailure: "Undelivered",
  Delivered: "Delivered",
  Exception: "Exception",
};

const placeOf = (a: any) => [a?.city, a?.state, a?.country].filter(Boolean).join(", ") || "";
const utcText = (iso: string) => iso.replace("T", " ").replace(/(\.\d+)?Z$/, "").slice(0, 19);

// Eventos de todas as transportadoras (origem + última milha), mais novo primeiro.
function toTimeline(item: any) {
  const providers: any[] = item?.track_info?.tracking?.providers ?? [];
  return providers.flatMap((p) => (p.events ?? []).map((e: any) => {
    const utc = e.time_utc ? utcText(e.time_utc) : null;
    return {
      event_time_utc: utc,
      event_time: e.time_raw?.date ? `${e.time_raw.date} ${e.time_raw.time ?? ""}`.trim() : utc,
      event_detail: String(e.description ?? "").trim(),
      event_location: e.location || placeOf(e.address),
    };
  })).filter((e) => e.event_detail).sort((a, b) => (b.event_time_utc ?? "").localeCompare(a.event_time_utc ?? ""));
}

function eddOf(item: any) {
  const e = item?.track_info?.time_metrics?.estimated_delivery_date;
  const day = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  return { from: day(e?.from), to: day(e?.to), source: e?.source ?? null };
}

function buildRuleMatcher(rules: { event_key: string; event_label: string; target_status: string }[]) {
  const ruleMap = new Map<string, string>();
  for (const r of rules) {
    ruleMap.set(r.event_key.toLowerCase(), r.target_status);
    ruleMap.set(r.event_label.toLowerCase(), r.target_status);
  }
  return (text: string | null | undefined): string | null => {
    if (!text) return null;
    const t = text.toLowerCase().trim();
    if (ruleMap.has(t)) return ruleMap.get(t)!;
    for (const [k, v] of ruleMap.entries()) if (t.includes(k) || k.includes(t)) return v;
    return null;
  };
}

// Sem regra da loja pro evento: pelo status geral do 17track.
function inferTarget(status: string | null, lastLabel: string | null): string | null {
  if (labelSaysDelivered(lastLabel) || status === "Delivered") return "delivered";
  if (status === "Exception" || status === "DeliveryFailure") return "problem";
  if (status === "InfoReceived" || status === "NotFound" || !status) return "pending_shipment";
  return "shipped";
}

// Lojas que o cron pode sincronizar: ativas (e com grupo ativo) e sem
// "Pausar sincronização" no Banco de Lojas.
async function syncableShopIds(shopIds: string[]) {
  if (!shopIds.length) return new Set<string>();
  const { data: shops } = await supabaseAdmin.from("shops").select("id,status,archived,group_id").in("id", shopIds);
  const groupIds = [...new Set((shops ?? []).map((s: any) => s.group_id).filter(Boolean))];
  const { data: groups } = groupIds.length
    ? await supabaseAdmin.from("shop_groups").select("id,status").in("id", groupIds)
    : { data: [] as any[] };
  const groupStatus = new Map((groups ?? []).map((g: any) => [g.id, g.status]));
  const paused = await getPausedShopifyStoreIds();
  const { data: links } = await supabaseAdmin.from("shop_order_settings").select("shop_id,shopify_store_id").in("shop_id", shopIds);
  const pausedShops = new Set((links ?? []).filter((l: any) => l.shopify_store_id && paused.has(l.shopify_store_id)).map((l: any) => l.shop_id));
  return new Set((shops ?? [])
    .filter((s: any) => s.status === "ativa" && !s.archived && (!s.group_id || groupStatus.get(s.group_id) === "ativo") && !pausedShops.has(s.id))
    .map((s: any) => s.id as string));
}

export type SeventeenSyncResult = { shops: number; orders: number; registered: number; updated: number; shopifyStatus: number; shopifyLinks: number; errors: string[]; outOfQuota: boolean };

// pushAll: manda o status pra Shopify de todos (não só dos que mudaram) — usado
// uma vez ao ligar o envio pra Shopify; a Shopify não repete status que já tem.
export async function runSeventeenTrackSync(opts: { deadline?: number; shopIds?: string[]; pushAll?: boolean } = {}): Promise<SeventeenSyncResult> {
  const deadline = opts.deadline ?? Date.now() + 240_000;
  const result: SeventeenSyncResult = { shops: 0, orders: 0, registered: 0, updated: 0, shopifyStatus: 0, shopifyLinks: 0, errors: [], outOfQuota: false };

  let integQuery = supabaseAdmin.from("track123_integrations")
    .select("shop_id,user_id,tracking_link_template").eq("provider", "17track");
  if (opts.shopIds) integQuery = integQuery.in("shop_id", opts.shopIds);
  const { data: integs, error: integErr } = await integQuery;
  if (integErr) throw new Error(integErr.message);
  const active = await syncableShopIds((integs ?? []).map((i) => i.shop_id));
  const shops = (integs ?? []).filter((i) => active.has(i.shop_id));
  result.shops = shops.length;
  if (!shops.length) return result;
  const integBy = new Map(shops.map((i) => [i.shop_id, i]));

  // Pedidos em aberto dos últimos 180 dias (sem entregue, cancelado ou
  // reembolsado) — pedido atrasado (o que vira chargeback) continua sendo
  // acompanhado enquanto não é entregue; mesma janela da aba Rastreamento.
  // Não gasta crédito: os antigos já estão cadastrados no 17track.
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const { data: orders, error: ordErr } = await selectAll<any>(supabaseAdmin.from("shop_orders")
    .select("id,user_id,shop_id,tracking_code,shipped_at,delivered_at,problem_at,fulfillments:raw->fulfillments")
    .in("shop_id", shops.map((s) => s.shop_id))
    .not("tracking_code", "is", null)
    .or("delivery_status.is.null,delivery_status.not.in.(delivered,returned)")
    .is("delivered_at", null)
    .or("shopify_financial_status.is.null,shopify_financial_status.not.in.(refunded,partially_refunded,voided)")
    .filter("raw->>cancelled_at", "is", null)
    .gte("order_date", since));
  if (ordErr) throw new Error(ordErr.message);
  result.orders = orders.length;
  if (!orders.length) return result;

  const { data: tracks } = await selectAllIn<any>(orders.map((o: any) => o.id), (ids) => supabaseAdmin.from("shop_order_tracking")
    .select("order_id,tracking_number,tracking_status,last_event_at,registered_17track_at,timeline,extra_packages").in("order_id", ids));
  const trackBy = new Map((tracks ?? []).map((t: any) => [t.order_id, t]));
  const code = (o: any) => String(o.tracking_code).trim().toUpperCase();

  // Pedido com mais de um envio: os outros códigos da Shopify viram "pacotes
  // extras" (o principal continua sendo o tracking_code do pedido).
  const extrasBy = new Map<string, ExtraPackage[]>();
  for (const o of orders) {
    const stored: ExtraPackage[] = Array.isArray(trackBy.get(o.id)?.extra_packages) ? trackBy.get(o.id).extra_packages : [];
    const numbers = fulfillmentCodes(o.fulfillments).filter((n) => n !== code(o));
    if (numbers.length) extrasBy.set(o.id, numbers.map((n) => stored.find((x) => x.number === n) ?? { number: n }));
  }
  const dirtyExtras = new Set<string>();

  // 1. Cadastro dos códigos que ainda não estão no 17track (principal e extras).
  type Reg = { o: any; number: string; extra: boolean };
  const toRegister: Reg[] = [];
  for (const o of orders) {
    const t = trackBy.get(o.id);
    if (!t?.registered_17track_at || String(t.tracking_number ?? "").toUpperCase() !== code(o)) toRegister.push({ o, number: code(o), extra: false });
    for (const x of extrasBy.get(o.id) ?? []) if (!x.registered_17track_at) toRegister.push({ o, number: x.number, extra: true });
  }
  for (let i = 0; i < toRegister.length && !result.outOfQuota; i += BATCH) {
    if (Date.now() > deadline) break;
    const chunk = toRegister.slice(i, i + BATCH);
    try {
      const data = await call17("/register", chunk.map((c) => ({ number: c.number, tag: c.o.id })));
      const ok = new Set<string>((data?.accepted ?? []).map((a: any) => String(a.number).toUpperCase()));
      result.registered += ok.size;
      for (const r of data?.rejected ?? []) {
        if (r.error?.code === ALREADY_REGISTERED) ok.add(String(r.number).toUpperCase());
        else if (OUT_OF_QUOTA.test(String(r.error?.message ?? ""))) result.outOfQuota = true;
        else result.errors.push(`${r.number}: ${r.error?.message ?? r.error?.code}`);
      }
      const now = new Date().toISOString();
      const rows = chunk.filter((c) => !c.extra && ok.has(c.number)).map((c) => ({
        user_id: c.o.user_id, shop_id: c.o.shop_id, order_id: c.o.id, tracking_number: c.number,
        provider: "17track", registered_17track_at: now,
      }));
      if (rows.length) {
        await supabaseAdmin.from("shop_order_tracking").upsert(rows, { onConflict: "order_id" });
        for (const r of rows) trackBy.set(r.order_id, { ...(trackBy.get(r.order_id) ?? {}), ...r });
      }
      for (const c of chunk.filter((c) => c.extra && ok.has(c.number))) {
        const x = (extrasBy.get(c.o.id) ?? []).find((p) => p.number === c.number);
        if (x) { x.registered_17track_at = now; dirtyExtras.add(c.o.id); }
      }
    } catch (e: any) {
      if (OUT_OF_QUOTA.test(String(e?.message))) result.outOfQuota = true;
      else result.errors.push(String(e?.message ?? e).slice(0, 200));
    }
  }

  // 2. Busca o rastreio de todos os códigos cadastrados (de 40 em 40).
  const { data: rules } = await supabaseAdmin.from("track123_event_rules")
    .select("shop_id,event_key,event_label,target_status").in("shop_id", shops.map((s) => s.shop_id)).eq("enabled", true);
  const matcherBy = new Map<string, ReturnType<typeof buildRuleMatcher>>();
  for (const s of shops) matcherBy.set(s.shop_id, buildRuleMatcher((rules ?? []).filter((r: any) => r.shop_id === s.shop_id)));

  const wanted = new Set<string>();
  for (const o of orders) {
    if (trackBy.get(o.id)?.registered_17track_at) wanted.add(code(o));
    for (const x of extrasBy.get(o.id) ?? []) if (x.registered_17track_at) wanted.add(x.number);
  }
  const codes = [...wanted];
  const itemBy = new Map<string, any>();
  for (let i = 0; i < codes.length; i += BATCH) {
    if (Date.now() > deadline) break;
    try {
      const data = await call17("/gettrackinfo", codes.slice(i, i + BATCH).map((number) => ({ number })));
      for (const item of data?.accepted ?? []) itemBy.set(String(item.number).toUpperCase(), item);
    } catch (e: any) {
      result.errors.push(String(e?.message ?? e).slice(0, 200));
    }
  }

  // 3. Grava pedido a pedido: primeiro os pacotes extras, depois o principal —
  // o pedido só conta como entregue quando TODOS os pacotes foram entregues.
  for (const o of orders) {
    const template = integBy.get(o.shop_id)?.tracking_link_template ?? null;
    const extras = extrasBy.get(o.id) ?? [];
    for (const x of extras) {
      const item = itemBy.get(x.number);
      if (!item) continue;
      const before = x.tracking_status ?? null;
      if (applyExtraItem(x, item)) dirtyExtras.add(o.id);
      if (Date.now() <= deadline) await pushToShopify(o, x.number, item, before, template, opts.pushAll, result);
    }
    if (dirtyExtras.has(o.id)) {
      const { error } = await supabaseAdmin.from("shop_order_tracking").upsert(
        { user_id: o.user_id, shop_id: o.shop_id, order_id: o.id, extra_packages: extras as any }, { onConflict: "order_id" });
      if (error) result.errors.push(`${code(o)} (pacotes extras): ${error.message.slice(0, 120)}`);
    }

    const item = itemBy.get(code(o));
    if (!item) continue;
    const stored = trackBy.get(o.id);
    const holdDelivered = extras.some((x) => x.status_key !== "Delivered");
    try {
      if (await applyItem(o, item, stored, template, matcherBy.get(o.shop_id)!, holdDelivered)) result.updated++;
    } catch (e: any) {
      result.errors.push(`${code(o)}: ${String(e?.message ?? e).slice(0, 150)}`);
      continue;
    }
    if (Date.now() <= deadline) await pushToShopify(o, code(o), item, stored?.tracking_status ?? null, template, opts.pushAll, result);
  }

  // Status por loja (o sino avisa quando para de sincronizar).
  const status = result.errors.length && !result.updated ? "error" : "ok";
  const msg = `17track: ${result.updated} atualizados, ${result.registered} cadastrados agora` +
    (result.shopifyStatus || result.shopifyLinks ? ` · Shopify: ${result.shopifyStatus} status, ${result.shopifyLinks} links` : "") +
    (result.outOfQuota ? " · SEM CRÉDITO no 17track — códigos novos não foram cadastrados" : "") +
    (result.errors.length ? ` · último erro: ${result.errors[result.errors.length - 1]}` : "");
  await supabaseAdmin.from("track123_integrations")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: result.outOfQuota ? "error" : status, last_sync_error: msg })
    .in("shop_id", shops.map((s) => s.shop_id));
  return result;
}

type ExtraPackage = {
  number: string; registered_17track_at?: string | null; carrier?: string | null;
  tracking_status?: string | null; status_key?: string | null;
  last_event_at?: string | null; last_event_label?: string | null; timeline?: any[];
  edd_from?: string | null; edd_to?: string | null; edd_source?: string | null;
};

// Códigos de rastreio de todos os envios (não cancelados) do pedido na Shopify.
function fulfillmentCodes(fulfillments: any[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const f of fulfillments ?? []) {
    if (String(f?.status ?? "").toLowerCase() === "cancelled") continue;
    for (const n of [f?.tracking_number, ...(f?.tracking_numbers ?? [])]) {
      const c = String(n ?? "").trim().toUpperCase();
      if (c) out.add(c);
    }
  }
  return [...out];
}

// Atualiza um pacote extra com o que o 17track trouxe. false = nada mudou.
function applyExtraItem(x: ExtraPackage, item: any): boolean {
  const timeline = toTimeline(item);
  const edd = eddOf(item);
  const status: string | null = item?.track_info?.latest_status?.status ?? null;
  const last = timeline[0];
  const lastAt = last?.event_time_utc ? `${last.event_time_utc.replace(" ", "T")}Z` : null;
  if (!timeline.length && x.timeline?.length) return false;
  const next: ExtraPackage = {
    ...x,
    carrier: ((item?.track_info?.tracking?.providers ?? []) as any[]).map((p) => p.provider?.name).filter(Boolean).join(" → ") || x.carrier || null,
    tracking_status: status ? STATUS_LABEL[status] ?? status : x.tracking_status ?? null,
    status_key: labelSaysDelivered(last?.event_detail) ? "Delivered" : status ?? x.status_key ?? null,
    last_event_at: lastAt ?? x.last_event_at ?? null,
    last_event_label: last?.event_detail ?? x.last_event_label ?? null,
    timeline: timeline.length ? timeline : x.timeline ?? [],
    edd_from: edd.from, edd_to: edd.to, edd_source: edd.source,
  };
  const changed = JSON.stringify(next) !== JSON.stringify(x);
  Object.assign(x, next);
  return changed;
}

// Shopify: troca o link do envio desse código e manda o status quando muda
// (erro aqui não para o sync).
async function pushToShopify(o: any, number: string, item: any, previousLabel: string | null, template: string | null, pushAll: boolean | undefined, result: SeventeenSyncResult) {
  try {
    const url = buildTrackingUrl(template, number);
    if (url && (await updateFulfillmentTrackingUrl({ shopId: o.shop_id, fulfillments: o.fulfillments, trackingNumber: number, url })).sent) result.shopifyLinks++;
    const status: string | null = item?.track_info?.latest_status?.status ?? null;
    const label = status ? STATUS_LABEL[status] ?? status : null;
    if (status && (pushAll || label !== previousLabel)) {
      const edd = officialEdd(eddOf(item));
      const lastUtc = toTimeline(item)[0]?.event_time_utc;
      const r = await pushFulfillmentStatusToShopify({
        orderId: o.id, trackingNumber: number, status,
        happenedAt: lastUtc ? `${lastUtc.replace(" ", "T")}Z` : null,
        estimatedDeliveryAt: edd?.to ?? edd?.from ?? null,
      });
      if (r.sent) result.shopifyStatus++;
    }
  } catch (e: any) {
    result.errors.push(`Shopify ${number}: ${String(e?.message ?? e).slice(0, 150)}`);
  }
}

// Grava o rastreio de um pedido. Devolve false quando não havia nada novo.
// holdDelivered: pedido com outro pacote ainda não entregue — mesmo com este
// entregue, o pedido não vira "entregue" (fica enviado).
async function applyItem(o: any, item: any, stored: any, template: string | null, matchRule: ReturnType<typeof buildRuleMatcher>, holdDelivered = false): Promise<boolean> {
  const status: string | null = item?.track_info?.latest_status?.status ?? null;
  const timeline = toTimeline(item);
  const edd = eddOf(item);
  const base = { user_id: o.user_id, shop_id: o.shop_id, order_id: o.id, provider: "17track", edd_from: edd.from, edd_to: edd.to, edd_source: edd.source };

  // Sem nenhum evento ainda (recém-cadastrado): não apaga o histórico que já
  // existe — só marca a previsão.
  if (!timeline.length) {
    await supabaseAdmin.from("shop_order_tracking").update({ edd_from: edd.from, edd_to: edd.to, edd_source: edd.source }).eq("order_id", o.id);
    return false;
  }

  const last = timeline[0];
  const lastAt = last.event_time_utc ? `${last.event_time_utc.replace(" ", "T")}Z` : null;
  const lastLabel = last.event_detail;
  // Evento mais antigo que o já gravado não volta o status.
  if (isOlderEvent(lastAt, stored?.last_event_at) && (stored?.timeline?.length ?? 0) > timeline.length) {
    await supabaseAdmin.from("shop_order_tracking").update({ edd_from: edd.from, edd_to: edd.to, edd_source: edd.source }).eq("order_id", o.id);
    return false;
  }

  const statusLabel = status ? STATUS_LABEL[status] ?? status : null;
  const carriers = ((item?.track_info?.tracking?.providers ?? []) as any[]).map((p) => p.provider?.name).filter(Boolean);
  let target = finalTrackingTarget(
    matchRule(lastLabel) ?? matchRule(statusLabel) ?? inferTarget(status, lastLabel),
    statusLabel, lastLabel, true);
  if (target === "delivered" && holdDelivered) target = "shipped";

  const eventDate = eventDateUS(lastAt) ?? isoTodayUS();
  const postedDate = firstCarrierEventDateUS(timeline);
  const orderUpdate: TablesUpdate<"shop_orders"> = {};
  if (postedDate && (!o.shipped_at || String(o.shipped_at).slice(0, 10) < postedDate)) orderUpdate.shipped_at = postedDate;
  if (target === "delivered") {
    orderUpdate.delivered_at = eventDate;
    orderUpdate.delivery_status = "delivered";
  } else if (target === "problem" && !o.problem_at) orderUpdate.problem_at = eventDate;
  const url = buildTrackingUrl(template, String(o.tracking_code));
  if (url) orderUpdate.tracking_url = url;

  await Promise.all([
    supabaseAdmin.from("shop_order_tracking").upsert({
      ...base,
      tracking_number: String(o.tracking_code).trim().toUpperCase(),
      carrier: carriers.join(" → ") || null,
      tracking_status: statusLabel,
      last_event_at: lastAt,
      last_event_label: lastLabel,
      timeline,
    }, { onConflict: "order_id" }),
    Object.keys(orderUpdate).length ? supabaseAdmin.from("shop_orders").update(orderUpdate).eq("id", o.id) : Promise.resolve(),
  ]);
  return true;
}

// Rastreio de UM código fora do banco (aba Chargebacks: pedido antigo que não
// está em shop_orders). Cadastra se precisar (1 crédito, uma vez só) e não
// grava nada — quem chama decide onde guardar.
export async function seventeenTrackStatus(trackingNumber: string): Promise<{ status: string | null; lastLabel: string | null; lastAt: string | null } | null> {
  const number = trackingNumber.trim().toUpperCase();
  const reg = await call17("/register", [{ number }]);
  const rej = (reg?.rejected ?? [])[0];
  if (rej && rej.error?.code !== ALREADY_REGISTERED) return null;
  const info = await call17("/gettrackinfo", [{ number }]);
  const item = (info?.accepted ?? [])[0];
  const timeline = item ? toTimeline(item) : [];
  if (!timeline.length) return null;
  const status: string | null = item?.track_info?.latest_status?.status ?? null;
  const lastLabel = timeline[0].event_detail;
  const lastAt = timeline[0].event_time_utc ? `${timeline[0].event_time_utc.replace(" ", "T")}Z` : null;
  return { status: finalTrackingTarget(inferTarget(status, lastLabel), status ? STATUS_LABEL[status] ?? status : null, lastLabel, true), lastLabel, lastAt };
}

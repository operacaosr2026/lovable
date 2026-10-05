import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { getPausedShopifyStoreIds } from "@/lib/sync-pause.server";
import { isoTodayUS } from "@/lib/timezone";
import { eventDateUS, finalTrackingTarget, firstCarrierEventDateUS, isOlderEvent, labelSaysDelivered } from "@/lib/track123-sync.server";
import type { TablesUpdate } from "@/integrations/supabase/types";

// Rastreio pelo 17track (substitui o Track123, loja por loja — ver
// track123_integrations.provider). Uma conta só pra todas as lojas
// (SEVENTEEN_TRACK_API_KEY). Cada rodada:
//  1. cadastra no 17track os códigos novos dos pedidos em aberto (1 crédito por
//     código, uma vez só — já cadastrado não cobra de novo);
//  2. busca o rastreio de todos os cadastrados, de 40 em 40 (não gasta crédito);
//  3. grava em shop_order_tracking/shop_orders no MESMO formato do Track123
//     (timeline com event_time_utc/event_detail/event_location, status tipo
//     "In transit"), então nenhuma tela precisa mudar.
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

// Status geral do 17track → texto no padrão do Track123 (o resto do sistema lê
// assim: "Info received" = etiqueta criada, "No record" = código sem registro…).
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

// Eventos de todas as transportadoras (origem + última milha) no formato do
// Track123 (MCP), mais novo primeiro.
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
// "Pausar sincronização" no Banco de Lojas — mesma regra do cron do Track123.
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

export type SeventeenSyncResult = { shops: number; orders: number; registered: number; updated: number; errors: string[]; outOfQuota: boolean };

export async function runSeventeenTrackSync(opts: { deadline?: number; shopIds?: string[] } = {}): Promise<SeventeenSyncResult> {
  const deadline = opts.deadline ?? Date.now() + 240_000;
  const result: SeventeenSyncResult = { shops: 0, orders: 0, registered: 0, updated: 0, errors: [], outOfQuota: false };

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

  // Pedidos em aberto dos últimos 60 dias (sem entregue, cancelado ou
  // reembolsado) — 60 e não 30 como no Track123 pra pedido muito atrasado (o que
  // vira chargeback) continuar sendo acompanhado.
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const { data: orders, error: ordErr } = await selectAll<any>(supabaseAdmin.from("shop_orders")
    .select("id,user_id,shop_id,tracking_code,shipped_at,delivered_at,problem_at")
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
    .select("order_id,tracking_number,last_event_at,registered_17track_at,timeline").in("order_id", ids));
  const trackBy = new Map((tracks ?? []).map((t: any) => [t.order_id, t]));
  const code = (o: any) => String(o.tracking_code).trim().toUpperCase();

  // 1. Cadastro dos códigos que ainda não estão no 17track.
  const toRegister = orders.filter((o: any) => {
    const t = trackBy.get(o.id);
    return !t?.registered_17track_at || String(t.tracking_number ?? "").toUpperCase() !== code(o);
  });
  for (let i = 0; i < toRegister.length && !result.outOfQuota; i += BATCH) {
    if (Date.now() > deadline) break;
    const chunk = toRegister.slice(i, i + BATCH);
    try {
      const data = await call17("/register", chunk.map((o: any) => ({ number: code(o), tag: o.id })));
      const ok = new Set<string>((data?.accepted ?? []).map((a: any) => String(a.number)));
      result.registered += ok.size;
      for (const r of data?.rejected ?? []) {
        if (r.error?.code === ALREADY_REGISTERED) ok.add(String(r.number));
        else if (OUT_OF_QUOTA.test(String(r.error?.message ?? ""))) result.outOfQuota = true;
        else result.errors.push(`${r.number}: ${r.error?.message ?? r.error?.code}`);
      }
      const now = new Date().toISOString();
      const rows = chunk.filter((o: any) => ok.has(code(o))).map((o: any) => ({
        user_id: o.user_id, shop_id: o.shop_id, order_id: o.id, tracking_number: code(o),
        provider: "17track", registered_17track_at: now,
      }));
      if (rows.length) {
        await supabaseAdmin.from("shop_order_tracking").upsert(rows, { onConflict: "order_id" });
        for (const r of rows) trackBy.set(r.order_id, { ...(trackBy.get(r.order_id) ?? {}), ...r });
      }
    } catch (e: any) {
      if (OUT_OF_QUOTA.test(String(e?.message))) result.outOfQuota = true;
      else result.errors.push(String(e?.message ?? e).slice(0, 200));
    }
  }

  // 2 e 3. Rastreio dos cadastrados.
  const { data: rules } = await supabaseAdmin.from("track123_event_rules")
    .select("shop_id,event_key,event_label,target_status").in("shop_id", shops.map((s) => s.shop_id)).eq("enabled", true);
  const matcherBy = new Map<string, ReturnType<typeof buildRuleMatcher>>();
  for (const s of shops) matcherBy.set(s.shop_id, buildRuleMatcher((rules ?? []).filter((r: any) => r.shop_id === s.shop_id)));

  const registered = orders.filter((o: any) => trackBy.get(o.id)?.registered_17track_at);
  const byCode = new Map<string, any[]>();
  for (const o of registered) byCode.set(code(o), [...(byCode.get(code(o)) ?? []), o]);
  const codes = [...byCode.keys()];
  for (let i = 0; i < codes.length; i += BATCH) {
    if (Date.now() > deadline) break;
    let data: any;
    try {
      data = await call17("/gettrackinfo", codes.slice(i, i + BATCH).map((number) => ({ number })));
    } catch (e: any) {
      result.errors.push(String(e?.message ?? e).slice(0, 200));
      continue;
    }
    for (const item of data?.accepted ?? []) {
      for (const o of byCode.get(String(item.number).toUpperCase()) ?? []) {
        try {
          if (await applyItem(o, item, trackBy.get(o.id), integBy.get(o.shop_id)?.tracking_link_template ?? null, matcherBy.get(o.shop_id)!)) result.updated++;
        } catch (e: any) {
          result.errors.push(`${code(o)}: ${String(e?.message ?? e).slice(0, 150)}`);
        }
      }
    }
  }

  // Status por loja (o sino avisa quando para de sincronizar).
  const status = result.errors.length && !result.updated ? "error" : "ok";
  const msg = `17track: ${result.updated} atualizados, ${result.registered} cadastrados agora` +
    (result.outOfQuota ? " · SEM CRÉDITO no 17track — códigos novos não foram cadastrados" : "") +
    (result.errors.length ? ` · último erro: ${result.errors[result.errors.length - 1]}` : "");
  await supabaseAdmin.from("track123_integrations")
    .update({ last_sync_at: new Date().toISOString(), last_sync_status: result.outOfQuota ? "error" : status, last_sync_error: msg })
    .in("shop_id", shops.map((s) => s.shop_id));
  return result;
}

// Grava o rastreio de um pedido. Devolve false quando não havia nada novo.
async function applyItem(o: any, item: any, stored: any, template: string | null, matchRule: ReturnType<typeof buildRuleMatcher>): Promise<boolean> {
  const status: string | null = item?.track_info?.latest_status?.status ?? null;
  const timeline = toTimeline(item);
  const edd = eddOf(item);
  const base = { user_id: o.user_id, shop_id: o.shop_id, order_id: o.id, provider: "17track", edd_from: edd.from, edd_to: edd.to, edd_source: edd.source };

  // Sem nenhum evento ainda (recém-cadastrado): não apaga o histórico que já
  // existe (veio do Track123) — só marca a previsão.
  if (!timeline.length) {
    await supabaseAdmin.from("shop_order_tracking").update({ edd_from: edd.from, edd_to: edd.to, edd_source: edd.source }).eq("order_id", o.id);
    return false;
  }

  const last = timeline[0];
  const lastAt = last.event_time_utc ? `${last.event_time_utc.replace(" ", "T")}Z` : null;
  const lastLabel = last.event_detail;
  // Evento mais antigo que o já gravado (ex.: Track123 tinha algo mais novo) não volta o status.
  if (isOlderEvent(lastAt, stored?.last_event_at) && (stored?.timeline?.length ?? 0) > timeline.length) {
    await supabaseAdmin.from("shop_order_tracking").update({ edd_from: edd.from, edd_to: edd.to, edd_source: edd.source }).eq("order_id", o.id);
    return false;
  }

  const statusLabel = status ? STATUS_LABEL[status] ?? status : null;
  const carriers = ((item?.track_info?.tracking?.providers ?? []) as any[]).map((p) => p.provider?.name).filter(Boolean);
  const target = finalTrackingTarget(
    matchRule(lastLabel) ?? matchRule(statusLabel) ?? inferTarget(status, lastLabel),
    statusLabel, lastLabel, true);

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

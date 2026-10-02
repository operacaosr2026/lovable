import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reportSystemError, clearSystemError } from "@/lib/system-errors.server";
import { selectAll } from "@/lib/select-all";
import { isoTodayUS, US_TIME_ZONE } from "@/lib/timezone";
import { fetchWithRetry } from "@/lib/http";

export function addDaysISO(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Taxa de estorno por loja — igual ao relatório "Taxa de estorno" da Shopify:
// chargebacks (disputas do tipo chargeback, cada uma conta — 2 no mesmo pedido
// contam 2; as "prevented" não) ÷ pedidos pagos + parcialmente reembolsados (totalmente
// reembolsados/cancelados ficam de fora), numa janela rolante de 90 dias
// contando hoje (estorno demora semanas pra acontecer depois da compra).
// Os pedidos vêm contados direto da Shopify (orders/count), não do nosso
// banco: o banco só tem pedidos a partir de quando a loja foi ligada ao
// sistema, e a janela de 90 dias pega pedidos anteriores a isso.
// As colunas *_30d guardam a janela atual (o nome ficou de quando era 30 dias);
// *_prev, os 90 dias imediatamente anteriores (delta do Dashboard).
export const ESTORNO_WINDOW_DAYS = 90;
// Chargeback "prevented" (evitado, ex.: resolvido por RDR antes de virar
// disputa) não entra — a Shopify também não conta.
const NOT_PREVENTED = "status.is.null,status.neq.prevented";

export type EstornoStats = { pedidos: number; estornos: number; prevPedidos: number; prevEstornos: number };

// Início/fim de um dia de Nova York como ISO com fuso (ex.: 2026-09-28T00:00:00-04:00).
function nyBound(date: string, end: boolean) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: US_TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`));
  const off = (parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00").replace("GMT", "") || "+00:00";
  return `${date}T${end ? "23:59:59" : "00:00:00"}${off}`;
}

export async function shopifyPaidOrdersCount(domain: string, token: string, from: string, to: string) {
  const count = async (financialStatus: string) => {
    const url = `https://${domain}/admin/api/2024-10/orders/count.json?status=any&financial_status=${financialStatus}` +
      `&created_at_min=${encodeURIComponent(nyBound(from, false))}&created_at_max=${encodeURIComponent(nyBound(to, true))}`;
    const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Shopify orders/count ${res.status}`);
    return Number(((await res.json()) as any).count ?? 0);
  };
  const [paid, partial] = await Promise.all([count("paid"), count("partially_refunded")]);
  return paid + partial;
}

export async function computeEstornoByShop(ownerId: string, shopIds: string[], to = isoTodayUS()): Promise<Map<string, EstornoStats>> {
  const from = addDaysISO(to, -(ESTORNO_WINDOW_DAYS - 1));
  const prevTo = addDaysISO(from, -1);
  const prevFrom = addDaysISO(prevTo, -(ESTORNO_WINDOW_DAYS - 1));
  const inWin = (d: string, a: string, b: string) => d >= a && d <= b;

  const [disputesRes, settingsRes] = await Promise.all([
    selectAll(supabaseAdmin.from("shop_order_disputes").select("shop_id, initiated_at")
      .eq("user_id", ownerId).in("shop_id", shopIds).eq("type", "chargeback").or(NOT_PREVENTED)
      .gte("initiated_at", prevFrom).lte("initiated_at", to)),
    supabaseAdmin.from("shop_order_settings").select("shop_id, shopify_store_id").eq("user_id", ownerId).in("shop_id", shopIds),
  ]);
  if (disputesRes.error) throw new Error(disputesRes.error.message);
  const storeByShop = new Map(((settingsRes.data ?? []) as any[]).map((s) => [s.shop_id as string, s.shopify_store_id as string | null]));
  const storeIds = [...new Set([...storeByShop.values()].filter(Boolean))] as string[];
  const { data: stores } = storeIds.length
    ? await supabaseAdmin.from("shopify_stores").select("id, shop_domain, access_token").eq("user_id", ownerId).in("id", storeIds)
    : { data: [] as any[] };
  const credsByStore = new Map(((stores ?? []) as any[]).map((s) => [s.id as string, s]));

  // Pedidos do nosso banco — só pra loja sem Shopify ligada, ou se a Shopify falhar.
  const dbCount = async (shopId: string, a: string, b: string) => {
    const { count } = await supabaseAdmin.from("shop_orders").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId).eq("shop_id", shopId).gte("order_date", a).lte("order_date", b);
    return count ?? 0;
  };

  const out = new Map<string, EstornoStats>();
  await Promise.all(shopIds.map(async (shopId) => {
    const disputes = ((disputesRes.data ?? []) as any[]).filter((d) => d.shop_id === shopId);
    const estornos = disputes.filter((d) => inWin(String(d.initiated_at).slice(0, 10), from, to)).length;
    const prevEstornos = disputes.filter((d) => inWin(String(d.initiated_at).slice(0, 10), prevFrom, prevTo)).length;
    const creds = credsByStore.get(storeByShop.get(shopId) ?? "");
    let pedidos: number, prevPedidos: number;
    try {
      if (!creds?.access_token) throw new Error("sem Shopify ligada");
      [pedidos, prevPedidos] = await Promise.all([
        shopifyPaidOrdersCount(creds.shop_domain, creds.access_token, from, to),
        shopifyPaidOrdersCount(creds.shop_domain, creds.access_token, prevFrom, prevTo),
      ]);
    } catch (e) {
      if (creds?.access_token) console.error("estorno: contagem de pedidos na Shopify falhou, usando o banco", shopId, e);
      [pedidos, prevPedidos] = await Promise.all([dbCount(shopId, from, to), dbCount(shopId, prevFrom, prevTo)]);
    }
    out.set(shopId, { pedidos, estornos, prevPedidos, prevEstornos });
  }));
  return out;
}

async function saveEstornoStats(ownerId: string, stats: Map<string, EstornoStats>) {
  const now = new Date().toISOString();
  let saved = 0;
  await Promise.all([...stats.entries()].map(async ([shopId, st]) => {
    const { error } = await supabaseAdmin.from("shop_order_settings").update({
      chargeback_orders_30d: st.pedidos, chargeback_count_30d: st.estornos,
      chargeback_orders_prev: st.prevPedidos, chargeback_count_prev: st.prevEstornos,
      chargeback_stats_at: now,
    }).eq("user_id", ownerId).eq("shop_id", shopId);
    if (error) {
      console.error("estorno-daily: falha ao gravar", shopId, error.message);
      await reportSystemError(ownerId, `job:estorno_save:${shopId}`, "Taxa de estorno não foi gravada", error.message);
    } else {
      saved++;
      await clearSystemError(ownerId, `job:estorno_save:${shopId}`);
    }
  }));
  return saved;
}

// Reconta só os chargebacks guardados de uma loja (a contagem de pedidos da
// Shopify fica a da meia-noite). Chamada quando chega disputa nova.
export async function refreshEstornoDisputeCounts(ownerId: string, shopId: string, to = isoTodayUS()) {
  const from = addDaysISO(to, -(ESTORNO_WINDOW_DAYS - 1));
  const prevTo = addDaysISO(from, -1);
  const prevFrom = addDaysISO(prevTo, -(ESTORNO_WINDOW_DAYS - 1));
  const count = async (a: string, b: string) => {
    const { count, error } = await supabaseAdmin.from("shop_order_disputes").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId).eq("shop_id", shopId).eq("type", "chargeback").or(NOT_PREVENTED).gte("initiated_at", a).lte("initiated_at", b);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [cur, prev] = await Promise.all([count(from, to), count(prevFrom, prevTo)]);
  await supabaseAdmin.from("shop_order_settings")
    .update({ chargeback_count_30d: cur, chargeback_count_prev: prev })
    .eq("user_id", ownerId).eq("shop_id", shopId).not("chargeback_stats_at", "is", null);
}

// Lê a taxa guardada (card de Lojas e Grupos e Dashboard). Loja sem valor
// guardado — ou guardado antes da janela atual existir (sem *_prev) — calcula
// na hora e já guarda.
export async function getEstornoStats(ownerId: string, shopIds: string[]): Promise<Map<string, EstornoStats>> {
  if (!shopIds.length) return new Map();
  const { data } = await supabaseAdmin.from("shop_order_settings")
    .select("shop_id, chargeback_orders_30d, chargeback_count_30d, chargeback_orders_prev, chargeback_count_prev, chargeback_stats_at")
    .eq("user_id", ownerId).in("shop_id", shopIds);
  const out = new Map<string, EstornoStats>();
  for (const s of (data ?? []) as any[]) {
    if (!s.chargeback_stats_at || s.chargeback_orders_prev == null) continue;
    out.set(s.shop_id, {
      pedidos: Number(s.chargeback_orders_30d ?? 0), estornos: Number(s.chargeback_count_30d ?? 0),
      prevPedidos: Number(s.chargeback_orders_prev ?? 0), prevEstornos: Number(s.chargeback_count_prev ?? 0),
    });
  }
  const missing = shopIds.filter((id) => !out.has(id));
  if (missing.length) {
    const fresh = await computeEstornoByShop(ownerId, missing);
    await saveEstornoStats(ownerId, fresh);
    for (const [id, st] of fresh) out.set(id, st);
  }
  return out;
}

// 1x por dia, à meia-noite de Nova York (pg_cron, ver *_estorno_daily.sql):
// grava a taxa de estorno de 90 dias em shop_order_settings, pro card de
// Lojas e Grupos e o Dashboard só lerem em vez de recalcular a cada abertura.
export async function runEstornoDaily() {
  const { data: settings, error } = await supabaseAdmin.from("shop_order_settings").select("user_id,shop_id");
  if (error) throw new Error(error.message);
  const byOwner = new Map<string, string[]>();
  for (const s of (settings ?? []) as any[]) {
    if (!byOwner.has(s.user_id)) byOwner.set(s.user_id, []);
    byOwner.get(s.user_id)!.push(s.shop_id);
  }
  let saved = 0;
  for (const [ownerId, shopIds] of byOwner) saved += await saveEstornoStats(ownerId, await computeEstornoByShop(ownerId, shopIds));
  return { saved };
}

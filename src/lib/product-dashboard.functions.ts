import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { attachLiveShopifyNames } from "@/lib/shop-orders.functions";
import { costProductsFor } from "@/lib/product-links.server";
import { isSupplierFree, lineItemCostQty, matchLineItemProduct, productCostAt, trackingCountsAsShipped, type CostProduct } from "@/lib/product-cost-match";
import { linksByProduct } from "@/lib/product-links.server";
import { comparisonPeriod } from "@/lib/finance-rules";
import { selectAll } from "@/lib/select-all";
import { fetchWithRetry } from "@/lib/http";
import { splitUtm } from "@/lib/utm";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";
import { EMPTY_COUNTS, type RawCounts } from "@/lib/experiment-metrics";
import { parseClarity } from "@/lib/clarity-parse";

// Dashboard da aba Vendas do produto. Independente dos outros: vendas e custo
// vêm dos pedidos (mesma regra de nome/palavra-chave do Dashboard), e o gasto
// de anúncio só das campanhas escolhidas pro produto (product_ad_campaigns),
// buscado ao vivo na Meta — nada é gravado no Caixa.

const GRAPH = "https://graph.facebook.com/v21.0";
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const db = <T extends keyof Database["public"]["Tables"]>(table: T) => supabaseAdmin.from(table);

type Campaign = { shop_id: string; ad_account_id: string; campaign_id: string; campaign_name: string | null };

async function assertProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
}

async function loadCampaigns(ownerId: string, productId: string): Promise<Campaign[]> {
  const { data, error } = await db("product_ad_campaigns")
    .select("shop_id,ad_account_id,campaign_id,campaign_name")
    .eq("user_id", ownerId).eq("product_id", productId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Campaign[];
}

async function tokensByShop(ownerId: string, shopIds: string[]) {
  if (!shopIds.length) return new Map<string, string>();
  const { data } = await supabaseAdmin.from("shop_meta_tokens").select("shop_id,access_token")
    .eq("user_id", ownerId).in("shop_id", shopIds);
  return new Map(((data ?? []) as any[]).filter((r) => r.access_token).map((r) => [r.shop_id as string, r.access_token as string]));
}

// Contas de anúncio que o produto pode usar: as da Caixa das lojas e as
// ligadas nos cards de Lojas & Grupos (sem loja própria — vão pela loja cuja
// conexão Meta enxerga a conta, a mais recente primeiro).
async function adAccountOptions(ownerId: string) {
  const [{ data: shopAccs }, { data: cardAccs }, { data: tokenRows }] = await Promise.all([
    supabaseAdmin.from("shop_meta_ad_accounts").select("shop_id,ad_account_id,account_name")
      .eq("user_id", ownerId).eq("enabled", true).order("created_at", { ascending: true }),
    supabaseAdmin.from("lg_card_meta_accounts").select("ad_account_id,account_name")
      .eq("user_id", ownerId).eq("enabled", true).order("created_at", { ascending: true }),
    supabaseAdmin.from("shop_meta_tokens").select("shop_id,access_token,ad_accounts")
      .eq("user_id", ownerId).order("updated_at", { ascending: false }),
  ]);
  const accounts = new Map<string, { shop_id: string; ad_account_id: string; account_name: string | null }>();
  for (const a of (shopAccs ?? []) as any[]) if (!accounts.has(a.ad_account_id)) accounts.set(a.ad_account_id, a);
  const tokens = ((tokenRows ?? []) as any[]).filter((r) => r.access_token);
  for (const a of (cardAccs ?? []) as any[]) {
    if (accounts.has(a.ad_account_id)) continue;
    const t = tokens.find((r) => ((r.ad_accounts ?? []) as any[])
      .some((x) => x.id === a.ad_account_id || `act_${x.account_id}` === a.ad_account_id));
    if (t) accounts.set(a.ad_account_id, { shop_id: t.shop_id, ad_account_id: a.ad_account_id, account_name: a.account_name });
  }
  return accounts;
}

// Gasto por dia das campanhas, agrupado por conta de anúncios (uma chamada
// por conta). Conta que falhar entra em `errors` — o total fica incompleto e a
// tela avisa.
async function campaignSpendByDate(ownerId: string, campaigns: Campaign[], since: string, until: string) {
  const byAccount = new Map<string, { shop_id: string; ids: string[] }>();
  for (const c of campaigns) {
    const entry = byAccount.get(c.ad_account_id) ?? { shop_id: c.shop_id, ids: [] };
    entry.ids.push(c.campaign_id);
    byAccount.set(c.ad_account_id, entry);
  }
  const tokens = await tokensByShop(ownerId, [...new Set(campaigns.map((c) => c.shop_id))]);
  const spend = new Map<string, number>();
  const errors: string[] = [];
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));

  await Promise.all([...byAccount.entries()].map(async ([account, { shop_id, ids }]) => {
    const token = tokens.get(shop_id);
    if (!token) { errors.push(`${account}: Meta desconectada da loja`); return; }
    const filtering = encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: ids }]));
    let url: string | null = `${GRAPH}/${account}/insights?level=account&fields=spend&time_increment=1&time_range=${timeRange}&filtering=${filtering}&limit=500&access_token=${encodeURIComponent(token)}`;
    try {
      while (url) {
        const r = await fetchWithRetry(url);
        const json: any = await r.json();
        if (!r.ok || json.error) throw new Error(json?.error?.message || `Falha (${r.status})`);
        for (const d of (json.data ?? []) as any[]) {
          if (d.date_start) spend.set(d.date_start, (spend.get(d.date_start) ?? 0) + Number(d.spend ?? 0));
        }
        url = json.paging?.next ?? null;
      }
    } catch (e: any) {
      errors.push(`${account}: ${String(e?.message ?? e)}`);
    }
  }));
  return { spend, errors };
}

const delta = (curr: number, prev: number) => (prev === 0 ? 0 : Math.round(((curr - prev) / prev) * 1000) / 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

// Faturamento, custo e unidades só dos itens deste produto no pedido (null se
// o pedido não tem o produto).
function productOrderTotals(o: any, catalog: { id: string; shopify_product_ids: string[] }[], productId: string, myCost: any) {
  const date = String(o.order_date);
  let faturamento = 0, custo = 0, unidades = 0, matched = false;
  const free = isSupplierFree(o.tags);
  const tracked = trackingCountsAsShipped(o.line_items, !!o.tracking_code);
  for (const li of (o.line_items ?? []) as any[]) {
    if (matchLineItemProduct(li, catalog)?.id !== productId) continue;
    matched = true;
    const qty = Number(li?.quantity ?? 0);
    const allocs = Array.isArray(li?.discount_allocations) ? li.discount_allocations : [];
    const discount = allocs.length
      ? allocs.reduce((s: number, a: any) => s + Number(a?.amount ?? 0), 0)
      : Number(li?.total_discount ?? 0);
    unidades += qty;
    faturamento += Number(li?.price ?? 0) * qty - discount;
    if (!free && myCost) custo += lineItemCostQty(li, tracked) * productCostAt(myCost, date);
  }
  return matched ? { faturamento, custo, unidades } : null;
}

export const getProductDashboard = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), from: ISO, to: ISO }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const { prevFrom, prevTo } = comparisonPeriod(data.from, data.to);

    const [ordersRes, costProducts, campaigns] = await Promise.all([
      selectAll(supabaseAdmin.from("shop_orders")
        .select("order_date,line_items:raw->line_items,tags:raw->>tags,tracking_code")
        .eq("user_id", ownerId).gte("order_date", prevFrom).lte("order_date", data.to)),
      costProductsFor(supabaseAdmin, ownerId),
      loadCampaigns(ownerId, data.product_id),
    ]);
    const catalog = costProducts as (CostProduct & { id: string; shopify_product_ids: string[] })[];
    const myCost = catalog.find((p) => p.id === data.product_id);

    type Day = { faturamento: number; custo: number; pedidos: number; unidades: number };
    const days = new Map<string, Day>();
    for (const o of (ordersRes.data ?? []) as any[]) {
      const m = productOrderTotals(o, catalog, data.product_id, myCost);
      if (!m) continue;
      const date = String(o.order_date);
      const d = days.get(date) ?? { faturamento: 0, custo: 0, pedidos: 0, unidades: 0 };
      d.faturamento += m.faturamento; d.custo += m.custo; d.unidades += m.unidades; d.pedidos += 1;
      days.set(date, d);
    }

    const configured = campaigns.length > 0;
    const ads = configured
      ? await campaignSpendByDate(ownerId, campaigns, prevFrom, data.to)
      : { spend: new Map<string, number>(), errors: [] as string[] };

    const sum = (from: string, to: string) => {
      const t = { faturamento: 0, custo: 0, pedidos: 0, unidades: 0, anuncios: 0 };
      for (const [date, d] of days) {
        if (date < from || date > to) continue;
        t.faturamento += d.faturamento; t.custo += d.custo; t.pedidos += d.pedidos; t.unidades += d.unidades;
      }
      for (const [date, v] of ads.spend) if (date >= from && date <= to) t.anuncios += v;
      return t;
    };
    const cur = sum(data.from, data.to);
    const prev = sum(prevFrom, prevTo);
    const lucro = cur.faturamento - cur.custo - cur.anuncios;
    const prevLucro = prev.faturamento - prev.custo - prev.anuncios;

    const chart: { date: string; faturamento: number; anuncios: number; custo: number; lucro: number }[] = [];
    for (let d = data.from; d <= data.to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
      const v = days.get(d);
      const a = ads.spend.get(d) ?? 0;
      const f = v?.faturamento ?? 0, c = v?.custo ?? 0;
      chart.push({ date: `${d.slice(8, 10)}/${d.slice(5, 7)}`, faturamento: round2(f), anuncios: round2(a), custo: round2(c), lucro: round2(f - c - a) });
    }

    return {
      configured,
      campaignCount: campaigns.length,
      adsErrors: ads.errors,
      totals: {
        faturamento: round2(cur.faturamento), faturamentoDelta: delta(cur.faturamento, prev.faturamento),
        custo: round2(cur.custo), custoDelta: delta(cur.custo, prev.custo),
        pedidos: cur.pedidos, pedidosDelta: delta(cur.pedidos, prev.pedidos),
        unidades: cur.unidades, unidadesDelta: delta(cur.unidades, prev.unidades),
        anuncios: round2(cur.anuncios), anunciosDelta: delta(cur.anuncios, prev.anuncios),
        lucro: round2(lucro), lucroDelta: delta(lucro, prevLucro),
      },
      chart,
    };
  });

// ── Vendas por criativo ──

// UTMs do pedido pela jornada do cliente da Shopify (customerJourneySummary).
// O landing_site do pedido vem cortado em 255 caracteres e o _fbc chega antes
// das UTMs, então quase nunca dá pra ler de lá.
const JOURNEY_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Order {
    legacyResourceId
    customerJourneySummary {
      lastVisit { utmParameters { source medium campaign content term } }
      firstVisit { utmParameters { source medium campaign content term } }
    }
  } }
}`;
type Utm = { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null };

// Guardadas em shop_order_utms depois da 1ª busca (não mudam). Pedido sem UTM
// só entra no cache com mais de 3 dias — a jornada pode demorar a ser montada.
async function orderUtms(ownerId: string, orders: { shop_id: string; external_id: string; date?: string }[]) {
  const utms = new Map<string, Utm>();
  const errors: string[] = [];
  const byShop = new Map<string, string[]>();
  for (const o of orders) byShop.set(o.shop_id, [...(byShop.get(o.shop_id) ?? []), o.external_id]);
  if (!byShop.size) return { utms, errors };

  const cached = new Set<string>();
  await Promise.all([...byShop.entries()].flatMap(([shopId, ids]) => {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
    return chunks.map(async (chunk) => {
      const { data } = await db("shop_order_utms").select("external_id,source,medium,campaign,content,term")
        .eq("shop_id", shopId).in("external_id", chunk);
      for (const r of data ?? []) {
        const key = `${shopId}:${r.external_id}`;
        cached.add(key);
        if (r.source || r.medium || r.campaign || r.content || r.term) {
          utms.set(key, { source: r.source, medium: r.medium, campaign: r.campaign, content: r.content, term: r.term });
        }
      }
    });
  }));
  const missing = new Map<string, string[]>();
  for (const [shopId, ids] of byShop) {
    const m = ids.filter((id) => !cached.has(`${shopId}:${id}`));
    if (m.length) missing.set(shopId, m);
  }
  if (!missing.size) return { utms, errors };

  const { data: settings } = await supabaseAdmin.from("shop_order_settings").select("shop_id,shopify_store_id")
    .eq("user_id", ownerId).in("shop_id", [...missing.keys()]);
  const storeByShop = new Map(((settings ?? []) as any[]).filter((r) => r.shopify_store_id).map((r) => [r.shop_id as string, r.shopify_store_id as string]));
  const { data: stores } = storeByShop.size
    ? await supabaseAdmin.from("shopify_stores").select("id,shop_domain,access_token").in("id", [...new Set(storeByShop.values())])
    : { data: [] as any[] };
  const storeById = new Map(((stores ?? []) as any[]).map((s) => [s.id as string, s]));
  const dateOf = new Map(orders.map((o) => [`${o.shop_id}:${o.external_id}`, o.date]));
  const oldEnough = addDaysIso(isoTodayUS(), -3);
  const toCache: Database["public"]["Tables"]["shop_order_utms"]["Insert"][] = [];

  await Promise.all([...missing.entries()].map(async ([shopId, ids]) => {
    const store = storeById.get(storeByShop.get(shopId) ?? "");
    if (!store?.access_token) { errors.push("Loja sem Shopify conectada"); return; }
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
    // Até 4 lotes ao mesmo tempo por loja (limite da API da Shopify).
    for (let i = 0; i < batches.length; i += 4) {
      try {
        await Promise.all(batches.slice(i, i + 4).map(async (batch) => {
          const res = await fetchWithRetry(`https://${store.shop_domain}/admin/api/2026-07/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": store.access_token },
            body: JSON.stringify({ query: JOURNEY_QUERY, variables: { ids: batch.map((id) => `gid://shopify/Order/${id}`) } }),
          });
          const json: any = await res.json();
          if (!res.ok || json.errors) throw new Error(json?.errors ? JSON.stringify(json.errors).slice(0, 200) : `Falha (${res.status})`);
          const found = new Set<string>();
          for (const n of (json.data?.nodes ?? []) as any[]) {
            const j = n?.customerJourneySummary;
            const u = j?.lastVisit?.utmParameters?.content ? j.lastVisit.utmParameters : j?.firstVisit?.utmParameters;
            if (n?.legacyResourceId && u) {
              const id = String(n.legacyResourceId);
              found.add(id);
              utms.set(`${shopId}:${id}`, u);
              toCache.push({ shop_id: shopId, external_id: id, source: u.source, medium: u.medium, campaign: u.campaign, content: u.content, term: u.term });
            }
          }
          for (const id of batch) {
            const d = dateOf.get(`${shopId}:${id}`);
            if (!found.has(id) && d && d < oldEnough) toCache.push({ shop_id: shopId, external_id: id });
          }
        }));
      } catch (e: any) {
        errors.push(`${store.shop_domain}: ${String(e?.message ?? e)}`);
        break;
      }
    }
  }));
  for (let i = 0; i < toCache.length; i += 500) {
    await db("shop_order_utms").upsert(toCache.slice(i, i + 500), { onConflict: "shop_id,external_id" });
  }
  return { utms, errors };
}

// Gasto e nome de cada anúncio das campanhas do produto no período.
async function adSpendByAd(ownerId: string, campaigns: Campaign[], since: string, until: string) {
  const byAccount = new Map<string, { shop_id: string; ids: string[] }>();
  for (const c of campaigns) {
    const entry = byAccount.get(c.ad_account_id) ?? { shop_id: c.shop_id, ids: [] };
    entry.ids.push(c.campaign_id);
    byAccount.set(c.ad_account_id, entry);
  }
  const tokens = await tokensByShop(ownerId, [...new Set(campaigns.map((c) => c.shop_id))]);
  const ads = new Map<string, { name: string; spend: number }>();
  const errors: string[] = [];
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));

  await Promise.all([...byAccount.entries()].map(async ([account, { shop_id, ids }]) => {
    const token = tokens.get(shop_id);
    if (!token) { errors.push(`${account}: Meta desconectada da loja`); return; }
    const filtering = encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: ids }]));
    let url: string | null = `${GRAPH}/${account}/insights?level=ad&fields=ad_id,ad_name,spend&time_range=${timeRange}&filtering=${filtering}&limit=500&access_token=${encodeURIComponent(token)}`;
    try {
      while (url) {
        const r = await fetchWithRetry(url);
        const json: any = await r.json();
        if (!r.ok || json.error) throw new Error(json?.error?.message || `Falha (${r.status})`);
        for (const d of (json.data ?? []) as any[]) {
          if (!d.ad_id) continue;
          const a = ads.get(d.ad_id) ?? { name: d.ad_name ?? d.ad_id, spend: 0 };
          a.spend += Number(d.spend ?? 0);
          ads.set(d.ad_id, a);
        }
        url = json.paging?.next ?? null;
      }
    } catch (e: any) {
      errors.push(`${account}: ${String(e?.message ?? e)}`);
    }
  }));
  return { ads, errors };
}

// utm_medium genérico (ex.: "paid") não serve de nome de criativo.
const GENERIC_MEDIUM = /^(paid|cpc|ppc|social|paid_social|paidsocial|facebook|fb|ig|instagram|meta)$/i;

export const getProductCreatives = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), from: ISO, to: ISO }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);

    const [ordersRes, costProducts, campaigns] = await Promise.all([
      selectAll(supabaseAdmin.from("shop_orders")
        .select("shop_id,external_id,order_date,line_items:raw->line_items,tags:raw->>tags,tracking_code")
        .eq("user_id", ownerId).gte("order_date", data.from).lte("order_date", data.to)),
      costProductsFor(supabaseAdmin, ownerId),
      loadCampaigns(ownerId, data.product_id),
    ]);
    const catalog = costProducts as (CostProduct & { id: string; shopify_product_ids: string[] })[];
    const myCost = catalog.find((p) => p.id === data.product_id);

    const sales: { shop_id: string; external_id: string; date: string; faturamento: number; custo: number; unidades: number }[] = [];
    for (const o of (ordersRes.data ?? []) as any[]) {
      const m = productOrderTotals(o, catalog, data.product_id, myCost);
      if (m) sales.push({ shop_id: o.shop_id, external_id: String(o.external_id), date: String(o.order_date).slice(0, 10), ...m });
    }

    const [journey, meta] = await Promise.all([
      orderUtms(ownerId, sales),
      campaigns.length ? adSpendByAd(ownerId, campaigns, data.from, data.to) : Promise.resolve({ ads: new Map<string, { name: string; spend: number }>(), errors: [] as string[] }),
    ]);

    type Row = { key: string; ad_id: string | null; nome: string; utm_medium: string | null; pedidos: number; unidades: number; faturamento: number; custo: number; gasto: number };
    const rows = new Map<string, Row>();
    const row = (key: string, init: () => Row) => { const r = rows.get(key) ?? init(); rows.set(key, r); return r; };

    for (const s of sales) {
      const u = journey.utms.get(`${s.shop_id}:${s.external_id}`);
      // Padrão novo "nome|id"; no antigo o content já era o id (ou um nome digitado).
      const content = splitUtm(u?.content);
      const adId = content.id ?? (content.name || null);
      const medium = splitUtm(u?.medium).name || null;
      const key = adId ? `ad:${adId}` : medium ? `utm:${medium}` : "none";
      const r = row(key, () => ({
        key, ad_id: adId, utm_medium: medium, pedidos: 0, unidades: 0, faturamento: 0, custo: 0, gasto: 0,
        nome: adId ? (meta.ads.get(adId)?.name ?? (medium && !GENERIC_MEDIUM.test(medium) ? medium : `Anúncio ${adId}`)) : medium ?? "Sem UTM",
      }));
      r.pedidos += 1; r.unidades += s.unidades; r.faturamento += s.faturamento; r.custo += s.custo;
    }
    for (const [adId, a] of meta.ads) {
      if (a.spend <= 0 && !rows.has(`ad:${adId}`)) continue;
      const r = row(`ad:${adId}`, () => ({ key: `ad:${adId}`, ad_id: adId, utm_medium: null, nome: a.name, pedidos: 0, unidades: 0, faturamento: 0, custo: 0, gasto: 0 }));
      r.nome = a.name;
      r.gasto += a.spend;
    }

    return {
      configured: campaigns.length > 0,
      errors: [...journey.errors, ...meta.errors],
      rows: [...rows.values()]
        .map((r) => ({ ...r, faturamento: round2(r.faturamento), custo: round2(r.custo), gasto: round2(r.gasto) }))
        .sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : b.faturamento - a.faturamento || b.gasto - a.gasto)),
    };
  });

// ── Configurar campanhas ──

// Contas de anúncio conectadas nas lojas (Caixa > loja > Meta) com as
// campanhas de cada uma, e as que já estão marcadas pro produto. Mesma conta
// em várias lojas aparece uma vez.
export const listProductAdCampaignOptions = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const [accounts, selected] = await Promise.all([
      adAccountOptions(ownerId),
      loadCampaigns(ownerId, data.product_id),
    ]);

    const selectedOut = selected.map((c) => ({ shop_id: c.shop_id, campaign_id: c.campaign_id, ad_account_id: c.ad_account_id, campaign_name: c.campaign_name }));
    if (!accounts.size) return { accounts: [], selected: selectedOut };

    const shopIds = [...new Set([...accounts.values()].map((a) => a.shop_id))];
    const [tokens, { data: shopRows }] = await Promise.all([
      tokensByShop(ownerId, shopIds),
      supabaseAdmin.from("shops").select("id,name").eq("user_id", ownerId).in("id", shopIds),
    ]);
    const shops = await attachLiveShopifyNames(ownerId, ((shopRows ?? []) as any[]).map((s) => ({ id: s.id as string, name: s.name as string })));
    const shopName = new Map(shops.map((s) => [s.id, s.name]));

    const result = await Promise.all([...accounts.values()].map(async (a) => {
      const token = tokens.get(a.shop_id);
      const base = { shop_id: a.shop_id, shop_name: shopName.get(a.shop_id) ?? "Loja", ad_account_id: a.ad_account_id, account_name: a.account_name };
      if (!token) return { ...base, error: "Meta desconectada da loja", campaigns: [] };
      const campaigns: { id: string; name: string; status: string }[] = [];
      let url: string | null = `${GRAPH}/${a.ad_account_id}/campaigns?fields=id,name,effective_status&limit=200&access_token=${encodeURIComponent(token)}`;
      try {
        for (let page = 0; url && page < 10; page++) {
          const r = await fetchWithRetry(url);
          const json: any = await r.json();
          if (!r.ok || json.error) throw new Error(json?.error?.message || `Falha (${r.status})`);
          for (const c of (json.data ?? []) as any[]) campaigns.push({ id: c.id, name: c.name, status: c.effective_status });
          url = json.paging?.next ?? null;
        }
        return { ...base, error: null, campaigns };
      } catch (e: any) {
        return { ...base, error: String(e?.message ?? e), campaigns };
      }
    }));

    return { accounts: result, selected: selectedOut };
  });

export const saveProductAdCampaigns = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    campaigns: z.array(z.object({
      shop_id: z.string().uuid(),
      ad_account_id: z.string().min(1).max(60),
      campaign_id: z.string().min(1).max(60),
      campaign_name: z.string().max(400).nullable(),
    })).max(500),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    if (data.campaigns.length) {
      const [{ data: own }, options] = await Promise.all([
        supabaseAdmin.from("shop_meta_ad_accounts").select("shop_id,ad_account_id").eq("user_id", ownerId),
        adAccountOptions(ownerId),
      ]);
      const ok = new Set([
        ...((own ?? []) as any[]).map((r) => `${r.shop_id}|${r.ad_account_id}`),
        ...[...options.values()].map((a) => `${a.shop_id}|${a.ad_account_id}`),
      ]);
      if (data.campaigns.some((c) => !ok.has(`${c.shop_id}|${c.ad_account_id}`))) throw new Error("Conta de anúncios não encontrada");
    }
    const { error: delErr } = await db("product_ad_campaigns").delete().eq("user_id", ownerId).eq("product_id", data.product_id);
    if (delErr) throw new Error(delErr.message);
    if (data.campaigns.length) {
      const { error } = await db("product_ad_campaigns").insert(
        data.campaigns.map((c) => ({ ...c, user_id: ownerId, product_id: data.product_id })),
      );
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ── Funil por produto ──

// Sessões (pixel da matriz) e checkout iniciado (pixel das sublojas) vêm de
// product_funnel_events; checkout concluído são os pedidos do produto, os
// mesmos do card Pedidos. Tudo só a partir do 1º dia com evento do pixel —
// antes disso não há sessões pra comparar e a taxa sairia inflada.
export const getProductFunnel = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), from: ISO, to: ISO }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);

    const pagesRes = await db("product_funnel_pages").select("pagefly_page_id,product_id").eq("user_id", ownerId);
    const pageProduct = new Map<string, string>(((pagesRes.data ?? []) as any[]).map((p) => [`pf:${p.pagefly_page_id}`, p.product_id]));
    const pages = ((pagesRes.data ?? []) as any[]).filter((p) => p.product_id === data.product_id).map((p) => p.pagefly_page_id as string);

    // Começa no 1º dia com sessão (pixel da matriz funcionando); sem sessão
    // ainda, no 1º evento qualquer.
    const firstDay = async (step?: string) => {
      let q = db("product_funnel_events").select("day").eq("user_id", ownerId);
      if (step) q = q.eq("step", step);
      const { data: row } = await q.order("day", { ascending: true }).limit(1).maybeSingle();
      return row ? String(row.day) : null;
    };
    const since = (await firstDay("session")) ?? (await firstDay());
    if (!since) return { installed: false as const, pages };
    const { prevFrom, prevTo } = comparisonPeriod(data.from, data.to);

    const [eventsRes, links, pubsRes, ordersRes] = await Promise.all([
      selectAll(db("product_funnel_events")
        .select("id,shopify_store_id,step,day,client_id,shopify_product_id,title")
        .eq("user_id", ownerId).gte("day", prevFrom).lte("day", data.to)),
      linksByProduct(ownerId),
      db("product_shopify_publications").select("product_id,shopify_store_id,shopify_product_id,handle")
        .eq("user_id", ownerId).eq("status", "ok").not("shopify_product_id", "is", null),
      selectAll(supabaseAdmin.from("shop_orders")
        .select("id,order_date,line_items:raw->line_items")
        .eq("user_id", ownerId).gte("order_date", prevFrom > since ? prevFrom : since).lte("order_date", data.to)),
    ]);
    const catalog = [...links].map(([id, l]) => ({ id, ...l }));
    const linked = new Map(catalog.flatMap((p) => p.shopify_product_ids.map((s) => [s, p.id] as const)));
    // Pixel da matriz manda "pf:<página do PageFly>", o ID do produto ou "h:<handle>" (pela URL).
    const published = new Map<string, string>();
    for (const p of (pubsRes.data ?? []) as any[]) {
      published.set(`${p.shopify_store_id}|${p.shopify_product_id}`, p.product_id);
      if (p.handle) published.set(`${p.shopify_store_id}|h:${String(p.handle).toLowerCase()}`, p.product_id);
    }

    type Counts = { sessions: number; checkouts: number; orders: number };
    const empty = (): Counts => ({ sessions: 0, checkouts: 0, orders: 0 });
    const cur = empty(), prev = empty();
    const bucket = (day: string) => (day >= since && day >= data.from && day <= data.to ? cur
      : day >= since && day >= prevFrom && day <= prevTo ? prev : null);

    const seen = new Set<string>();
    for (const e of (eventsRes.data ?? []) as any[]) {
      const productId = pageProduct.get(e.shopify_product_id)
        ?? published.get(`${e.shopify_store_id}|${e.shopify_product_id}`)
        ?? linked.get(String(e.shopify_product_id));
      if (productId !== data.product_id) continue;
      const key = `${e.step}|${e.shopify_store_id}|${e.day}|${e.client_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = bucket(String(e.day));
      if (b) b[e.step === "session" ? "sessions" : "checkouts"] += 1;
    }
    for (const o of (ordersRes.data ?? []) as any[]) {
      const b = bucket(String(o.order_date));
      if (!b) continue;
      if (((o.line_items ?? []) as any[]).some((li) => matchLineItemProduct(li, catalog)?.id === data.product_id)) b.orders += 1;
    }

    return { installed: true as const, pages, since, cur, prev: prevTo >= since ? prev : null };
  });

// Id da página no link do PageFly (…/apps/pagefly?id=<id>) ou o próprio id colado.
function pageflyPageId(input: string) {
  const s = input.trim();
  let id = s;
  try { id = new URL(s).searchParams.get("id") ?? ""; } catch { /* não é URL: é o id */ }
  id = id.trim().toLowerCase();
  if (!/^[a-z0-9-]{8,64}$/.test(id)) throw new Error("Link inválido — cole o link da página do PageFly (…/apps/pagefly?id=…).");
  return id;
}

export const addProductFunnelPage = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), url: z.string().trim().min(1).max(2000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertProduct(ownerId, data.product_id);
    const id = pageflyPageId(data.url);
    const { data: existing } = await db("product_funnel_pages").select("product_id")
      .eq("user_id", ownerId).eq("pagefly_page_id", id).maybeSingle();
    if (existing && existing.product_id !== data.product_id) {
      const { data: other } = await supabaseAdmin.from("products").select("name").eq("id", existing.product_id).maybeSingle();
      throw new Error(`Essa página já está ligada ao produto ${other?.name ?? "outro"}.`);
    }
    const { error } = await db("product_funnel_pages")
      .upsert({ user_id: ownerId, pagefly_page_id: id, product_id: data.product_id }, { onConflict: "user_id,pagefly_page_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeProductFunnelPage = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), pagefly_page_id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await db("product_funnel_pages").delete()
      .eq("user_id", context.ownerId).eq("product_id", data.product_id).eq("pagefly_page_id", data.pagefly_page_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Métricas da campanha (Inteligência › Campanhas) ──

// Contagens brutas por dia (e por conjunto, se pedido); as taxas (CPM, CTR,
// CPA...) são calculadas na tela a partir delas, pra linha de total sair certa.
export type ExperimentRaw = RawCounts & { date: string; group: string; group_name: string };

// A Meta repete o mesmo evento em vários action_types; pega o primeiro que vier.
const ACTION_KEYS = {
  lpv: ["landing_page_view", "omni_landing_page_view"],
  ic: ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout", "omni_initiated_checkout"],
  purchase: ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"],
};
const actionCount = (actions: any[] | undefined, keys: string[]) => {
  for (const k of keys) {
    const a = (actions ?? []).find((x) => x?.action_type === k);
    if (a) return Number(a.value ?? 0);
  }
  return 0;
};
const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const nyDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));

export const getExperimentMetrics = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ experiment_id: z.string().uuid(), from: ISO, to: ISO, level: z.enum(["campaign", "adset"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const { data: exp } = await db("experiments").select("product_id,campaign_id,campaign_name")
      .eq("id", data.experiment_id).eq("user_id", ownerId).maybeSingle();
    if (!exp) throw new Error("Campanha não encontrada");
    if (!exp.campaign_id) return { configured: false as const };

    const campaign = (await loadCampaigns(ownerId, exp.product_id)).find((c) => c.campaign_id === exp.campaign_id);
    if (!campaign) throw new Error("A campanha da Meta não está mais ligada ao produto (Inteligência › Vendas)");

    const errors: string[] = [];
    const rows = new Map<string, ExperimentRaw>();
    const row = (date: string, group: string, group_name: string) => {
      const key = `${date}|${group}`;
      const r = rows.get(key) ?? { ...EMPTY_COUNTS, date, group, group_name };
      rows.set(key, r);
      return r;
    };
    const adsets = new Map<string, string>();   // id → nome (pra casar UTM antiga, só com nome)
    let activeAdsets: string[] | null = null;   // conjuntos rodando agora (filtro "Só ativos")
    let metaCampaignName: string | null = null;

    // Meta, Shopify, Clarity e Diário são buscados ao mesmo tempo; o casamento
    // da Shopify e do Clarity com os conjuntos vem depois (precisa dos nomes da Meta).
    const metaTask = async () => {
    const token = (await tokensByShop(ownerId, [campaign.shop_id])).get(campaign.shop_id);
    if (!token) errors.push("Meta desconectada da loja da campanha");
    else {
      // Status de entrega atual dos conjuntos; falha aqui só desliga o filtro.
      const statusTask = data.level !== "adset" ? null : (async () => {
        try {
          const ids: string[] = [];
          let next: string | null = `${GRAPH}/${campaign.campaign_id}/adsets?fields=id,effective_status&limit=500&access_token=${encodeURIComponent(token)}`;
          while (next) {
            const r = await fetchWithRetry(next);
            const json: any = await r.json();
            if (!r.ok || json.error) throw new Error(json?.error?.message || `Falha (${r.status})`);
            for (const a of (json.data ?? []) as any[]) if (a.effective_status === "ACTIVE") ids.push(String(a.id));
            next = json.paging?.next ?? null;
          }
          activeAdsets = ids;
        } catch (e) {
          console.error("[experiment-metrics] status dos conjuntos:", e);
        }
      })();
      const timeRange = encodeURIComponent(JSON.stringify({ since: data.from, until: data.to }));
      let url: string | null = `${GRAPH}/${campaign.campaign_id}/insights?level=${data.level}&fields=campaign_name,adset_id,adset_name,spend,impressions,inline_link_clicks,actions&time_increment=1&time_range=${timeRange}&limit=500&access_token=${encodeURIComponent(token)}`;
      try {
        while (url) {
          const r = await fetchWithRetry(url);
          const json: any = await r.json();
          if (!r.ok || json.error) throw new Error(json?.error?.message || `Falha (${r.status})`);
          for (const d of (json.data ?? []) as any[]) {
            metaCampaignName = d.campaign_name ?? metaCampaignName;
            const group = data.level === "adset" ? String(d.adset_id) : "all";
            if (data.level === "adset") adsets.set(group, d.adset_name ?? group);
            const x = row(d.date_start, group, data.level === "adset" ? d.adset_name ?? group : "Campanha");
            x.spend += Number(d.spend ?? 0);
            x.impressions += Number(d.impressions ?? 0);
            x.clicks += Number(d.inline_link_clicks ?? 0);
            x.lpv += actionCount(d.actions, ACTION_KEYS.lpv);
            x.ic += actionCount(d.actions, ACTION_KEYS.ic);
            x.purchases_meta += actionCount(d.actions, ACTION_KEYS.purchase);
          }
          url = json.paging?.next ?? null;
        }
      } catch (e: any) {
        errors.push(`Meta: ${String(e?.message ?? e)}`);
      }
      await statusTask;
    }
    };

    // Shopify: pedidos do produto cuja UTM é desta campanha. Padrão novo casa
    // pelo id; UTM antiga (só nome) casa pelo nome atual ou o guardado.
    const shopifyTask = async () => {
    const [ordersRes, costProducts] = await Promise.all([
      selectAll(supabaseAdmin.from("shop_orders")
        .select("shop_id,external_id,order_date,line_items:raw->line_items,tags:raw->>tags,tracking_code")
        .eq("user_id", ownerId).gte("order_date", data.from).lte("order_date", data.to)),
      costProductsFor(supabaseAdmin, ownerId),
    ]);
    const catalog = costProducts as (CostProduct & { id: string; shopify_product_ids: string[] })[];
    const myCost = catalog.find((p) => p.id === exp.product_id);
    const sales: { shop_id: string; external_id: string; date: string; faturamento: number }[] = [];
    for (const o of (ordersRes.data ?? []) as any[]) {
      const m = productOrderTotals(o, catalog, exp.product_id, myCost);
      if (m) sales.push({ shop_id: o.shop_id, external_id: String(o.external_id), date: String(o.order_date).slice(0, 10), faturamento: m.faturamento });
    }
    return { sales, journey: await orderUtms(ownerId, sales) };
    };

    // Diário: registros do tipo "Alteração" no período (do produto ou desta
    // campanha; os de outras campanhas não), marcados na tabela.
    const changesTask = async () => {
      const { data: sys } = await db("product_diary_note_types").select("id").eq("user_id", ownerId).eq("is_system", true).maybeSingle();
      if (!sys) return [];
      const { data: entries } = await db("product_diary_entries").select("content,created_at").eq("user_id", ownerId).eq("product_id", exp.product_id)
        .eq("note_type_id", sys.id).or(`experiment_id.is.null,experiment_id.eq.${data.experiment_id}`).gte("created_at", `${data.from}T00:00:00-06:00`).lte("created_at", `${data.to}T23:59:59-03:00`)
        .order("created_at", { ascending: true });
      return (entries ?? []).map((e) => ({ date: nyDate(e.created_at), content: e.content })).filter((e) => e.date >= data.from && e.date <= data.to);
    };

    // Clarity: projeto do produto. Campaign = utm_campaign, Medium = utm_medium
    // (conjunto); filtra pela campanha do teste.
    const [, { sales, journey }, { data: snaps }, changes] = await Promise.all([
      metaTask(),
      shopifyTask(),
      db("clarity_snapshots").select("day,partial,raw").eq("user_id", ownerId).eq("product_id", exp.product_id).gte("day", data.from).lte("day", data.to),
      changesTask(),
    ]);

    errors.push(...journey.errors.map((e) => `Shopify: ${e}`));
    for (const s of sales) {
      const u = journey.utms.get(`${s.shop_id}:${s.external_id}`);
      if (!u) continue;
      const c = splitUtm(u.campaign);
      const isCampaign = c.id ? c.id === campaign.campaign_id : sameName(c.name, metaCampaignName) || sameName(c.name, exp.campaign_name);
      if (!isCampaign) continue;
      let group = "all", groupName = "Campanha";
      if (data.level === "adset") {
        const m = splitUtm(u.medium);
        const id = m.id ?? [...adsets].find(([, name]) => sameName(name, m.name))?.[0];
        group = id ?? "?";
        groupName = id ? adsets.get(id) ?? m.name : "Conjunto não identificado";
      }
      const x = row(s.date, group, groupName);
      x.purchases_shop += 1;
      x.revenue += s.faturamento;
    }

    const partialDays = new Set<string>();
    for (const snap of snaps ?? []) {
      for (const c of parseClarity(snap.raw)) {
        const camp = splitUtm(c.campaign);
        const isCampaign = camp.id ? camp.id === campaign.campaign_id : sameName(camp.name, metaCampaignName) || sameName(camp.name, exp.campaign_name);
        if (!isCampaign || c.sessions <= 0) continue;
        let group = "all", groupName = "Campanha";
        if (data.level === "adset") {
          const m = splitUtm(c.medium);
          const id = m.id ?? [...adsets].find(([, name]) => sameName(name, m.name))?.[0];
          group = id ?? "?";
          groupName = id ? adsets.get(id) ?? m.name : "Conjunto não identificado";
        }
        if (snap.partial) partialDays.add(snap.day);
        const x = row(String(snap.day), group, groupName);
        const n = c.sessions;
        x.c_sessions += n;
        if (c.time !== null) { x.c_time += c.time * n; x.c_time_n += n; }
        if (c.scroll !== null) { x.c_scroll += c.scroll * n; x.c_scroll_n += n; }
        if (c.quickback !== null) { x.c_quickback += c.quickback * n; x.c_quickback_n += n; }
        if (c.rage !== null) { x.c_rage += c.rage * n; x.c_rage_n += n; }
        if (c.dead !== null) { x.c_dead += c.dead * n; x.c_dead_n += n; }
        if (c.errors !== null) { x.c_errors += c.errors * n; x.c_errors_n += n; }
      }
    }

    return {
      configured: true as const,
      campaign_name: metaCampaignName ?? exp.campaign_name ?? campaign.campaign_id,
      errors,
      rows: [...rows.values()].map((r) => ({ ...r, spend: round2(r.spend), revenue: round2(r.revenue) })),
      changes,
      partialDays: [...partialDays],
      activeAdsets: activeAdsets as string[] | null,
    };
  });

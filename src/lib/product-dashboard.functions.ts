import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { attachLiveShopifyNames, costProductsFor } from "@/lib/shop-orders.functions";
import { isSupplierFree, lineItemCostQty, matchLineItemProduct, productCostAt } from "@/lib/product-cost-match";
import { comparisonPeriod } from "@/lib/finance-rules";
import { selectAll } from "@/lib/select-all";
import { fetchWithRetry } from "@/lib/http";

// Dashboard da aba Vendas do produto. Independente dos outros: vendas e custo
// vêm dos pedidos (mesma regra de nome/palavra-chave do Dashboard), e o gasto
// de anúncio só das campanhas escolhidas pro produto (product_ad_campaigns),
// buscado ao vivo na Meta — nada é gravado no Caixa.

const GRAPH = "https://graph.facebook.com/v21.0";
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const db = (table: string) => (supabaseAdmin as any).from(table);

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
function productOrderTotals(o: any, catalog: { id: string; name: string; keywords: string[] | null }[], productId: string, myCost: any) {
  const date = String(o.order_date);
  let faturamento = 0, custo = 0, unidades = 0, matched = false;
  const free = isSupplierFree(o.tags);
  for (const li of (o.line_items ?? []) as any[]) {
    const title = String(li?.title ?? li?.name ?? "");
    if (matchLineItemProduct(title, catalog)?.id !== productId) continue;
    matched = true;
    const qty = Number(li?.quantity ?? 0);
    const allocs = Array.isArray(li?.discount_allocations) ? li.discount_allocations : [];
    const discount = allocs.length
      ? allocs.reduce((s: number, a: any) => s + Number(a?.amount ?? 0), 0)
      : Number(li?.total_discount ?? 0);
    unidades += qty;
    faturamento += Number(li?.price ?? 0) * qty - discount;
    if (!free && myCost) custo += lineItemCostQty(li, !!o.tracking_code) * productCostAt(myCost, date);
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

    const [ordersRes, catalogRes, costProducts, campaigns] = await Promise.all([
      selectAll(supabaseAdmin.from("shop_orders")
        .select("order_date,line_items:raw->line_items,tags:raw->>tags,tracking_code")
        .eq("user_id", ownerId).gte("order_date", prevFrom).lte("order_date", data.to)),
      supabaseAdmin.from("products").select("id,name,keywords").eq("user_id", ownerId),
      costProductsFor(supabaseAdmin, ownerId),
      loadCampaigns(ownerId, data.product_id),
    ]);
    const catalog = (catalogRes.data ?? []) as { id: string; name: string; keywords: string[] | null }[];
    const me = catalog.find((p) => p.id === data.product_id)!;
    const myCost = costProducts.find((p) => p.name === me.name);

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

async function orderUtms(ownerId: string, orders: { shop_id: string; external_id: string }[]) {
  const utms = new Map<string, Utm>();
  const errors: string[] = [];
  const byShop = new Map<string, string[]>();
  for (const o of orders) byShop.set(o.shop_id, [...(byShop.get(o.shop_id) ?? []), o.external_id]);
  if (!byShop.size) return { utms, errors };

  const { data: settings } = await supabaseAdmin.from("shop_order_settings").select("shop_id,shopify_store_id")
    .eq("user_id", ownerId).in("shop_id", [...byShop.keys()]);
  const storeByShop = new Map(((settings ?? []) as any[]).filter((r) => r.shopify_store_id).map((r) => [r.shop_id as string, r.shopify_store_id as string]));
  const { data: stores } = storeByShop.size
    ? await supabaseAdmin.from("shopify_stores").select("id,shop_domain,access_token").in("id", [...new Set(storeByShop.values())])
    : { data: [] as any[] };
  const storeById = new Map(((stores ?? []) as any[]).map((s) => [s.id as string, s]));

  await Promise.all([...byShop.entries()].map(async ([shopId, ids]) => {
    const store = storeById.get(storeByShop.get(shopId) ?? "");
    if (!store?.access_token) { errors.push("Loja sem Shopify conectada"); return; }
    try {
      for (let i = 0; i < ids.length; i += 50) {
        const res = await fetchWithRetry(`https://${store.shop_domain}/admin/api/2026-07/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": store.access_token },
          body: JSON.stringify({ query: JOURNEY_QUERY, variables: { ids: ids.slice(i, i + 50).map((id) => `gid://shopify/Order/${id}`) } }),
        });
        const json: any = await res.json();
        if (!res.ok || json.errors) throw new Error(json?.errors ? JSON.stringify(json.errors).slice(0, 200) : `Falha (${res.status})`);
        for (const n of (json.data?.nodes ?? []) as any[]) {
          const j = n?.customerJourneySummary;
          const u = j?.lastVisit?.utmParameters?.content ? j.lastVisit.utmParameters : j?.firstVisit?.utmParameters;
          if (n?.legacyResourceId && u) utms.set(`${shopId}:${n.legacyResourceId}`, u);
        }
      }
    } catch (e: any) {
      errors.push(`${store.shop_domain}: ${String(e?.message ?? e)}`);
    }
  }));
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

    const [ordersRes, catalogRes, costProducts, campaigns] = await Promise.all([
      selectAll(supabaseAdmin.from("shop_orders")
        .select("shop_id,external_id,order_date,line_items:raw->line_items,tags:raw->>tags,tracking_code")
        .eq("user_id", ownerId).gte("order_date", data.from).lte("order_date", data.to)),
      supabaseAdmin.from("products").select("id,name,keywords").eq("user_id", ownerId),
      costProductsFor(supabaseAdmin, ownerId),
      loadCampaigns(ownerId, data.product_id),
    ]);
    const catalog = (catalogRes.data ?? []) as { id: string; name: string; keywords: string[] | null }[];
    const me = catalog.find((p) => p.id === data.product_id)!;
    const myCost = costProducts.find((p) => p.name === me.name);

    const sales: { shop_id: string; external_id: string; faturamento: number; custo: number; unidades: number }[] = [];
    for (const o of (ordersRes.data ?? []) as any[]) {
      const m = productOrderTotals(o, catalog, data.product_id, myCost);
      if (m) sales.push({ shop_id: o.shop_id, external_id: String(o.external_id), ...m });
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
      const adId = u?.content?.trim() || null;
      const medium = u?.medium?.trim() || null;
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
    const [{ data: accountRows }, selected] = await Promise.all([
      supabaseAdmin.from("shop_meta_ad_accounts").select("shop_id,ad_account_id,account_name")
        .eq("user_id", ownerId).eq("enabled", true).order("created_at", { ascending: true }),
      loadCampaigns(ownerId, data.product_id),
    ]);
    const accounts = new Map<string, { shop_id: string; ad_account_id: string; account_name: string | null }>();
    for (const a of (accountRows ?? []) as any[]) if (!accounts.has(a.ad_account_id)) accounts.set(a.ad_account_id, a);

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
    const shopIds = [...new Set(data.campaigns.map((c) => c.shop_id))];
    if (shopIds.length) {
      const { data: own } = await supabaseAdmin.from("shop_meta_ad_accounts").select("shop_id,ad_account_id")
        .eq("user_id", ownerId).in("shop_id", shopIds);
      const ok = new Set(((own ?? []) as any[]).map((r) => `${r.shop_id}|${r.ad_account_id}`));
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

    const { data: first } = await db("product_funnel_events").select("day")
      .eq("user_id", ownerId).order("day", { ascending: true }).limit(1).maybeSingle();
    if (!first) return { installed: false as const };
    const since = String(first.day);
    const { prevFrom, prevTo } = comparisonPeriod(data.from, data.to);

    const [eventsRes, catalogRes, pubsRes, ordersRes] = await Promise.all([
      selectAll(db("product_funnel_events")
        .select("id,shopify_store_id,step,day,client_id,shopify_product_id,title")
        .eq("user_id", ownerId).gte("day", prevFrom).lte("day", data.to)),
      supabaseAdmin.from("products").select("id,name,keywords").eq("user_id", ownerId),
      db("product_shopify_publications").select("product_id,shopify_store_id,shopify_product_id")
        .eq("user_id", ownerId).eq("status", "ok").not("shopify_product_id", "is", null),
      selectAll(supabaseAdmin.from("shop_orders")
        .select("id,order_date,line_items:raw->line_items")
        .eq("user_id", ownerId).gte("order_date", prevFrom > since ? prevFrom : since).lte("order_date", data.to)),
    ]);
    const catalog = (catalogRes.data ?? []) as { id: string; name: string; keywords: string[] | null }[];
    const published = new Map(((pubsRes.data ?? []) as any[]).map((p) => [`${p.shopify_store_id}|${p.shopify_product_id}`, p.product_id as string]));

    type Counts = { sessions: number; checkouts: number; orders: number };
    const empty = (): Counts => ({ sessions: 0, checkouts: 0, orders: 0 });
    const cur = empty(), prev = empty();
    const bucket = (day: string) => (day >= since && day >= data.from && day <= data.to ? cur
      : day >= since && day >= prevFrom && day <= prevTo ? prev : null);

    const seen = new Set<string>();
    for (const e of (eventsRes.data ?? []) as any[]) {
      const productId = published.get(`${e.shopify_store_id}|${e.shopify_product_id}`) ?? matchLineItemProduct(e.title, catalog)?.id;
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
      if (((o.line_items ?? []) as any[]).some((li) => matchLineItemProduct(String(li?.title ?? li?.name ?? ""), catalog)?.id === data.product_id)) b.orders += 1;
    }

    return { installed: true as const, since, cur, prev: prevTo >= since ? prev : null };
  });

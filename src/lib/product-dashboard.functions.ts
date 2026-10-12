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
      const date = String(o.order_date);
      let faturamento = 0, custo = 0, unidades = 0, matched = false;
      const free = isSupplierFree(o.tags);
      for (const li of (o.line_items ?? []) as any[]) {
        const title = String(li?.title ?? li?.name ?? "");
        if (matchLineItemProduct(title, catalog)?.id !== data.product_id) continue;
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
      if (!matched) continue;
      const d = days.get(date) ?? { faturamento: 0, custo: 0, pedidos: 0, unidades: 0 };
      d.faturamento += faturamento; d.custo += custo; d.unidades += unidades; d.pedidos += 1;
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

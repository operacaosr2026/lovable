import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { metaTokenForAccount } from "@/lib/lg-card-ad-spend.server";
import { driveDownload, driveDownloadRange, driveFileMeta } from "@/lib/drive.server";
import { creativeFeaturesSpec, textOptimizationOn } from "@/lib/ad-ai-features";
import { ATTRIBUTION_KEYS, LIFECYCLE_KEYS, RETENTION_DAYS, adSetGoal, attributionSpec, type Attribution, type Lifecycle } from "@/lib/ad-schedule";
import { MULTI_MAX, MULTI_MIN, type Distribution, type MultiFormat, type PlanAdset } from "@/lib/ad-plan";

// Aba Anúncios do produto: publica uma campanha na Meta com os criativos da aba
// Criativos. O navegador monta a árvore (campanha › conjuntos › anúncios, já com
// os nomes — src/lib/ad-plan.ts) e conduz os passos (campanha → mídias →
// conjunto → anúncio), pra mostrar o progresso e não segurar uma requisição
// longa enquanto a Meta processa os vídeos.

const GRAPH = "https://graph.facebook.com/v23.0";
// Envio de vídeo em partes vai pro domínio de vídeo da Meta.
const GRAPH_VIDEO = "https://graph-video.facebook.com/v23.0";
// Formato flexível (creative_asset_groups_spec) segue a versão da documentação dele.
const GRAPH_FLEX = "https://graph.facebook.com/v27.0";
const BUCKET = "project-attachments";
// Moedas sem centavos na Meta (orçamento vai na unidade inteira).
const NO_CENTS = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);

// Até 5 títulos e 5 descrições (copy) por criativo. title/body: publicações antigas (um só).
export type CreativeText = {
  titles?: string[]; bodies?: string[]; title_ids?: string[]; body_ids?: string[];
  title?: string; body?: string; title_id?: string; body_id?: string;
};

export const GENDERS = ["all", "male", "female"] as const;
export type Gender = typeof GENDERS[number];

export const AD_CTAS = ["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "BUY_NOW", "GET_OFFER", "SIGN_UP"] as const;

// Evento do pixel que o conjunto otimiza (promoted_object.custom_event_type).
export const CONVERSION_EVENTS = {
  PURCHASE: "Compra",
  INITIATED_CHECKOUT: "Finalização de compra",
  ADD_PAYMENT_INFO: "Informações de pagamento",
  ADD_TO_CART: "Adição ao carrinho",
  VIEW_CONTENT: "Visualização de conteúdo",
  LEAD: "Lead",
  COMPLETE_REGISTRATION: "Cadastro concluído",
} as const;
export type ConversionEvent = keyof typeof CONVERSION_EVENTS;
const CONVERSION_KEYS = Object.keys(CONVERSION_EVENTS) as [ConversionEvent, ...ConversionEvent[]];

export type AdPublicationConfig = {
  // card_id: conta vem do card de Lojas e Grupos. shop_id só nas publicações antigas.
  card_id?: string; shop_id?: string; ad_account_id: string;
  // Campanha
  campaign_name: string; budget_mode?: "CBO" | "ABO"; daily_budget: number; status: "PAUSED" | "ACTIVE";
  // Conjunto
  countries: string[]; age_min?: number; age_max?: number; pixel_id: string; conversion_event?: ConversionEvent;
  genders?: Gender; age_suggestion?: boolean; gender_suggestion?: boolean;
  advantage_audience?: boolean; // publicações antigas (Advantage+ = idade como sugestão)
  // Anúncio
  page_id: string; page_name: string; instagram_user_id?: string; instagram_username?: string;
  link: string; url_tags: string; cta: typeof AD_CTAS[number];
  distribution?: Distribution; multi_format?: MultiFormat; custom?: Record<string, string>;
  // Textos escolhidos do banco (Títulos e Descrições) pra cada criativo. body = descrição (a copy).
  creative_texts?: Record<string, CreativeText>;
  // Melhorias de IA da Meta ligadas (chave → true). Ausente/false = desligada.
  ai_features?: Record<string, boolean>;
  multi_advertiser?: boolean; // "Anúncios com vários anunciantes"
  attribution?: Attribution; lifecycle?: Lifecycle; retention_days?: number;
  start_time?: string; // ISO com fuso da conta; vazio = começa ao publicar
  display_link?: string; // link de exibição (ex.: voultie.com)
  texts?: { mode: "creative" | "shared"; bodies: string[]; titles: string[]; descriptions: string[] }; // publicações antigas
  plan?: PlanAdset[];
  adset_ids?: Record<string, string>; // conjuntos já criados (chave do plano → id na Meta), pra "tentar de novo"
  structure?: "single" | "per_creative"; // publicações antigas
};
// key = nó da árvore (publicações antigas usam creative_id).
export type AdResult = {
  key?: string; creative_id?: string; creative_ids?: string[]; name: string; adset_name?: string;
  adset_id?: string; ad_id?: string; error?: string;
};
export type AdMedia = { kind: "image"; image_hash: string } | { kind: "video"; video_id: string; thumbnail_url?: string };

const db = (table: string) => (supabaseAdmin as any).from(table);

async function graph<T = any>(path: string, token: string, params: Record<string, unknown> = {}, method: "GET" | "POST" = "GET", base = GRAPH): Promise<T> {
  const body = new URLSearchParams({ access_token: token });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = method === "GET"
    ? await fetch(`${base}/${path}?${body}`, { signal: AbortSignal.timeout(60_000) })
    : await fetch(`${base}/${path}`, { method: "POST", body, signal: AbortSignal.timeout(120_000) });
  const json = await res.json().catch(() => ({}));
  if (json?.error) throw new Error(json.error.error_user_msg || json.error.error_user_title || json.error.message || "Erro na Meta");
  if (!res.ok) throw new Error(`Meta respondeu ${res.status}`);
  return json as T;
}

// Token da conexão Meta (de qualquer loja) que enxerga a conta de anúncio.
async function tokenFor(ownerId: string, adAccountId: string) {
  const token = await metaTokenForAccount(ownerId, adAccountId);
  if (!token) throw new Error("Nenhuma conexão com o Facebook enxerga esta conta de anúncio");
  return token;
}

async function loadPublication(ownerId: string, id: string) {
  const { data } = await db("product_ad_publications").select("*").eq("id", id).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Publicação não encontrada");
  return data as { id: string; product_id: string; ad_account_id: string; campaign_id: string; config: AdPublicationConfig; ads: AdResult[] };
}

async function loadCreative(ownerId: string, productId: string, creativeId: string) {
  const { data } = await supabaseAdmin.from("product_creatives").select("*")
    .eq("id", creativeId).eq("product_id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Criativo não encontrado");
  return data as any;
}

async function saveAdResult(pubId: string, ads: AdResult[], result: AdResult) {
  const next = [...ads.filter((a) => a.key !== result.key), result];
  await db("product_ad_publications").update({ ads: next }).eq("id", pubId);
}

// Valor em reais/dólares → unidade da Meta (centavos, menos nas moedas sem centavos).
async function toMetaMoney(ownerId: string, adAccountId: string, value: number) {
  const { data: acc } = await db("lg_card_meta_accounts").select("currency")
    .eq("user_id", ownerId).eq("ad_account_id", adAccountId).not("currency", "is", null).limit(1).maybeSingle();
  return Math.round(value * (NO_CENTS.has(String(acc?.currency ?? "USD").toUpperCase()) ? 1 : 100));
}

// ── Leitura ──

export const getProductAdsSetup = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const [accounts, pubs, shopifyPubs, product, pubCount] = await Promise.all([
      // Mesmas contas da integração Meta dos cards de Lojas e Grupos (cards ativos).
      db("lg_card_meta_accounts").select("card_id,ad_account_id,account_name,currency,enabled,lg_cards!inner(name,status)")
        .eq("user_id", ownerId).eq("enabled", true).eq("lg_cards.status", "ativo"),
      db("product_ad_publications").select("id,campaign_id,campaign_name,ad_account_id,status,config,ads,error,created_at")
        .eq("product_id", data.product_id).eq("user_id", ownerId).order("created_at", { ascending: false }).limit(30),
      supabaseAdmin.from("product_shopify_publications").select("shopify_store_id,handle,role,status")
        .eq("product_id", data.product_id).eq("user_id", ownerId).eq("status", "ok"),
      supabaseAdmin.from("products").select("name").eq("id", data.product_id).maybeSingle(),
      db("product_ad_publications").select("id", { count: "exact", head: true }).eq("product_id", data.product_id).eq("user_id", ownerId),
    ]);

    // Falha de conexão não pode virar "nenhuma conta conectada".
    const failed = accounts.error ?? pubs.error;
    if (failed) throw new Error(`Não consegui falar com o banco de dados agora (${failed.message}). Tente de novo em instantes.`);
    const storeIds = (shopifyPubs.data ?? []).map((p) => p.shopify_store_id);
    const { data: stores } = storeIds.length
      ? await supabaseAdmin.from("shopify_stores").select("id,name,shop_domain").in("id", storeIds)
      : { data: [] as { id: string; name: string | null; shop_domain: string | null }[] };
    const storeById = new Map((stores ?? []).map((s) => [s.id, s]));
    const links = (shopifyPubs.data ?? [])
      .map((p) => {
        const s = storeById.get(p.shopify_store_id);
        if (!s?.shop_domain || !p.handle) return null;
        return { label: `${s.name || s.shop_domain}${p.role ? ` (${p.role})` : ""}`, url: `https://${s.shop_domain}/products/${p.handle}`, matriz: p.role === "matriz" };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b!.matriz) - Number(a!.matriz)) as { label: string; url: string; matriz: boolean }[];

    return {
      product_name: ((product.data as any)?.name ?? "") as string,
      publication_count: (pubCount.count ?? 0) as number,
      accounts: dedupeAccounts((accounts.data ?? []) as any[]),
      links,
      publications: (pubs.data ?? []) as {
        id: string; campaign_id: string | null; campaign_name: string; ad_account_id: string; status: "running" | "ok" | "partial" | "error";
        config: AdPublicationConfig; ads: AdResult[]; error: string | null; created_at: string;
      }[],
    };
  });

// Conta ligada em mais de um card aparece uma vez, com os nomes dos cards.
function dedupeAccounts(rows: any[]) {
  const by = new Map<string, { card_id: string; card_name: string; ad_account_id: string; account_name: string; currency: string }>();
  for (const r of rows) {
    const cardName = String(r.lg_cards?.name ?? "Card");
    const cur = by.get(r.ad_account_id);
    if (cur) { if (!cur.card_name.split(", ").includes(cardName)) cur.card_name += `, ${cardName}`; continue; }
    by.set(r.ad_account_id, {
      card_id: r.card_id, card_name: cardName, ad_account_id: r.ad_account_id,
      account_name: r.account_name ?? r.ad_account_id, currency: r.currency ?? "USD",
    });
  }
  return [...by.values()].sort((a, b) => a.account_name.localeCompare(b.account_name));
}

// own = da conta de anúncio / BM dela; profile = de outra BM ou do seu perfil.
// business = BM dona da página (vazio = página só do perfil).
export type AdPage = { id: string; name: string; business_id?: string; business?: string };
// username vazio quando a Meta não entrega o @ (exige permissão que o app não tem).
export type AdInstagram = { id: string; username: string; page_id?: string; page_name?: string };

export type AssetsDebug = { source: string; result: string }[];

// Ao trocar de conta: só o que é da conta (pixel, fuso, BM dona) — 1 chamada.
export const getAdAccountAssets = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ad_account_id: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const token = await tokenFor(context.ownerId, data.ad_account_id);
    const acc = await graph<{ timezone_name?: string; business?: { id: string }; adspixels?: { data?: { id: string; name: string }[] } }>(
      data.ad_account_id, token, { fields: "timezone_name,business{id},adspixels.limit(100){id,name}" },
    );
    return {
      pixels: acc.adspixels?.data ?? [],
      timezone: acc.timezone_name ?? "America/New_York",
      business_id: acc.business?.id ?? null,
    };
  });

// Páginas e Instagram de todos os perfis do Facebook conectados (de todas as BMs),
// independente da conta. Pesado: a tela guarda o resultado por 24h e só busca de novo
// no botão "Atualizar páginas".
export const getProfilePages = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    type List<T> = { data?: T[]; paging?: { next?: string } };
    type Ig = { id: string; username?: string };
    type PageRow = AdPage & { access_token?: string; instagram_business_account?: Ig; connected_instagram_account?: Ig };
    const debug: AssetsDebug = [];
    const isLimit = (m: string) => /\(#(4|17|32|613)\)|limit reached/i.test(m);

    const { data: tokenRows } = await supabaseAdmin.from("shop_meta_tokens").select("access_token").eq("user_id", context.ownerId);
    const tokens = [...new Set(((tokenRows ?? []) as any[]).map((r) => r.access_token as string).filter(Boolean))];
    if (!tokens.length) throw new Error("Nenhuma conexão com o Facebook");

    // Mesmo perfil conectado em várias lojas = um só.
    const profiles = new Map<string, { token: string; name: string }>();
    for (const t of tokens) {
      const me = await graph<{ id: string; name?: string }>("me", t, { fields: "id,name" }).catch((e) => { debug.push({ source: "Perfil", result: `erro: ${String(e.message).slice(0, 160)}` }); return null; });
      if (me && !profiles.has(me.id)) profiles.set(me.id, { token: t, name: me.name ?? me.id });
    }

    const pages = new Map<string, AdPage>();
    const igs = new Map<string, AdInstagram>();
    const pageToken = new Map<string, string>();
    const addIg = (ig: Ig, page_id?: string) => {
      const cur = igs.get(ig.id);
      if (cur) { if (page_id && !cur.page_id) cur.page_id = page_id; if (ig.username && !cur.username) cur.username = ig.username; return; }
      igs.set(ig.id, { id: ig.id, username: ig.username ?? "", page_id });
    };

    for (const { token, name: who } of profiles.values()) {
      let limited = false;
      const all = async <T,>(path: string, params: Record<string, unknown>, max = 1000): Promise<T[]> => {
        const first = await graph<List<T>>(path, token, params);
        const out = [...(first.data ?? [])];
        let next = first.paging?.next;
        while (next && out.length < max) {
          const json = (await (await fetch(next, { signal: AbortSignal.timeout(60_000) })).json().catch(() => ({}))) as List<T> & { error?: unknown };
          if (json.error) break;
          out.push(...(json.data ?? []));
          next = json.paging?.next;
        }
        return out;
      };
      const safe = async <T,>(source: string, fn: () => Promise<T[]>): Promise<T[]> => {
        if (limited) return [];
        try { const r = await fn(); debug.push({ source: `${who} › ${source}`, result: `${r.length} encontrado(s)` }); return r; }
        catch (e: any) { const m = String(e.message); if (isLimit(m)) limited = true; debug.push({ source: `${who} › ${source}`, result: `erro: ${m.slice(0, 160)}` }); return []; }
      };

      // Descobre uma vez se a Meta deixa trazer o Instagram junto da página; depois não tenta de novo.
      let igFields = ",instagram_business_account{id,username},connected_instagram_account{id,username}";
      const pagesOf = async (path: string, extra = ""): Promise<PageRow[]> => {
        try { return await all<PageRow>(path, { fields: `id,name${extra}${igFields}`, limit: 100 }); }
        catch (e: any) {
          if (isLimit(String(e.message)) || !igFields) throw e;
          igFields = "";
          return all<PageRow>(path, { fields: `id,name${extra}`, limit: 100 });
        }
      };
      const take = (rows: PageRow[], business?: { id: string; name: string }) => {
        for (const p of rows) {
          const cur = pages.get(p.id);
          if (!cur) pages.set(p.id, { id: p.id, name: p.name, ...(business ? { business_id: business.id, business: business.name } : {}) });
          else if (business && !cur.business_id) Object.assign(cur, { business_id: business.id, business: business.name });
          if (p.access_token) pageToken.set(p.id, p.access_token);
          if (p.instagram_business_account) addIg(p.instagram_business_account, p.id);
          if (p.connected_instagram_account) addIg(p.connected_instagram_account, p.id);
        }
      };

      take(await safe("Suas páginas", () => pagesOf("me/accounts", ",access_token")));
      const bms = await safe("Suas BMs", () => all<{ id: string; name: string }>("me/businesses", { fields: "id,name", limit: 100 }, 200));
      for (const b of bms.slice(0, 30)) {
        take(await safe(`${b.name} › páginas`, () => pagesOf(`${b.id}/owned_pages`)), b);
        take(await safe(`${b.name} › páginas de clientes`, () => pagesOf(`${b.id}/client_pages`)), b);
        // Sem o Instagram junto da página: pega o Instagram da BM (1 chamada por BM).
        if (!igFields) for (const ig of await safe(`${b.name} › Instagram`, () => all<Ig>(`${b.id}/owned_instagram_accounts`, { fields: "id,username", limit: 100 }))) addIg(ig);
      }
    }

    // Sem @: tenta ler com a chave da página ligada ao Instagram (no máximo 10).
    const unnamed = [...igs.values()].filter((ig) => !ig.username && ig.page_id && pageToken.has(ig.page_id)).slice(0, 10);
    await Promise.all(unnamed.map(async (ig) => {
      const r = await graph<{ username?: string }>(ig.id, pageToken.get(ig.page_id!)!, { fields: "username" }).catch(() => null);
      if (r?.username) ig.username = r.username;
    }));
    for (const ig of igs.values()) if (ig.page_id) ig.page_name = pages.get(ig.page_id)?.name;

    const rank = (ig: AdInstagram) => (ig.username ? 0 : ig.page_name ? 1 : 2);
    return {
      pages: [...pages.values()].sort((a, b) => a.name.localeCompare(b.name)),
      instagrams: [...igs.values()].sort((a, b) => rank(a) - rank(b) || (a.username || a.page_name || a.id).localeCompare(b.username || b.page_name || b.id)),
      debug,
      fetched_at: new Date().toISOString(),
    };
  });

// ── Uso do limite de chamadas da Meta ──
// A Meta manda em cada resposta quanto do limite já foi usado (cabeçalhos
// X-App-Usage, X-Ad-Account-Usage, X-Business-Use-Case-Usage) e, quando estoura,
// em quantos minutos libera. Uma chamada leve (id da conta) lê isso.

export type MetaUsage = { pct: number; regain_minutes: number; tier: string | null; limited: boolean };

function parseUsage(res: Response, limited: boolean): MetaUsage {
  const json = (h: string) => { try { return JSON.parse(res.headers.get(h) ?? "null"); } catch { return null; } };
  const app = json("x-app-usage");
  const acc = json("x-ad-account-usage");
  const buc = json("x-business-use-case-usage");
  const pcts: number[] = [];
  let regain = 0;
  if (app) pcts.push(Number(app.call_count ?? 0), Number(app.total_cputime ?? 0), Number(app.total_time ?? 0));
  if (acc) { pcts.push(Number(acc.acc_id_util_pct ?? 0)); regain = Math.max(regain, Math.ceil(Number(acc.reset_time_duration ?? 0) / 60)); }
  for (const list of Object.values((buc ?? {}) as Record<string, any[]>)) {
    for (const u of list ?? []) {
      pcts.push(Number(u.call_count ?? 0), Number(u.total_cputime ?? 0), Number(u.total_time ?? 0));
      regain = Math.max(regain, Number(u.estimated_time_to_regain_access ?? 0));
    }
  }
  const pct = Math.min(100, Math.round(Math.max(0, ...pcts.filter((n) => Number.isFinite(n)))));
  return { pct: limited ? 100 : pct, regain_minutes: regain, tier: acc?.ads_api_access_tier ?? null, limited: limited || pct >= 100 };
}

export const getMetaUsage = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ad_account_id: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }): Promise<MetaUsage> => {
    const token = await tokenFor(context.ownerId, data.ad_account_id);
    const res = await fetch(`${GRAPH}/${data.ad_account_id}?fields=id&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) });
    const body: any = await res.json().catch(() => ({}));
    const code = body?.error?.code;
    return parseUsage(res, [4, 17, 32, 613, 80004].includes(Number(code)));
  });

// ── Publicação (passo a passo) ──

const PlanInput = z.array(z.object({
  key: z.string().min(1).max(20),
  name: z.string().trim().min(1).max(250),
  ads: z.array(z.object({
    key: z.string().min(1).max(20),
    name: z.string().trim().min(1).max(250),
    format: z.enum(["single", "flexible", "carousel"]),
    creative_ids: z.array(z.string().uuid()).min(1).max(MULTI_MAX),
  }).refine((a) => a.format === "single" ? a.creative_ids.length === 1 : a.creative_ids.length >= MULTI_MIN, "Quantidade de criativos inválida pro formato"))
    .min(1).max(50),
})).min(1).max(50);

const ConfigInput = z.object({
  card_id: z.string().uuid(),
  ad_account_id: z.string().min(1).max(60),
  campaign_name: z.string().trim().min(1).max(250),
  budget_mode: z.enum(["CBO", "ABO"]),
  daily_budget: z.number().positive().max(1_000_000),
  status: z.enum(["PAUSED", "ACTIVE"]),
  countries: z.array(z.string().trim().length(2).toUpperCase()).min(1).max(50),
  age_min: z.number().int().min(18).max(65),
  age_max: z.number().int().min(18).max(65),
  genders: z.enum(GENDERS),
  age_suggestion: z.boolean(),
  gender_suggestion: z.boolean(),
  pixel_id: z.string().min(1).max(60),
  conversion_event: z.enum(CONVERSION_KEYS).default("PURCHASE"),
  page_id: z.string().min(1).max(60),
  page_name: z.string().max(200).default(""),
  instagram_user_id: z.string().max(60).optional(),
  instagram_username: z.string().max(200).optional(),
  link: z.string().trim().url().max(2000),
  url_tags: z.string().trim().max(1000).default(""),
  cta: z.enum(AD_CTAS),
  distribution: z.enum(["per_creative", "together", "single_ad"]),
  multi_format: z.enum(["flexible", "carousel"]),
  custom: z.record(z.string().max(100)).default({}),
  creative_texts: z.record(z.object({
    titles: z.array(z.string().max(500)).max(5).default([]),
    bodies: z.array(z.string().max(5000)).max(5).default([]),
    title_ids: z.array(z.string().uuid()).max(5).default([]),
    body_ids: z.array(z.string().uuid()).max(5).default([]),
  })).default({}),
  ai_features: z.record(z.boolean()).default({}),
  multi_advertiser: z.boolean().default(false),
  attribution: z.enum(ATTRIBUTION_KEYS).default("default"),
  lifecycle: z.enum(LIFECYCLE_KEYS).default("all"),
  retention_days: z.number().int().refine((n) => (RETENTION_DAYS as readonly number[]).includes(n)).default(180),
  start_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/).optional(),
  display_link: z.string().trim().max(200).default(""),
  plan: PlanInput,
}).refine((c) => c.age_min <= c.age_max, "Idade mínima maior que a máxima");

export const startAdPublication = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), config: ConfigInput }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const { config } = data;
    const token = await tokenFor(ownerId, config.ad_account_id);

    const { data: pub, error } = await db("product_ad_publications").insert({
      user_id: ownerId, product_id: data.product_id, card_id: config.card_id, ad_account_id: config.ad_account_id,
      campaign_name: config.campaign_name, config, status: "running",
    }).select("id").single();
    if (error) throw new Error(error.message);

    try {
      // CBO: orçamento e lance na campanha (a Meta divide entre os conjuntos).
      const budget = config.budget_mode === "CBO"
        ? { daily_budget: await toMetaMoney(ownerId, config.ad_account_id, config.daily_budget), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }
        : { is_adset_budget_sharing_enabled: false };
      const campaign = await graph<{ id: string }>(`${config.ad_account_id}/campaigns`, token, {
        name: config.campaign_name,
        objective: "OUTCOME_SALES",
        status: config.status,
        special_ad_categories: [],
        buying_type: "AUCTION",
        ...budget,
      }, "POST");
      await db("product_ad_publications").update({ campaign_id: campaign.id }).eq("id", pub.id);
      return { publication_id: pub.id as string, campaign_id: campaign.id };
    } catch (e: any) {
      await db("product_ad_publications").update({ status: "error", error: e.message }).eq("id", pub.id);
      throw e;
    }
  });

export const uploadAdMedia = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ publication_id: z.string().uuid(), creative_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }): Promise<AdMedia> => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const c = await loadCreative(context.ownerId, pub.product_id, data.creative_id);
    if (!c.media_path && !c.drive_file_id) throw new Error("Criativo sem mídia");
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    await db("product_creatives").update({ last_used_at: new Date().toISOString() }).eq("id", c.id);

    // Do Drive: a Meta baixa o vídeo direto do link público; a imagem passa pelo servidor.
    if (!c.media_path && c.drive_file_id) {
      if (c.media_kind === "video") throw new Error("Vídeo do Drive vai em partes (startDriveVideoUpload)");
      const bytes = Buffer.from(await driveDownload(c.drive_file_id)).toString("base64");
      return { kind: "image", image_hash: await uploadImageBytes(pub.ad_account_id, token, bytes) };
    }

    if (c.media_kind === "video") {
      const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(c.media_path, 60 * 60 * 3);
      if (!signed?.signedUrl) throw new Error("Não foi possível gerar o link do vídeo");
      const v = await graph<{ id: string }>(`${pub.ad_account_id}/advideos`, token, { file_url: signed.signedUrl, name: c.name || "Criativo" }, "POST");
      return { kind: "video", video_id: v.id };
    }
    const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(c.media_path);
    if (error || !blob) throw new Error("Não foi possível ler a imagem");
    const bytes = Buffer.from(await blob.arrayBuffer()).toString("base64");
    return { kind: "image", image_hash: await uploadImageBytes(pub.ad_account_id, token, bytes) };
  });

async function uploadImageBytes(adAccountId: string, token: string, bytes: string) {
  const img = await graph<{ images: Record<string, { hash: string }> }>(`${adAccountId}/adimages`, token, { bytes }, "POST");
  const hash = Object.values(img.images ?? {})[0]?.hash;
  if (!hash) throw new Error("A Meta não devolveu o hash da imagem");
  return hash;
}

// ── Vídeo do Drive em partes (upload resumível da Meta) ──
// O servidor lê cada parte do Drive e entrega direto pra Meta: nada fica guardado
// aqui e não depende da Meta conseguir baixar do Drive (que trava com vídeo grande).

async function graphVideo<T = any>(path: string, token: string, form: FormData): Promise<T> {
  form.set("access_token", token);
  const res = await fetch(`${GRAPH_VIDEO}/${path}`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const json: any = await res.json().catch(() => ({}));
  if (json?.error) throw new Error(json.error.error_user_msg || json.error.error_user_title || json.error.message || "Erro na Meta");
  if (!res.ok) throw new Error(`Meta respondeu ${res.status}`);
  return json as T;
}

const fields = (o: Record<string, string | number>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };

export const startDriveVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ publication_id: z.string().uuid(), creative_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const c = await loadCreative(context.ownerId, pub.product_id, data.creative_id);
    if (!c.drive_file_id) throw new Error("Criativo não é do Drive");
    const meta = await driveFileMeta(c.drive_file_id);
    const size = Number(meta.size ?? 0);
    if (!size) throw new Error("O Drive não informou o tamanho do vídeo");
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    await db("product_creatives").update({ last_used_at: new Date().toISOString() }).eq("id", c.id);
    const r = await graphVideo<{ upload_session_id: string; video_id: string; start_offset: string; end_offset: string }>(
      `${pub.ad_account_id}/advideos`, token, fields({ upload_phase: "start", file_size: size }),
    );
    return { upload_session_id: r.upload_session_id, video_id: r.video_id, start_offset: Number(r.start_offset), end_offset: Number(r.end_offset), size };
  });

export const transferDriveVideoChunk = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    publication_id: z.string().uuid(), creative_id: z.string().uuid(), upload_session_id: z.string().min(1),
    start_offset: z.number().int().min(0), end_offset: z.number().int().min(1),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const c = await loadCreative(context.ownerId, pub.product_id, data.creative_id);
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    const bytes = await driveDownloadRange(c.drive_file_id, data.start_offset, data.end_offset);
    const form = fields({ upload_phase: "transfer", upload_session_id: data.upload_session_id, start_offset: data.start_offset });
    form.set("video_file_chunk", new Blob([bytes]), "chunk.mp4");
    const r = await graphVideo<{ start_offset: string; end_offset: string }>(`${pub.ad_account_id}/advideos`, token, form);
    return { start_offset: Number(r.start_offset), end_offset: Number(r.end_offset) };
  });

export const finishDriveVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ publication_id: z.string().uuid(), creative_id: z.string().uuid(), upload_session_id: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const c = await loadCreative(context.ownerId, pub.product_id, data.creative_id);
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    await graphVideo(`${pub.ad_account_id}/advideos`, token, fields({ upload_phase: "finish", upload_session_id: data.upload_session_id, title: c.name || "Criativo" }));
    return { ok: true };
  });

type VideoStatus = { video_status?: string; processing_progress?: number; processing_phase?: { status?: string; errors?: { message?: string }[] }; uploading_phase?: { status?: string; errors?: { message?: string }[] } };
export type VideoCheck =
  | { state: "ready"; thumbnail_url?: string }
  | { state: "processing"; progress: number | null }
  | { state: "error"; error: string };

// Status de vários vídeos numa chamada só (poupa o limite de chamadas da Meta).
// A capa (picture) vem junto; a lista de thumbnails é só reserva.
export const checkAdVideos = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ publication_id: z.string().uuid(), video_ids: z.array(z.string().min(1)).min(1).max(50) }).parse(d))
  .handler(async ({ context, data }): Promise<Record<string, VideoCheck>> => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    const res = await graph<Record<string, { status?: VideoStatus; picture?: string }>>("", token, { ids: data.video_ids.join(","), fields: "status,picture" });
    const out: Record<string, VideoCheck> = {};
    for (const id of data.video_ids) {
      const v = res[id] ?? {};
      const status = v.status?.video_status;
      if (status === "error") {
        const why = v.status?.processing_phase?.errors?.[0]?.message ?? v.status?.uploading_phase?.errors?.[0]?.message;
        out[id] = { state: "error", error: why ? `A Meta não conseguiu processar o vídeo: ${why}` : "A Meta não conseguiu processar o vídeo" };
      } else if (status !== "ready") {
        out[id] = { state: "processing", progress: v.status?.processing_progress ?? null };
      } else {
        let thumbnail_url = v.picture;
        if (!thumbnail_url) {
          const thumbs = await graph<{ data: { uri: string; is_preferred: boolean }[] }>(`${id}/thumbnails`, token, { fields: "uri,is_preferred" }).catch(() => null);
          thumbnail_url = (thumbs?.data?.find((t) => t.is_preferred) ?? thumbs?.data?.[0])?.uri;
        }
        out[id] = { state: "ready", thumbnail_url };
      }
    }
    return out;
  });

const MediaInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), image_hash: z.string().min(1) }),
  z.object({ kind: z.literal("video"), video_id: z.string().min(1), thumbnail_url: z.string().url().optional() }),
]);

function findAdset(pub: { config: AdPublicationConfig }, adsetKey: string) {
  const set = pub.config.plan?.find((s) => s.key === adsetKey);
  if (!set) throw new Error("Conjunto não encontrado na publicação");
  return set;
}

export const createAdset = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ publication_id: z.string().uuid(), adset_key: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const cfg = pub.config;
    const set = findAdset(pub, data.adset_key);
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    const eu = cfg.countries.some((cc) => EU.has(cc));
    // Idade/gênero como sugestão = a Meta pode ir além pra achar compradores
    // (targeting_automation.individual_setting). Desmarcado = só quem está dentro.
    const gender = cfg.genders ?? "all";
    const ageSuggestion = cfg.age_suggestion ?? cfg.advantage_audience !== false;
    const genderSuggestion = gender !== "all" && !!cfg.gender_suggestion;
    const individual = { ...(ageSuggestion ? { age: 1 } : {}), ...(genderSuggestion ? { gender: 1 } : {}) };
    const params = {
      name: set.name,
      campaign_id: pub.campaign_id,
      ...(cfg.budget_mode === "CBO"
        ? {}
        : { daily_budget: await toMetaMoney(context.ownerId, pub.ad_account_id, cfg.daily_budget), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }),
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      promoted_object: { pixel_id: cfg.pixel_id, custom_event_type: cfg.conversion_event ?? "PURCHASE" },
      targeting: {
        geo_locations: { countries: cfg.countries },
        age_min: cfg.age_min ?? 18,
        age_max: cfg.age_max ?? 65,
        ...(gender !== "all" ? { genders: [gender === "male" ? 1 : 2] } : {}),
        targeting_automation: { advantage_audience: 0, ...(Object.keys(individual).length ? { individual_setting: individual } : {}) },
      },
      ...(eu ? { dsa_beneficiary: cfg.page_name || set.name, dsa_payor: cfg.page_name || set.name } : {}),
      attribution_spec: attributionSpec(cfg.attribution ?? "default"),
      ...(cfg.start_time ? { start_time: cfg.start_time } : {}),
      status: cfg.status,
    };
    // Ciclo de vida do cliente (ad_set_goal) é recente na API: se a Meta recusar
    // o campo, cria sem ele e avisa (o resto do conjunto vale).
    const goal = adSetGoal(cfg.lifecycle ?? "all", cfg.retention_days ?? 180);
    let adsetId: string;
    let warning: string | null = null;
    try {
      adsetId = (await graph<{ id: string }>(`${pub.ad_account_id}/adsets`, token, { ...params, ad_set_goal: goal }, "POST")).id;
    } catch (e: any) {
      if (!/ad_set_goal|goal|lifecycle|ciclo de vida/i.test(String(e.message))) throw e;
      adsetId = (await graph<{ id: string }>(`${pub.ad_account_id}/adsets`, token, params, "POST")).id;
      warning = `Ciclo de vida do cliente não aplicado: ${e.message}`;
    }
    await db("product_ad_publications").update({ config: { ...cfg, adset_ids: { ...(cfg.adset_ids ?? {}), [set.key]: adsetId } } }).eq("id", pub.id);
    return { adset_id: adsetId, warning };
  });

export const createAdInAdset = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    publication_id: z.string().uuid(),
    adset_key: z.string().min(1),
    ad_key: z.string().min(1),
    adset_id: z.string().min(1),
    media: z.record(MediaInput),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const cfg = pub.config;
    const set = findAdset(pub, data.adset_key);
    const ad = set.ads.find((a) => a.key === data.ad_key);
    if (!ad) throw new Error("Anúncio não encontrado na publicação");
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    const base: AdResult = { key: ad.key, name: ad.name, adset_name: set.name, creative_ids: ad.creative_ids, adset_id: data.adset_id };

    try {
      const creatives = await Promise.all(ad.creative_ids.map((id) => loadCreative(context.ownerId, pub.product_id, id)));
      const media = ad.creative_ids.map((id) => {
        const m = data.media[id];
        if (!m) throw new Error("Mídia do criativo não foi enviada pra Meta");
        return m;
      });
      const identity = { page_id: cfg.page_id, ...(cfg.instagram_user_id ? { instagram_user_id: cfg.instagram_user_id } : {}) };
      let adId: string;

      if (ad.format === "flexible") {
        // Formato flexível: um grupo com todas as mídias e textos; a Meta escolhe o que mostrar.
        const t = textsFor(cfg, creatives);
        const r = await graph<{ id: string }>(`${pub.ad_account_id}/ads`, token, {
          name: ad.name,
          adset_id: data.adset_id,
          status: cfg.status,
          creative: {
            name: ad.name, object_story_spec: identity,
            ...creativeExtras(cfg, t),
            ...(cfg.url_tags ? { url_tags: cfg.url_tags } : {}),
          },
          creative_asset_groups_spec: {
            groups: [{
              images: media.filter((m) => m.kind === "image").map((m) => ({ hash: (m as any).image_hash })),
              videos: media.filter((m) => m.kind === "video").map((m) => ({ video_id: (m as any).video_id })),
              texts: [
                ...t.bodies.map((text) => ({ text, text_type: "primary_text" })),
                ...t.titles.map((text) => ({ text, text_type: "headline" })),
                ...t.descriptions.map((text) => ({ text, text_type: "description" })),
              ],
              call_to_action: { type: cfg.cta, value: { link: cfg.link } },
            }],
          },
        }, "POST", GRAPH_FLEX);
        adId = r.id;
      } else {
        const t = textsFor(cfg, creatives);
        const spec = ad.format === "carousel"
          ? carouselSpec(creatives, media, cfg, identity)
          : creativeSpec(media[0], cfg, identity, t);
        const creative = await graph<{ id: string }>(`${pub.ad_account_id}/adcreatives`, token, {
          name: ad.name,
          url_tags: cfg.url_tags || undefined,
          ...spec,
          ...creativeExtras(cfg, ad.format === "carousel" ? { titles: [], bodies: [], descriptions: [] } : t),
        }, "POST");
        const r = await graph<{ id: string }>(`${pub.ad_account_id}/ads`, token, {
          name: ad.name, adset_id: data.adset_id, creative: { creative_id: creative.id }, status: cfg.status,
        }, "POST");
        adId = r.id;
      }

      await saveAdResult(pub.id, pub.ads, { ...base, ad_id: adId });
      return { ad_id: adId };
    } catch (e: any) {
      await saveAdResult(pub.id, pub.ads, { ...base, error: e.message });
      throw e;
    }
  });

function cleanList(arr: unknown, fallback?: unknown) {
  const list = (Array.isArray(arr) ? arr : []).map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!list.length && typeof fallback === "string" && fallback.trim()) list.push(fallback.trim());
  return list;
}

type AdTexts = { bodies: string[]; titles: string[]; descriptions: string[] };
const uniq5 = (l: string[]) => [...new Set(l)].slice(0, 5);

// Textos do criativo: titles = título (headline), descriptions = texto principal
// (a copy), link_descriptions = descrição. Vários criativos: junta sem repetir, até 5.
function creativeTexts(c: any): AdTexts {
  return { titles: cleanList(c.titles, c.title), bodies: cleanList(c.descriptions, c.description), descriptions: cleanList(c.link_descriptions) };
}

function textsFor(cfg: AdPublicationConfig, creatives: any[]): AdTexts {
  if (cfg.creative_texts) {
    const picks = creatives.map((c) => cfg.creative_texts?.[c.id] ?? {});
    return {
      titles: uniq5(cleanList(picks.flatMap((p) => p.titles ?? [p.title]))),
      bodies: uniq5(cleanList(picks.flatMap((p) => p.bodies ?? [p.body]))),
      descriptions: [],
    };
  }
  if (cfg.texts?.mode === "shared") {
    return { bodies: uniq5(cleanList(cfg.texts.bodies)), titles: uniq5(cleanList(cfg.texts.titles)), descriptions: uniq5(cleanList(cfg.texts.descriptions)) };
  }
  const all = creatives.map(creativeTexts);
  return {
    bodies: uniq5(all.flatMap((t) => t.bodies)),
    titles: uniq5(all.flatMap((t) => t.titles)),
    descriptions: uniq5(all.flatMap((t) => t.descriptions)),
  };
}

type Identity = { page_id: string; instagram_user_id?: string };

// Melhorias da Meta (tudo desligado menos o escolhido; "otimizar texto por pessoa"
// liga sozinho com mais de um título/descrição) e anúncios com vários anunciantes.
function creativeExtras(cfg: AdPublicationConfig, t: AdTexts) {
  return {
    degrees_of_freedom_spec: creativeFeaturesSpec(cfg.ai_features, textOptimizationOn(t.titles.length, t.bodies.length)),
    contextual_multi_ads: { enroll_status: cfg.multi_advertiser ? "OPT_IN" : "OPT_OUT" },
  };
}

// O anúncio vai sempre completo (mídia, link, botão, link de exibição) com o
// primeiro texto de cada. Com mais de um título/descrição, as outras opções vão
// em asset_feed_spec só com os textos ("várias opções de texto", como no
// Gerenciador) — o link fica no object_story_spec, senão a Meta recusa
// ("O campo de link é obrigatório").
function creativeSpec(media: z.infer<typeof MediaInput>, cfg: AdPublicationConfig, identity: Identity, t: AdTexts) {
  const caption = cfg.display_link?.trim() || undefined;
  const cta = { type: cfg.cta, value: { link: cfg.link } };

  const object_story_spec = media.kind === "video"
    ? { ...identity, video_data: { video_id: media.video_id, image_url: media.thumbnail_url, message: t.bodies[0], title: t.titles[0], link_description: t.descriptions[0], call_to_action: { type: cfg.cta, value: { link: cfg.link, ...(caption ? { link_caption: caption } : {}) } } } }
    : { ...identity, link_data: { image_hash: media.image_hash, link: cfg.link, message: t.bodies[0], name: t.titles[0], description: t.descriptions[0], caption, call_to_action: cta } };

  if (t.titles.length <= 1 && t.bodies.length <= 1 && t.descriptions.length <= 1) return { object_story_spec };

  return {
    object_story_spec,
    asset_feed_spec: {
      ...(t.titles.length ? { titles: t.titles.map((text) => ({ text })) } : {}),
      ...(t.bodies.length ? { bodies: t.bodies.map((text) => ({ text })) } : {}),
      ...(t.descriptions.length ? { descriptions: t.descriptions.map((text) => ({ text })) } : {}),
      optimization_type: "DEGREES_OF_FREEDOM",
    },
  };
}

// Carrossel: um cartão por criativo, com o título escolhido pra ele; o texto
// principal do anúncio é a descrição (copy) do primeiro criativo que tiver uma.
function carouselSpec(creatives: any[], media: z.infer<typeof MediaInput>[], cfg: AdPublicationConfig, identity: Identity) {
  const cta = { type: cfg.cta, value: { link: cfg.link } };
  const shared = cfg.texts?.mode === "shared" && !cfg.creative_texts ? textsFor(cfg, creatives) : null;
  const child_attachments = creatives.map((c, i) => {
    const m = media[i];
    const t = cfg.creative_texts ? textsFor(cfg, [c]) : shared ?? creativeTexts(c);
    const card = { link: cfg.link, name: t.titles[0], description: t.descriptions[0], call_to_action: cta };
    return m.kind === "video" ? { ...card, video_id: m.video_id, picture: m.thumbnail_url } : { ...card, image_hash: m.image_hash };
  });
  return {
    object_story_spec: {
      ...identity,
      link_data: { link: cfg.link, message: textsFor(cfg, creatives).bodies[0], caption: cfg.display_link?.trim() || undefined, child_attachments, call_to_action: cta, multi_share_optimized: true, multi_share_end_card: false },
    },
  };
}

export const finishAdPublication = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    publication_id: z.string().uuid(),
    // Falhas que só o navegador viu (mídia que não subiu, vídeo que a Meta não processou, conjunto que falhou).
    failures: z.array(z.object({
      key: z.string().max(20), name: z.string().max(250), adset_name: z.string().max(250).optional(), error: z.string().max(1000),
    })).max(500).default([]),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const known = new Set(pub.ads.map((a) => a.key));
    const ads: AdResult[] = [...pub.ads, ...data.failures.filter((f) => !known.has(f.key))];
    const ok = ads.filter((a) => a.ad_id).length;
    const status = ok === 0 ? "error" : ok < ads.length ? "partial" : "ok";
    await db("product_ad_publications").update({ ads, status, error: ok === 0 ? "Nenhum anúncio foi criado" : null }).eq("id", pub.id);
    return { status };
  });

export const deleteAdPublication = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await db("product_ad_publications").delete().eq("id", data.id).eq("user_id", context.ownerId);
    return { ok: true };
  });

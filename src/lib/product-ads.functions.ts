import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { metaTokenForAccount } from "@/lib/lg-card-ad-spend.server";

// Aba Anúncios do produto: publica uma campanha na Meta com os criativos da aba
// Criativos. O cliente conduz os passos (campanha → mídia de cada criativo →
// conjunto + anúncio), pra mostrar o progresso e não segurar uma requisição
// longa enquanto a Meta processa os vídeos.

const GRAPH = "https://graph.facebook.com/v23.0";
const BUCKET = "project-attachments";
// Moedas sem centavos na Meta (orçamento vai na unidade inteira).
const NO_CENTS = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);

export const AD_CTAS = ["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "BUY_NOW", "GET_OFFER", "SIGN_UP"] as const;

export type AdPublicationConfig = {
  // card_id: conta vem do card de Lojas e Grupos. shop_id só nas publicações antigas.
  card_id?: string; shop_id?: string; ad_account_id: string; page_id: string; page_name: string; pixel_id: string;
  instagram_user_id?: string; instagram_username?: string;
  campaign_name: string; link: string; url_tags: string; countries: string[]; daily_budget: number;
  structure: "single" | "per_creative"; cta: typeof AD_CTAS[number]; status: "PAUSED" | "ACTIVE";
};
export type AdResult = { creative_id: string; name: string; adset_id?: string; ad_id?: string; error?: string };
export type AdMedia = { kind: "image"; image_hash: string } | { kind: "video"; video_id: string; thumbnail_url?: string };

const db = (table: string) => (supabaseAdmin as any).from(table);

async function graph<T = any>(path: string, token: string, params: Record<string, unknown> = {}, method: "GET" | "POST" = "GET"): Promise<T> {
  const body = new URLSearchParams({ access_token: token });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = method === "GET"
    ? await fetch(`${GRAPH}/${path}?${body}`, { signal: AbortSignal.timeout(60_000) })
    : await fetch(`${GRAPH}/${path}`, { method: "POST", body, signal: AbortSignal.timeout(120_000) });
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
  const next = [...ads.filter((a) => a.creative_id !== result.creative_id), result];
  await db("product_ad_publications").update({ ads: next }).eq("id", pubId);
}

// ── Leitura ──

export const getProductAdsSetup = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const [accounts, pubs, shopifyPubs] = await Promise.all([
      // Mesmas contas da integração Meta dos cards de Lojas e Grupos (cards ativos).
      db("lg_card_meta_accounts").select("card_id,ad_account_id,account_name,currency,enabled,lg_cards!inner(name,status)")
        .eq("user_id", ownerId).eq("enabled", true).eq("lg_cards.status", "ativo"),
      db("product_ad_publications").select("id,campaign_id,campaign_name,ad_account_id,status,config,ads,error,created_at")
        .eq("product_id", data.product_id).eq("user_id", ownerId).order("created_at", { ascending: false }).limit(30),
      supabaseAdmin.from("product_shopify_publications").select("shopify_store_id,handle,role,status")
        .eq("product_id", data.product_id).eq("user_id", ownerId).eq("status", "ok"),
    ]);

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

export type AdPage = { id: string; name: string };
// username vazio quando a Meta não entrega o @ (exige permissão que o app não tem).
export type AdInstagram = { id: string; username: string; page_id?: string; page_name?: string };

export type AssetsDebug = { source: string; result: string }[];

export const getAdAccountAssets = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ad_account_id: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const act = data.ad_account_id;
    const token = await tokenFor(context.ownerId, act);
    type List<T> = { data?: T[] };
    type Ig = { id: string; username?: string };

    // Cada fonte que falha (permissão que falta, edge que a conta não tem) não
    // derruba as outras; o resultado de cada uma vai em "Detalhes da busca".
    const debug: AssetsDebug = [];
    const track = async <T,>(source: string, p: Promise<T>, count: (r: T) => number = (r: any) => r?.data?.length ?? 0) => {
      try { const r = await p; debug.push({ source, result: `${count(r)} encontrado(s)` }); return r; }
      catch (e: any) { debug.push({ source, result: `erro: ${String(e.message).slice(0, 160)}` }); return null; }
    };

    const [promote, mine, pixels, actIg, acc, actConnectedIg] = await Promise.all([
      track("Páginas da conta de anúncio", graph<List<AdPage>>(`${act}/promote_pages`, token, { fields: "id,name", limit: 200 })),
      track("Suas páginas", graph<List<AdPage & { access_token?: string }>>("me/accounts", token, { fields: "id,name,access_token", limit: 200 })),
      graph<List<{ id: string; name: string }>>(`${act}/adspixels`, token, { fields: "id,name", limit: 100 }),
      track("Instagram da conta de anúncio", graph<List<Ig>>(`${act}/instagram_accounts`, token, { fields: "id,username", limit: 100 })),
      track("BM da conta", graph<{ business?: { id: string } }>(act, token, { fields: "business{id}" }), (r) => (r?.business ? 1 : 0)),
      track("Instagram conectado à conta", graph<List<Ig>>(`${act}/connected_instagram_accounts`, token, { fields: "id,username", limit: 100 })),
    ]);
    // Páginas e Instagram da BM dona da conta.
    const bm = acc?.business?.id;
    const [bmOwned, bmClient, bmIg, bmOwnedIg] = bm ? await Promise.all([
      track("Páginas da BM", graph<List<AdPage>>(`${bm}/owned_pages`, token, { fields: "id,name", limit: 200 })),
      track("Páginas de clientes da BM", graph<List<AdPage>>(`${bm}/client_pages`, token, { fields: "id,name", limit: 200 })),
      track("Instagram da BM", graph<List<Ig>>(`${bm}/instagram_accounts`, token, { fields: "id,username", limit: 200 })),
      track("Instagram próprio da BM", graph<List<Ig>>(`${bm}/owned_instagram_accounts`, token, { fields: "id,username", limit: 200 })),
    ]) : [null, null, null, null];

    const pages = new Map<string, AdPage>();
    for (const list of [promote, bmOwned, bmClient, mine]) for (const p of list?.data ?? []) if (!pages.has(p.id)) pages.set(p.id, { id: p.id, name: p.name });
    const pageToken = new Map((mine?.data ?? []).filter((p) => p.access_token).map((p) => [p.id, p.access_token!]));

    const igs = new Map<string, AdInstagram>();
    const addIg = (id: string, username: string | undefined, page_id?: string) => {
      const cur = igs.get(id);
      if (cur) { if (page_id && !cur.page_id) cur.page_id = page_id; if (username && !cur.username) cur.username = username; return; }
      igs.set(id, { id, username: username ?? "", page_id });
    };

    // Instagram de cada página — é assim que o Gerenciador acha o Instagram ligado
    // só à página (sem BM). Usa a chave da própria página quando a Meta dá uma.
    // Cada campo em chamada separada: um campo sem permissão derruba a chamada inteira.
    const perPage: Record<string, { found: number; errors: Set<string> }> = {};
    const pageCall = async (label: string, pageId: string, fn: (tk: string) => Promise<Ig[]>) => {
      const stat = (perPage[label] ??= { found: 0, errors: new Set() });
      try { const list = await fn(pageToken.get(pageId) ?? token); stat.found += list.length; for (const ig of list) addIg(ig.id, ig.username, pageId); }
      catch (e: any) { stat.errors.add(String(e.message).slice(0, 120)); }
    };
    const field = (name: string) => async (tk: string, pageId: string) => {
      const r = await graph<Record<string, Ig | undefined>>(pageId, tk, { fields: `${name}{id,username}` });
      return r[name] ? [r[name]!] : [];
    };
    const ids = [...pages.keys()].slice(0, 40);
    for (let i = 0; i < ids.length; i += 8) {
      await Promise.all(ids.slice(i, i + 8).flatMap((id) => [
        pageCall("Página › Instagram profissional", id, (tk) => field("instagram_business_account")(tk, id)),
        pageCall("Página › Instagram conectado", id, (tk) => field("connected_instagram_account")(tk, id)),
        pageCall("Página › Instagrams da página", id, (tk) => graph<List<Ig>>(`${id}/instagram_accounts`, tk, { fields: "id,username" }).then((r) => r.data ?? [])),
        pageCall("Página › Instagram criado pela página", id, (tk) => graph<List<Ig>>(`${id}/page_backed_instagram_accounts`, tk, { fields: "id,username" }).then((r) => r.data ?? [])),
      ]));
    }
    for (const [source, st] of Object.entries(perPage)) {
      debug.push({ source, result: `${st.found} encontrado(s)${st.errors.size ? ` · erro: ${[...st.errors][0]}` : ""}` });
    }
    for (const list of [actIg, actConnectedIg, bmIg, bmOwnedIg]) for (const ig of list?.data ?? []) addIg(ig.id, ig.username);

    // Sem @: tenta ler com a chave da página ligada ao Instagram.
    const unnamed = [...igs.values()].filter((ig) => !ig.username && ig.page_id && pageToken.has(ig.page_id)).slice(0, 40);
    await Promise.all(unnamed.map(async (ig) => {
      const r = await graph<{ username?: string }>(ig.id, pageToken.get(ig.page_id!)!, { fields: "username" }).catch(() => null);
      if (r?.username) ig.username = r.username;
    }));
    for (const ig of igs.values()) if (ig.page_id) ig.page_name = pages.get(ig.page_id)?.name;

    const rank = (ig: AdInstagram) => (ig.username ? 0 : ig.page_name ? 1 : 2);
    return {
      pages: [...pages.values()].sort((a, b) => a.name.localeCompare(b.name)),
      instagrams: [...igs.values()].sort((a, b) => rank(a) - rank(b) || (a.username || a.page_name || a.id).localeCompare(b.username || b.page_name || b.id)),
      pixels: pixels.data ?? [],
      debug,
    };
  });

// ── Publicação (passo a passo) ──

const ConfigInput = z.object({
  card_id: z.string().uuid(),
  ad_account_id: z.string().min(1).max(60),
  page_id: z.string().min(1).max(60),
  page_name: z.string().max(200).default(""),
  instagram_user_id: z.string().max(60).optional(),
  instagram_username: z.string().max(200).optional(),
  pixel_id: z.string().min(1).max(60),
  campaign_name: z.string().trim().min(1).max(200),
  link: z.string().trim().url().max(2000),
  url_tags: z.string().trim().max(1000).default(""),
  countries: z.array(z.string().trim().length(2).toUpperCase()).min(1).max(50),
  daily_budget: z.number().positive().max(1_000_000),
  structure: z.enum(["single", "per_creative"]),
  cta: z.enum(AD_CTAS),
  status: z.enum(["PAUSED", "ACTIVE"]),
});

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
      const campaign = await graph<{ id: string }>(`${config.ad_account_id}/campaigns`, token, {
        name: config.campaign_name,
        objective: "OUTCOME_SALES",
        status: config.status,
        special_ad_categories: [],
        buying_type: "AUCTION",
        is_adset_budget_sharing_enabled: false,
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
    if (!c.media_path) throw new Error("Criativo sem mídia");
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    try {
      if (c.media_kind === "video") {
        const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(c.media_path, 60 * 60 * 3);
        if (!signed?.signedUrl) throw new Error("Não foi possível gerar o link do vídeo");
        const v = await graph<{ id: string }>(`${pub.ad_account_id}/advideos`, token, { file_url: signed.signedUrl, name: c.name || "Criativo" }, "POST");
        return { kind: "video", video_id: v.id };
      }
      const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(c.media_path);
      if (error || !blob) throw new Error("Não foi possível ler a imagem");
      const bytes = Buffer.from(await blob.arrayBuffer()).toString("base64");
      const img = await graph<{ images: Record<string, { hash: string }> }>(`${pub.ad_account_id}/adimages`, token, { bytes }, "POST");
      const hash = Object.values(img.images ?? {})[0]?.hash;
      if (!hash) throw new Error("A Meta não devolveu o hash da imagem");
      return { kind: "image", image_hash: hash };
    } catch (e: any) {
      await saveAdResult(pub.id, pub.ads, { creative_id: c.id, name: c.name, error: e.message });
      throw e;
    }
  });

export const checkAdVideo = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ publication_id: z.string().uuid(), video_id: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    const v = await graph<{ status?: { video_status?: string } }>(data.video_id, token, { fields: "status" });
    const status = v.status?.video_status;
    if (status === "error") return { state: "error" as const };
    if (status !== "ready") return { state: "processing" as const };
    const thumbs = await graph<{ data: { uri: string; is_preferred: boolean }[] }>(`${data.video_id}/thumbnails`, token, { fields: "uri,is_preferred" });
    const thumb = thumbs.data?.find((t) => t.is_preferred) ?? thumbs.data?.[0];
    return { state: "ready" as const, thumbnail_url: thumb?.uri };
  });

const MediaInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), image_hash: z.string().min(1) }),
  z.object({ kind: z.literal("video"), video_id: z.string().min(1), thumbnail_url: z.string().url().optional() }),
]);

export const createAdForCreative = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    publication_id: z.string().uuid(),
    creative_id: z.string().uuid(),
    media: MediaInput,
    adset_id: z.string().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const c = await loadCreative(context.ownerId, pub.product_id, data.creative_id);
    const cfg = pub.config;
    const token = await tokenFor(context.ownerId, pub.ad_account_id);
    const name = (c.name || "Criativo") as string;

    try {
      let adsetId = data.adset_id;
      if (!adsetId) {
        const { data: acc } = await db("lg_card_meta_accounts").select("currency")
          .eq("user_id", context.ownerId).eq("ad_account_id", pub.ad_account_id).not("currency", "is", null).limit(1).maybeSingle();
        const cents = NO_CENTS.has(String(acc?.currency ?? "USD").toUpperCase()) ? 1 : 100;
        const eu = cfg.countries.some((cc) => EU.has(cc));
        const adset = await graph<{ id: string }>(`${pub.ad_account_id}/adsets`, token, {
          name: cfg.structure === "single" ? cfg.campaign_name : `${cfg.campaign_name} · ${name}`,
          campaign_id: pub.campaign_id,
          daily_budget: Math.round(cfg.daily_budget * cents),
          billing_event: "IMPRESSIONS",
          optimization_goal: "OFFSITE_CONVERSIONS",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          promoted_object: { pixel_id: cfg.pixel_id, custom_event_type: "PURCHASE" },
          targeting: { geo_locations: { countries: cfg.countries }, age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 1 } },
          ...(eu ? { dsa_beneficiary: cfg.page_name || name, dsa_payor: cfg.page_name || name } : {}),
          status: cfg.status,
        }, "POST");
        adsetId = adset.id;
      }

      const creative = await graph<{ id: string }>(`${pub.ad_account_id}/adcreatives`, token, {
        name,
        url_tags: cfg.url_tags || undefined,
        ...creativeSpec(c, data.media, cfg),
      }, "POST");

      const ad = await graph<{ id: string }>(`${pub.ad_account_id}/ads`, token, {
        name,
        adset_id: adsetId,
        creative: { creative_id: creative.id },
        status: cfg.status,
      }, "POST");

      await saveAdResult(pub.id, pub.ads, { creative_id: c.id, name, adset_id: adsetId, ad_id: ad.id });
      return { adset_id: adsetId, ad_id: ad.id };
    } catch (e: any) {
      await saveAdResult(pub.id, pub.ads, { creative_id: c.id, name, error: e.message });
      throw e;
    }
  });

// Títulos do criativo = títulos do anúncio; descrições = texto principal.
// Com mais de um texto vai como "várias opções de texto" (asset_feed_spec).
function creativeSpec(c: any, media: z.infer<typeof MediaInput>, cfg: AdPublicationConfig) {
  const clean = (arr: unknown, fallback: unknown) => {
    const list = (Array.isArray(arr) ? arr : []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (!list.length && typeof fallback === "string" && fallback.trim()) list.push(fallback.trim());
    return list.slice(0, 5);
  };
  const titles = clean(c.titles, c.title);
  const bodies = clean(c.descriptions, c.description);
  const cta = { type: cfg.cta, value: { link: cfg.link } };
  const identity = { page_id: cfg.page_id, ...(cfg.instagram_user_id ? { instagram_user_id: cfg.instagram_user_id } : {}) };

  if (titles.length <= 1 && bodies.length <= 1) {
    const object_story_spec = media.kind === "video"
      ? { ...identity, video_data: { video_id: media.video_id, image_url: media.thumbnail_url, message: bodies[0], title: titles[0], call_to_action: cta } }
      : { ...identity, link_data: { image_hash: media.image_hash, link: cfg.link, message: bodies[0], name: titles[0], call_to_action: cta } };
    return { object_story_spec };
  }

  return {
    object_story_spec: identity,
    asset_feed_spec: {
      ...(media.kind === "video"
        ? { videos: [{ video_id: media.video_id, thumbnail_url: media.thumbnail_url }], ad_formats: ["SINGLE_VIDEO"] }
        : { images: [{ hash: media.image_hash }], ad_formats: ["SINGLE_IMAGE"] }),
      ...(titles.length ? { titles: titles.map((text) => ({ text })) } : {}),
      ...(bodies.length ? { bodies: bodies.map((text) => ({ text })) } : {}),
      link_urls: [{ website_url: cfg.link }],
      call_to_action_types: [cfg.cta],
      optimization_type: "DEGREES_OF_FREEDOM",
    },
  };
}

export const finishAdPublication = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    publication_id: z.string().uuid(),
    // Falhas que só o navegador viu (ex.: vídeo que a Meta não processou).
    failures: z.array(z.object({ creative_id: z.string().uuid(), name: z.string().max(200), error: z.string().max(1000) })).max(200).default([]),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const pub = await loadPublication(context.ownerId, data.publication_id);
    const known = new Set(pub.ads.map((a) => a.creative_id));
    const ads: AdResult[] = [...pub.ads, ...data.failures.filter((f) => !known.has(f.creative_id))];
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

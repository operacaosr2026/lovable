import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ExternalLink, Film, GalleryHorizontal, Image as ImageIcon, LayoutGrid,
  Layers, Loader2, Megaphone, Pencil, Rows3, RotateCcw, Shuffle, Trash2, Users, XCircle,
} from "lucide-react";
import { listCreatives } from "@/lib/products.functions";
import { getNamingTemplate } from "@/lib/naming.functions";
import {
  AD_CTAS, getProductAdsSetup, getAdAccountAssets, startAdPublication, uploadAdMedia, checkAdVideo,
  createAdset, createAdInAdset, finishAdPublication, deleteAdPublication,
  type AdPublicationConfig, type AdMedia, type AdInstagram, type AdResult, type Gender,
} from "@/lib/product-ads.functions";
import { buildPlan, MULTI_MAX, MULTI_MIN, type Distribution, type MultiFormat, type PlanAd } from "@/lib/ad-plan";
import { DEFAULT_TEMPLATES, codeLabel, codesIn, customCodes } from "@/lib/naming";
import { NAMING_QK } from "@/components/products/Naming";
import { useProductCopies } from "@/components/products/ProductCopies";
import { useTrafficColumns } from "@/components/products/TrafficBoard";
import type { ProductCopy, TrafficColumn } from "@/lib/traffic-board.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AI_FEATURES, AI_GROUP_LABEL, type AiFeature } from "@/lib/ad-ai-features";
import { ATTRIBUTIONS, ATTRIBUTION_KEYS, LIFECYCLES, LIFECYCLE_KEYS, RETENTION_DAYS, zonedToIso, type Attribution, type Lifecycle } from "@/lib/ad-schedule";
import { STANDARD_URL_TAGS } from "@/lib/utm";
import { cn } from "@/lib/utils";
import { TabSkeleton } from "@/components/products/TabSkeleton";

const CTA_LABELS: Record<typeof AD_CTAS[number], string> = {
  SHOP_NOW: "Comprar agora", LEARN_MORE: "Saiba mais", ORDER_NOW: "Peça agora",
  BUY_NOW: "Comprar", GET_OFFER: "Obter oferta", SIGN_UP: "Cadastre-se",
};
const OLD_DEFAULT_URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";

type Form = {
  card_id?: string; ad_account_id?: string;
  budget_mode: "CBO" | "ABO"; daily_budget?: number; status: "PAUSED" | "ACTIVE";
  countriesText: string; age_min: number; age_max: number; pixel_id?: string;
  genders: Gender; age_suggestion: boolean; gender_suggestion: boolean;
  page_id?: string; page_name: string; instagram_user_id?: string; instagram_username?: string;
  link: string; cta: typeof AD_CTAS[number]; url_tags: string;
  distribution: Distribution; multi_format: MultiFormat; custom: Record<string, string>;
  // Título e descrição (copy) do banco escolhidos pra cada criativo (ids de product_copies).
  picks: Record<string, TextPick>;
  ai_features: Record<string, boolean>;
  multi_advertiser: boolean; display_link: string;
  attribution: Attribution; lifecycle: Lifecycle; retention_days: number;
  schedule: "now" | "later"; start_local: string; // "2026-11-24T08:00" no fuso da conta
};
const DEFAULT_FORM: Form = {
  budget_mode: "CBO", daily_budget: 50, status: "PAUSED",
  countriesText: "US", age_min: 18, age_max: 65, genders: "all", age_suggestion: true, gender_suggestion: true,
  page_name: "", link: "", cta: "SHOP_NOW", url_tags: STANDARD_URL_TAGS,
  distribution: "per_creative", multi_format: "flexible", custom: {},
  picks: {},
  ai_features: {},
  multi_advertiser: false, display_link: "",
  attribution: "default", lifecycle: "all", retention_days: 180,
  schedule: "now", start_local: "",
};

// Ids de product_copies escolhidos pra um criativo (até 5 de cada).
type TextPick = { titles: string[]; bodies: string[] };
const MAX_TEXTS = 5;
type NodeState = { state: "running" | "ok" | "error"; label: string };

const inputCls = "w-full px-3 h-9 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50 disabled:opacity-60";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const adsManagerUrl = (act: string, campaignId: string) =>
  `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act.replace(/^act_/, "")}&selected_campaign_ids=${campaignId}`;
const todayDM = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const money = (v: number, cur?: string) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ""}`;

export function igLabel(i: { id: string; username: string; page_name?: string }) {
  if (i.username) return `@${i.username}${i.page_name ? ` · ${i.page_name}` : ""}`;
  if (i.page_name) return `Instagram da página ${i.page_name}`;
  return `Instagram …${i.id.slice(-5)}`;
}

// Publicação antiga (estrutura "single"/"per_creative", sem CBO) → formulário novo.
function formFromLast(last: AdPublicationConfig | undefined): Partial<Form> {
  if (!last) return {};
  return {
    budget_mode: last.budget_mode ?? "ABO",
    daily_budget: last.daily_budget,
    status: "PAUSED",
    countriesText: last.countries?.join(", ") || "US",
    age_min: last.age_min ?? 18, age_max: last.age_max ?? 65,
    genders: last.genders ?? "all", age_suggestion: last.age_suggestion ?? last.advantage_audience ?? true, gender_suggestion: last.gender_suggestion ?? true,
    pixel_id: last.pixel_id, page_id: last.page_id, page_name: last.page_name ?? "",
    instagram_user_id: last.instagram_user_id, instagram_username: last.instagram_username,
    link: last.link ?? "", cta: last.cta ?? "SHOP_NOW",
    url_tags: !last.url_tags || last.url_tags === OLD_DEFAULT_URL_TAGS ? STANDARD_URL_TAGS : last.url_tags,
    distribution: last.distribution ?? (last.structure === "single" ? "together" : "per_creative"),
    multi_format: last.multi_format ?? "flexible",
    custom: last.custom ?? {},
    ai_features: last.ai_features ?? {},
    multi_advertiser: last.multi_advertiser ?? false, display_link: last.display_link ?? "",
    attribution: last.attribution ?? "default", lifecycle: last.lifecycle ?? "all", retention_days: last.retention_days ?? 180,
    picks: Object.fromEntries(Object.entries(last.creative_texts ?? {}).map(([id, t]) => [id, {
      titles: t.title_ids ?? (t.title_id ? [t.title_id] : []),
      bodies: t.body_ids ?? (t.body_id ? [t.body_id] : []),
    }])),
  };
}

export function ProductAds({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const setupFn = useServerFn(getProductAdsSetup);
  const assetsFn = useServerFn(getAdAccountAssets);
  const creativesFn = useServerFn(listCreatives);
  const namingFn = useServerFn(getNamingTemplate);
  const startFn = useServerFn(startAdPublication);
  const uploadFn = useServerFn(uploadAdMedia);
  const checkFn = useServerFn(checkAdVideo);
  const adsetFn = useServerFn(createAdset);
  const adFn = useServerFn(createAdInAdset);
  const finishFn = useServerFn(finishAdPublication);
  const deleteFn = useServerFn(deleteAdPublication);

  const setup = useQuery({ queryKey: ["product-ads", productId], queryFn: () => setupFn({ data: { product_id: productId } }) });
  const creativesQ = useQuery({ queryKey: ["creatives", productId], queryFn: () => creativesFn({ data: { product_id: productId } }) });
  const naming = useQuery({ queryKey: NAMING_QK, queryFn: () => namingFn() });
  const creatives = useMemo(() => ((creativesQ.data?.creatives ?? []) as any[]).filter((c) => c.media_path || c.drive_file_id), [creativesQ.data]);
  const templates = naming.data ?? DEFAULT_TEMPLATES;
  const { data: copies = [] } = useProductCopies(productId);
  const { data: copyColumns } = useTrafficColumns("copies");

  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [nodes, setNodes] = useState<Record<string, NodeState>>({});
  const [running, setRunning] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const set = (patch: Partial<Form>) => setForm((p) => ({ ...p, ...patch }));

  // Pré-preenche com a última publicação do produto (ou o padrão).
  useEffect(() => {
    if (initialized || !setup.data) return;
    const last = setup.data.publications[0]?.config;
    const acc = setup.data.accounts.find((a) => a.ad_account_id === last?.ad_account_id) ?? setup.data.accounts[0];
    setForm({ ...DEFAULT_FORM, ...formFromLast(last), card_id: acc?.card_id, ad_account_id: acc?.ad_account_id, link: last?.link ?? setup.data.links[0]?.url ?? "" });
    setInitialized(true);
  }, [setup.data, initialized]);

  const account = setup.data?.accounts.find((a) => a.ad_account_id === form.ad_account_id);
  const assets = useQuery({
    queryKey: ["ad-account-assets", form.ad_account_id],
    enabled: !!form.ad_account_id,
    queryFn: () => assetsFn({ data: { ad_account_id: form.ad_account_id! } }),
    staleTime: 5 * 60_000,
  });
  const igs = assets.data?.instagrams ?? [];

  const igForPage = (pageId: string | undefined, current?: string) =>
    igs.find((i) => i.page_id && i.page_id === pageId) ?? igs.find((i) => i.id === current);

  // Página, Instagram e pixel: mantém a escolha se ainda existir na conta, senão pega a primeira.
  useEffect(() => {
    if (!assets.data) return;
    const { pages, pixels, instagrams } = assets.data;
    setForm((p) => {
      const page = pages.find((x) => x.id === p.page_id) ?? pages[0];
      const pixel = pixels.find((x) => x.id === p.pixel_id) ?? pixels[0];
      const ig = instagrams.find((i) => i.id === p.instagram_user_id) ?? instagrams.find((i) => i.page_id && i.page_id === page?.id);
      return { ...p, page_id: page?.id, page_name: page?.name ?? "", pixel_id: pixel?.id, instagram_user_id: ig?.id, instagram_username: ig?.username || undefined };
    });
  }, [assets.data]);

  // Nomes editados à mão valem pra árvore atual; mudou a montagem, voltam pro modelo.
  const shapeKey = `${selected.join(",")}|${form.distribution}|${form.multi_format}`;
  useEffect(() => { setOverrides((o): Record<string, string> => (o.campaign ? { campaign: o.campaign } : {})); }, [shapeKey]);

  const countries = useMemo(() => form.countriesText.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)), [form.countriesText]);
  const chosen = useMemo(() => selected.map((id) => creatives.find((c) => c.id === id)).filter(Boolean) as any[], [selected, creatives]);
  const custom = customCodes(templates);

  const values: Record<string, string> = {
    produto: setup.data?.product_name ?? "",
    loja: account?.card_name ?? "",
    conta: account?.account_name ?? "",
    estrutura: form.budget_mode,
    orcamento: form.daily_budget ? String(form.daily_budget) : "",
    data: todayDM(),
    numero: String((setup.data?.publication_count ?? 0) + 1),
    paises: countries.join(","),
    idade: `${form.age_min}-${form.age_max}`,
    genero: GENDER_CODE[form.genders],
    pagina: form.page_name,
    instagram: form.instagram_username ?? "",
    ...form.custom,
  };
  const valuesKey = JSON.stringify(values);

  const plan = useMemo(() => buildPlan({
    creatives: chosen.map((c) => ({ id: c.id, name: c.name || "Criativo", kind: c.media_kind === "video" ? "video" : "image" })),
    distribution: form.distribution, multiFormat: form.multi_format, templates, values, overrides,
  }), [chosen, form.distribution, form.multi_format, templates, valuesKey, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const adCount = plan.adsets.reduce((n, s) => n + s.ads.length, 0);
  const perDay = form.daily_budget ? (form.budget_mode === "CBO" ? form.daily_budget : form.daily_budget * plan.adsets.length) : 0;

  const missing: string[] = [];
  if (!account) missing.push("conta de anúncio");
  if (!(Number(form.daily_budget) > 0)) missing.push("orçamento");
  if (!countries.length) missing.push("países");
  if (!form.pixel_id) missing.push("pixel");
  if (form.age_min > form.age_max) missing.push("idade válida");
  if (!form.page_id) missing.push("página");
  if (!/^https?:\/\/\S+$/.test(form.link)) missing.push("link de destino");
  if (!chosen.length) missing.push("criativos");
  const copyById = useMemo(() => new Map(copies.map((c) => [c.id, c])), [copies]);
  // Escolha que aponta pra texto apagado do banco conta como vazia.
  const pickOf = (id: string): TextPick => {
    const p = form.picks[id];
    return { titles: (p?.titles ?? []).filter((x) => copyById.has(x)), bodies: (p?.bodies ?? []).filter((x) => copyById.has(x)) };
  };
  const timezone = assets.data?.timezone ?? "America/New_York";
  const startIso = form.schedule === "later" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.start_local) ? zonedToIso(form.start_local, timezone) : undefined;
  if (form.schedule === "later" && (!startIso || new Date(startIso).getTime() <= Date.now())) missing.push("data de início no futuro");
  const withoutBody = chosen.filter((c) => !pickOf(c.id).bodies.length).length;
  if (form.distribution === "single_ad" && chosen.length > 0 && (chosen.length < MULTI_MIN || chosen.length > MULTI_MAX)) {
    missing.push(`de ${MULTI_MIN} a ${MULTI_MAX} criativos no anúncio`);
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const mark = (key: string, label: string, state: NodeState["state"] = "running") => setNodes((n) => ({ ...n, [key]: { label, state } }));

  const publish = async () => {
    if (missing.length || running) return;
    const statusText = form.status === "ACTIVE" ? "ATIVOS (já começam a gastar)" : "pausados";
    const ok = await confirm(`Criar "${plan.campaign_name}" com ${plan.adsets.length} conjunto(s) e ${adCount} anúncio(s) ${statusText}?`);
    if (!ok) return;

    const config = {
      card_id: form.card_id!, ad_account_id: form.ad_account_id!,
      campaign_name: plan.campaign_name, budget_mode: form.budget_mode, daily_budget: Number(form.daily_budget), status: form.status,
      countries, age_min: form.age_min, age_max: form.age_max, pixel_id: form.pixel_id!,
      genders: form.genders, age_suggestion: form.age_suggestion, gender_suggestion: form.gender_suggestion,
      page_id: form.page_id!, page_name: form.page_name, instagram_user_id: form.instagram_user_id, instagram_username: form.instagram_username,
      link: form.link.trim(), url_tags: form.url_tags.trim(), cta: form.cta,
      distribution: form.distribution, multi_format: form.multi_format, custom: form.custom,
      ai_features: form.ai_features, multi_advertiser: form.multi_advertiser, display_link: form.display_link.trim(),
      attribution: form.attribution, lifecycle: form.lifecycle, retention_days: form.retention_days,
      ...(startIso ? { start_time: startIso } : {}),
      creative_texts: Object.fromEntries(chosen.map((c) => {
        const p = pickOf(c.id);
        return [c.id, {
          title_ids: p.titles, titles: p.titles.map((x) => copyById.get(x)!.text),
          body_ids: p.bodies, bodies: p.bodies.map((x) => copyById.get(x)!.text),
        }];
      })),
      plan: plan.adsets,
    };

    setRunning(true);
    setNodes({ campaign: { state: "running", label: "Criando campanha" } });
    const failures: { key: string; name: string; adset_name?: string; error: string }[] = [];
    try {
      const { publication_id } = await startFn({ data: { product_id: productId, config } });
      mark("campaign", "Campanha criada", "ok");

      // 1) Mídias: sobe todas primeiro — a Meta processa os vídeos em paralelo.
      const media = new Map<string, AdMedia>();
      const mediaError = new Map<string, string>();
      for (const c of chosen) {
        mark(`m:${c.id}`, c.media_kind === "video" ? "Enviando vídeo" : "Enviando imagem");
        try {
          media.set(c.id, await uploadFn({ data: { publication_id, creative_id: c.id } }));
          mark(`m:${c.id}`, c.media_kind === "video" ? "Meta processando" : "Imagem enviada", c.media_kind === "video" ? "running" : "ok");
        } catch (e: any) {
          mediaError.set(c.id, e.message);
          mark(`m:${c.id}`, e.message, "error");
        }
      }

      // 2) Espera os vídeos ficarem prontos (todos juntos).
      const deadline = Date.now() + 15 * 60_000;
      let pending = [...media.entries()].filter(([, m]) => m.kind === "video");
      while (pending.length) {
        const next: typeof pending = [];
        for (const [id, m] of pending) {
          if (m.kind !== "video") continue;
          const r = await checkFn({ data: { publication_id, video_id: m.video_id } }).catch(() => ({ state: "processing" as const, thumbnail_url: undefined }));
          if (r.state === "ready") { media.set(id, { ...m, thumbnail_url: r.thumbnail_url }); mark(`m:${id}`, "Vídeo pronto", "ok"); }
          else if (r.state === "error") { media.delete(id); mediaError.set(id, "A Meta não conseguiu processar o vídeo"); mark(`m:${id}`, "A Meta não conseguiu processar o vídeo", "error"); }
          else if (Date.now() > deadline) { media.delete(id); mediaError.set(id, "O vídeo demorou demais pra processar na Meta"); mark(`m:${id}`, "Demorou demais na Meta", "error"); }
          else next.push([id, m]);
        }
        pending = next;
        if (pending.length) await sleep(5000);
      }

      // 3) Conjuntos e anúncios.
      for (const set of plan.adsets) {
        const ready = set.ads.filter((ad) => ad.creative_ids.every((id) => media.has(id)));
        for (const ad of set.ads.filter((a) => !ready.includes(a))) {
          const err = ad.creative_ids.map((id) => mediaError.get(id)).find(Boolean) ?? "Mídia não enviada";
          mark(ad.key, err, "error");
          failures.push({ key: ad.key, name: ad.name, adset_name: set.name, error: err });
        }
        if (!ready.length) { mark(set.key, "Sem anúncios prontos", "error"); continue; }

        mark(set.key, "Criando conjunto");
        let adsetId: string;
        try {
          const r = await adsetFn({ data: { publication_id, adset_key: set.key } });
          adsetId = r.adset_id;
          mark(set.key, r.warning ? `Conjunto criado. ${r.warning}` : "Conjunto criado", "ok");
          if (r.warning) toast.warning(r.warning);
        } catch (e: any) {
          mark(set.key, e.message, "error");
          for (const ad of ready) { mark(ad.key, "Conjunto não foi criado", "error"); failures.push({ key: ad.key, name: ad.name, adset_name: set.name, error: e.message }); }
          continue;
        }
        for (const ad of ready) {
          mark(ad.key, "Criando anúncio");
          try {
            await adFn({ data: { publication_id, adset_key: set.key, ad_key: ad.key, adset_id: adsetId, media: pickMedia(media, ad) } });
            mark(ad.key, "Anúncio criado", "ok");
          } catch (e: any) {
            mark(ad.key, e.message, "error");
          }
        }
      }

      const { status } = await finishFn({ data: { publication_id, failures } });
      if (status === "ok") toast.success("Campanha publicada");
      else if (status === "partial") toast.warning("Campanha publicada, mas alguns anúncios falharam");
      else toast.error("Nenhum anúncio foi criado");
      if (status !== "error") { setSelected([]); setOverrides({}); }
    } catch (e: any) {
      mark("campaign", e.message, "error");
      toast.error(e.message);
    } finally {
      setRunning(false);
      qc.invalidateQueries({ queryKey: ["product-ads", productId] });
    }
  };

  if (setup.isLoading) return <TabSkeleton />;
  if (setup.error) return <div className="text-sm text-destructive">{(setup.error as Error).message}</div>;
  const data = setup.data!;

  if (!data.accounts.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-16 text-center">
        <Megaphone className="size-8 text-muted-foreground mx-auto mb-2" />
        <div className="text-sm font-semibold">Nenhuma conta de anúncio conectada</div>
        <div className="text-xs text-muted-foreground mt-1">Ligue uma conta de anúncio na integração Meta de um card em Lojas e Grupos pra publicar campanhas.</div>
      </div>
    );
  }

  const cur = account?.currency ?? "";
  const pageLabel = form.page_name || "—";
  const selectedIg = igs.find((i) => i.id === form.instagram_user_id);
  const igText = form.instagram_user_id ? (selectedIg ? igLabel(selectedIg) : "Instagram") : "Página do Facebook";

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <fieldset disabled={running} className="space-y-4 min-w-0">
          {/* ① Campanha */}
          <Step n={1} icon={Megaphone} title="Campanha" summary={account ? `${account.account_name} · ${form.budget_mode}${form.daily_budget ? ` ${money(form.daily_budget, cur)}/dia` : ""}` : undefined}>
            <Field label="Conta de anúncio">
              <select
                value={account?.ad_account_id ?? ""}
                onChange={(e) => { const a = data.accounts.find((x) => x.ad_account_id === e.target.value); set({ card_id: a?.card_id, ad_account_id: a?.ad_account_id }); }}
                className={inputCls}
              >
                {data.accounts.map((a) => <option key={a.ad_account_id} value={a.ad_account_id}>{a.account_name} · {a.card_name}</option>)}
              </select>
            </Field>

            <Field label="Orçamento">
              <div className="grid sm:grid-cols-2 gap-2">
                <OptionCard
                  active={form.budget_mode === "CBO"} onClick={() => set({ budget_mode: "CBO" })}
                  title="CBO · na campanha" text="Um valor para a campanha toda. A Meta coloca mais dinheiro no conjunto que vende melhor."
                />
                <OptionCard
                  active={form.budget_mode === "ABO"} onClick={() => set({ budget_mode: "ABO" })}
                  title="ABO · por conjunto" text="Cada conjunto gasta o mesmo valor. Bom para comparar criativos com verba igual."
                />
              </div>
            </Field>

            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={form.budget_mode === "CBO" ? "Orçamento diário da campanha" : "Orçamento diário de cada conjunto"}>
                <div className="relative">
                  <input type="number" min={1} step="1" value={form.daily_budget ?? ""} onChange={(e) => set({ daily_budget: e.target.value === "" ? undefined : Number(e.target.value) })} className={cn(inputCls, "pr-16")} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{cur}/dia</span>
                </div>
              </Field>
              <Field label="Ao publicar">
                <Segmented
                  value={form.status}
                  onChange={(v) => set({ status: v })}
                  options={[{ value: "PAUSED", label: "Criar pausada" }, { value: "ACTIVE", label: "Já ativar" }]}
                />
                {form.status === "ACTIVE" && <p className="text-xs text-warning mt-1">Começa a gastar assim que a Meta aprovar.</p>}
              </Field>
            </div>
          </Step>

          {/* ② Conjunto */}
          <Step n={2} icon={Users} title="Conjunto" summary={`${countries.join(", ") || "—"} · ${values.idade}${form.age_suggestion ? " (sugestão)" : ""}${form.genders !== "all" ? ` · ${GENDER_LABEL[form.genders]}${form.gender_suggestion ? " (sugestão)" : ""}` : ""}`}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Países" hint="Códigos de 2 letras, separados por vírgula (US, CA, GB).">
                <input value={form.countriesText} onChange={(e) => set({ countriesText: e.target.value })} placeholder="US, CA" className={inputCls} />
              </Field>
              <Field label="Pixel (otimiza para compra)">
                <select value={form.pixel_id ?? ""} disabled={assets.isLoading} onChange={(e) => set({ pixel_id: e.target.value })} className={inputCls}>
                  {assets.isLoading && <option>Carregando...</option>}
                  {assets.data?.pixels.length === 0 && <option value="">Nenhum pixel nesta conta</option>}
                  {assets.data?.pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Idade">
                <div className="flex items-center gap-2">
                  <AgeInput value={form.age_min} onChange={(age_min) => set({ age_min })} />
                  <span className="text-xs text-muted-foreground shrink-0">até</span>
                  <AgeInput value={form.age_max} onChange={(age_max) => set({ age_max })} />
                </div>
                <SuggestionCheck checked={form.age_suggestion} onChange={(v) => set({ age_suggestion: v })} />
              </Field>
              <Field label="Gênero">
                <Segmented
                  value={form.genders}
                  onChange={(v) => set({ genders: v })}
                  options={[{ value: "all", label: "Todos" }, { value: "male", label: "Homens" }, { value: "female", label: "Mulheres" }]}
                />
                <SuggestionCheck checked={form.gender_suggestion && form.genders !== "all"} disabled={form.genders === "all"} onChange={(v) => set({ gender_suggestion: v })} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground font-medium">Como sugestão:</strong> a Meta pode mostrar para quem está fora dessa faixa se achar compradores.
              Desmarcado: só para quem está dentro. Otimiza para compra no pixel, com posicionamentos automáticos.
            </p>

            <div className="border-t border-border pt-3 space-y-2">
              <Field label="Ciclo de vida do cliente">
                <div className="grid sm:grid-cols-3 gap-2">
                  {LIFECYCLE_KEYS.map((k) => (
                    <OptionCard key={k} compact active={form.lifecycle === k} onClick={() => set({ lifecycle: k })} title={LIFECYCLES[k].label} text={LIFECYCLES[k].help} />
                  ))}
                </div>
              </Field>
              {form.lifecycle !== "all" && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Conta como "já comprou" quem comprou nos últimos</span>
                  <select value={form.retention_days} onChange={(e) => set({ retention_days: Number(e.target.value) })} className={cn(inputCls, "h-8 w-auto text-xs")}>
                    {RETENTION_DAYS.map((d) => <option key={d} value={d}>{d === 730 ? "2 anos" : `${d} dias`}</option>)}
                  </select>
                  <span>(pelo pixel da conta)</span>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3 border-t border-border pt-3">
              <Field label="Atribuição" hint="Não dá para mudar depois de publicar.">
                <select value={form.attribution} onChange={(e) => set({ attribution: e.target.value as Attribution })} className={inputCls}>
                  {ATTRIBUTION_KEYS.map((k) => <option key={k} value={k}>{ATTRIBUTIONS[k].label}</option>)}
                </select>
              </Field>
              <Field label="Início" hint={form.schedule === "later" ? `Horário da conta de anúncio (${timezone.replace(/_/g, " ")}).` : undefined}>
                <Segmented value={form.schedule} onChange={(v) => set({ schedule: v })} options={[{ value: "now", label: "Ao publicar" }, { value: "later", label: "Agendar" }]} />
                {form.schedule === "later" && (
                  <input type="datetime-local" value={form.start_local} onChange={(e) => set({ start_local: e.target.value })} className={cn(inputCls, "mt-2")} />
                )}
              </Field>
            </div>
          </Step>

          {/* ③ Anúncios */}
          <Step n={3} icon={ImageIcon} title="Anúncios" summary={chosen.length ? `${chosen.length} criativo(s) · ${pageLabel}` : undefined}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Página do Facebook">
                <select value={form.page_id ?? ""} disabled={assets.isLoading} onChange={(e) => {
                  const page = assets.data?.pages.find((p) => p.id === e.target.value);
                  const ig = igForPage(page?.id, form.instagram_user_id);
                  set({ page_id: page?.id, page_name: page?.name ?? "", instagram_user_id: ig?.id, instagram_username: ig?.username || undefined });
                }} className={inputCls}>
                  {assets.isLoading && <option>Carregando...</option>}
                  {assets.data?.pages.length === 0 && <option value="">Nenhuma página nesta conta</option>}
                  {assets.data?.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Instagram">
                <InstagramSelect igs={igs} loading={assets.isLoading} value={form.instagram_user_id} onChange={(ig) => set({ instagram_user_id: ig?.id, instagram_username: ig?.username || undefined })} />
              </Field>
              <Field label="Link de destino">
                <input value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://..." className={inputCls} list="product-ad-links" />
                <datalist id="product-ad-links">{data.links.map((l) => <option key={l.url} value={l.url}>{l.label}</option>)}</datalist>
              </Field>
              <Field label="Link de exibição" hint="O endereço que aparece no anúncio (ex.: voultie.com). Opcional.">
                <input value={form.display_link} onChange={(e) => set({ display_link: e.target.value })} placeholder={displayFromLink(form.link)} className={inputCls} />
              </Field>
              <Field label="Botão">
                <select value={form.cta} onChange={(e) => set({ cta: e.target.value as typeof AD_CTAS[number] })} className={inputCls}>
                  {AD_CTAS.map((c) => <option key={c} value={c}>{CTA_LABELS[c]}</option>)}
                </select>
              </Field>
            </div>
            {assets.error && <p className="text-xs text-destructive">{(assets.error as Error).message}</p>}
            {assets.data && (assets.data.pages.length === 0 || igs.length === 0) && (
              <p className="text-xs text-warning">
                Não achei {assets.data.pages.length === 0 ? "páginas" : "contas do Instagram"} nesta conta. Reconecte o Facebook (Integrações da loja) e marque as páginas e o Instagram na janela da Meta.
              </p>
            )}
            <details className="text-xs text-muted-foreground group">
              <summary className="cursor-pointer hover:text-foreground list-none inline-flex items-center gap-1">
                <ChevronDown className="size-3 transition-transform group-open:rotate-180" /> Parâmetros de URL e detalhes da busca
              </summary>
              <div className="mt-2 space-y-2">
                <Field label="Parâmetros de URL (UTM)">
                  <input value={form.url_tags} onChange={(e) => set({ url_tags: e.target.value })} className={inputCls} />
                </Field>
                {assets.data && (
                  <ul className="space-y-0.5 pl-1">
                    <li className="text-foreground font-medium">Busca na Meta: {assets.data.pages.length} página(s), {igs.length} Instagram(s)</li>
                    {assets.data.debug.map((d) => <li key={d.source}><span className="text-foreground">{d.source}:</span> {d.result}</li>)}
                  </ul>
                )}
              </div>
            </details>

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-semibold text-foreground">
                  Criativos {selected.length > 0 && <span className="text-primary normal-case tracking-normal">· {selected.length} marcado(s)</span>}
                </div>
                {creatives.length > 0 && (
                  <button type="button" onClick={() => setSelected(selected.length === creatives.length ? [] : creatives.map((c) => c.id))} className="text-xs text-muted-foreground hover:text-foreground">
                    {selected.length === creatives.length ? "Limpar" : "Marcar todos"}
                  </button>
                )}
              </div>
              {creatives.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum criativo com mídia. Suba vídeos ou imagens (ou importe do Drive) em Produção › Criativos.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2.5">
                  {creatives.map((c) => (
                    <CreativeTile key={c.id} c={c} order={selected.indexOf(c.id)} node={nodes[`m:${c.id}`]} onClick={() => toggle(c.id)} />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <div className="text-[13px] font-semibold text-foreground">Como montar</div>
              <div className="grid sm:grid-cols-3 gap-2">
                <OptionCard icon={LayoutGrid} active={form.distribution === "per_creative"} onClick={() => set({ distribution: "per_creative" })}
                  title="Testar criativos" text="1 conjunto por criativo. Cada um roda separado, sem você duplicar nada." />
                <OptionCard icon={Rows3} active={form.distribution === "together"} onClick={() => set({ distribution: "together" })}
                  title="Todos juntos" text="1 conjunto com 1 anúncio por criativo. A Meta escolhe quem recebe mais." />
                <OptionCard icon={Layers} active={form.distribution === "single_ad"} onClick={() => set({ distribution: "single_ad" })}
                  title="Vários em 1 anúncio" text={`Junta de ${MULTI_MIN} a ${MULTI_MAX} criativos num anúncio só.`} />
              </div>
              {form.distribution === "single_ad" && (
                <div className="grid sm:grid-cols-2 gap-2 pt-1">
                  <OptionCard icon={Shuffle} compact active={form.multi_format === "flexible"} onClick={() => set({ multi_format: "flexible" })}
                    title="Flexível" text="A Meta escolhe a melhor mídia para cada pessoa." />
                  <OptionCard icon={GalleryHorizontal} compact active={form.multi_format === "carousel"} onClick={() => set({ multi_format: "carousel" })}
                    title="Carrossel" text="A pessoa arrasta para o lado. A ordem é a ordem em que você marcou." />
                </div>
              )}
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div className="text-[13px] font-semibold text-foreground">Textos</div>
              <TextPicker
                creatives={chosen}
                copies={copies}
                columns={copyColumns ?? []}
                pickOf={pickOf}
                onPick={(ids, patch) => set({ picks: { ...form.picks, ...Object.fromEntries(ids.map((id) => [id, { ...pickOf(id), ...patch }])) } })}
              />
              {withoutBody > 0 && <p className="text-xs text-warning">{withoutBody} criativo(s) sem descrição: o anúncio sobe sem texto principal.</p>}
            </div>

            <AiFeaturesPanel
              value={form.ai_features} onChange={(ai_features) => set({ ai_features })}
              multiAdvertiser={form.multi_advertiser} onMultiAdvertiser={(multi_advertiser) => set({ multi_advertiser })}
            />

            {custom.length > 0 && (
              <div className="border-t border-border pt-4">
                <div className="text-[13px] font-semibold text-foreground">Códigos que você criou no modelo de nomes</div>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                  O sistema não sabe preencher estes sozinho. Escreva o valor ou deixe vazio (some do nome).{" "}
                  <Link to="/settings/templates" search={{ tipo: "nomenclatura" }} className="text-primary hover:underline">Editar modelo</Link>
                </p>
                <div className="grid sm:grid-cols-3 gap-3">
                  {custom.map((code) => (
                    <div key={code} className="min-w-0">
                      <div className="flex items-baseline gap-1.5 mb-1.5">
                        <code className="text-xs font-medium">{`{{${code}}}`}</code>
                        <span className="text-[11px] text-muted-foreground truncate">no nome {levelsUsing(templates, code)}</span>
                      </div>
                      <input value={form.custom[code] ?? ""} onChange={(e) => set({ custom: { ...form.custom, [code]: e.target.value } })} placeholder={codeLabel(code)} className={inputCls} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Step>
        </fieldset>

        {/* Revisão */}
        <aside className="lg:sticky lg:top-0 rounded-2xl border border-border bg-card soft-shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Revisão</div>
              <Link to="/settings/templates" search={{ tipo: "nomenclatura" }} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                <Pencil className="size-3" /> Modelo de nomes
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <Stat label="Conjuntos" value={String(plan.adsets.length)} />
              <Stat label="Anúncios" value={String(adCount)} />
              <Stat label="Total/dia" value={perDay ? money(perDay, cur) : "—"} />
            </div>
          </div>

          <div className="px-3 py-3 max-h-[52vh] overflow-y-auto space-y-1">
            <TreeRow
              icon={Megaphone} level={0} node={nodes.campaign}
              value={plan.campaign_name} edited={!!overrides.campaign} disabled={running}
              onChange={(v) => setOverrides((o) => ({ ...o, campaign: v }))} onReset={() => setOverrides((o) => without(o, "campaign"))}
              meta={`${form.budget_mode}${form.budget_mode === "CBO" && form.daily_budget ? ` · ${money(form.daily_budget, cur)}/dia` : ""} · ${form.status === "ACTIVE" ? "ativa" : "pausada"}${startIso ? ` · início ${form.start_local.slice(8, 10)}/${form.start_local.slice(5, 7)} ${form.start_local.slice(11, 16)}` : ""}`}
            />
            {plan.adsets.length === 0 && <p className="text-xs text-muted-foreground px-2 py-6 text-center">Marque os criativos para montar os conjuntos e anúncios.</p>}
            {plan.adsets.map((s) => (
              <div key={s.key} className="space-y-1">
                <TreeRow
                  icon={Users} level={1} node={nodes[s.key]}
                  value={s.name} edited={!!overrides[s.key]} disabled={running}
                  onChange={(v) => setOverrides((o) => ({ ...o, [s.key]: v }))} onReset={() => setOverrides((o) => without(o, s.key))}
                  meta={form.budget_mode === "ABO" && form.daily_budget ? `${money(form.daily_budget, cur)}/dia` : undefined}
                />
                {s.ads.map((ad) => (
                  <TreeRow
                    key={ad.key} level={2} node={nodes[ad.key]}
                    thumbs={ad.creative_ids.map((id) => creatives.find((c) => c.id === id)).filter(Boolean)}
                    value={ad.name} edited={!!overrides[ad.key]} disabled={running}
                    onChange={(v) => setOverrides((o) => ({ ...o, [ad.key]: v }))} onReset={() => setOverrides((o) => without(o, ad.key))}
                    meta={`${FORMAT_LABEL[ad.format]}${ad.creative_ids.length > 1 ? ` (${ad.creative_ids.length})` : ""} · ${igText}`}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="px-4 py-3 border-t border-border space-y-2 bg-background/40">
            {missing.length > 0 && !running && <p className="text-xs text-muted-foreground">Falta: {missing.join(", ")}</p>}
            <button onClick={publish} disabled={missing.length > 0 || running} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
              {running ? "Publicando..." : adCount ? `Publicar ${adCount} anúncio(s)` : "Publicar"}
            </button>
            {running && <p className="text-xs text-muted-foreground text-center">Não feche esta aba até terminar. Vídeos podem levar alguns minutos na Meta.</p>}
          </div>
        </aside>
      </div>

      {data.publications.length > 0 && (
        <History
          publications={data.publications}
          onDelete={(id) => confirm("Tirar do histórico? A campanha continua na Meta.").then(async (yes) => {
            if (!yes) return;
            await deleteFn({ data: { id } });
            qc.invalidateQueries({ queryKey: ["product-ads", productId] });
          })}
        />
      )}
    </div>
  );
}

function levelsUsing(t: Record<"campaign" | "adset" | "ad", string>, code: string) {
  const names = { campaign: "da campanha", adset: "do conjunto", ad: "do anúncio" } as const;
  return (Object.keys(names) as (keyof typeof names)[]).filter((l) => codesIn(t[l]).includes(code)).map((l) => names[l]).join(", ");
}

// Melhorias de IA da Meta (Advantage+ criativo): tudo desligado até você ligar.
function AiFeaturesPanel({ value, onChange, multiAdvertiser, onMultiAdvertiser }: {
  value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void;
  multiAdvertiser: boolean; onMultiAdvertiser: (v: boolean) => void;
}) {
  const on = [...AI_FEATURES.filter((f) => value[f.key]), ...(multiAdvertiser ? [1] : [])];
  const groups = (Object.keys(AI_GROUP_LABEL) as AiFeature["group"][]).map((g) => ({ g, list: AI_FEATURES.filter((f) => f.group === g) }));
  return (
    <details className="border-t border-border pt-4 group/ai">
      <summary className="cursor-pointer list-none flex items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">Melhorias automáticas da Meta</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", on.length ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {on.length ? `${on.length} ligada(s)` : "Tudo desligado"}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground ml-auto transition-transform group-open/ai:rotate-180" />
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Advantage+ criativo e afins: a Meta mexe na mídia, nos textos ou adiciona coisas ao anúncio. Tudo vai <strong className="text-foreground font-medium">desligado</strong>, menos o que você ligar aqui; fica salvo para a próxima campanha.
            <span className="block mt-1"><strong className="text-foreground font-medium">Otimizar texto por pessoa</strong> liga sozinho quando o anúncio tem mais de um título ou descrição.</span>
          </p>
          {on.length > 0 && <button type="button" onClick={() => { onChange({}); onMultiAdvertiser(false); }} className="text-xs text-muted-foreground hover:text-foreground shrink-0">Desligar tudo</button>}
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3">
          {groups.map(({ g, list }) => (
            <div key={g} className="space-y-1">
              <div className="text-xs font-medium mb-1">{AI_GROUP_LABEL[g]}</div>
              {list.map((f) => (
                <label key={f.key} title={f.help} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                  <Switch checked={!!value[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} />
                  <span className="min-w-0">
                    <span className="text-xs font-medium flex items-center gap-1">
                      {f.label}
                      {f.ai && <span className="text-[9px] px-1 rounded bg-violet-500/10 text-violet-600 dark:text-violet-300 font-semibold">IA</span>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground leading-snug">{f.help}</span>
                  </span>
                </label>
              ))}
              {g === "extras" && (
                <label className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                  <Switch checked={multiAdvertiser} onChange={onMultiAdvertiser} />
                  <span className="min-w-0">
                    <span className="text-xs font-medium">Anúncios com vários anunciantes</span>
                    <span className="block text-[11px] text-muted-foreground leading-snug">Seu anúncio aparece junto com anúncios de outras marcas.</span>
                  </span>
                </label>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function displayFromLink(link: string) {
  try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return "ex.: sualoja.com"; }
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked}
      onClick={(e) => { e.preventDefault(); onChange(!checked); }}
      className={cn("mt-0.5 relative h-4 w-7 rounded-full transition-colors shrink-0", checked ? "bg-primary" : "bg-muted-foreground/30")}
    >
      <span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow transition-all", checked ? "left-3.5" : "left-0.5")} />
    </button>
  );
}

// Lançamentos › Textos: até 5 títulos e 5 descrições (copy) do banco pra cada criativo.
// Com mais de um, a Meta testa as combinações ("otimizar texto por pessoa").
function TextPicker({ creatives, copies, columns, pickOf, onPick }: {
  creatives: any[]; copies: ProductCopy[]; columns: TrafficColumn[];
  pickOf: (id: string) => TextPick; onPick: (creativeIds: string[], patch: Partial<TextPick>) => void;
}) {
  const titles = copies.filter((c) => c.kind === "title");
  const bodies = copies.filter((c) => c.kind === "body");

  if (!copies.length) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
        <p className="text-sm font-medium">Nenhum título ou descrição neste produto</p>
        <p className="text-xs text-muted-foreground mt-1">Cadastre na aba <strong className="text-foreground font-medium">Tráfego › Títulos e Descrições</strong> e volte aqui para escolher.</p>
      </div>
    );
  }
  if (!creatives.length) return <p className="text-xs text-muted-foreground">Marque os criativos acima para escolher os títulos e as descrições de cada um.</p>;

  const all = creatives.map((c) => c.id);
  const key = (l: string[]) => [...l].sort().join(",");
  // Igual em todos → mostra a lista; diferente → null ("vários diferentes").
  const common = (k: keyof TextPick) => { const first = pickOf(all[0])[k]; return all.every((id) => key(pickOf(id)[k]) === key(first)) ? first : null; };
  const grid = "grid sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] gap-2";

  return (
    <div className="space-y-2">
      <div className={`hidden sm:grid ${grid.replace("grid ", "")} px-1 text-xs text-muted-foreground font-medium`}>
        <span>Criativo</span><span>Títulos (até {MAX_TEXTS})</span><span>Descrições / copy (até {MAX_TEXTS})</span>
      </div>
      {creatives.length > 1 && (
        <div className={`${grid} items-start rounded-lg bg-primary/5 border border-primary/20 px-2 py-2`}>
          <span className="text-xs font-medium text-primary px-1 pt-1.5">Aplicar a todos</span>
          <CopyMulti items={titles} columns={columns} value={common("titles")} onChange={(v) => onPick(all, { titles: v })} empty="Sem título" />
          <CopyMulti items={bodies} columns={columns} value={common("bodies")} onChange={(v) => onPick(all, { bodies: v })} empty="Sem descrição" />
        </div>
      )}
      {creatives.map((c) => {
        const p = pickOf(c.id);
        return (
          <div key={c.id} className={`${grid} items-start rounded-lg border border-border bg-background px-2 py-2`}>
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative w-7 aspect-[9/16] rounded overflow-hidden bg-muted shrink-0"><Media c={c} className="absolute inset-0 w-full h-full object-cover" /></div>
              <span className="text-xs font-medium truncate">{c.name || "Criativo"}</span>
            </div>
            <CopyMulti items={titles} columns={columns} value={p.titles} onChange={(v) => onPick([c.id], { titles: v })} empty="Sem título" />
            <CopyMulti items={bodies} columns={columns} value={p.bodies} onChange={(v) => onPick([c.id], { bodies: v })} empty="Sem descrição" long />
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Com mais de um título ou descrição, a Meta testa as combinações e mostra a melhor para cada pessoa.</p>
    </div>
  );
}

// Etiquetas dos textos escolhidos + "Adicionar" (lista do banco agrupada pelas colunas da esteira).
// value null = criativos com escolhas diferentes (só no "Aplicar a todos").
function CopyMulti({ items, columns, value, onChange, empty, long }: {
  items: ProductCopy[]; columns: TrafficColumn[]; value: string[] | null; onChange: (v: string[]) => void; empty: string; long?: boolean;
}) {
  const [q, setQ] = useState("");
  const selected = value ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const first = columns[0]?.id;
  const term = q.trim().toLowerCase();
  const groups = columns
    .map((col) => ({
      col,
      list: items
        .filter((i) => (i.column_id && columns.some((c) => c.id === i.column_id) ? i.column_id : first) === col.id)
        .filter((i) => !term || i.text.toLowerCase().includes(term))
        .sort((a, b) => a.position - b.position),
    }))
    .filter((g) => g.list.length);
  const short = (t: string, n = 60) => { const one = t.replace(/\s+/g, " ").trim(); return one.length > n ? `${one.slice(0, n)}…` : one; };
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : selected.length < MAX_TEXTS ? [...selected, id] : selected);

  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {value === null && <span className="text-xs text-muted-foreground italic px-1">Vários diferentes</span>}
      {selected.map((id) => (
        <span key={id} title={byId.get(id)?.text} className={cn("inline-flex items-center gap-1 max-w-full rounded-md bg-muted px-2 py-1 text-xs", !long && "font-medium")}>
          <span className="truncate">{short(byId.get(id)?.text ?? "", long ? 70 : 45)}</span>
          <button type="button" onClick={() => onChange(selected.filter((x) => x !== id))} className="text-muted-foreground hover:text-destructive shrink-0" title="Tirar">
            <XCircle className="size-3" />
          </button>
        </span>
      ))}
      {value !== null && !selected.length && <span className="text-xs text-muted-foreground px-1">{empty}</span>}
      <Popover onOpenChange={(o) => !o && setQ("")}>
        <PopoverTrigger asChild>
          <button type="button" disabled={selected.length >= MAX_TEXTS && value !== null}
            className="h-7 px-2 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/40 disabled:opacity-40">
            {value === null ? "Escolher para todos" : selected.length ? "+ Adicionar" : "+ Escolher"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[26rem] max-w-[90vw] p-0">
          <div className="p-2 border-b border-border">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className={cn(inputCls, "h-8 text-xs")} />
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5 space-y-2">
            {groups.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nada encontrado.</p>}
            {groups.map((g) => (
              <div key={g.col.id}>
                <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">{g.col.name}</div>
                {g.list.map((i) => {
                  const on = selected.includes(i.id);
                  const full = !on && selected.length >= MAX_TEXTS;
                  return (
                    <button key={i.id} type="button" disabled={full} onClick={() => toggle(i.id)}
                      className={cn("w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-40", on && "bg-primary/5")}>
                      <span className={cn("mt-0.5 size-3.5 rounded border grid place-items-center shrink-0", on ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/50")}>
                        {on && <Check className="size-2.5" />}
                      </span>
                      <span className="line-clamp-3 whitespace-pre-line break-words">{i.text}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground">{selected.length} de {MAX_TEXTS} escolhido(s)</div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const GENDER_LABEL: Record<Gender, string> = { all: "Todos", male: "Homens", female: "Mulheres" };
const GENDER_CODE: Record<Gender, string> = { all: "", male: "H", female: "M" };

function SuggestionCheck({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("mt-1.5 inline-flex items-center gap-1.5 text-xs select-none", disabled ? "text-muted-foreground/60" : "text-muted-foreground cursor-pointer hover:text-foreground")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-primary" />
      Usar como sugestão
    </label>
  );
}

const FORMAT_LABEL: Record<PlanAd["format"], string> = { single: "Único", flexible: "Flexível", carousel: "Carrossel" };

function without(o: Record<string, string>, key: string) {
  const next = { ...o };
  delete next[key];
  return next;
}

function pickMedia(all: Map<string, AdMedia>, ad: PlanAd) {
  return Object.fromEntries(ad.creative_ids.map((id) => [id, all.get(id)!]));
}

// Digita livre; ajusta pra 18–65 ao sair do campo (ou Enter).
function AgeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => { const v = clampAge(text); setText(String(v)); if (v !== value) onChange(v); };
  return (
    <input
      inputMode="numeric" value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 2))}
      onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()}
      className={cn(inputCls, "text-center")}
    />
  );
}

function clampAge(v: string) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(65, Math.max(18, n)) : 18;
}

function InstagramSelect({ igs, loading, value, onChange }: { igs: AdInstagram[]; loading: boolean; value?: string; onChange: (ig?: AdInstagram) => void }) {
  const named = igs.filter((i) => i.username || i.page_name);
  const others = igs.filter((i) => !i.username && !i.page_name);
  return (
    <select value={value ?? ""} disabled={loading} onChange={(e) => onChange(igs.find((i) => i.id === e.target.value))} className={inputCls}>
      {loading && <option>Carregando...</option>}
      {!loading && <option value="">Usar a página do Facebook</option>}
      {named.length > 0 && <optgroup label="Identificados">{named.map((i) => <option key={i.id} value={i.id}>{igLabel(i)}</option>)}</optgroup>}
      {others.length > 0 && <optgroup label="Sem nome (a Meta não informou)">{others.map((i) => <option key={i.id} value={i.id}>{igLabel(i)}</option>)}</optgroup>}
    </select>
  );
}

function CreativeTile({ c, order, node, onClick }: { c: any; order: number; node?: NodeState; onClick: () => void }) {
  const on = order >= 0;
  return (
    <button type="button" onClick={onClick} className={cn("text-left rounded-xl border overflow-hidden bg-background transition-all", on ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/40")}>
      <div className="relative aspect-[9/16] bg-muted/40">
        <Media c={c} className="absolute inset-0 w-full h-full object-cover" />
        <span className={cn("absolute top-1.5 left-1.5 size-5 rounded-md border grid place-items-center text-[11px] font-semibold", on ? "bg-primary border-primary text-primary-foreground" : "border-white/80 bg-black/25")}>
          {on ? order + 1 : null}
        </span>
        {c.media_kind === "video" && <Film className="absolute bottom-1.5 left-1.5 size-3.5 text-white drop-shadow" />}
        {node && (
          <div className={cn("absolute inset-x-0 bottom-0 px-1.5 py-1 text-[11px] leading-tight text-white flex items-start gap-1", node.state === "error" ? "bg-destructive/90" : node.state === "ok" ? "bg-emerald-600/90" : "bg-black/70")}>
            <StateIcon state={node.state} className="size-3 shrink-0" />
            <span className="line-clamp-3">{node.label}</span>
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="text-xs font-medium truncate">{c.name || "Sem nome"}</div>
        <div className="text-[11px] text-muted-foreground">{c.media_kind === "video" ? "Vídeo" : "Imagem"}{c.drive_file_id && !c.media_path ? " · Drive" : ""}</div>
      </div>
    </button>
  );
}

function Media({ c, className }: { c: any; className?: string }) {
  if (!c.media_path && c.drive_file_id) {
    return c.thumb_url ? <img src={c.thumb_url} alt="" className={className} /> : <div className={cn(className, "grid place-items-center bg-muted")}><Film className="size-4 text-muted-foreground" /></div>;
  }
  return c.media_kind === "video"
    ? <video src={`${c.media_url}#t=0.1`} preload="metadata" muted playsInline className={cn(className, "bg-black")} />
    : <img src={c.media_url} alt="" className={className} />;
}

function TreeRow({ icon: Icon, level, value, meta, edited, disabled, node, thumbs, onChange, onReset }: {
  icon?: React.ComponentType<{ className?: string }>; level: 0 | 1 | 2; value: string; meta?: string; edited: boolean; disabled: boolean;
  node?: NodeState; thumbs?: any[]; onChange: (v: string) => void; onReset: () => void;
}) {
  return (
    <div className={cn("flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50", level === 1 && "ml-3", level === 2 && "ml-7")}>
      {thumbs ? (
        <div className="relative size-8 shrink-0">
          {thumbs.slice(0, 3).map((c, i) => (
            <div key={c.id} className="absolute size-7 rounded-md overflow-hidden border border-background bg-muted" style={{ left: i * 3, top: i }}>
              <Media c={c} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      ) : Icon ? (
        <div className={cn("size-6 rounded-md grid place-items-center shrink-0 mt-0.5", level === 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          <Icon className="size-3.5" />
        </div>
      ) : null}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <input
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            title="Clique para editar o nome"
            className={cn("w-full min-w-0 bg-transparent rounded px-1 -mx-1 text-[13px] outline-none border border-transparent hover:border-border focus:border-primary/50 focus:bg-background truncate", level === 0 && "font-semibold")}
          />
          {edited && !disabled && (
            <button type="button" onClick={onReset} title="Voltar ao nome do modelo" className="text-muted-foreground hover:text-foreground shrink-0">
              <RotateCcw className="size-3" />
            </button>
          )}
        </div>
        {node ? (
          <div className={cn("text-xs flex items-center gap-1 mt-0.5", node.state === "error" ? "text-destructive" : node.state === "ok" ? "text-success" : "text-muted-foreground")}>
            <StateIcon state={node.state} className="size-3 shrink-0" />
            <span className="line-clamp-2">{node.label}</span>
          </div>
        ) : meta ? (
          <div className="text-xs text-muted-foreground truncate">{meta}</div>
        ) : null}
      </div>
    </div>
  );
}

function StateIcon({ state, className }: { state: NodeState["state"]; className?: string }) {
  if (state === "ok") return <CheckCircle2 className={className} />;
  if (state === "error") return <XCircle className={className} />;
  return <Loader2 className={cn(className, "animate-spin")} />;
}

function History({ publications, onDelete }: {
  publications: { id: string; campaign_id: string | null; campaign_name: string; ad_account_id: string; status: string; config: AdPublicationConfig; ads: AdResult[]; error: string | null; created_at: string }[];
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-sm font-semibold mb-2">Publicadas</div>
      <div className="rounded-2xl border border-border bg-card soft-shadow-sm divide-y divide-border">
        {publications.map((p) => {
          const ok = p.ads.filter((a) => a.ad_id).length;
          const failed = p.ads.filter((a) => a.error && !a.ad_id);
          const sets = new Set(p.ads.map((a) => a.adset_id ?? a.adset_name).filter(Boolean)).size;
          return (
            <div key={p.id} className="px-3 py-2.5 flex items-start gap-3">
              <StatusIcon status={p.status} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.campaign_name}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(p.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  {p.config?.budget_mode ? ` · ${p.config.budget_mode}` : ""}
                  {sets ? ` · ${sets} conjunto(s)` : ""} · {ok} anúncio(s)
                  {p.config?.status === "ACTIVE" ? " · ativa" : " · pausada"}
                  {p.config?.daily_budget ? ` · ${p.config.daily_budget}/dia` : ""}
                </div>
                {p.error && <div className="text-xs text-destructive mt-0.5">{p.error}</div>}
                {failed.map((a, i) => (
                  <div key={a.key ?? a.creative_id ?? i} className="text-xs text-destructive mt-0.5">{a.adset_name ? `${a.adset_name} › ` : ""}{a.name}: {a.error}</div>
                ))}
              </div>
              {p.campaign_id && (
                <a href={adsManagerUrl(p.ad_account_id, p.campaign_id)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-1 shrink-0 hover:underline">
                  Gerenciador <ExternalLink className="size-3" />
                </a>
              )}
              <button title="Tirar do histórico (não apaga na Meta)" onClick={() => onDelete(p.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" />;
  if (status === "partial") return <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />;
  if (status === "running") return <Loader2 className="size-4 text-muted-foreground animate-spin shrink-0 mt-0.5" />;
  return <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />;
}

function Step({ n, icon: Icon, title, summary, children }: { n: number; icon: React.ComponentType<{ className?: string }>; title: string; summary?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card soft-shadow-sm p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="size-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold grid place-items-center shrink-0">{n}</span>
        <Icon className="size-4 text-muted-foreground" />
        <div className="text-[15px] font-semibold">{title}</div>
        {summary && <div className="ml-auto text-xs text-muted-foreground truncate max-w-[55%]">{summary}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground font-medium mb-1.5">{label}</div>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold truncate">{value}</div>
    </div>
  );
}

function OptionCard({ icon: Icon, title, text, active, compact, onClick }: {
  icon?: React.ComponentType<{ className?: string }>; title: string; text: string; active: boolean; compact?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative text-left rounded-xl border px-3 transition-all",
        compact ? "py-2" : "py-2.5",
        active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border bg-background hover:border-primary/40",
      )}
    >
      <div className="flex items-center gap-1.5 pr-5">
        {Icon && <Icon className={cn("size-3.5", active ? "text-primary" : "text-muted-foreground")} />}
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{text}</p>
      {active && <Check className="absolute top-2.5 right-2.5 size-3.5 text-primary" />}
    </button>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-lg border border-border bg-background p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={`flex-1 h-8 rounded-md text-xs font-medium transition-colors ${value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

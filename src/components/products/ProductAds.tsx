import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, ExternalLink, Film, Loader2, Megaphone, Trash2, XCircle } from "lucide-react";
import { listCreatives } from "@/lib/products.functions";
import {
  AD_CTAS, getProductAdsSetup, getAdAccountAssets, startAdPublication, uploadAdMedia, checkAdVideo,
  createAdForCreative, finishAdPublication, deleteAdPublication, type AdPublicationConfig, type AdMedia,
} from "@/lib/product-ads.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";

const CTA_LABELS: Record<typeof AD_CTAS[number], string> = {
  SHOP_NOW: "Comprar agora", LEARN_MORE: "Saiba mais", ORDER_NOW: "Peça agora",
  BUY_NOW: "Comprar", GET_OFFER: "Obter oferta", SIGN_UP: "Cadastre-se",
};
const DEFAULTS: Partial<AdPublicationConfig> = {
  structure: "single", cta: "SHOP_NOW", status: "PAUSED", daily_budget: 30,
  url_tags: "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}",
};

type Step = { label: string; state: "running" | "ok" | "error" };

const inputCls = "w-full px-3 h-9 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const adsManagerUrl = (act: string, campaignId: string) =>
  `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act.replace(/^act_/, "")}&selected_campaign_ids=${campaignId}`;

export function ProductAds({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const setupFn = useServerFn(getProductAdsSetup);
  const assetsFn = useServerFn(getAdAccountAssets);
  const creativesFn = useServerFn(listCreatives);
  const startFn = useServerFn(startAdPublication);
  const uploadFn = useServerFn(uploadAdMedia);
  const checkFn = useServerFn(checkAdVideo);
  const createAdFn = useServerFn(createAdForCreative);
  const finishFn = useServerFn(finishAdPublication);
  const deleteFn = useServerFn(deleteAdPublication);

  const setup = useQuery({ queryKey: ["product-ads", productId], queryFn: () => setupFn({ data: { product_id: productId } }) });
  const creativesQ = useQuery({ queryKey: ["creatives", productId], queryFn: () => creativesFn({ data: { product_id: productId } }) });
  const creatives = ((creativesQ.data?.creatives ?? []) as any[]).filter((c) => c.media_path);

  const [cfg, setCfg] = useState<Partial<AdPublicationConfig>>({});
  const [countriesText, setCountriesText] = useState("US");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [steps, setSteps] = useState<Record<string, Step>>({});
  const [running, setRunning] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const set = (patch: Partial<AdPublicationConfig>) => setCfg((p) => ({ ...p, ...patch }));

  // Pré-preenche com a última publicação do produto (ou o padrão).
  useEffect(() => {
    if (initialized || !setup.data) return;
    const last = setup.data.publications[0]?.config;
    const acc = setup.data.accounts.find((a) => a.ad_account_id === last?.ad_account_id && a.shop_id === last?.shop_id) ?? setup.data.accounts[0];
    setCfg({
      ...DEFAULTS,
      ...last,
      shop_id: acc?.shop_id, ad_account_id: acc?.ad_account_id,
      link: last?.link ?? setup.data.links[0]?.url ?? "",
      campaign_name: "",
    });
    if (last?.countries?.length) setCountriesText(last.countries.join(", "));
    setInitialized(true);
  }, [setup.data, initialized]);

  const account = setup.data?.accounts.find((a) => a.shop_id === cfg.shop_id && a.ad_account_id === cfg.ad_account_id);
  const assets = useQuery({
    queryKey: ["ad-account-assets", cfg.shop_id, cfg.ad_account_id],
    enabled: !!cfg.shop_id && !!cfg.ad_account_id,
    queryFn: () => assetsFn({ data: { shop_id: cfg.shop_id!, ad_account_id: cfg.ad_account_id! } }),
    staleTime: 5 * 60_000,
  });

  // Página e pixel: mantém a escolha se ainda existir na conta, senão pega a primeira.
  useEffect(() => {
    if (!assets.data) return;
    const { pages, pixels } = assets.data;
    setCfg((p) => {
      const page = pages.find((x) => x.id === p.page_id) ?? pages[0];
      const pixel = pixels.find((x) => x.id === p.pixel_id) ?? pixels[0];
      return { ...p, page_id: page?.id, page_name: page?.name ?? "", pixel_id: pixel?.id };
    });
  }, [assets.data]);

  const countries = useMemo(() => countriesText.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)), [countriesText]);
  const chosen = creatives.filter((c) => selected.has(c.id));

  const missing: string[] = [];
  if (!account) missing.push("conta de anúncio");
  if (!cfg.page_id) missing.push("página");
  if (!cfg.pixel_id) missing.push("pixel");
  if (!chosen.length) missing.push("criativos");
  if (!cfg.campaign_name?.trim()) missing.push("nome da campanha");
  if (!/^https?:\/\/\S+$/.test(cfg.link ?? "")) missing.push("link de destino");
  if (!countries.length) missing.push("países");
  if (!(Number(cfg.daily_budget) > 0)) missing.push("orçamento");

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const step = (id: string, label: string, state: Step["state"] = "running") => setSteps((s) => ({ ...s, [id]: { label, state } }));

  const publish = async () => {
    if (missing.length || running) return;
    const config = { ...cfg, countries, daily_budget: Number(cfg.daily_budget), campaign_name: cfg.campaign_name!.trim() } as AdPublicationConfig;
    const ok = await confirm(
      `Criar a campanha "${config.campaign_name}" com ${chosen.length} anúncio(s) ${config.status === "ACTIVE" ? "ATIVOS (já começam a gastar)" : "pausados"}?`,
    );
    if (!ok) return;

    setRunning(true);
    setSteps(Object.fromEntries(chosen.map((c) => [c.id, { label: "Na fila", state: "running" as const }])));
    try {
      const { publication_id } = await startFn({ data: { product_id: productId, config } });

      // 1) Sobe todas as mídias primeiro — a Meta processa os vídeos em paralelo.
      const media = new Map<string, AdMedia>();
      const failures: { creative_id: string; name: string; error: string }[] = [];
      for (const c of chosen) {
        step(c.id, c.media_kind === "video" ? "Enviando vídeo pra Meta" : "Enviando imagem pra Meta");
        try {
          media.set(c.id, await uploadFn({ data: { publication_id, creative_id: c.id } }));
        } catch (e: any) {
          step(c.id, e.message, "error");
        }
      }

      // 2) Espera cada vídeo ficar pronto e cria conjunto + anúncio.
      let sharedAdset: string | undefined;
      for (const c of chosen) {
        let m = media.get(c.id);
        if (!m) continue;
        try {
          if (m.kind === "video") {
            step(c.id, "Meta processando o vídeo");
            const deadline = Date.now() + 15 * 60_000;
            for (;;) {
              const r = await checkFn({ data: { publication_id, video_id: m.video_id } });
              if (r.state === "ready") { m = { ...m, thumbnail_url: r.thumbnail_url }; break; }
              if (r.state === "error") throw new Error("A Meta não conseguiu processar o vídeo");
              if (Date.now() > deadline) throw new Error("O vídeo demorou demais pra processar na Meta");
              await sleep(5000);
            }
          }
          step(c.id, "Criando anúncio");
          const r = await createAdFn({
            data: { publication_id, creative_id: c.id, media: m, adset_id: config.structure === "single" ? sharedAdset : undefined },
          });
          if (config.structure === "single") sharedAdset = r.adset_id;
          step(c.id, "Anúncio criado", "ok");
        } catch (e: any) {
          step(c.id, e.message, "error");
          failures.push({ creative_id: c.id, name: c.name || "Criativo", error: String(e.message).slice(0, 1000) });
        }
      }

      const { status } = await finishFn({ data: { publication_id, failures } });
      if (status === "ok") toast.success("Campanha publicada");
      else if (status === "partial") toast.warning("Campanha publicada, mas alguns anúncios falharam");
      else toast.error("Nenhum anúncio foi criado");
      if (status !== "error") { setSelected(new Set()); set({ campaign_name: "" }); }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRunning(false);
      qc.invalidateQueries({ queryKey: ["product-ads", productId] });
    }
  };

  if (setup.isLoading) return <div className="py-16 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (setup.error) return <div className="text-sm text-destructive">{(setup.error as Error).message}</div>;
  const data = setup.data!;

  if (!data.accounts.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-16 text-center">
        <Megaphone className="size-8 text-muted-foreground mx-auto mb-2" />
        <div className="text-sm font-semibold">Nenhuma conta de anúncio conectada</div>
        <div className="text-xs text-muted-foreground mt-1">Conecte a Meta e uma conta de anúncio em uma loja (Integrações) pra publicar campanhas.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Section n={1} title="Conta">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Conta de anúncio">
            <select
              value={account ? `${account.shop_id}|${account.ad_account_id}` : ""}
              onChange={(e) => { const [shop_id, ad_account_id] = e.target.value.split("|"); set({ shop_id, ad_account_id }); }}
              className={inputCls}
            >
              {data.accounts.map((a) => (
                <option key={`${a.shop_id}|${a.ad_account_id}`} value={`${a.shop_id}|${a.ad_account_id}`}>{a.account_name} · {a.shop_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Página do Facebook">
            <select value={cfg.page_id ?? ""} disabled={assets.isLoading} onChange={(e) => {
              const page = assets.data?.pages.find((p) => p.id === e.target.value);
              set({ page_id: page?.id, page_name: page?.name ?? "" });
            }} className={inputCls}>
              {assets.isLoading && <option>Carregando...</option>}
              {assets.data?.pages.length === 0 && <option value="">Nenhuma página nesta conta</option>}
              {assets.data?.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Pixel (otimiza pra compra)">
            <select value={cfg.pixel_id ?? ""} disabled={assets.isLoading} onChange={(e) => set({ pixel_id: e.target.value })} className={inputCls}>
              {assets.isLoading && <option>Carregando...</option>}
              {assets.data?.pixels.length === 0 && <option value="">Nenhum pixel nesta conta</option>}
              {assets.data?.pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        {assets.error && <p className="text-xs text-destructive mt-2">{(assets.error as Error).message}</p>}
      </Section>

      <Section
        n={2}
        title="Criativos"
        aside={creatives.length > 0 && (
          <button onClick={() => setSelected(selected.size === creatives.length ? new Set() : new Set(creatives.map((c) => c.id)))} className="text-xs text-muted-foreground hover:text-foreground">
            {selected.size === creatives.length ? "Limpar" : "Selecionar todos"}
          </button>
        )}
      >
        {creatives.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum criativo com mídia. Suba vídeos ou imagens na aba Produção › Criativos.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
            {creatives.map((c) => {
              const on = selected.has(c.id);
              const st = steps[c.id];
              const titles = Array.isArray(c.titles) ? c.titles.length : 0;
              const bodies = Array.isArray(c.descriptions) ? c.descriptions.length : 0;
              return (
                <button key={c.id} disabled={running} onClick={() => toggle(c.id)} className={`text-left rounded-xl border overflow-hidden bg-surface transition-colors disabled:cursor-default ${on ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/40"}`}>
                  <div className="relative aspect-[9/16] bg-muted/40">
                    {c.media_kind === "video"
                      ? <video src={`${c.media_url}#t=0.1`} preload="metadata" muted playsInline className="absolute inset-0 w-full h-full object-cover bg-black" />
                      : <img src={c.media_url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                    <span className={`absolute top-1.5 left-1.5 size-4 rounded border grid place-items-center ${on ? "bg-primary border-primary text-primary-foreground" : "border-white/80 bg-black/20"}`}>
                      {on && <Check className="size-3" />}
                    </span>
                    {c.media_kind === "video" && <Film className="absolute bottom-1.5 left-1.5 size-3.5 text-white drop-shadow" />}
                    {st && (
                      <div className={`absolute inset-x-0 bottom-0 px-1.5 py-1 text-[10px] leading-tight text-white flex items-start gap-1 ${st.state === "error" ? "bg-destructive/90" : st.state === "ok" ? "bg-emerald-600/90" : "bg-black/70"}`}>
                        {st.state === "running" ? <Loader2 className="size-3 animate-spin shrink-0" /> : st.state === "ok" ? <CheckCircle2 className="size-3 shrink-0" /> : <XCircle className="size-3 shrink-0" />}
                        <span className="line-clamp-3">{st.label}</span>
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="text-xs font-medium truncate">{c.name || "Sem nome"}</div>
                    <div className={`text-[10px] ${titles + bodies === 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {titles + bodies === 0 ? "Sem textos" : `${titles} título(s) · ${bodies} texto(s)`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">Títulos do criativo viram os títulos do anúncio e as descrições viram o texto principal. Com mais de um, a Meta testa as combinações.</p>
      </Section>

      <Section n={3} title="Campanha">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome da campanha">
            <input value={cfg.campaign_name ?? ""} onChange={(e) => set({ campaign_name: e.target.value })} placeholder="Ex.: [Produto] Teste criativos 14/10" className={inputCls} />
          </Field>
          <Field label="Link de destino">
            <input value={cfg.link ?? ""} onChange={(e) => set({ link: e.target.value })} placeholder="https://..." className={inputCls} list="product-ad-links" />
            <datalist id="product-ad-links">{data.links.map((l) => <option key={l.url} value={l.url}>{l.label}</option>)}</datalist>
          </Field>
          <Field label={`Orçamento diário por conjunto (${account?.currency ?? ""})`}>
            <input type="number" min={1} step="1" value={cfg.daily_budget ?? ""} onChange={(e) => set({ daily_budget: e.target.value === "" ? undefined : Number(e.target.value) })} className={inputCls} />
          </Field>
          <Field label="Países (códigos, separados por vírgula)">
            <input value={countriesText} onChange={(e) => setCountriesText(e.target.value)} placeholder="US, CA" className={inputCls} />
          </Field>
          <Field label="Estrutura">
            <Segmented
              value={cfg.structure ?? "single"}
              onChange={(v) => set({ structure: v })}
              options={[{ value: "single", label: "1 conjunto com todos" }, { value: "per_creative", label: "1 conjunto por criativo" }]}
            />
          </Field>
          <Field label="Botão">
            <select value={cfg.cta ?? "SHOP_NOW"} onChange={(e) => set({ cta: e.target.value as typeof AD_CTAS[number] })} className={inputCls}>
              {AD_CTAS.map((c) => <option key={c} value={c}>{CTA_LABELS[c]}</option>)}
            </select>
          </Field>
          <Field label="Parâmetros de URL (UTM)">
            <input value={cfg.url_tags ?? ""} onChange={(e) => set({ url_tags: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Ao publicar">
            <Segmented
              value={cfg.status ?? "PAUSED"}
              onChange={(v) => set({ status: v })}
              options={[{ value: "PAUSED", label: "Criar pausada" }, { value: "ACTIVE", label: "Já ativar" }]}
            />
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Vendas (compra no pixel), público Advantage+ (18–65) e posicionamentos automáticos.
          {cfg.structure === "per_creative" && chosen.length > 0 && cfg.daily_budget ? ` Total por dia: ${(chosen.length * Number(cfg.daily_budget)).toLocaleString("pt-BR")} ${account?.currency ?? ""}.` : ""}
        </p>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {missing.length > 0 && !running && <span className="text-xs text-muted-foreground">Falta: {missing.join(", ")}</span>}
        <button onClick={publish} disabled={missing.length > 0 || running} className="h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
          {running ? "Publicando..." : `Publicar ${chosen.length || ""} anúncio(s)`}
        </button>
      </div>
      {running && <p className="text-xs text-muted-foreground text-right -mt-3">Não feche esta aba até terminar.</p>}

      {data.publications.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-2">Publicadas</div>
          <div className="rounded-2xl border border-border bg-surface divide-y divide-border">
            {data.publications.map((p) => {
              const ok = p.ads.filter((a) => a.ad_id).length;
              const failed = p.ads.filter((a) => a.error && !a.ad_id);
              return (
                <div key={p.id} className="px-3 py-2.5 flex items-start gap-3">
                  <StatusIcon status={p.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.campaign_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(p.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {ok} anúncio(s)
                      {p.config?.status === "ACTIVE" ? " · ativa" : " · pausada"}
                      {p.config?.daily_budget ? ` · ${p.config.daily_budget}/dia` : ""}
                    </div>
                    {p.error && <div className="text-xs text-destructive mt-0.5">{p.error}</div>}
                    {failed.map((a) => <div key={a.creative_id} className="text-xs text-destructive mt-0.5">{a.name}: {a.error}</div>)}
                  </div>
                  {p.campaign_id && (
                    <a href={adsManagerUrl(p.ad_account_id, p.campaign_id)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-1 shrink-0 hover:underline">
                      Gerenciador <ExternalLink className="size-3" />
                    </a>
                  )}
                  <button
                    title="Tirar do histórico (não apaga na Meta)"
                    onClick={() => confirm("Tirar do histórico? A campanha continua na Meta.").then(async (yes) => {
                      if (!yes) return;
                      await deleteFn({ data: { id: p.id } });
                      qc.invalidateQueries({ queryKey: ["product-ads", productId] });
                    })}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />;
  if (status === "partial") return <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />;
  if (status === "running") return <Loader2 className="size-4 text-muted-foreground animate-spin shrink-0 mt-0.5" />;
  return <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />;
}

function Section({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="size-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold grid place-items-center">{n}</span>
        <div className="text-sm font-semibold flex-1">{title}</div>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">{label}</div>
      {children}
    </div>
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

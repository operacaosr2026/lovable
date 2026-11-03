import { Fragment, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Columns3, Loader2, Megaphone, Pencil, Settings2, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AutoTextarea } from "@/components/shops/StoreProduction";
import { getExperimentMetrics, type ExperimentRaw } from "@/lib/product-dashboard.functions";
import { METRIC_LABEL, kindName, updateExperiment, type CampaignKind, type CampaignStatus, type Experiment } from "@/lib/experiments.functions";
import { getCampaignTemplate, type SummaryField } from "@/lib/campaign-template.functions";
import {
  METRIC_DEFS, SOURCE_LABEL, compareToBase, deriveMetrics, fmtMetric, sumCounts,
  type MetricDef, type MetricSource, type RawCounts,
} from "@/lib/experiment-metrics";
import { STATUS_STYLE, TagsPopover, daysLive, findStatus, fmtDate } from "@/components/products/ProductCampaigns";
import { ProductDiary } from "@/components/products/ProductDiary";
import { CampaignTemplateEditor } from "@/components/products/CampaignTemplate";

// Janela da campanha (aba Campanhas do produto): Resumo (campos do template +
// o que está testando), Métricas (dia a dia da campanha da Meta, linhas =
// datas, colunas = métricas, como no Gerenciador de Anúncios, com total e
// comparação com a base) e Diário interno.

const inputCls = "h-9 px-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const COLS_KEY = "experiment-columns-v2";
const ACTIVE_ONLY_KEY = "experiment-adsets-active-only";
const MAX_DAYS = 92;
const AVAILABLE = METRIC_DEFS;
// Do Clarity, só as 3 principais aparecem de início; o resto fica em Colunas.
const DEFAULT_COLS = AVAILABLE.filter((m) => m.source !== "clarity" || ["sessions", "engaged_time", "scroll_depth"].includes(m.key)).map((m) => m.key);

const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

function loadCols(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
    if (Array.isArray(v)) return v.filter((k) => AVAILABLE.some((m) => m.key === k));
  } catch { /* sem localStorage: usa o padrão */ }
  return DEFAULT_COLS;
}

type Tab = "resumo" | "metricas" | "diario";
const TABS: [Tab, string][] = [["resumo", "Resumo"], ["metricas", "Métricas"], ["diario", "Diário"]];

export function CampaignView({ experiment, statuses, kinds, productId, allTags, onEdit, onTags, onClose }: {
  experiment: Experiment; statuses: CampaignStatus[]; kinds: CampaignKind[]; productId: string; allTags: string[]; onEdit: () => void; onTags: (tags: string[]) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("resumo");
  const days = daysLive(experiment);
  const status = findStatus(statuses, experiment.status);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-full max-w-[min(96vw,1500px)] h-[90vh] overflow-y-auto overflow-x-hidden block">
        <div className="min-w-0">
        <div className="flex flex-wrap items-start gap-3 pr-8">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold tracking-tight">{experiment.title}</DialogTitle>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
              <span className={`font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${STATUS_STYLE[status.color].pill}`}>{status.name}</span>
              {experiment.campaign_name && <span className="px-1.5 py-0.5 rounded-md bg-muted flex items-center gap-1"><Megaphone className="size-3" /> {experiment.campaign_name}</span>}
              {experiment.started_at && <span>Início {fmtDate(experiment.started_at)}{experiment.ended_at ? ` · Fim ${fmtDate(experiment.ended_at)}` : ""}{days ? ` · ${days} ${days === 1 ? "dia" : "dias"}` : ""}</span>}
            </div>
            <div className="mt-2 max-w-xl"><TagsPopover tags={experiment.tags} allTags={allTags} onChange={onTags} /></div>
          </div>
          <button onClick={onEdit} className="h-9 px-3 rounded-lg border border-border text-sm flex items-center gap-1.5 hover:bg-muted">
            <Pencil className="size-3.5" /> Editar
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-border mt-4">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`h-9 px-3 text-sm font-medium border-b-2 -mb-px ${tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "resumo" && <CampaignSummary experiment={experiment} kinds={kinds} productId={productId} onEdit={onEdit} />}
        {tab === "metricas" && <CampaignMetrics experiment={experiment} />}
        {tab === "diario" && <div className="pt-4"><ProductDiary productId={productId} experimentId={experiment.id} /></div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Resumo ──

function CampaignSummary({ experiment, kinds, productId, onEdit }: { experiment: Experiment; kinds: CampaignKind[]; productId: string; onEdit: () => void }) {
  const [editingFields, setEditingFields] = useState(false);
  const qc = useQueryClient();
  const tplFn = useServerFn(getCampaignTemplate);
  const updateFn = useServerFn(updateExperiment);
  const { data: fields, isLoading } = useQuery({ queryKey: ["campaign-template"], queryFn: () => tplFn(), staleTime: 5 * 60_000 });
  const save = useMutation({
    mutationFn: (summary: Record<string, string | boolean>) => updateFn({ data: { id: experiment.id, summary } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product-experiments", productId] }),
    onError: (e: any) => toast.error(e.message),
  });
  const setValue = (id: string, v: string | boolean | null) => {
    const next = { ...experiment.summary };
    if (v === null || v === "") delete next[id]; else next[id] = v;
    save.mutate(next);
  };
  const e = experiment;
  const testing: [string, string][] = ([
    ["O que está testando", kindName(kinds, e.kind)],
    ["Hipótese", e.hypothesis],
    ["Controle → variação", e.control || e.variant ? `${e.control || "Atual"} → ${e.variant || "Variação"}` : ""],
    ["Métrica que decide", METRIC_LABEL[e.metric]],
    ["Regra de parada", e.stop_rule],
    ["Verba", e.budget != null ? `US$ ${e.budget.toLocaleString("pt-BR")}` : ""],
  ] as [string, string][]).filter(([, v]) => v);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 pt-4">
      <section className="rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold">Resumo</h3>
          {save.isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <button onClick={() => setEditingFields(true)} title="Editar os campos do Resumo (valem para todas as campanhas)"
            className="ml-auto size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
            <Settings2 className="size-3.5" />
          </button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
        ) : !fields?.length ? (
          <p className="text-sm text-muted-foreground">Nenhum campo no Resumo. <button onClick={() => setEditingFields(true)} className="text-primary hover:underline">Criar campos</button></p>
        ) : (
          <div className="divide-y divide-border/60">
            {fields.map((fld) => (
              <SummaryRow key={fld.id} field={fld} value={experiment.summary?.[fld.id]} onSave={(v) => setValue(fld.id, v)} />
            ))}
          </div>
        )}
      </section>

      {editingFields && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditingFields(false); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Campos do Resumo</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground -mt-2">
              Valem para todas as campanhas. Também dá pra editar em <Link to="/settings/templates" search={{ tipo: "campanhas" }} className="text-primary hover:underline">Configurações › Templates › Campanhas</Link>.
            </p>
            <CampaignTemplateEditor onSaved={() => setEditingFields(false)} />
          </DialogContent>
        </Dialog>
      )}

      <div className="space-y-4">
        <section className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold">O que estou testando</h3>
            <button onClick={onEdit} title="Editar" className="ml-auto size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
              <Pencil className="size-3.5" />
            </button>
          </div>
          {testing.length ? (
            <dl className="space-y-2.5">
              {testing.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
                  <dd className="text-sm whitespace-pre-wrap">{v}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="text-sm text-muted-foreground">Nada preenchido.</p>}
        </section>
        {e.learning && (
          <section className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold">Aprendizado</h3>
            </div>
            <p className="text-sm whitespace-pre-wrap">{e.learning}</p>
          </section>
        )}
      </div>
    </div>
  );
}

// Campo do resumo editado ali mesmo: texto salva ao sair do campo; sim/não e
// opções salvam no clique.
function SummaryRow({ field, value, onSave }: { field: SummaryField; value: string | boolean | undefined; onSave: (v: string | boolean | null) => void }) {
  const text = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const commit = () => { if (draft.trim() !== text) onSave(draft.trim() || null); };
  const fieldCls = "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none hover:border-border focus:border-primary/50 focus:bg-background";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[160px_minmax(0,1fr)] gap-1 sm:gap-3 py-2 items-start">
      <span className="text-[13px] text-muted-foreground pt-1.5">{field.label}</span>
      {field.type === "toggle" ? (
        <div className="flex items-center gap-1 py-0.5">
          {([[true, "Ligado"], [false, "Desligado"]] as const).map(([v, label]) => (
            <button key={label} onClick={() => onSave(value === v ? null : v)}
              className={`h-7 px-2.5 rounded-md text-xs font-medium border ${value === v ? (v ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-transparent" : "bg-muted text-foreground border-transparent") : "border-border text-muted-foreground hover:bg-muted"}`}>
              {label}
            </button>
          ))}
        </div>
      ) : field.type === "select" ? (
        <select value={text} onChange={(e) => onSave(e.target.value || null)} className={`${fieldCls} cursor-pointer`}>
          <option value="">—</option>
          {text && !field.options.includes(text) && <option value={text}>{text}</option>}
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.type === "long" ? (
        <AutoTextarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} placeholder="—"
          className={`${fieldCls} min-h-9 resize-none whitespace-pre-wrap`} />
      ) : (
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          placeholder="—" className={fieldCls} />
      )}
    </div>
  );
}

// ── Métricas ──

function CampaignMetrics({ experiment }: { experiment: Experiment }) {
  const getFn = useServerFn(getExperimentMetrics);
  const today = nyToday();
  const [draftFrom, setDraftFrom] = useState(() => experiment.started_at ?? addDays(today, -6));
  const [draftTo, setDraftTo] = useState(() => (experiment.ended_at && experiment.ended_at < today ? experiment.ended_at : today));
  // As datas só valem 400ms depois da última mudança (não busca a cada clique no calendário).
  const [{ from, to }, setRange] = useState({ from: draftFrom, to: draftTo });
  useEffect(() => {
    const t = setTimeout(() => setRange({ from: draftFrom, to: draftTo }), 400);
    return () => clearTimeout(t);
  }, [draftFrom, draftTo]);
  const [level, setLevel] = useState<"campaign" | "adset">("campaign");
  const [activeOnly, setActiveOnly] = useState(() => {
    try { return localStorage.getItem(ACTIVE_ONLY_KEY) === "1"; } catch { return false; }
  });
  const toggleActiveOnly = () => {
    const next = !activeOnly;
    setActiveOnly(next);
    try { localStorage.setItem(ACTIVE_ONLY_KEY, next ? "1" : "0"); } catch { /* ignora */ }
  };
  const [cols, setCols] = useState<string[]>(loadCols);

  const rangeOk = from <= to && daysBetween(from, to) < MAX_DAYS;
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["experiment-metrics", experiment.id, experiment.campaign_id, from, to, level],
    queryFn: async () => ({ ...(await getFn({ data: { experiment_id: experiment.id, from, to, level } })), from, to, level }),
    enabled: rangeOk && !!experiment.campaign_id,
    staleTime: 5 * 60_000,
    // Enquanto o período novo carrega, a tabela anterior continua na tela.
    placeholderData: keepPreviousData,
  });

  const shown = AVAILABLE.filter((m) => cols.includes(m.key));
  const toggleCol = (key: string) => {
    const next = cols.includes(key) ? cols.filter((k) => k !== key) : [...cols, key];
    setCols(next);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignora */ }
  };

  // Linhas do período que já chegou (não do que está carregando).
  const dates = useMemo(() => {
    if (!data) return [];
    const out: string[] = [];
    for (let d = data.from; d <= data.to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [data]);

  const groups = useMemo(() => {
    if (!data?.configured) return [];
    const byGroup = new Map<string, { name: string; rows: Map<string, ExperimentRaw> }>();
    for (const r of data.rows) {
      const g = byGroup.get(r.group) ?? { name: r.group_name, rows: new Map() };
      g.rows.set(r.date, r);
      byGroup.set(r.group, g);
    }
    if (!byGroup.size) byGroup.set("all", { name: "Campanha", rows: new Map() });
    const active = data.level === "adset" && activeOnly && data.activeAdsets ? new Set(data.activeAdsets) : null;
    return [...byGroup.entries()].map(([id, g]) => ({ id, ...g }))
      .filter((g) => !active || active.has(g.id))
      .sort((a, b) => (a.id === "?" ? 1 : b.id === "?" ? -1 : a.name.localeCompare(b.name)));
  }, [data, activeOnly]);

  const changesByDate = useMemo(() => {
    const m = new Map<string, string[]>();
    if (data?.configured) for (const c of data.changes) m.set(c.date, [...(m.get(c.date) ?? []), c.content]);
    return m;
  }, [data]);

  const hasBase = Object.keys(experiment.baseline ?? {}).length > 0;
  const partialDays = useMemo(() => new Set(data?.configured ? data.partialDays : []), [data]);
  const sources = (["meta", "shopify", "clarity"] as MetricSource[]).map((s) => ({ s, n: shown.filter((m) => m.source === s).length })).filter((x) => x.n > 0);

  return (
    <div>
    {!experiment.campaign_id ? (
      <div className="rounded-2xl border border-dashed border-border py-12 text-center mt-4">
        <p className="text-sm font-medium">Nenhuma campanha ligada a este teste</p>
        <p className="text-xs text-muted-foreground mt-1">Clique em Editar e escolha a campanha da Meta para ver as métricas dia a dia.</p>
      </div>
    ) : (
      <>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <input type="date" value={draftFrom} max={draftTo} onChange={(e) => e.target.value && setDraftFrom(e.target.value)} className={inputCls} aria-label="De" />
          <span className="text-xs text-muted-foreground">até</span>
          <input type="date" value={draftTo} min={draftFrom} max={today} onChange={(e) => e.target.value && setDraftTo(e.target.value)} className={inputCls} aria-label="Até" />
          <div className="flex items-center rounded-lg border border-border p-0.5">
            {([["campaign", "Campanha"], ["adset", "Por conjunto"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setLevel(v)}
                className={`h-8 px-3 rounded-md text-xs font-medium ${level === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
          {level === "adset" && (
            <label className={`h-9 px-3 rounded-lg border text-sm flex items-center gap-1.5 cursor-pointer ${activeOnly ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted"}`}
              title={data?.configured && data.level === "adset" && !data.activeAdsets ? "Não deu pra ler o status dos conjuntos na Meta agora" : "Mostrar só os conjuntos que estão rodando agora"}>
              <input type="checkbox" checked={activeOnly} onChange={toggleActiveOnly} /> Só ativos
            </label>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button className="h-9 px-3 rounded-lg border border-border text-sm flex items-center gap-1.5 hover:bg-muted">
                <Columns3 className="size-3.5" /> Colunas
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3 max-h-[60vh] overflow-y-auto">
              {(["meta", "shopify", "clarity"] as MetricSource[]).map((src) => (
                <div key={src} className="mb-2 last:mb-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{SOURCE_LABEL[src]}</p>
                  {AVAILABLE.filter((m) => m.source === src).map((m) => (
                    <label key={m.key} className="flex items-center gap-2 py-0.5 text-sm cursor-pointer">
                      <input type="checkbox" checked={cols.includes(m.key)} onChange={() => toggleCol(m.key)} />
                      {m.label}
                    </label>
                  ))}
                </div>
              ))}
            </PopoverContent>
          </Popover>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {!rangeOk && <p className="text-xs text-destructive mt-2">Escolha um período de até {MAX_DAYS} dias.</p>}

        {error ? (
          <p className="text-sm text-destructive mt-4">{(error as Error).message}</p>
        ) : isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : data?.configured ? (
          <>
            {data.errors.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs p-2.5 space-y-0.5">
                {data.errors.map((e, i) => <p key={i} className="flex items-start gap-1.5"><AlertTriangle className="size-3.5 shrink-0 mt-px" /> {e}</p>)}
              </div>
            )}
            {groups.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhum conjunto ativo com dados no período.</p>}
            {groups.map((g) => (
              <MetricsTable key={g.id} title={level === "adset" ? g.name : null} dates={dates} rows={g.rows}
                shown={shown} sources={sources} changes={changesByDate} partialDays={partialDays} baseline={hasBase ? experiment.baseline : null} />
            ))}
            <p className="text-[11px] text-muted-foreground mt-3">
              Compras (Shopify) são os pedidos deste produto com a UTM da campanha. A Meta conta a compra até 7 dias depois do clique e a Shopify no dia do pedido, por isso os números não batem 100%.
              Clarity: por campanha e conjunto (utm_campaign e utm_medium), a partir do dia em que o Clarity do produto foi conectado (barra no topo da aba Campanhas); dia com * é parcial (busca manual, últimas 24h).
            </p>
          </>
        ) : null}
      </>
    )}
    </div>
  );
}

// Cor de cada fonte no cabeçalho e nas colunas, pra separar Meta, Shopify e Clarity.
const SOURCE_STYLE: Record<MetricSource, { head: string; sub: string; cell: string; foot: string; dot: string }> = {
  meta: { head: "bg-sky-500/15 text-sky-700 dark:text-sky-300", sub: "bg-sky-500/[0.07]", cell: "bg-sky-500/[0.025]", foot: "bg-sky-500/[0.08]", dot: "bg-sky-500" },
  shopify: { head: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", sub: "bg-emerald-500/[0.07]", cell: "bg-emerald-500/[0.025]", foot: "bg-emerald-500/[0.08]", dot: "bg-emerald-500" },
  clarity: { head: "bg-violet-500/15 text-violet-700 dark:text-violet-300", sub: "bg-violet-500/[0.07]", cell: "bg-violet-500/[0.025]", foot: "bg-violet-500/[0.08]", dot: "bg-violet-500" },
};

function MetricsTable({ title, dates, rows, shown, sources, changes, partialDays, baseline }: {
  title: string | null; dates: string[]; rows: Map<string, ExperimentRaw>; shown: MetricDef[];
  sources: { s: MetricSource; n: number }[]; changes: Map<string, string[]>; partialDays: Set<string>; baseline: Record<string, number> | null;
}) {
  const total = deriveMetrics(sumCounts([...rows.values()] as RawCounts[]));
  // Linha grossa no começo de cada fonte.
  const edge = (i: number) => (i === 0 || shown[i - 1].source !== shown[i].source ? "border-l-2 border-l-border" : "");
  const td = "px-3 py-2 text-center tabular-nums whitespace-nowrap";
  const first = "px-3 py-2 text-left whitespace-nowrap sticky left-0 z-10 border-r border-border";

  return (
    <section className="mt-4 min-w-0">
      {title && <h3 className="text-sm font-semibold mb-1.5">{title}</h3>}
      <div className="overflow-x-auto rounded-xl border border-border max-w-full">
        <table className="min-w-full text-[13px] border-collapse">
          <thead>
            <tr>
              <th className={`${first} bg-card`} />
              {sources.map(({ s, n }) => (
                <th key={s} colSpan={n} className={`px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider border-l-2 border-l-border ${SOURCE_STYLE[s].head}`}>
                  <span className="inline-flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${SOURCE_STYLE[s].dot}`} />{SOURCE_LABEL[s]}</span>
                </th>
              ))}
            </tr>
            <tr className="border-b border-border text-[11.5px] text-muted-foreground">
              <th className={`${first} bg-card font-medium`}>Data</th>
              {shown.map((m, i) => (
                <th key={m.key} title={m.hint} className={`px-3 py-2 text-center font-medium leading-tight min-w-[92px] ${SOURCE_STYLE[m.source].sub} ${edge(i)}`}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => {
              const r = rows.get(d);
              const v = r ? deriveMetrics(r) : null;
              const notes = changes.get(d);
              return (
                <tr key={d} className="border-t border-border/50 hover:[&>td]:bg-muted/60" title={notes ? `Alteração: ${notes.join(" · ")}` : undefined}>
                  <td className={`${first} bg-card`}>
                    <span className="flex items-center gap-1.5">
                      {fmtDate(d)}
                      {partialDays.has(d) && <span className="text-amber-600" title="Clarity parcial: busca manual (últimas 24h)">*</span>}
                      {notes && <StickyNote className="size-3.5 text-sky-500" aria-label={`Alteração: ${notes.join("; ")}`} />}
                    </span>
                  </td>
                  {shown.map((m, i) => (
                    <td key={m.key} className={`${td} ${SOURCE_STYLE[m.source].cell} ${edge(i)} ${v ? "" : "text-muted-foreground/40"}`}>
                      {v ? fmtMetric(v[m.key], m.format) : "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="font-semibold">
            <tr className="border-t-2 border-border">
              <td className={`${first} bg-muted`}>Total</td>
              {shown.map((m, i) => (
                <td key={m.key} className={`${td} ${SOURCE_STYLE[m.source].foot} ${edge(i)}`}>{fmtMetric(total[m.key], m.format)}</td>
              ))}
            </tr>
            {baseline && (
              <Fragment>
                <tr className="border-t border-border/60 font-normal text-muted-foreground">
                  <td className={`${first} bg-muted`}>Base</td>
                  {shown.map((m, i) => (
                    <td key={m.key} className={`${td} ${SOURCE_STYLE[m.source].cell} ${edge(i)}`}>
                      {baseline[m.key] !== undefined ? fmtMetric(baseline[m.key], m.format) : ""}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-border/60">
                  <td className={`${first} bg-muted`}>vs. base</td>
                  {shown.map((m, i) => {
                    const c = compareToBase(total[m.key], baseline[m.key], m.better);
                    const cls = !c || c.good === null ? "text-muted-foreground" : c.good ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
                    return (
                      <td key={m.key} className={`${td} ${SOURCE_STYLE[m.source].cell} ${edge(i)}`}>
                        {c && (
                          <span className={`inline-block rounded-md px-1.5 py-0.5 ${cls} ${c.good === null ? "" : c.good ? "bg-emerald-500/10" : "bg-destructive/10"}`}>
                            {c.change > 0 ? "▲" : c.change < 0 ? "▼" : ""} {Math.abs(c.change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            )}
          </tfoot>
        </table>
      </div>
    </section>
  );
}

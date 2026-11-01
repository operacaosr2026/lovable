// Colunas da tabela de métricas do teste (Meta, Shopify e Clarity). "better"
// diz pra que lado é melhora na comparação com a base; "baseline" diz se faz
// sentido digitar uma base (volumes como gasto e pedidos não fazem).

export type MetricSource = "meta" | "shopify" | "clarity";
export type MetricFormat = "money" | "pct" | "int" | "num" | "secs";

export type MetricDef = {
  key: string; label: string; source: MetricSource; format: MetricFormat;
  better: "up" | "down" | null; baseline: boolean; hint?: string;
};

export const SOURCE_LABEL: Record<MetricSource, string> = { meta: "Meta", shopify: "Shopify", clarity: "Clarity" };

export const METRIC_DEFS: MetricDef[] = [
  { key: "spend", label: "Gasto", source: "meta", format: "money", better: null, baseline: false },
  { key: "cpm", label: "CPM", source: "meta", format: "money", better: "down", baseline: true },
  { key: "ctr", label: "CTR (link)", source: "meta", format: "pct", better: "up", baseline: true },
  { key: "cpc", label: "CPC (link)", source: "meta", format: "money", better: "down", baseline: true },
  { key: "arrival_rate", label: "Taxa de chegada", source: "meta", format: "pct", better: "up", baseline: true, hint: "Visualizações da página ÷ cliques no link" },
  { key: "lpv_cost", label: "Custo por visualização da página", source: "meta", format: "money", better: "down", baseline: true },
  { key: "desire_rate", label: "Taxa de desejo", source: "meta", format: "pct", better: "up", baseline: true, hint: "Finalizações ÷ visualizações da página" },
  { key: "ic_cost", label: "Custo por finalização", source: "meta", format: "money", better: "down", baseline: true },
  { key: "purchases_meta", label: "Compras (Meta)", source: "meta", format: "int", better: "up", baseline: false },
  { key: "cpa_meta", label: "CPA (Meta)", source: "meta", format: "money", better: "down", baseline: true },
  { key: "purchases_shop", label: "Compras (Shopify)", source: "shopify", format: "int", better: "up", baseline: false, hint: "Pedidos com a UTM da campanha" },
  { key: "revenue", label: "Receita", source: "shopify", format: "money", better: "up", baseline: false },
  { key: "cpa_real", label: "CPA real", source: "shopify", format: "money", better: "down", baseline: true, hint: "Gasto da Meta ÷ compras da Shopify" },
  { key: "roas_real", label: "ROAS real", source: "shopify", format: "num", better: "up", baseline: true, hint: "Receita da Shopify ÷ gasto" },
  { key: "cvr_real", label: "Conversão real", source: "shopify", format: "pct", better: "up", baseline: true, hint: "Compras da Shopify ÷ visualizações da página" },
  { key: "sessions", label: "Sessões", source: "clarity", format: "int", better: "up", baseline: false },
  { key: "engaged_time", label: "Tempo de engajamento", source: "clarity", format: "secs", better: "up", baseline: true },
  { key: "scroll_depth", label: "Rolagem média", source: "clarity", format: "pct", better: "up", baseline: true },
  { key: "quickback", label: "Saída rápida", source: "clarity", format: "pct", better: "down", baseline: true, hint: "% das sessões" },
  { key: "rage_clicks", label: "Cliques de raiva", source: "clarity", format: "pct", better: "down", baseline: true, hint: "% das sessões" },
  { key: "dead_clicks", label: "Cliques mortos", source: "clarity", format: "pct", better: "down", baseline: true, hint: "% das sessões" },
  { key: "script_errors", label: "Erros de script", source: "clarity", format: "pct", better: "down", baseline: true, hint: "% das sessões" },
];

export const BASELINE_METRICS = METRIC_DEFS.filter((m) => m.baseline);
export const BASELINE_KEYS = BASELINE_METRICS.map((m) => m.key);

export const FORMAT_UNIT: Record<MetricFormat, string> = { money: "US$", pct: "%", int: "", num: "x", secs: "s" };

// Contagens brutas de um dia (ou da soma de vários) → valor de cada coluna.
// Divisão por zero vira null ("—" na tabela). Clarity vem como soma ponderada
// pelas sessões (c_time = Σ tempo × sessões...), pra média do total sair certa;
// c_*_n são as sessões das linhas que tinham aquela métrica.
export type RawCounts = {
  spend: number; impressions: number; clicks: number; lpv: number; ic: number;
  purchases_meta: number; purchases_shop: number; revenue: number;
  c_sessions: number;
  c_time: number; c_time_n: number; c_scroll: number; c_scroll_n: number;
  c_quickback: number; c_quickback_n: number; c_rage: number; c_rage_n: number;
  c_dead: number; c_dead_n: number; c_errors: number; c_errors_n: number;
};

export const EMPTY_COUNTS: RawCounts = {
  spend: 0, impressions: 0, clicks: 0, lpv: 0, ic: 0, purchases_meta: 0, purchases_shop: 0, revenue: 0,
  c_sessions: 0, c_time: 0, c_time_n: 0, c_scroll: 0, c_scroll_n: 0, c_quickback: 0, c_quickback_n: 0,
  c_rage: 0, c_rage_n: 0, c_dead: 0, c_dead_n: 0, c_errors: 0, c_errors_n: 0,
};

const div = (a: number, b: number, mult = 1) => (b > 0 ? (a / b) * mult : null);

export function deriveMetrics(r: RawCounts): Record<string, number | null> {
  return {
    spend: r.spend,
    cpm: div(r.spend, r.impressions, 1000),
    ctr: div(r.clicks, r.impressions, 100),
    cpc: div(r.spend, r.clicks),
    arrival_rate: div(r.lpv, r.clicks, 100),
    lpv_cost: div(r.spend, r.lpv),
    desire_rate: div(r.ic, r.lpv, 100),
    ic_cost: div(r.spend, r.ic),
    purchases_meta: r.purchases_meta,
    cpa_meta: div(r.spend, r.purchases_meta),
    purchases_shop: r.purchases_shop,
    revenue: r.revenue,
    cpa_real: div(r.spend, r.purchases_shop),
    roas_real: div(r.revenue, r.spend),
    cvr_real: div(r.purchases_shop, r.lpv, 100),
    sessions: r.c_sessions > 0 ? r.c_sessions : null,
    engaged_time: div(r.c_time, r.c_time_n),
    scroll_depth: div(r.c_scroll, r.c_scroll_n),
    quickback: div(r.c_quickback, r.c_quickback_n),
    rage_clicks: div(r.c_rage, r.c_rage_n),
    dead_clicks: div(r.c_dead, r.c_dead_n),
    script_errors: div(r.c_errors, r.c_errors_n),
  };
}

export function sumCounts(rows: RawCounts[]): RawCounts {
  const t: RawCounts = { ...EMPTY_COUNTS };
  for (const r of rows) for (const k of Object.keys(t) as (keyof RawCounts)[]) t[k] += r[k] ?? 0;
  return t;
}

const nf = (min: number, max: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const NF0 = nf(0, 0), NF2 = nf(2, 2);
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtMetric(v: number | null | undefined, format: MetricFormat) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (format) {
    case "money": return USD.format(v);
    case "pct": return `${NF2.format(v)}%`;
    case "int": return NF0.format(v);
    case "num": return NF2.format(v);
    case "secs": return `${NF0.format(v)}s`;
  }
}

// Variação contra a base, em %, e se é melhora (respeita o "better" da coluna).
export function compareToBase(v: number | null, base: number | undefined, better: MetricDef["better"]) {
  if (v === null || base === undefined || base === 0 || !better) return null;
  const change = ((v - base) / Math.abs(base)) * 100;
  const good = Math.abs(change) < 0.5 ? null : better === "up" ? change > 0 : change < 0;
  return { change, good };
}

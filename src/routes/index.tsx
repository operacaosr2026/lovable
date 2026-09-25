import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageShell } from "@/components/PageHeader";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  TrendingUp, Megaphone, Package, Wallet, RotateCcw,
  ArrowUpRight, ArrowDownRight, BarChart3,
  CalendarDays, ChevronDown, PieChart as PieChartIcon,
  CheckSquare, AlertTriangle, Clock, Truck, ChevronRight, Target,
} from "lucide-react";
import {
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { getDashboardOverview } from "@/lib/lg-cards.functions";
import { listCompanyGoals } from "@/lib/company-goals.functions";
import { listLogisticsOrders } from "@/lib/lg-logistics.functions";
import { listTasks } from "@/lib/tasks.functions";
import { computeLogisticsKpis, computeLogisticsTrend } from "@/lib/logistics-kpis";
import { DateRangePicker } from "@/components/lojas-grupos/LgDashboard";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { redirect } from "@tanstack/react-router";
import { isoTodayUS, US_TIME_ZONE } from "@/lib/timezone";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login" });
    }
  },
  head: () => ({
    meta: [
      { title: "Dashboard — SRX Growth" },
      { name: "description", content: "Visão rápida do seu dia." },
    ],
  }),
  component: Dashboard,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-muted-foreground">
      Erro ao carregar: {error?.message ?? "tente recarregar"}
    </div>
  ),
});

// ─── Period helpers ─────────────────────────────────────────────────────────────

const isoToday = isoTodayUS;
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function getPeriodRange(period: string, custom?: { from: string; to: string }) {
  const today = isoToday();
  let from = today, to = today;
  if (period === "ontem") { from = addDays(today, -1); to = addDays(today, -1); }
  if (period === "7d")    { from = addDays(today, -6); }
  if (period === "30d")   { from = addDays(today, -29); }
  if (period === "mes")   {
    from = `${today.slice(0, 7)}-01`; to = today;
  }
  if (period === "custom" && custom) { from = custom.from; to = custom.to; }
  return { from, to };
}
function daysBetween(from: string, to: string) {
  return Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86_400_000) + 1;
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);
}
function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Cores por métrica (ícone dos KPIs + série ativa do gráfico) ───────────────

type MetricAccent = "primary" | "info" | "warning" | "success" | "destructive";

const METRIC_ACCENTS: Record<MetricAccent, { chip: string; solid: string }> = {
  primary:     { chip: "bg-primary/10 text-primary",         solid: "var(--color-primary)" },
  info:        { chip: "bg-info/10 text-info",               solid: "var(--color-info)" },
  warning:     { chip: "bg-warning/15 text-warning",         solid: "var(--color-warning)" },
  success:     { chip: "bg-success/15 text-success",         solid: "var(--color-success)" },
  destructive: { chip: "bg-destructive/10 text-destructive", solid: "var(--color-destructive)" },
};

// Paleta categórica (identidade por loja) — validada com a skill dataviz,
// ordem fixa, não circular. Ver --chart-1..5 em styles.css.
const SHOP_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const OTHER_COLOR = "var(--color-muted-foreground)";

// ─── Delta (variação vs. período anterior) ─────────────────────────────────────

function DashDelta({ value, unit = "%", invert = false }: { value: number; unit?: string; invert?: boolean }) {
  const good = invert ? value <= 0 : value >= 0;
  const Arrow = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? "text-success" : "text-destructive"}`}>
      <Arrow className="size-3" />
      {value >= 0 ? "+" : ""}{value}{unit}
    </span>
  );
}

// ─── Sparkline (mini gráfico sem eixos, dentro do card de KPI) ─────────────────

type DailyPoint = { date: string; faturamento: number; anuncios: number; custo: number; lucro: number };

function Sparkline({ data, dataKey, color }: { data: DailyPoint[]; dataKey: keyof DailyPoint; color: string }) {
  if (data.length < 2) return <div className="h-full" />;
  const gradId = `dash-spark-${dataKey}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Card de KPI (valor + delta + sparkline + 2 estatísticas) ──────────────────

function DashKpiCard({
  icon: Icon, accent, label, value, delta, deltaUnit = "%", invert = false,
  sparklineKey, chartData, stats, periodNote, shopRows, loading,
}: {
  icon: any; accent: MetricAccent; label: string; value: string;
  delta: number; deltaUnit?: string; invert?: boolean;
  sparklineKey?: keyof DailyPoint;
  chartData: DailyPoint[];
  stats?: [{ label: string; value: string }, { label: string; value: string }];
  periodNote?: string;
  shopRows?: { shop_id: string; shop_name: string; taxaEstorno: number }[];
  loading?: boolean;
}) {
  const a = METRIC_ACCENTS[accent];
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 soft-shadow-sm min-w-0 flex flex-col">
      <div className="flex items-center gap-2.5 mb-3 min-w-0">
        <div className={`size-9 rounded-xl grid place-items-center shrink-0 ${a.chip}`}>
          <Icon className="size-4.5" />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      </div>
      {loading
        ? <div className="h-7 w-24 bg-muted animate-pulse rounded-lg" />
        : <p className="text-xl font-bold tracking-tight text-foreground truncate">{value}</p>
      }
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <DashDelta value={delta} unit={deltaUnit} invert={invert} />
        <span className="text-[11px] text-muted-foreground">vs. mês anterior</span>
      </div>

      {sparklineKey && (
        <div className="flex-1 min-h-9 mt-3">
          <Sparkline data={chartData} dataKey={sparklineKey} color={a.solid} />
        </div>
      )}

      {stats ? (
        <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <p className="text-[10px] text-muted-foreground truncate">{s.label}</p>
              <p className="text-xs font-semibold text-foreground truncate">{s.value}</p>
            </div>
          ))}
        </div>
      ) : periodNote ? (
        <p className="mt-3 pt-3 border-t border-border text-[10px] text-muted-foreground">{periodNote}</p>
      ) : null}

      {shopRows && shopRows.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-1">
          {shopRows.map((r) => (
            <div key={r.shop_id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground truncate">{r.shop_name}</span>
              <span className="font-medium text-foreground tabular-nums shrink-0">{fmtPct(r.taxaEstorno)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tooltip do gráfico principal ──────────────────────────────────────────────

function DashTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-card border border-border p-3 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1 font-medium">{label}</p>
      <p className={`font-semibold ${Number(payload[0].value) < 0 ? "text-destructive" : "text-foreground"}`}>{fmtMoney(payload[0].value)}</p>
    </div>
  );
}

// Tooltip do donut da Composição: loja, faturamento e participação.
function DonutTooltip({ active, payload, total }: any) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  const pct = total > 0 ? (s.faturamento / total) * 100 : 0;
  return (
    <div className="rounded-xl bg-card border border-border p-2.5 shadow-lg text-xs">
      <p className="flex items-center gap-1.5 font-medium text-foreground mb-0.5">
        <span className="size-2 rounded-full shrink-0" style={{ background: s.color }} />{s.shop_name}
      </p>
      <p className="font-semibold text-foreground tabular-nums">{fmtMoney(s.faturamento)}</p>
      <p className="text-muted-foreground tabular-nums">{pct.toFixed(1)}% do total</p>
    </div>
  );
}

// ─── Breakdown por loja: top 4 + "Outros" quando há mais de 5 lojas ────────────

type ShopBreakdownRow = { shop_id: string; shop_name: string; faturamento: number; taxaEstorno: number; totalPedidos: number; totalEstornos: number };
type ShopSlice = ShopBreakdownRow & { color: string };

// Ordem crescente por nome (numérica: "Loja 2" antes de "Loja 10"); "Outros"
// sempre por último, já que é um agregado, não uma loja de verdade.
function byShopName(a: { shop_id: string; shop_name: string }, b: { shop_id: string; shop_name: string }) {
  if (a.shop_id === "outros") return 1;
  if (b.shop_id === "outros") return -1;
  return a.shop_name.localeCompare(b.shop_name, "pt-BR", { numeric: true });
}

function buildShopSlices(shopBreakdown: ShopBreakdownRow[]): ShopSlice[] {
  const sorted = [...shopBreakdown].filter((s) => s.faturamento > 0).sort((a, b) => b.faturamento - a.faturamento);
  if (sorted.length <= 5) return sorted.map((s, i) => ({ ...s, color: SHOP_COLORS[i] })).sort(byShopName);

  const top = sorted.slice(0, 4).map((s, i) => ({ ...s, color: SHOP_COLORS[i] }));
  const rest = sorted.slice(4);
  const pedidos = rest.reduce((s, r) => s + r.totalPedidos, 0);
  const estornos = rest.reduce((s, r) => s + r.totalEstornos, 0);
  const outros: ShopSlice = {
    shop_id: "outros",
    shop_name: "Outros",
    faturamento: rest.reduce((s, r) => s + r.faturamento, 0),
    taxaEstorno: pedidos > 0 ? estornos / pedidos : 0,
    totalPedidos: pedidos,
    totalEstornos: estornos,
    color: OTHER_COLOR,
  };
  return [...top, outros].sort(byShopName);
}

// ─── Abas do gráfico principal ──────────────────────────────────────────────────

type ChartTabKey = "metas" | "lucro" | "faturamento" | "anuncios";

const CHART_TABS: { key: ChartTabKey; label: string; accent: MetricAccent }[] = [
  { key: "metas",       label: "Metas",          accent: "primary" },
  { key: "lucro",       label: "Lucro",          accent: "success" },
  { key: "faturamento", label: "Faturamento",    accent: "primary" },
  { key: "anuncios",    label: "Gasto com Ads",  accent: "info" },
];

// ─── Aba "Metas": histórico de metas por mês ───────────────────────────────────

const MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const fmtK = (n: number) => {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, "").replace(".", ",")}k` : `$${Math.round(abs)}`;
  return n < 0 ? `-${s}` : s;
};

type GoalsHistory = {
  months: { month: string; meta: number; realizado: number; projecao: number | null; atingida: boolean; atual: boolean }[];
  atingidas: number;
  total: number;
};

// Cor do selo de %: verde ≥ 100%, laranja 70–99%, vermelho < 70%.
const pctTone = (pct: number) =>
  pct >= 100 ? { bg: "var(--color-success)", text: "var(--color-success)" }
  : pct >= 70 ? { bg: "#f59e0b", text: "#d97706" }
  : { bg: "var(--color-destructive)", text: "var(--color-destructive)" };

// Meta do mês: linha tracejada (mais larga que a barra) + etiqueta com o valor.
function MetaLineShape(props: any) {
  const { x, y, width, payload } = props;
  if (!width || y == null || !payload?.meta) return null;
  const label = `$${Math.round(payload.meta).toLocaleString("en-US")}`;
  const w = Math.max(44, label.length * 6.4 + 12);
  return (
    <g>
      <line x1={x - 12} x2={x + width + 12} y1={y} y2={y} stroke="var(--color-primary)" strokeWidth={2} strokeDasharray="6 4" />
      <rect x={x + width / 2 - w / 2} y={y - 22} width={w} height={17} rx={5} fill="var(--color-primary)" fillOpacity={0.1} />
      <text x={x + width / 2} y={y - 10} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-primary)">{label}</text>
    </g>
  );
}

// Lucro realizado: barra roxa com degradê e o valor dentro.
function RealizadoShape(props: any) {
  const { x, y, width, height, payload } = props;
  if (!width || height == null || height <= 0) return null;
  const top = payload?.projExtra > 0 ? 0 : 6;
  return (
    <g>
      <defs>
        <linearGradient id="goal-bar-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={1} />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.45} />
        </linearGradient>
      </defs>
      <path d={`M${x},${y + height} L${x},${y + top} Q${x},${y} ${x + top},${y} L${x + width - top},${y} Q${x + width},${y} ${x + width},${y + top} L${x + width},${y + height} Z`} fill="url(#goal-bar-grad)" />
      {height > 22 && (
        <text x={x + width / 2} y={y + 16} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff">{fmtK(payload.realizado)}</text>
      )}
    </g>
  );
}

// Projeção do mês atual: caixa tracejada em cima do realizado até o valor previsto,
// com o valor dentro e o selo de % projetado acima.
function ProjecaoShape(props: any) {
  const { x, y, width, height, payload } = props;
  if (!width || !height || height <= 0) return null;
  return (
    <g>
      <rect x={x + 1} y={y + 1} width={width - 2} height={height - 1} rx={6} fill="var(--color-primary)" fillOpacity={0.1}
        stroke="var(--color-primary)" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="5 4" />
      {height > 20 && (
        <text x={x + width / 2} y={y + 16} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--color-primary)">{fmtK(payload.projecao)}</text>
      )}
    </g>
  );
}

// Selo de % acima da barra (realizado; no mês atual, o % projetado).
function PctPill(props: any) {
  const { x, y, width, index, data } = props;
  const d = data?.[index];
  if (!d || !d.meta || x == null || y == null) return null;
  const pct = d.pctShown;
  const tone = pctTone(pct);
  const label = `${Math.round(pct)}%`;
  const w = label.length * 7 + 14;
  const cx = x + width / 2;
  return (
    <g>
      <rect x={cx - w / 2} y={y - 22} width={w} height={17} rx={8.5} fill={tone.bg} fillOpacity={0.15} />
      <text x={cx} y={y - 10} textAnchor="middle" fontSize={10} fontWeight={700} fill={tone.text}>{label}</text>
    </g>
  );
}

function GoalsHistoryChart({ data, loading }: { data?: GoalsHistory; loading: boolean }) {
  if (loading) return <div className="flex-1 min-h-[240px] bg-muted animate-pulse rounded-xl" />;
  const months = (data?.months ?? []).map((m) => {
    const projExtra = m.atual && m.projecao != null ? Math.max(0, m.projecao - m.realizado) : 0;
    const pctShown = m.meta > 0 ? ((m.atual && m.projecao != null ? m.projecao : m.realizado) / m.meta) * 100 : 0;
    return { ...m, label: MONTH_ABBR[Number(m.month.slice(5, 7)) - 1] ?? m.month, projExtra, pctShown, topo: Math.max(0, m.realizado) + projExtra };
  });
  const atual = months.find((m) => m.atual);
  const yMax = Math.max(0, ...months.map((m) => Math.max(m.meta, m.topo))) * 1.28 || 1000;
  const BAR = 44;
  return (
    <div className="flex-1 min-h-[240px] flex flex-col">
      {months.length === 0 ? (
        <p className="flex-1 grid place-items-center text-xs text-muted-foreground py-8">Nenhuma meta cadastrada ainda.</p>
      ) : (
        <>
          <div className="flex-1 min-h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 26, right: 14, left: -14, bottom: 0 }} barGap={-BAR} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, yMax]} tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtK(Number(v))} />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload;
                    return (
                      <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-md text-xs space-y-0.5">
                        <p className="font-semibold text-foreground mb-1">{MONTH_FULL[Number(p.month.slice(5, 7)) - 1]} {p.month.slice(0, 4)}</p>
                        <p className="text-muted-foreground">Realizado: <span className="font-semibold text-foreground">{fmtMoney(p.realizado)}</span></p>
                        {p.atual && p.projecao != null && <p className="text-muted-foreground">Projeção: <span className="font-semibold text-foreground">{fmtMoney(p.projecao)}</span></p>}
                        <p className="text-muted-foreground">Meta: <span className="font-semibold text-foreground">{fmtMoney(p.meta)}</span></p>
                        <p className="font-semibold" style={{ color: pctTone(p.pctShown).text }}>{Math.round(p.pctShown)}% da meta{p.atual ? " (projetado)" : ""}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="realizado" stackId="lucro" barSize={BAR} shape={<RealizadoShape />} isAnimationActive={false} />
                <Bar dataKey="projExtra" stackId="lucro" barSize={BAR} shape={<ProjecaoShape />} isAnimationActive={false} />
                {/* Meta por cima das barras (a linha aparece mesmo quando o lucro passa dela) */}
                <Bar dataKey="meta" barSize={BAR} shape={<MetaLineShape />} isAnimationActive={false} />
                {/* Camada invisível só pro selo de % no topo (realizado + projeção) */}
                <Bar dataKey="topo" barSize={BAR} shape={() => <g />} isAnimationActive={false}>
                  <LabelList dataKey="topo" content={<PctPill data={months} />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" /> Lucro realizado</span>
            <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-primary" /> Meta do mês</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-dashed border-primary bg-primary/10" /> Projeção do mês</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success" /> ≥ 100%</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-amber-500" /> 70–99%</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-destructive" /> &lt; 70%</span>
          </div>
          {atual && (
            <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border border-border px-3 py-2">
              <div className="flex items-center gap-2 min-w-0 col-span-2 sm:col-span-1">
                <span className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><CalendarDays className="size-3.5" /></span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground truncate">{MONTH_FULL[Number(atual.month.slice(5, 7)) - 1]} de {atual.month.slice(0, 4)}</p>
                  <p className="text-[10px] text-muted-foreground truncate">Meta: {fmtMoney(atual.meta)}</p>
                </div>
              </div>
              <div className="min-w-0 sm:border-l sm:border-border sm:pl-3">
                <p className="text-sm font-bold text-foreground tabular-nums">{fmtK(atual.realizado)}</p>
                <p className="text-[10px] text-muted-foreground">Realizado até hoje</p>
              </div>
              <div className="min-w-0 border-l border-border pl-3">
                <p className="text-sm font-bold text-foreground tabular-nums">{atual.projecao != null ? fmtK(atual.projecao) : "—"}</p>
                <p className="text-[10px] text-muted-foreground">Projeção no mês</p>
              </div>
              <div className="min-w-0 border-l border-border pl-3">
                <p className="text-sm font-bold tabular-nums" style={{ color: pctTone(atual.pctShown).text }}>{Math.round(atual.pctShown)}%</p>
                <p className="text-[10px] text-muted-foreground">Projeção da meta</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Indicador com mini-gráfico (coluna ao lado do gráfico) ────────────────────

type TrendDatum = { label: string; value: number | null };

// Variação do valor de hoje contra 7 dias atrás. Nesses indicadores, cair é
// bom (menos pendências, entrega mais rápida) → verde; subir → vermelho.
function trendDelta(data: TrendDatum[]): number | null {
  const first = data.find((d) => d.value != null)?.value ?? null;
  const last = data[data.length - 1]?.value ?? null;
  if (first == null || last == null || first === 0) return null;
  return ((last - first) / first) * 100;
}

function MiniTrend({ data, color, kind, fmt, gradId }: {
  data: TrendDatum[]; color: string; kind: "area" | "bar"; fmt: (v: number) => string; gradId: string;
}) {
  const last = data.length - 1;
  const axis = (
    <XAxis dataKey="label" axisLine={false} tickLine={false} interval={0} height={14}
      tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }} />
  );
  const lastLabel = (props: any) => {
    const { x, y, width, index, cx, cy } = props;
    // Na Area o "value" vem como [base, valor]; o número certo está no dado do ponto.
    const raw = props.payload?.value ?? (Array.isArray(props.value) ? props.value[props.value.length - 1] : props.value);
    const value = raw == null ? null : Number(raw);
    if (index !== last || value == null || !Number.isFinite(value)) return <g key={`l-${index}`} />;
    const px = cx ?? x + (width ?? 0) / 2;
    const py = cy ?? y;
    return <text key={`l-${index}`} x={px} y={py - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill={color}>{fmt(value)}</text>;
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      {kind === "bar" ? (
        <BarChart data={data} margin={{ top: 14, right: 4, left: 4, bottom: 0 }}>
          {axis}
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={color} fillOpacity={i === last ? 1 : 0.3} />)}
            <LabelList dataKey="value" content={lastLabel} />
          </Bar>
        </BarChart>
      ) : (
        <AreaChart data={data} margin={{ top: 14, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {axis}
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.75} fill={`url(#${gradId})`}
            connectNulls isAnimationActive={false}
            dot={(p: any) => p.index === last && p.payload?.value != null
              ? <g key={`d-${p.index}`}><circle cx={p.cx} cy={p.cy} r={3} fill={color} />{lastLabel(p)}</g>
              : <g key={`d-${p.index}`} />} />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}

function OpsTile({ icon: Icon, accent, label, value, hint, loading, onClick, trend, kind = "area", fmt }: {
  icon: typeof TrendingUp; accent: MetricAccent; label: string; value: string | number;
  hint?: string; loading?: boolean; onClick?: () => void;
  trend: TrendDatum[]; kind?: "area" | "bar"; fmt: (v: number) => string;
}) {
  const delta = trendDelta(trend);
  const good = delta != null && delta <= 0;
  return (
    <button
      onClick={onClick}
      className="group bg-card border border-border rounded-2xl p-3 flex items-center gap-3 text-left hover:border-primary/30 transition-colors min-w-0 h-full"
    >
      <div className={`size-10 rounded-xl grid place-items-center shrink-0 ${METRIC_ACCENTS[accent].chip}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 w-[96px] shrink-0">
        {loading
          ? <div className="h-6 w-12 bg-muted animate-pulse rounded" />
          : <p className="text-xl font-bold leading-tight tabular-nums">{value}</p>}
        <p className="text-xs font-medium text-foreground leading-tight truncate">{label}</p>
        {hint && <p className="text-[10px] leading-tight truncate text-destructive font-medium">{hint}</p>}
        {delta != null && !loading && (
          <span className={`inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${good ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}
            title="Comparado a 7 dias atrás">
            {delta > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
            <span className="font-normal text-muted-foreground ml-0.5">7d</span>
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0 h-[68px]">
        {!loading && <MiniTrend data={trend} color={METRIC_ACCENTS[accent].solid} kind={kind} fmt={fmt} gradId={`ops-${label.replace(/\W/g, "")}`} />}
      </div>
      <ChevronRight className="size-4 text-muted-foreground/60 group-hover:text-foreground shrink-0" />
    </button>
  );
}

const fmtDays = (d: number | null) => (d == null ? "—" : `${d.toFixed(1)}d`);

// ─── Dashboard ──────────────────────────────────────────────────────────────────

function Dashboard() {
  const { session } = useAuth();
  const getDashboardOverviewFn = useServerFn(getDashboardOverview);

  const [period, setPeriod] = useState("mes");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const { from, to } = useMemo(() => getPeriodRange(period, customRange), [period, customRange]);
  const nDias = useMemo(() => daysBetween(from, to), [from, to]);

  // "Metas" vem primeiro e já selecionada.
  const [activeTab, setActiveTab] = useState<ChartTabKey>("metas");
  // Metas da empresa (página Metas): meses com realizado (fechados + o atual).
  const goalsHistoryFn = useServerFn(listCompanyGoals);
  const goalsHistory = useQuery({
    queryKey: ["goals-history-overview"],
    queryFn: async (): Promise<GoalsHistory> => {
      const { goals } = await goalsHistoryFn();
      const months = goals.filter((g) => g.realizado != null).map((g) => ({
        month: g.month.slice(0, 7), meta: g.meta, realizado: g.realizado ?? 0, projecao: g.projecao ?? null,
        atingida: g.meta > 0 && (g.realizado ?? 0) >= g.meta, atual: g.status === "em_andamento",
      }));
      return { months, atingidas: months.filter((m) => m.atingida).length, total: months.length };
    },
    enabled: activeTab === "metas",
  });

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ["dashboard-overview", from, to],
    queryFn: () => getDashboardOverviewFn({ data: { from, to } }),
    enabled: !!session,
  });

  // Indicadores de operação ao lado do gráfico — mesmos pedidos e mesma conta
  // da aba Rastreamento (listLogisticsOrders + computeLogisticsKpis), no
  // período selecionado aqui; tarefas pendentes vêm da aba Tarefas.
  const navigate = useNavigate();
  const listLogisticsFn = useServerFn(listLogisticsOrders);
  const listTasksFn = useServerFn(listTasks);
  const opsShopIds: string[] = (data as any)?.shopIds ?? [];
  const opsCardIds: string[] = (data as any)?.cardIds ?? [];
  const { data: logisticsOrders = [], isLoading: logisticsLoading } = useQuery({
    queryKey: ["lg-logistics", "dashboard", opsShopIds.join(","), from, to],
    queryFn: () => listLogisticsFn({ data: { shop_ids: opsShopIds, from, to } }),
    enabled: !!session && opsShopIds.length > 0,
  });
  const { data: allTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasksFn(),
    enabled: !!session,
  });
  const opsKpis = useMemo(() => computeLogisticsKpis(logisticsOrders as any[], Date.now()), [logisticsOrders]);
  const opsTrend = useMemo(() => computeLogisticsTrend(logisticsOrders as any[], Date.now(), isoTodayUS()), [logisticsOrders]);
  const tasksTrend = useMemo(() => opsTrend.map((p, i) => ({
    label: p.label,
    // Tarefas em aberto no fim de cada dia (criada até o dia e ainda não concluída nele);
    // o último ponto é o valor atual.
    value: i === opsTrend.length - 1
      ? allTasks.filter((t) => t.status !== "concluida").length
      : allTasks.filter((t) => t.created_at.slice(0, 10) <= p.date && (!t.completed_at || t.completed_at.slice(0, 10) > p.date)).length,
  })), [opsTrend, allTasks]);
  const openTasks = allTasks.filter((t) => t.status !== "concluida");
  const todayUS = isoTodayUS();
  const overdueTasks = openTasks.filter((t) => t.due_date && t.due_date < todayUS).length;
  const logisticsHref = opsCardIds.length === 1 ? `/shops/lojas-grupos/${opsCardIds[0]}?tab=logistica` : "/shops/lojas-grupos";
  const opsLoading = isLoading || logisticsLoading;
  const totals = (data as any)?.totals ?? {
    faturamento: 0, faturamentoDelta: 0, anuncios: 0, anunciosDelta: 0,
    custoProduto: 0, custoProdutoDelta: 0, lucro: 0, lucroDelta: 0,
    taxaEstorno: 0, taxaEstornoDeltaPP: 0, pedidos: 0, pedidosDelta: 0,
  };
  const chartData: DailyPoint[] = (data as any)?.chartData ?? [];
  const shopBreakdown: ShopBreakdownRow[] = (data as any)?.shopBreakdown ?? [];

  const slices = useMemo(() => buildShopSlices(shopBreakdown), [shopBreakdown]);
  const donutTotal = slices.reduce((s, x) => s + x.faturamento, 0);
  const estornoByShop = useMemo(
    () => [...shopBreakdown].filter((s) => s.totalPedidos > 0).sort(byShopName),
    [shopBreakdown],
  );

  const today = new Date();
  const greeting = (() => {
    const h = Number(today.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: US_TIME_ZONE }));
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  })();
  const firstName = (session?.user?.user_metadata?.full_name ?? session?.user?.email?.split("@")[0] ?? "")
    .toString().split(" ")[0];

  const activeTabCfg = CHART_TABS.find((t) => t.key === activeTab)!;
  const activeColor = METRIC_ACCENTS[activeTabCfg.accent].solid;
  // Parte abaixo de zero (ex.: dia com lucro negativo) em vermelho. Posição do
  // zero dentro da altura da linha (0 = topo, 1 = base); sem valor negativo,
  // cor única — senão a borda do traço vaza da bounding box e pinta de vermelho.
  const negColor = "var(--color-destructive)";
  const zeroOffset = useMemo(() => {
    if (activeTab === "metas") return 1;
    const values = chartData.map((d) => Number(d[activeTab]) || 0);
    const max = Math.max(0, ...values), min = Math.min(0, ...values);
    return max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);
  }, [chartData, activeTab]);
  const posStop = zeroOffset <= 0 ? negColor : activeColor;
  const negStop = zeroOffset >= 1 ? activeColor : negColor;

  return (
    <PageShell>
      {/* ── Cabeçalho ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            {greeting}{firstName && <>, <span className="text-gradient-primary">{firstName}</span></>}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border border-border bg-card text-xs text-muted-foreground">
            <CalendarDays className="size-3.5" /> {fmtDate(from)} → {fmtDate(to)}
          </span>
          <div className="flex items-center gap-1.5">
            {isFetching && <div className="size-3.5 rounded-full border-2 border-border border-t-primary animate-spin" />}
            <DateRangePicker period={period} setPeriod={setPeriod} customRange={customRange} setCustomRange={setCustomRange} />
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
        <DashKpiCard
          icon={TrendingUp} accent="primary" loading={isLoading}
          label="Faturamento total" value={fmtMoney(totals.faturamento)}
          delta={totals.faturamentoDelta} sparklineKey="faturamento" chartData={chartData}
          stats={[
            { label: "Média diária", value: fmtMoney(totals.faturamento / nDias) },
            { label: "Pedidos", value: totals.pedidos.toLocaleString("pt-BR") },
          ]}
        />
        <DashKpiCard
          icon={Megaphone} accent="info" loading={isLoading} invert
          label="Gasto com ads" value={fmtMoney(totals.anuncios)}
          delta={totals.anunciosDelta} sparklineKey="anuncios" chartData={chartData}
          stats={[
            { label: "% do faturamento", value: fmtPct(totals.faturamento > 0 ? totals.anuncios / totals.faturamento : 0) },
            { label: "Média diária", value: fmtMoney(totals.anuncios / nDias) },
          ]}
        />
        <DashKpiCard
          icon={Package} accent="warning" loading={isLoading} invert
          label="Gasto com pedidos" value={fmtMoney(totals.custoProduto)}
          delta={totals.custoProdutoDelta} sparklineKey="custo" chartData={chartData}
          stats={[
            { label: "% do faturamento", value: fmtPct(totals.faturamento > 0 ? totals.custoProduto / totals.faturamento : 0) },
            { label: "Média por pedido", value: fmtMoney(totals.pedidos > 0 ? totals.custoProduto / totals.pedidos : 0) },
          ]}
        />
        <DashKpiCard
          icon={Wallet} accent="success" loading={isLoading}
          label="Lucro" value={fmtMoney(totals.lucro)}
          delta={totals.lucroDelta} sparklineKey="lucro" chartData={chartData}
          stats={[
            { label: "Margem de lucro", value: fmtPct(totals.faturamento > 0 ? totals.lucro / totals.faturamento : 0) },
            { label: "Média diária", value: fmtMoney(totals.lucro / nDias) },
          ]}
        />
        <DashKpiCard
          icon={RotateCcw} accent="destructive" loading={isLoading} invert
          label="Taxa de estorno" value={fmtPct(totals.taxaEstorno)}
          delta={totals.taxaEstornoDeltaPP} deltaUnit=" p.p."
          shopRows={estornoByShop}
          chartData={chartData}
        />
      </div>

      {/* ── Gráfico principal · Composição ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,250px)_minmax(0,290px)] gap-4 items-stretch">
        <div className="bg-card border border-border rounded-2xl p-5 min-w-0 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                <BarChart3 className="size-4.5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight">{activeTab === "metas" ? "Lucro" : activeTabCfg.label}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {CHART_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`text-xs font-medium px-3 h-7 rounded-lg transition-colors ${
                    activeTab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <div className="relative">
                <select disabled value={activeTab === "metas" ? "mensal" : "diario"} className="appearance-none bg-card border border-border text-foreground text-xs rounded-xl px-3 pr-7 h-7 opacity-70">
                  <option value="diario">Diário</option>
                  <option value="mensal">Mensal</option>
                </select>
                <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          {activeTab === "metas" ? (
            <GoalsHistoryChart data={goalsHistory.data} loading={goalsHistory.isLoading} />
          ) : isLoading ? (
            <div className="flex-1 min-h-[240px] bg-muted animate-pulse rounded-xl" />
          ) : (
            <div className="flex-1 min-h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="dash-main-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={`${Math.min(5, zeroOffset * 100)}%`} stopColor={posStop} stopOpacity={0.3} />
                    <stop offset={`${zeroOffset * 100}%`} stopColor={posStop} stopOpacity={0} />
                    <stop offset={`${zeroOffset * 100}%`} stopColor={negStop} stopOpacity={0} />
                    <stop offset={`${Math.max(95, zeroOffset * 100)}%`} stopColor={negStop} stopOpacity={0.3} />
                  </linearGradient>
                  <linearGradient id="dash-main-stroke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={`${zeroOffset * 100}%`} stopColor={posStop} />
                    <stop offset={`${zeroOffset * 100}%`} stopColor={negStop} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip content={<DashTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
                <Area type="monotone" dataKey={activeTab} stroke="url(#dash-main-stroke)" strokeWidth={2} fill="url(#dash-main-grad)" dot={false}
                  activeDot={(p: any) => (
                    <circle key={`ad-${p.index}`} cx={p.cx} cy={p.cy} r={4} stroke="var(--color-card)" strokeWidth={2}
                      fill={Number(p.payload?.[activeTab]) < 0 ? negColor : activeColor} />
                  )} />
              </AreaChart>
            </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Composição do faturamento */}
        <div className="bg-card border border-border rounded-2xl p-5 min-w-0 flex flex-col">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
              <PieChartIcon className="size-4.5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight">Composição do faturamento</p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex-1 min-h-[200px] bg-muted animate-pulse rounded-xl" />
          ) : slices.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">Sem faturamento no período.</p>
          ) : (
            <>
              {/* Donut ocupa o espaço livre do card (a linha é tão alta quanto a coluna de indicadores) */}
              <div className="relative flex-1 min-h-[200px] max-h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={slices} dataKey="faturamento" nameKey="shop_name" innerRadius="64%" outerRadius="94%" paddingAngle={2} strokeWidth={0}>
                      {slices.map((s) => <Cell key={s.shop_id} fill={s.color} />)}
                    </Pie>
                    <Tooltip content={<DonutTooltip total={donutTotal} />} wrapperStyle={{ zIndex: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 grid place-items-center pointer-events-none px-6">
                  <div className="text-center min-w-0">
                    <p className="text-lg font-bold text-foreground truncate tabular-nums">{fmtMoney(donutTotal)}</p>
                    <p className="text-[10px] text-muted-foreground">Total</p>
                    {/* Comparativo com o período anterior de mesmo tamanho ("Este mês" → mês anterior) */}
                    <span className={`inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${
                      totals.faturamentoDelta >= 0 ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"
                    }`}>
                      {totals.faturamentoDelta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                      {totals.faturamentoDelta >= 0 ? "+" : ""}{Number(totals.faturamentoDelta).toFixed(1)}%
                    </span>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{period === "mes" ? "vs mês anterior" : "vs período anterior"}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2.5">
                {slices.map((s) => (
                  <div key={s.shop_id} className="flex items-center gap-2 text-xs">
                    <span className="size-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-foreground truncate flex-1">{s.shop_name}</span>
                    <span className="text-muted-foreground font-medium tabular-nums shrink-0">
                      {donutTotal > 0 ? ((s.faturamento / donutTotal) * 100).toFixed(1) : "0.0"}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Operação: tarefas + indicadores do Rastreamento (com evolução de 7 dias) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5 min-w-0">
          <OpsTile icon={CheckSquare} accent="primary" label="Tarefas pendentes"
            value={openTasks.length} hint={overdueTasks ? `${overdueTasks} atrasada${overdueTasks === 1 ? "" : "s"}` : undefined}
            loading={tasksLoading} onClick={() => navigate({ to: "/tarefas" })}
            trend={tasksTrend} kind="bar" fmt={(v) => String(v)} />
          <OpsTile icon={AlertTriangle} accent="destructive" label="Precisa de atenção"
            value={opsKpis.attention} loading={opsLoading} onClick={() => navigate({ href: logisticsHref })}
            trend={opsTrend.map((p) => ({ label: p.label, value: p.attention }))} fmt={(v) => String(v)} />
          <OpsTile icon={Package} accent="warning" label="Pendente envio"
            value={opsKpis.pending} loading={opsLoading} onClick={() => navigate({ href: logisticsHref })}
            trend={opsTrend.map((p) => ({ label: p.label, value: p.pending }))} kind="bar" fmt={(v) => String(v)} />
          <OpsTile icon={Clock} accent="info" label="TM Postagem"
            value={fmtDays(opsKpis.avgPostingDays)} loading={opsLoading} onClick={() => navigate({ href: logisticsHref })}
            trend={opsTrend.map((p) => ({ label: p.label, value: p.avgPostingDays }))} fmt={(v) => `${v.toFixed(1)}d`} />
          <OpsTile icon={Truck} accent="success" label="TM Entrega"
            value={fmtDays(opsKpis.avgDeliveryDays)} loading={opsLoading} onClick={() => navigate({ href: logisticsHref })}
            trend={opsTrend.map((p) => ({ label: p.label, value: p.avgDeliveryDays }))} fmt={(v) => `${v.toFixed(1)}d`} />
        </div>
      </div>
    </PageShell>
  );
}

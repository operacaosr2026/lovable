import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from "recharts";
import {
  ShoppingCart, TrendingUp, Wallet, BarChart3, DollarSign, Flag, CheckCircle2, AlertTriangle,
  Target, TrendingDown, Minus, StickyNote, Plus, X, Calendar, CalendarCheck, CalendarClock, ChevronRight, Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getLgAccumulatedLucro } from "@/lib/lg-overview.functions";
import {
  getCompanyGoalCurrent, listCompanyGoals, upsertCompanyGoal, deleteCompanyGoal,
} from "@/lib/company-goals.functions";
import { isoTodayUS } from "@/lib/timezone";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isoToday = isoTodayUS;

function formatAxisMoney(v: number) {
  const n = Math.round(v);
  if (Math.abs(n) < 1000) return `$${n}`;
  const k = n / 1000;
  return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function daysBetween(from: string, to: string) {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400_000);
}

function addDaysIso(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDatePt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function ProgressTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const real = payload.find((p: any) => p.dataKey === "lucroAcumulado" && p.value != null);
  const projetado = payload.find((p: any) => p.dataKey === "lucroProjetado" && p.value != null);
  return (
    <div className="rounded-xl bg-card border border-border p-2.5 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1 font-medium">{label}</p>
      {real && <p className="font-semibold text-foreground">{fmtMoney(real.value)} <span className="text-muted-foreground font-normal">(real)</span></p>}
      {projetado && <p className="font-semibold text-primary/70">{fmtMoney(projetado.value)} <span className="text-muted-foreground font-normal">(projeção)</span></p>}
    </div>
  );
}

// Badge (pill) preso ao ponto final da projeção no gráfico
function ProjectionEndLabel(props: any) {
  const vb = props.viewBox;
  // ReferenceDot passa o label com viewBox = {x: cx-r, y: cy-r, width: 2r, height: 2r};
  // o centro real do ponto é x/y + metade da largura/altura da própria caixa, não vb.x/vb.y direto.
  const x = vb ? vb.x + vb.width / 2 : (props.cx ?? props.x);
  const rawY = vb ? vb.y + vb.height / 2 : (props.cy ?? props.y);
  if (x == null || rawY == null || Number.isNaN(x) || Number.isNaN(rawY)) return null;
  // Nunca deixa o selo estourar o topo do gráfico, mesmo quando o ponto fica muito perto da borda superior.
  const y = Math.max(rawY, 34);
  const text = String(props.value);
  const width = text.length * 6.5 + 18;
  return (
    <g>
      <rect x={x - width / 2} y={y - 32} width={width} height={22} rx={11} fill={props.fill} />
      <text x={x} y={y - 17} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{text}</text>
    </g>
  );
}

// Compara o ritmo dos últimos 3 dias com a média geral do período da meta
function tendenciaKind(mediaUltimos3?: number, mediaGeral?: number): "up" | "down" | "flat" | null {
  if (mediaUltimos3 == null || mediaGeral == null || mediaGeral === 0) return null;
  const variacao = (mediaUltimos3 - mediaGeral) / Math.abs(mediaGeral);
  if (variacao > 0.1) return "up";
  if (variacao < -0.1) return "down";
  return "flat";
}

function tendenciaLabel(mediaUltimos3?: number, mediaGeral?: number) {
  const kind = tendenciaKind(mediaUltimos3, mediaGeral);
  if (kind === "up") return "Acelerando";
  if (kind === "down") return "Desacelerando";
  if (kind === "flat") return "Estável";
  return "—";
}

function tendenciaVariacaoPct(mediaUltimos3?: number, mediaGeral?: number) {
  if (mediaUltimos3 == null || mediaGeral == null || mediaGeral === 0) return 0;
  return ((mediaUltimos3 - mediaGeral) / Math.abs(mediaGeral)) * 100;
}

function TendenciaIcon({ mediaUltimos3, mediaGeral }: { mediaUltimos3?: number; mediaGeral?: number }) {
  const kind = tendenciaKind(mediaUltimos3, mediaGeral);
  if (kind === "up") return <TrendingUp className="size-3 text-success" />;
  if (kind === "down") return <TrendingDown className="size-3 text-destructive" />;
  return <Minus className="size-3" />;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

// ─── Sub-tab button ─────────────────────────────────────────────────────────────

function SubTabBtn({
  active, onClick, icon, children,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Stat card (top row do dashboard de Meta) ──────────────────────────────────

const ACCENTS = {
  primary: "bg-primary/10 text-primary",
  blue:    "bg-blue-500/10 text-blue-600",
  success: "bg-success/10 text-success",
} as const;

const ACCENT_CARD = {
  primary: "border-primary/15 bg-primary/[0.04]",
  blue:    "border-blue-500/15 bg-blue-500/[0.04]",
  success: "border-success/15 bg-success/[0.04]",
} as const;

const ACCENT_TEXT = {
  primary: "text-primary",
  blue:    "text-blue-600",
  success: "text-success",
} as const;

const ACCENT_PILL = {
  primary: "bg-primary/10",
  blue:    "bg-blue-500/10",
  success: "bg-success/10",
} as const;

const ACCENT_SOLID = {
  primary: "bg-primary",
  blue:    "bg-blue-600",
  success: "bg-success",
} as const;

function StatCard({
  icon, accent, label, value, sub, trendIcon, footer, footerIcon, loading,
}: {
  icon: React.ReactNode; accent: keyof typeof ACCENTS; label: string; value: string; sub?: string;
  trendIcon?: React.ReactNode; footer?: React.ReactNode; footerIcon?: React.ReactNode; loading?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-3xl border p-5 flex flex-col gap-3", ACCENT_CARD[accent])}>
      <div className={cn("pointer-events-none absolute -right-8 -bottom-10 size-32 rounded-full blur-2xl opacity-30", ACCENT_SOLID[accent])} />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn("size-9 rounded-2xl grid place-items-center shrink-0", ACCENTS[accent])}>
            {icon}
          </div>
          <span className="text-xs font-bold text-foreground">{label}</span>
        </div>
        {trendIcon && (
          <div className={cn("size-7 rounded-xl grid place-items-center shrink-0", ACCENTS[accent])}>
            {trendIcon}
          </div>
        )}
      </div>
      <div className="relative">
        {loading
          ? <Skeleton className="h-10 w-28" />
          : <p className={cn("text-4xl font-extrabold leading-none", ACCENT_TEXT[accent])}>{value}</p>
        }
        {sub && <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>}
      </div>
      {footer && (
        <div className={cn("relative flex items-center gap-2 rounded-xl px-2.5 py-2", ACCENT_PILL[accent])}>
          {footerIcon && (
            <span className={cn("size-5 rounded-full grid place-items-center text-white shrink-0", ACCENT_SOLID[accent])}>
              {footerIcon}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{footer}</span>
        </div>
      )}
    </div>
  );
}

// ─── Summary row (card "Resumo da meta") ───────────────────────────────────────

function SummaryRow({
  icon, iconCls, label, value, valueClass = "text-foreground",
}: {
  icon: React.ReactNode; iconCls: string; label: string; value: string; valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className={cn("size-7 rounded-lg grid place-items-center shrink-0", iconCls)}>
          {icon}
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={cn("text-sm font-bold", valueClass)}>{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function fmtMonthPt(monthStart: string) {
  const name = MONTHS_PT[Number(monthStart.slice(5, 7)) - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${monthStart.slice(0, 4)}`;
}
function addMonths(monthStart: string, n: number) {
  const d = new Date(`${monthStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

type PlanGoal = { month: string; meta: number; lucro_por_venda: number | null; realizado: number | null; status: string };

const fmtUsdInt = (n: number) => `US$ ${Math.round(n).toLocaleString("pt-BR")}`;
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const fmtMonthShort = (m: string) => `${MONTHS_SHORT[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
// Campo de meta no formato 10.000 (só inteiros).
const fmtMetaInput = (digits: string) => (digits ? Number(digits).toLocaleString("pt-BR") : "");
const onlyDigits = (v: string) => v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

function PlanStat({ icon: Icon, tone, label, value, sub, children }: {
  icon: any; tone: "violet" | "green" | "blue" | "amber"; label: string; value: string; sub?: string; children?: React.ReactNode;
}) {
  const tones = {
    violet: { card: "bg-violet-500/[0.06] border-violet-500/15", tile: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
    green:  { card: "bg-emerald-500/[0.06] border-emerald-500/15", tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    blue:   { card: "bg-blue-500/[0.06] border-blue-500/15", tile: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
    amber:  { card: "bg-amber-500/[0.07] border-amber-500/20", tile: "bg-amber-500/20 text-amber-600 dark:text-amber-400" },
  }[tone];
  return (
    <div className={cn("rounded-2xl border p-4 flex items-start gap-3", tones.card)}>
      <div className={cn("size-11 rounded-xl grid place-items-center shrink-0", tones.tile)}><Icon className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tracking-tight leading-tight text-foreground">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

// ─── Planejamento: meta deste mês e dos próximos (12 + os adicionados) ──────────
function GoalPlanning({ goals, loading, onSaved }: { goals: PlanGoal[]; loading: boolean; onSaved: () => Promise<void> }) {
  const current = `${isoToday().slice(0, 7)}-01`;
  const [extraMonths, setExtraMonths] = useState(0);
  const byMonth = new Map(goals.map((g) => [g.month, g]));
  const lastSaved = goals.reduce((max, g) => (g.month > max ? g.month : max), current);
  const baseCount = 12 + extraMonths;
  const count = Math.max(baseCount, (() => {
    // Metas já salvas além da janela também aparecem.
    let n = 0; while (addMonths(current, n) <= lastSaved) n++; return n;
  })());
  const months = Array.from({ length: count }, (_, i) => addMonths(current, i));
  // Sugestão pra mês vazio: a última meta definida.
  const last = [...goals].filter((g) => g.month <= current).pop() ?? goals[0];

  const planned = months.filter((m) => byMonth.has(m));
  const totalMeta = planned.reduce((sum, m) => sum + (byMonth.get(m)?.meta ?? 0), 0);
  const currentGoal = byMonth.get(current);

  if (loading) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <PlanStat icon={BarChart3} tone="violet" label="Total de metas" value={`${months.length} meses`}
          sub={`${fmtMonthShort(months[0])} → ${fmtMonthShort(months[months.length - 1])}`} />
        <PlanStat icon={Target} tone="green" label="Meta total do período" value={fmtUsdInt(totalMeta)}
          sub={planned.length ? `${fmtUsdInt(totalMeta / planned.length)}/mês em média` : "Nenhum mês planejado"} />
        <PlanStat icon={TrendingUp} tone="blue" label="Mês atual" value={currentGoal ? fmtUsdInt(currentGoal.meta) : "—"}
          sub={fmtMonthPt(current)} />
        <PlanStat icon={Trophy} tone="amber" label="Meses planejados" value={`${planned.length} / ${months.length}`}>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden flex-1">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${(planned.length / months.length) * 100}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground">{Math.round((planned.length / months.length) * 100)}%</span>
          </div>
        </PlanStat>
      </div>

      <div className="bg-card border border-border rounded-3xl p-5">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
          <div>
            <p className="text-base font-bold text-foreground">Metas dos próximos meses</p>
            <p className="text-xs text-muted-foreground">Lucro de todas as lojas dos grupos ativos. Meses já fechados ficam no Histórico.</p>
          </div>
          <button
            onClick={() => setExtraMonths((n) => n + 1)}
            className="h-10 px-4 rounded-xl bg-primary/80 text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary transition-colors"
          >
            <Plus className="size-4" /> Adicionar mês
          </button>
        </div>
        <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_152px] gap-4 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Mês</span><span>Meta de lucro (USD)</span><span>Progresso</span><span className="text-center">Ações</span>
        </div>
        <div className="space-y-2">
          {months.map((m) => (
            <PlanRow key={m} month={m} isCurrent={m === current} goal={byMonth.get(m)} suggestion={last} onSaved={onSaved} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanRow({ month, isCurrent, goal, suggestion, onSaved }: {
  month: string; isCurrent: boolean; goal?: PlanGoal; suggestion?: PlanGoal; onSaved: () => Promise<void>;
}) {
  const upsertFn = useServerFn(upsertCompanyGoal);
  const deleteFn = useServerFn(deleteCompanyGoal);
  const saved = goal ? String(Math.round(goal.meta)) : "";
  const [meta, setMeta] = useState(saved);
  const [saving, setSaving] = useState(false);
  const dirty = meta !== saved;

  async function save() {
    const metaN = Number(meta);
    if (!metaN || metaN <= 0) { toast.error("Informe um valor de meta válido"); return; }
    setSaving(true);
    try {
      await upsertFn({ data: { month: month.slice(0, 7), meta: metaN } });
      await onSaved();
      toast.success(`Meta de ${fmtMonthPt(month)} salva`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar meta");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm(`Remover a meta de ${fmtMonthPt(month)}?`)) return;
    setSaving(true);
    try {
      await deleteFn({ data: { month: month.slice(0, 7) } });
      setMeta("");
      await onSaved();
      toast.success("Meta removida");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao remover meta");
    } finally { setSaving(false); }
  }

  // Progresso: realizado do mês (só o atual tem; meses futuros começam em 0).
  const alvo = goal?.meta ?? (Number(meta) || 0);
  const realizado = goal?.realizado ?? 0;
  const pctProg = alvo > 0 ? Math.max(0, Math.min(100, (realizado / alvo) * 100)) : 0;

  return (
    <div className={cn(
      "grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_152px] items-center gap-3 md:gap-4 rounded-xl border p-3",
      isCurrent ? "border-primary/40 bg-primary/5" : "border-border",
    )}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn("size-9 rounded-lg grid place-items-center shrink-0", isCurrent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
          <Calendar className="size-4" />
        </div>
        <span className="text-sm font-semibold text-foreground truncate">{fmtMonthPt(month)}</span>
        {isCurrent && <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-primary/10 text-primary shrink-0">Mês atual</span>}
      </div>
      <div className="relative">
        <input
          type="text" inputMode="numeric" value={fmtMetaInput(meta)}
          onChange={(e) => setMeta(onlyDigits(e.target.value))}
          onKeyDown={(e) => { if (e.key === "Enter" && dirty) save(); }}
          placeholder={suggestion ? fmtMetaInput(String(Math.round(suggestion.meta))) : "10.000"}
          aria-label={`Meta de ${fmtMonthPt(month)}`}
          className="h-10 w-full rounded-lg border border-border bg-background pl-3 pr-12 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">USD</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <div className="h-2 rounded-full bg-muted overflow-hidden flex-1">
            <div className={cn("h-full rounded-full", pctProg >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${pctProg}%` }} />
          </div>
          <span className="text-xs font-semibold text-foreground w-10 text-right tabular-nums">{Math.round(pctProg)}%</span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
          <span className="font-semibold text-foreground">{fmtUsdInt(realizado)}</span> de {fmtUsdInt(alvo)}
        </p>
      </div>
      <div className="flex items-center justify-end md:justify-center gap-2">
        {goal && (
          <button onClick={remove} disabled={saving} title="Remover meta"
            className="size-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-destructive hover:border-destructive/40 grid place-items-center transition-colors disabled:opacity-50">
            <X className="size-3.5" />
          </button>
        )}
        <button onClick={save} disabled={saving || !dirty}
          className={cn(
            "h-9 px-4 rounded-lg text-sm font-medium transition-colors disabled:cursor-default",
            goal ? "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                 : "bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-60",
          )}>
          {saving ? "Salvando..." : goal ? "Salvar" : "Definir"}
        </button>
      </div>
    </div>
  );
}

// Página "Metas" (menu lateral): meta da empresa por mês, medindo o lucro das
// lojas dos grupos ativos (company-goals.server.ts). Atual = mês corrente,
// Histórico = meses anteriores (realizado congelado), Planejamento = definir
// as metas deste mês e dos próximos.
export function CompanyGoals() {
  const queryClient = useQueryClient();

  const getAccFn     = useServerFn(getLgAccumulatedLucro);
  const getCurrentFn = useServerFn(getCompanyGoalCurrent);
  const listGoalsFn  = useServerFn(listCompanyGoals);

  const [subTab, setSubTab] = useState<"atual" | "historico" | "planejamento">("atual");

  // ── Meta do mês atual + lojas que contam nela ──────────────────────────────
  const { data: current, isLoading: loadingGoal } = useQuery({
    queryKey: ["company-goal-current"],
    queryFn: () => getCurrentFn(),
  });
  const shopIds = current?.shopIds ?? [];
  const hasShops = shopIds.length > 0;
  // Mesmo formato da meta antiga (início/fim = mês fechado), pro resto da tela não mudar.
  const savedGoal: any = current?.goal
    ? { ...current.goal, start_date: current.monthStart, prazo: current.monthEnd }
    : null;

  // ── Lucro acumulado do mês (mesma conta da aba Metas antiga) ─────────────────
  const { data: accData, isLoading: loadingAcc } = useQuery({
    queryKey: ["lg-acc-lucro", shopIds.join(","), savedGoal?.start_date],
    queryFn: () => getAccFn({ data: { shop_ids: shopIds, start_date: savedGoal.start_date } }),
    enabled: hasShops && !!savedGoal,
    staleTime: 3 * 60_000,
  });

  // ── Todas as metas (histórico e planejamento) ──────────────────────────────
  const { data: goalsData, isLoading: loadingHistory } = useQuery({
    queryKey: ["company-goals"],
    queryFn: () => listGoalsFn(),
    enabled: subTab !== "atual",
  });
  const allGoals = goalsData?.goals ?? [];

  async function refreshGoalQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["company-goal-current"] }),
      queryClient.invalidateQueries({ queryKey: ["company-goals"] }),
      queryClient.invalidateQueries({ queryKey: ["lg-acc-lucro"] }),
      queryClient.invalidateQueries({ queryKey: ["goals-history-overview"] }),
    ]);
  }

  // ── Derived meta calculations ─────────────────────────────────────────────
  // Vendas/dia = (falta pra meta ÷ dias restantes) ÷ lucro previsto por venda,
  // definido junto com a meta (em vez de derivado de dados históricos).
  const derived = useMemo(() => {
    if (!savedGoal || !accData) return null;

    const meta = Number(savedGoal.meta ?? 0);
    const lucroAcumulado = accData.lucro ?? 0;
    const lucroRestante = meta - lucroAcumulado;
    const percentAtingida = meta > 0 ? (lucroAcumulado / meta) * 100 : 0;
    const batida = lucroAcumulado >= meta;

    const today = isoToday();
    const diasRestantes = Math.max(0, daysBetween(today, savedGoal.prazo));
    const vencida = daysBetween(today, savedGoal.prazo) <= 0 && !batida;

    const projecaoFinal = lucroAcumulado + (accData.mediaUltimos3 ?? 0) * diasRestantes;
    const percentProjecao = meta > 0 ? (projecaoFinal / meta) * 100 : 0;
    const lucroNecessarioPorDia = diasRestantes > 0 ? lucroRestante / diasRestantes : 0;

    // Lucro médio por venda real do mês (lucro acumulado ÷ pedidos) — não é
    // mais preenchido no planejamento.
    const lucroPorVenda = (accData.pedidos ?? 0) > 0 ? lucroAcumulado / accData.pedidos : 0;
    const semLucroPorVenda = lucroPorVenda <= 0;

    let vendasPorDia = 0;
    if (!semLucroPorVenda && diasRestantes > 0) {
      vendasPorDia = Math.round(lucroNecessarioPorDia / lucroPorVenda);
    }

    // Depois de batida a meta, os cards passam a mostrar o ritmo real do
    // período (em vez de "quanto falta"), pra acompanhar quanto vai passar dela.
    const diasComDados = Math.max(1, (accData.chartData ?? []).length);
    const vendasMediaReal = (accData.pedidos ?? 0) / diasComDados;
    const lucroMedioReal = lucroAcumulado / diasComDados;

    return {
      lucroAcumulado,
      vendasPorDia,
      vendasMediaReal,
      lucroMedioReal,
      lucroNecessarioPorDia,
      projecaoFinal,
      percentProjecao,
      percentAtingida,
      diasRestantes,
      meta,
      batida,
      vencida,
      semLucroPorVenda,
    };
  }, [savedGoal, accData]);

  // ── Gráfico: dados reais + projeção futura até o prazo ────────────────────
  const d: any = derived;

  const chartData = useMemo(() => {
    const real = (accData?.chartData ?? []) as { date: string; lucroAcumulado: number }[];
    if (!real.length || !d || !savedGoal) return real.map((p) => ({ ...p, lucroProjetado: null }));

    const points = real.map((p) => ({ ...p, lucroProjetado: null as number | null }));
    const lastValue = real[real.length - 1].lucroAcumulado;
    // ponte: repete o último valor real como início da linha projetada, pra elas se conectarem
    points[points.length - 1] = { ...points[points.length - 1], lucroProjetado: lastValue };

    if (!d.vencida && d.diasRestantes > 0) {
      const mediaDia = accData?.mediaUltimos3 ?? 0;
      let cum = lastValue;
      let cur = isoToday();
      for (let i = 1; i <= d.diasRestantes; i++) {
        cur = addDaysIso(cur, 1);
        cum += mediaDia;
        points.push({
          date: `${cur.slice(8, 10)}/${cur.slice(5, 7)}`,
          lucroAcumulado: null as any,
          lucroProjetado: Math.round(cum * 100) / 100,
        });
      }
    }
    return points;
  }, [accData, d, savedGoal]);

  return (
    <div className="space-y-4">
      {!loadingGoal && !hasShops ? (
        <p className="text-xs text-muted-foreground">Nenhum grupo ativo com lojas — a meta da empresa soma o lucro das lojas dos grupos ativos.</p>
      ) : (
        <>
          {/* ── Subabas ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between flex-wrap gap-3 border-b border-border">
            <div className="flex items-center gap-1">
              <SubTabBtn active={subTab === "atual"} onClick={() => setSubTab("atual")} icon={<Target className="size-3.5" />}>
                Atual
              </SubTabBtn>
              <SubTabBtn active={subTab === "historico"} onClick={() => setSubTab("historico")} icon={<TrendingUp className="size-3.5" />}>
                Histórico
              </SubTabBtn>
              <SubTabBtn active={subTab === "planejamento"} onClick={() => setSubTab("planejamento")} icon={<CalendarClock className="size-3.5" />}>
                Planejamento
              </SubTabBtn>
            </div>
          </div>

          {/* ── Histórico: detalhes (leitura) da meta ativa + metas anteriores */}
          {subTab === "historico" && (
            <>
            {/* Meta ativa */}
            <div className="bg-card border border-border rounded-3xl p-5 flex flex-col gap-4">
              {loadingGoal ? (
                <Skeleton className="h-24 w-full rounded-xl" />
              ) : !savedGoal ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma meta para este mês. Defina na aba Planejamento.
                </p>
              ) : (() => {
                const diasDecorridos = Math.max(0, daysBetween(savedGoal.start_date, isoToday()));
                const diasRestantes = Math.max(0, daysBetween(isoToday(), savedGoal.prazo));
                const totalDias = Math.max(1, daysBetween(savedGoal.start_date, savedGoal.prazo));
                const pctTempo = Math.min(100, (diasDecorridos / totalDias) * 100);
                return (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                          <Target className="size-4" />
                        </div>
                        <span className="text-sm font-bold text-foreground">Meta do mês</span>
                        <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-primary/10 text-primary">Em andamento</span>
                      </div>
                    </div>

                    <div className="border-t border-border" />

                    <div className="flex items-center gap-6 flex-wrap">
                      <div className="flex-1 flex items-center justify-center text-center">
                        <div>
                          <p className="text-4xl font-extrabold text-foreground leading-none">{fmtMoney(Number(savedGoal.meta))}</p>
                          <p className="text-sm text-muted-foreground mt-1.5">meta de lucro ativa</p>
                        </div>
                      </div>
                      <div className="w-px h-10 bg-border hidden sm:block" />
                      <div className="flex-1 flex items-center justify-center gap-3">
                        <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                          <Calendar className="size-4" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Período da meta</p>
                          <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                            {fmtDatePt(savedGoal.start_date)} <span className="text-muted-foreground font-normal">→</span> {fmtDatePt(savedGoal.prazo)}
                          </p>
                          <div className="flex items-center gap-8 mt-0.5 text-[10px] text-muted-foreground">
                            <span>Início</span><span>Fim</span>
                          </div>
                        </div>
                      </div>
                      <div className="w-px h-10 bg-border hidden sm:block" />
                      <div className="flex-1 flex items-center justify-center gap-3">
                        <div className="size-10 rounded-xl bg-success/10 text-success grid place-items-center shrink-0">
                          <CalendarClock className="size-4" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Progresso</p>
                          <div className="flex items-center gap-4">
                            <div>
                              <p className="text-sm font-bold text-success">{diasDecorridos}</p>
                              <p className="text-[10px] text-muted-foreground whitespace-nowrap">{diasDecorridos === 1 ? "Dia decorrido" : "Dias decorridos"}</p>
                            </div>
                            <div className="w-px h-8 bg-border" />
                            <div>
                              <p className="text-sm font-bold text-foreground">{diasRestantes}</p>
                              <p className="text-[10px] text-muted-foreground whitespace-nowrap">Dias restantes</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-primary shrink-0">{pctTempo.toFixed(1)}%</span>
                        <div className="h-2 rounded-full bg-muted overflow-hidden flex-1">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pctTempo}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">{diasDecorridos} de {totalDias} dias</span>
                      </div>
                      {d && (
                        <div className="flex items-center gap-3">
                          <span className={cn("text-sm font-bold shrink-0", d.percentAtingida >= 100 ? "text-success" : "text-primary")}>
                            {Math.max(0, d.percentAtingida).toFixed(1)}%
                          </span>
                          <div className="h-2 rounded-full bg-muted overflow-hidden flex-1">
                            <div
                              className={cn("h-full rounded-full", d.percentAtingida >= 100 ? "bg-success" : "bg-primary")}
                              style={{ width: `${Math.min(100, Math.max(0, d.percentAtingida))}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">{fmtMoney(d.lucroAcumulado)} de {fmtMoney(d.meta)}</span>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Metas anteriores */}
            <div className="bg-card border border-border rounded-3xl p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Metas por mês</p>
              {loadingHistory ? (
                <div className="space-y-2">
                  {[0, 1].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
                </div>
              ) : !allGoals.some((g) => g.realizado != null) ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma meta registrada ainda.</p>
              ) : (
                <div className="space-y-2">
                  {[...allGoals].filter((g) => g.realizado != null).reverse().map((g) => (
                    <div key={g.month} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3.5">
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                          <TrendingUp className="size-4" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">{fmtMoney(g.meta)}</p>
                          <p className="text-xs text-muted-foreground">{fmtMonthPt(g.month)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold text-foreground">{fmtMoney(g.realizado ?? 0)}</p>
                          <span className={cn(
                            "text-[10px] font-semibold rounded-full px-2 py-0.5",
                            g.status === "em_andamento" ? "bg-primary/10 text-primary"
                            : g.status === "batida" ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive"
                          )}>
                            {g.status === "em_andamento" ? "Em andamento" : g.status === "batida" ? "Batida" : "Não batida"}
                          </span>
                        </div>
                        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
          )}

          {/* ── Definir Meta: dashboard rico da meta ativa ──────────────────── */}
          {subTab === "atual" && (
            <>
            {loadingGoal ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[150px] rounded-2xl" />)}
              </div>
            ) : !savedGoal ? (
              <div className="bg-card border border-border rounded-2xl p-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Nenhuma meta para este mês.</p>
                <button
                  onClick={() => setSubTab("planejamento")}
                  className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Definir no Planejamento
                </button>
              </div>
            ) : loadingAcc && !accData ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-[150px] rounded-2xl" />)}
              </div>
            ) : d && (
              <>
                {/* Top row: 3 cards na mesma linha */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Progresso da meta */}
                  {(() => {
                    const clampedPercent = Math.min(100, Math.max(0, d.percentAtingida));
                    // O número continua contando depois de 100% (quanto passou da meta);
                    // só a barra/marcador ficam limitados ao tamanho da barra.
                    const shownPercent = Math.max(0, d.percentAtingida);
                    const stateColor: "success" | "destructive" | "primary" = d.batida ? "success" : d.vencida ? "destructive" : "primary";
                    const textCls = stateColor === "success" ? "text-success" : stateColor === "destructive" ? "text-destructive" : "text-primary";
                    const bgSoftCls = stateColor === "success" ? "bg-success/10" : stateColor === "destructive" ? "bg-destructive/10" : "bg-primary/10";
                    const bgSolidCls = stateColor === "success" ? "bg-success" : stateColor === "destructive" ? "bg-destructive" : "bg-primary";
                    const badgeIcon = d.batida ? <CheckCircle2 className="size-3.5" /> : d.vencida ? <AlertTriangle className="size-3.5" /> : <TrendingUp className="size-3.5" />;
                    const badgeLabel = d.batida ? "Batida!" : d.vencida ? "Vencida" : "Em andamento";

                    return (
                      <div className={cn("rounded-3xl border bg-card p-4 flex flex-col gap-2.5", stateColor === "success" ? "border-success/15" : stateColor === "destructive" ? "border-destructive/15" : "border-primary/15")}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className={cn("size-7 rounded-xl grid place-items-center shrink-0", bgSoftCls, textCls)}>
                              <Target className="size-3.5" />
                            </div>
                            <span className="text-[10px] font-bold text-foreground uppercase tracking-wide">Progresso da meta</span>
                          </div>
                          <span className={cn("flex items-center gap-1 rounded-full text-[11px] font-semibold px-2 py-0.5 shrink-0", bgSoftCls, textCls)}>
                            {badgeIcon}
                            {badgeLabel}
                          </span>
                        </div>

                        <div>
                          <p className={cn("text-3xl font-extrabold leading-none", textCls)}>
                            {shownPercent.toFixed(1)}%
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">da meta atingida</p>
                        </div>

                        <div className="relative pt-4">
                          <div
                            className={cn("absolute top-0 -translate-x-1/2 rounded-full text-white text-[10px] font-bold px-2 py-0.5 whitespace-nowrap", bgSolidCls)}
                            style={{ left: `${clampedPercent}%` }}
                          >
                            {shownPercent.toFixed(1)}%
                            <span className={cn("absolute left-1/2 -bottom-1 -translate-x-1/2 size-1.5 rotate-45", bgSolidCls)} />
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all", bgSolidCls)}
                              style={{ width: `${clampedPercent}%` }}
                            />
                          </div>
                        </div>

                        <div className="border-t border-border" />

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className={cn("size-7 rounded-lg grid place-items-center shrink-0", bgSoftCls, textCls)}>
                              <Wallet className="size-3" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-foreground">{fmtMoney(d.lucroAcumulado)}</p>
                              <p className="text-[10px] text-muted-foreground">Lucro acumulado</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className={cn("size-7 rounded-lg grid place-items-center shrink-0", bgSoftCls, textCls)}>
                              <Flag className="size-3" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-foreground">{fmtMoney(d.meta)}</p>
                              <p className="text-[10px] text-muted-foreground">Meta definida</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <StatCard
                    icon={<ShoppingCart className="size-5" />}
                    accent="primary"
                    label="Vendas por dia"
                    value={d.batida ? d.vendasMediaReal.toFixed(1).replace(".", ",") : d.vencida ? "—" : String(d.vendasPorDia)}
                    sub={d.batida ? "Média real no período" : d.semLucroPorVenda && !d.vencida ? "Sem vendas no mês ainda" : "Média diária"}
                    trendIcon={<TrendingUp className="size-4" />}
                    footerIcon={<BarChart3 className="size-3.5" />}
                    footer={<><span className="font-bold text-primary">{accData?.pedidosOntem ?? 0}</span> vendas ontem</>}
                  />
                  <StatCard
                    icon={<Wallet className="size-5" />}
                    accent="success"
                    label={d.batida ? "Lucro médio/dia" : "Lucro necessário/dia"}
                    value={d.batida ? fmtMoney(d.lucroMedioReal) : d.vencida ? "—" : fmtMoney(d.lucroNecessarioPorDia)}
                    sub={d.batida ? "Meta batida — média no período" : "Para bater a meta"}
                    trendIcon={<Target className="size-4" />}
                    footerIcon={<DollarSign className="size-3.5" />}
                    footer={<><span className="font-bold text-success">{fmtMoney(accData?.lucroOntem ?? 0)}</span> ontem</>}
                  />
                </div>

                {/* Chart + coluna lateral */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                  {/* Projeção de lucro acumulado */}
                  {(() => {
                    const acimaDaMeta = d.projecaoFinal >= d.meta;
                    const projColor = acimaDaMeta ? "var(--color-success)" : "var(--color-destructive)";
                    return (
                      <div className="bg-card border border-border rounded-2xl p-5">
                        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                          <div className="flex items-center gap-3">
                            <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                              <BarChart3 className="size-4" />
                            </div>
                            <span className="text-sm font-bold text-foreground">Projeção de lucro acumulado</span>
                          </div>
                          {chartData.length > 0 && (
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block" style={{ background: "#6b7280" }} /> Real</span>
                              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block" style={{ borderTop: `1px dashed ${projColor}` }} /> Projeção</span>
                              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-success inline-block" style={{ borderTop: "1px dashed var(--color-success)" }} /> Meta</span>
                            </div>
                          )}
                        </div>
                        {chartData.length > 0 ? (
                          <>
                            <div className="group relative">
                              <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={chartData} margin={{ top: 44, right: 46, left: -8, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="lg-goal-progress-grad" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%"  stopColor="var(--color-primary)" stopOpacity={0.25} />
                                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="lg-projection-grad" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%"  stopColor={projColor} stopOpacity={0.3} />
                                      <stop offset="95%" stopColor={projColor} stopOpacity={0} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                  <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                                  <YAxis
                                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false}
                                    tickFormatter={v => formatAxisMoney(v)}
                                    domain={[(min: number) => Math.min(0, min), (max: number) => Math.ceil(Math.max(max, d.meta, d.projecaoFinal) / 500) * 500]}
                                    width={48}
                                  />
                                  <Tooltip content={<ProgressTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
                                  <ReferenceLine y={d.meta} stroke="var(--color-success)" strokeDasharray="4 4"
                                    label={{ value: "Meta", position: "insideTopRight", fill: "var(--color-success)", fontSize: 10 }} />
                                  <Area type="monotone" dataKey="lucroAcumulado" stroke="#6b7280" strokeWidth={2}
                                    fill="url(#lg-goal-progress-grad)" dot={{ r: 3, fill: "#6b7280" }} activeDot={{ r: 4, fill: "#6b7280" }} connectNulls={false} />
                                  <Area type="linear" dataKey="lucroProjetado" stroke={projColor} strokeWidth={2} strokeDasharray="6 4"
                                    fill="url(#lg-projection-grad)" dot={false} activeDot={{ r: 4, fill: projColor }} connectNulls={true} />
                                  {chartData[chartData.length - 1]?.lucroProjetado != null && (
                                    <ReferenceDot
                                      x={chartData[chartData.length - 1].date}
                                      y={chartData[chartData.length - 1].lucroProjetado as number}
                                      r={4}
                                      fill={projColor}
                                      stroke="var(--color-card)"
                                      strokeWidth={2}
                                      label={<ProjectionEndLabel value={fmtMoney(chartData[chartData.length - 1].lucroProjetado as number)} fill={projColor} />}
                                    />
                                  )}
                                </AreaChart>
                              </ResponsiveContainer>
                              {!d.vencida && !d.batida && (
                                <div className={cn(
                                  "pointer-events-none absolute top-2 right-2 max-w-[210px] rounded-xl border p-3 shadow-sm text-xs opacity-0 transition-opacity group-hover:opacity-100",
                                  acimaDaMeta ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"
                                )}>
                                  <p className={cn("flex items-center gap-1 font-bold mb-1", acimaDaMeta ? "text-success" : "text-destructive")}>
                                    {acimaDaMeta ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                                    {acimaDaMeta ? "Acima da meta" : "Abaixo da meta"}
                                  </p>
                                  <p className="text-muted-foreground leading-snug">
                                    {acimaDaMeta ? (
                                      <>Vai superar a meta em{" "}
                                        <span className="font-semibold text-foreground">{fmtMoney(d.projecaoFinal - d.meta)}</span>{" "}
                                        ({(d.percentProjecao - 100).toFixed(1)}%)</>
                                    ) : (
                                      <>Faltam{" "}
                                        <span className="font-semibold text-foreground">{fmtMoney(d.meta - d.projecaoFinal)}</span>{" "}
                                        ({(100 - d.percentProjecao).toFixed(1)}%) para alcançar a meta</>
                                    )}
                                  </p>
                                </div>
                              )}
                            </div>
                            {!d.vencida && !d.batida && (
                              <div className={cn(
                                "mt-3 rounded-xl border px-3 py-2.5 flex items-center gap-2.5 text-xs",
                                acimaDaMeta ? "border-success/20 bg-success/5" : "border-destructive/20 bg-destructive/5"
                              )}>
                                <div className={cn("size-7 rounded-full grid place-items-center shrink-0", acimaDaMeta ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                                  <Target className="size-3.5" />
                                </div>
                                <span className="text-muted-foreground">
                                  Se mantiver a média dos últimos 3 dias, a projeção é de{" "}
                                  <span className={cn("font-semibold", acimaDaMeta ? "text-success" : "text-destructive")}>{fmtMoney(d.projecaoFinal)}</span>{" "}
                                  ({d.percentProjecao.toFixed(1)}% da meta)
                                </span>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground py-16 text-center">Ainda não há dados para o gráfico.</p>
                        )}
                      </div>
                    );
                  })()}

                  <div className="flex flex-col gap-4 h-full">
                    {/* Tendência */}
                    <div className="bg-card border border-border rounded-2xl p-4 flex-1 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tendência (últimos 3 dias)</p>
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "size-10 rounded-full grid place-items-center shrink-0",
                              tendenciaKind(accData?.mediaUltimos3, accData?.mediaGeral) === "up" ? "bg-success/10"
                              : tendenciaKind(accData?.mediaUltimos3, accData?.mediaGeral) === "down" ? "bg-destructive/10"
                              : "bg-muted"
                            )}>
                              <TendenciaIcon mediaUltimos3={accData?.mediaUltimos3} mediaGeral={accData?.mediaGeral} />
                            </div>
                            <p className="text-lg font-bold text-foreground">{tendenciaLabel(accData?.mediaUltimos3, accData?.mediaGeral)}</p>
                          </div>
                        </div>
                        {(accData?.chartData?.length ?? 0) > 1 && (
                          <div className="w-16 h-9 shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={accData!.chartData.slice(-7)} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="lg-spark-grad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <Area type="monotone" dataKey="lucroAcumulado" stroke="var(--color-primary)" strokeWidth={1.5}
                                  fill="url(#lg-spark-grad)" dot={false} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        Sua média dos últimos 3 dias está{" "}
                        <span className="font-semibold text-foreground">
                          {Math.abs(tendenciaVariacaoPct(accData?.mediaUltimos3, accData?.mediaGeral)).toFixed(1)}%
                        </span>{" "}
                        {tendenciaVariacaoPct(accData?.mediaUltimos3, accData?.mediaGeral) >= 0 ? "acima" : "abaixo"} da média geral.
                      </p>
                    </div>

                    {/* Resumo da meta */}
                    <div className="bg-card border border-border rounded-2xl p-4 flex-1 flex flex-col">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                          <Target className="size-3.5" />
                        </div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Resumo da meta</p>
                      </div>
                      <div className="flex flex-col flex-1">
                        <SummaryRow icon={<Calendar className="size-3.5" />} iconCls="bg-blue-500/10 text-blue-600"
                          label="Dias decorridos" value={`${daysBetween(savedGoal.start_date, isoToday())} / ${daysBetween(savedGoal.start_date, savedGoal.prazo)}`} />
                        <SummaryRow icon={<CalendarCheck className="size-3.5" />} iconCls="bg-success/10 text-success"
                          label="Dias restantes" value={String(Math.max(0, daysBetween(isoToday(), savedGoal.prazo)))} />
                        <SummaryRow icon={<Wallet className="size-3.5" />} iconCls="bg-primary/10 text-primary"
                          label="Lucro acumulado" value={fmtMoney(d.lucroAcumulado)} valueClass="text-primary" />
                        <SummaryRow icon={<Flag className="size-3.5" />} iconCls="bg-success/10 text-success"
                          label="Meta" value={fmtMoney(d.meta)} valueClass="text-success" />
                        {d.batida ? (
                          <SummaryRow icon={<TrendingUp className="size-3.5" />} iconCls="bg-success/10 text-success"
                            label="Acima da meta" value={`+${fmtMoney(d.lucroAcumulado - d.meta)}`} valueClass="text-success" />
                        ) : (
                          <SummaryRow icon={<Target className="size-3.5" />} iconCls="bg-amber-500/10 text-amber-600"
                            label="Falta para a meta" value={fmtMoney(Math.max(0, d.meta - d.lucroAcumulado))} valueClass="text-amber-600" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

              </>
            )}
            </>
          )}

          {/* ── Planejamento: meta deste mês e dos próximos ─────────────────── */}
          {subTab === "planejamento" && (
            <GoalPlanning goals={allGoals} loading={loadingHistory} onSaved={refreshGoalQueries} />
          )}
        </>
      )}
    </div>
  );
}

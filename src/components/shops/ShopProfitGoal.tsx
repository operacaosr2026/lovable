import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getShopProfitGoal, upsertShopProfitGoal, getProfitGoalLiveStats } from "@/lib/shop-profit-goals.functions";
import { syncShopifyOrders } from "@/lib/shop-orders.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Target, TrendingUp, TrendingDown, Flame, Zap, Settings2, DollarSign,
  ShoppingCart, BarChart3, Percent, Wallet, Gauge, Sparkles, ArrowRight,
  Link2, CheckCircle2, RefreshCw, Loader2,
} from "lucide-react";
import { toast } from "sonner";

type Goal = {
  id?: string;
  shop_id: string;
  target_profit: number;
  start_date: string;
  end_date: string;
  sale_price: number;
  supplier_cost: number;
  fees_pct: number;
  max_cpa: number;
  total_sales: number;
  total_revenue: number;
  total_marketing: number;
  daily_budget: number;
  currency: string;
};

const empty = (shopId: string): Goal => ({
  shop_id: shopId,
  target_profit: 0,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  sale_price: 0,
  supplier_cost: 0,
  fees_pct: 0,
  max_cpa: 0,
  total_sales: 0,
  total_revenue: 0,
  total_marketing: 0,
  daily_budget: 0,
  currency: "USD",
});

export function ShopProfitGoal({ shopId }: { shopId: string }) {
  const get = useServerFn(getShopProfitGoal);
  const getStats = useServerFn(getProfitGoalLiveStats);
  const upsert = useServerFn(upsertShopProfitGoal);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scaleBudget, setScaleBudget] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["shop-profit-goal", shopId],
    queryFn: () => get({ data: { shop_id: shopId } }),
  });
  const storedGoal = (data?.goal as Goal | null) ?? null;

  const stats = useQuery({
    queryKey: ["shop-profit-goal-stats", shopId, storedGoal?.start_date, storedGoal?.end_date],
    queryFn: () => getStats({ data: {
      shop_id: shopId,
      start_date: storedGoal!.start_date,
      end_date: storedGoal!.end_date,
    } }),
    enabled: Boolean(storedGoal?.start_date && storedGoal?.end_date),
  });

  // Live goal: override sales/revenue with Shopify-synced values when connected.
  const goal: Goal | null = useMemo(() => {
    if (!storedGoal) return null;
    if (!stats.data?.connected) return storedGoal;
    return {
      ...storedGoal,
      total_sales: stats.data.sales || storedGoal.total_sales,
      total_revenue: stats.data.revenue || storedGoal.total_revenue,
    };
  }, [storedGoal, stats.data]);

  const mut = useMutation({
    mutationFn: (g: Goal) => upsert({ data: g }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop-profit-goal", shopId] });
      qc.invalidateQueries({ queryKey: ["shop-profit-goal-stats", shopId] });
      setOpen(false);
      toast.success("Meta salva");
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao salvar"),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando…</div>;
  }

  if (!goal || goal.target_profit === 0) {
    return (
      <>
        <EmptyState onConfigure={() => setOpen(true)} />
        <ConfigDialog open={open} onOpenChange={setOpen} initial={goal ?? empty(shopId)} onSave={(g) => mut.mutate(g)} saving={mut.isPending} />
      </>
    );
  }

  return (
    <>
      <Dashboard
        shopId={shopId}
        goal={goal}
        scaleBudget={scaleBudget}
        onScale={setScaleBudget}
        onConfigure={() => setOpen(true)}
        liveStats={stats.data}
      />
      <ConfigDialog open={open} onOpenChange={setOpen} initial={goal} onSave={(g) => mut.mutate(g)} saving={mut.isPending} liveStats={stats.data} />
    </>
  );
}

function EmptyState({ onConfigure }: { onConfigure: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-surface to-surface/40 p-12 text-center">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,oklch(0.6_0.22_285/0.15),transparent_60%)] pointer-events-none" />
      <div className="relative">
        <div className="mx-auto size-14 rounded-2xl bg-primary/10 text-primary grid place-items-center mb-4">
          <Target className="size-7" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Defina sua meta de lucro</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Transforme esta loja em um cockpit financeiro de performance. Saiba em tempo real o ritmo necessário para bater sua meta.
        </p>
        <Button onClick={onConfigure} size="lg" className="mt-6 gap-2">
          <Settings2 className="size-4" /> Configurar Meta
        </Button>
      </div>
    </div>
  );
}

// ---------------- calculations ----------------
function computeMetrics(g: Goal, scaleBudget: number | null) {
  const today = new Date();
  const start = new Date(g.start_date + "T00:00:00");
  const end = new Date(g.end_date + "T00:00:00");
  const msDay = 86400000;
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / msDay));
  const daysElapsed = Math.max(0, Math.min(totalDays, Math.ceil((today.getTime() - start.getTime()) / msDay)));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  const fees = g.sale_price * (g.fees_pct / 100);
  const profitBeforeMarketing = g.sale_price - g.supplier_cost - fees;
  const cpa = g.total_sales > 0 ? g.total_marketing / g.total_sales : 0;
  const profitPerSale = profitBeforeMarketing - cpa;
  const accumulatedProfit = profitPerSale * g.total_sales;
  const remainingProfit = Math.max(0, g.target_profit - accumulatedProfit);
  const remainingSales = profitPerSale > 0 ? remainingProfit / profitPerSale : 0;
  const salesPerDay = daysRemaining > 0 ? remainingSales / daysRemaining : 0;
  const dailyInvestNeeded = salesPerDay * (cpa || g.max_cpa);
  const totalInvestRemaining = dailyInvestNeeded * daysRemaining;
  const currentBudget = scaleBudget ?? g.daily_budget;
  const dailyDiff = dailyInvestNeeded - currentBudget;
  const finalProjection = daysElapsed > 0 ? (accumulatedProfit / daysElapsed) * totalDays : 0;
  const requiredPace = totalDays > 0 ? g.target_profit / totalDays : 0;
  const currentPace = daysElapsed > 0 ? accumulatedProfit / daysElapsed : 0;
  const attackScore = requiredPace > 0 ? (currentPace / requiredPace) * 100 : 0;
  const progressPct = g.target_profit > 0 ? (accumulatedProfit / g.target_profit) * 100 : 0;
  const roas = g.total_marketing > 0 ? g.total_revenue / g.total_marketing : 0;
  const margin = g.total_revenue > 0 ? (accumulatedProfit / g.total_revenue) * 100 : 0;

  return {
    totalDays, daysElapsed, daysRemaining,
    fees, profitBeforeMarketing, cpa, profitPerSale, accumulatedProfit,
    remainingProfit, remainingSales, salesPerDay, dailyInvestNeeded,
    totalInvestRemaining, dailyDiff, finalProjection, attackScore,
    progressPct, roas, margin,
  };
}

function fmt(g: Goal, n: number, opts: Intl.NumberFormatOptions = {}) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: g.currency, maximumFractionDigits: 0, ...opts }).format(n);
  } catch {
    return `$${n.toFixed(0)}`;
  }
}
function num(n: number, d = 0) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(n); }

function statusBadge(score: number) {
  if (score >= 125) return { label: "SUPERANDO META", icon: Flame, color: "oklch(0.7 0.18 30)", bg: "bg-orange-500/10 text-orange-400 border-orange-500/30" };
  if (score >= 100) return { label: "ON TRACK", icon: TrendingUp, color: "oklch(0.65 0.18 155)", bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
  if (score >= 90) return { label: "NO RITMO", icon: Zap, color: "oklch(0.78 0.15 90)", bg: "bg-amber-500/10 text-amber-400 border-amber-500/30" };
  return { label: "ATRASADO", icon: TrendingDown, color: "oklch(0.65 0.2 25)", bg: "bg-rose-500/10 text-rose-400 border-rose-500/30" };
}

// ---------------- dashboard ----------------
type LiveStats = {
  sales: number; revenue: number; orders_count: number;
  currency: string | null; connected: boolean;
  store: { id: string; name: string | null; last_sync_at: string | null } | null;
} | undefined;

function Dashboard({ shopId, goal, scaleBudget, onScale, onConfigure, liveStats }: {
  shopId: string;
  goal: Goal;
  scaleBudget: number | null;
  onScale: (v: number | null) => void;
  onConfigure: () => void;
  liveStats: LiveStats;
}) {
  const qc = useQueryClient();
  const syncFn = useServerFn(syncShopifyOrders);
  const syncGoal = useMutation({
    mutationFn: async () => {
      const days = Math.max(1, Math.min(90, Math.ceil((Date.now() - new Date(goal.start_date + "T00:00:00").getTime()) / 86400000) + 1));
      return await syncFn({ data: { shop_id: shopId, since_days: days } });
    },
    onSuccess: () => {
      toast.success("Meta de lucro sincronizada");
      qc.invalidateQueries({ queryKey: ["shop-profit-goal-stats", shopId] });
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao sincronizar"),
  });

  const m = useMemo(() => computeMetrics(goal, scaleBudget), [goal, scaleBudget]);
  const s = statusBadge(m.attackScore);
  const StatusIcon = s.icon;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      {/* HERO — solid dark cockpit */}
      <div
        className="relative overflow-hidden rounded-3xl p-8 text-white shadow-2xl"
        style={{
          background:
            "radial-gradient(120% 100% at 100% 0%, oklch(0.42 0.22 295 / 0.55) 0%, transparent 55%), radial-gradient(80% 80% at 0% 100%, oklch(0.55 0.24 320 / 0.35) 0%, transparent 60%), #0A0D16",
        }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_60%,rgba(0,0,0,0.4))] pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-white/50 mb-3 flex items-center gap-2">
              <Target className="size-3.5" /> Meta de Lucro
              {liveStats?.connected && (
                <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] tracking-wider">
                  <CheckCircle2 className="size-3" /> SHOPIFY · {liveStats.store?.name ?? "conectada"}
                </span>
              )}
            </div>
            <div className="text-5xl md:text-6xl font-semibold tracking-tight tabular-nums text-white">
              {fmt(goal, goal.target_profit)}
            </div>
            <div className="flex items-center gap-3 mt-3 text-sm text-white/60">
              <span>{new Date(goal.start_date).toLocaleDateString("pt-BR")}</span>
              <ArrowRight className="size-3.5" />
              <span>{new Date(goal.end_date).toLocaleDateString("pt-BR")}</span>
              <span className="mx-1 size-1 rounded-full bg-white/30" />
              <span>{m.daysRemaining} dias restantes</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`inline-flex items-center gap-2 px-4 h-10 rounded-full border text-xs font-medium tracking-wider ${s.bg}`}>
              <StatusIcon className="size-3.5" /> {s.label}
            </div>
            <Button
              variant="outline" size="sm" onClick={() => syncGoal.mutate()} disabled={syncGoal.isPending || !liveStats?.connected}
              className="gap-1.5 bg-white/5 border-white/15 text-white hover:bg-white/10 hover:text-white"
              title={liveStats?.connected ? "Atualiza apenas os dados desta meta" : "Conecte uma loja em Integrações"}
            >
              {syncGoal.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Sincronizar meta
            </Button>
            <Button variant="outline" size="sm" onClick={onConfigure} className="gap-1.5 bg-white/5 border-white/15 text-white hover:bg-white/10 hover:text-white">
              <Settings2 className="size-3.5" /> Editar
            </Button>
          </div>
        </div>

        {/* progress */}
        <div className="relative mt-8">
          <div className="flex items-end justify-between mb-2 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/50">Lucro atual</div>
              <div className="font-semibold tabular-nums text-white text-lg">{fmt(goal, m.accumulatedProfit)}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-white/50">Falta</div>
              <div className="font-semibold tabular-nums text-white text-lg">{fmt(goal, m.remainingProfit)}</div>
            </div>
          </div>
          <div className="h-3 w-full rounded-full bg-white/10 overflow-hidden ring-1 ring-white/5">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out shadow-[0_0_24px_rgba(168,85,247,0.6)]"
              style={{
                width: `${Math.min(100, Math.max(0, m.progressPct))}%`,
                background: "linear-gradient(90deg, oklch(0.65 0.24 300), oklch(0.7 0.22 340))",
              }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-xs text-white/50 tabular-nums">
            <span>{num(m.progressPct, 1)}% concluído</span>
            <span>{num(100 - m.progressPct, 1)}% restante</span>
          </div>
        </div>
      </div>



      {/* WHAT NEEDS TO HAPPEN + ATTACK SCORE */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 relative overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-md">
          <div className="absolute -top-32 -left-32 w-72 h-72 rounded-full bg-primary/8 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-5">O que precisa acontecer</div>
            <div className="grid grid-cols-2 gap-4">
              <BigStat label="Vendas / dia" value={num(m.salesPerDay, 0)} variant="solid-dark" />
              <BigStat label="Investimento ideal" value={`${fmt(goal, m.dailyInvestNeeded)}/dia`} variant="solid-primary" />
              <BigStat label="Investimento atual" value={`${fmt(goal, scaleBudget ?? goal.daily_budget)}/dia`} variant="soft" />
              <BigStat
                label="Diferença diária"
                value={`${m.dailyDiff >= 0 ? "+" : ""}${fmt(goal, m.dailyDiff)}/dia`}
                variant={m.dailyDiff > 0 ? "warn" : "good"}
              />
            </div>
          </div>
        </div>

        <AttackScore score={m.attackScore} />
      </div>


      {/* GAUGE + PROJECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Gauge_ goal={goal} need={m.salesPerDay} current={m.salesPerDay * (m.dailyDiff <= 0 ? 1.05 : 0.7)} />
        <Projection goal={goal} projected={m.finalProjection} />
      </div>

      {/* KPIs */}
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
          <Sparkles className="size-3.5" /> Indicadores
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={ShoppingCart} label="Vendas totais" value={num(goal.total_sales)} />
          <KPI icon={DollarSign} label="Receita bruta" value={fmt(goal, goal.total_revenue)} />
          <KPI icon={Target} label="CPA médio" value={fmt(goal, m.cpa)} />
          <KPI icon={TrendingUp} label="Lucro / venda" value={fmt(goal, m.profitPerSale)} />
          <KPI icon={Wallet} label="Lucro acumulado" value={fmt(goal, m.accumulatedProfit)} />
          <KPI icon={BarChart3} label="ROAS" value={num(m.roas, 2)} />
          <KPI icon={Percent} label="Margem" value={`${num(m.margin, 1)}%`} />
          <KPI icon={Zap} label="Marketing total" value={fmt(goal, goal.total_marketing)} />
        </div>
      </div>

      {/* FINANCIAL FLOW */}
      <FinancialFlow goal={goal} m={m} />

      {/* WHAT REMAINS */}
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">O que falta para bater a meta</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Small label="Lucro restante" value={fmt(goal, m.remainingProfit)} />
          <Small label="Vendas restantes" value={num(m.remainingSales, 0)} />
          <Small label="Dias restantes" value={`${m.daysRemaining}d`} />
          <Small label="Vendas / dia necessárias" value={num(m.salesPerDay, 0)} />
          <Small label="Investimento diário necessário" value={`${fmt(goal, m.dailyInvestNeeded)}/dia`} />
          <Small label="Investimento total restante" value={fmt(goal, m.totalInvestRemaining)} />
        </div>
      </div>

      {/* SCALE SIMULATOR */}
      <ScaleSimulator goal={goal} m={m} value={scaleBudget ?? goal.daily_budget} onChange={onScale} />
    </div>
  );
}

function BigStat({ label, value, variant = "soft" }: {
  label: string;
  value: string;
  variant?: "solid-dark" | "solid-primary" | "soft" | "good" | "warn";
}) {
  const styles: Record<string, { wrap: string; label: string; value: string }> = {
    "solid-dark": {
      wrap: "rounded-2xl p-4 shadow-lg ring-1 ring-white/5",
      label: "text-white/55",
      value: "text-white",
    },
    "solid-primary": {
      wrap: "rounded-2xl p-4 shadow-lg shadow-primary/30 ring-1 ring-white/10",
      label: "text-white/70",
      value: "text-white",
    },
    soft: {
      wrap: "rounded-2xl p-4 border border-border bg-muted/30",
      label: "text-muted-foreground",
      value: "text-foreground/80",
    },
    good: {
      wrap: "rounded-2xl p-4 border border-emerald-500/30 bg-emerald-500/8",
      label: "text-emerald-700 dark:text-emerald-300",
      value: "text-emerald-600 dark:text-emerald-300",
    },
    warn: {
      wrap: "rounded-2xl p-4 border border-amber-500/30 bg-amber-500/8",
      label: "text-amber-700 dark:text-amber-300",
      value: "text-amber-600 dark:text-amber-400",
    },
  };
  const inlineBg =
    variant === "solid-dark"
      ? { background: "#0A0D16" }
      : variant === "solid-primary"
      ? { background: "linear-gradient(135deg, oklch(0.55 0.24 295), oklch(0.48 0.22 320))" }
      : undefined;
  const st = styles[variant];
  return (
    <div className={st.wrap} style={inlineBg}>
      <div className={`text-[10px] uppercase tracking-[0.18em] mb-1.5 ${st.label}`}>{label}</div>
      <div className={`text-2xl md:text-[1.7rem] font-semibold tracking-tight tabular-nums ${st.value}`}>{value}</div>
    </div>
  );
}

function AttackScore({ score }: { score: number }) {
  const s = statusBadge(score);
  const clamped = Math.max(0, Math.min(150, score));
  const r = 56;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, clamped) / 100) * c;
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-7 flex flex-col items-center justify-center text-white shadow-xl ring-1 ring-white/10"
      style={{
        background:
          "radial-gradient(100% 100% at 50% 0%, oklch(0.5 0.24 295) 0%, oklch(0.32 0.18 295) 60%, #0A0D16 100%)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.25em] text-white/55 mb-3">Meta Attack Score™</div>
      <div className="relative">
        <svg width="160" height="160" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" />
          <circle
            cx="70" cy="70" r={r} fill="none"
            stroke={s.color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            transform="rotate(-90 70 70)"
            style={{ transition: "stroke-dasharray 800ms cubic-bezier(0.4,0,0.2,1)", filter: "drop-shadow(0 0 12px currentColor)" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-4xl font-semibold tabular-nums text-white">{num(score, 0)}%</div>
        </div>
      </div>
      <div className="mt-4 text-xs text-white/65 tracking-wider">{s.label}</div>
    </div>
  );
}


function Gauge_({ goal, need, current }: { goal: Goal; need: number; current: number }) {
  const max = Math.max(need * 1.5, current * 1.2, 1);
  const pct = Math.min(100, (current / max) * 100);
  const needPct = Math.min(100, (need / max) * 100);
  const tone = current >= need ? "emerald" : current >= need * 0.8 ? "amber" : "rose";
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-surface to-surface/30 p-7">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-5 flex items-center gap-2">
        <Gauge className="size-3.5" /> Velocímetro de meta
      </div>
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Atual</div>
          <div className="text-3xl font-semibold tabular-nums">{num(current, 0)} <span className="text-sm text-muted-foreground font-normal">vendas/dia</span></div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Necessário</div>
          <div className="text-lg font-medium tabular-nums">{num(need, 0)}/dia</div>
        </div>
      </div>
      <div className="relative h-3 rounded-full bg-muted/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${tone === "emerald" ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : tone === "amber" ? "bg-gradient-to-r from-amber-500 to-amber-400" : "bg-gradient-to-r from-rose-500 to-rose-400"}`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute top-0 bottom-0 w-px bg-foreground/60" style={{ left: `${needPct}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">Marcador indica o ritmo necessário para bater a meta.</div>
    </div>
  );
}

function Projection({ goal, projected }: { goal: Goal; projected: number }) {
  const diff = projected - goal.target_profit;
  const positive = diff >= 0;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-surface to-surface/30 p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,oklch(0.6_0.22_285/0.1),transparent_60%)] pointer-events-none" />
      <div className="relative">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-5">Se continuar assim</div>
        <div className="space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Lucro projetado</div>
            <div className="text-4xl font-semibold tabular-nums">{fmt(goal, projected)}</div>
          </div>
          <div className="flex items-center justify-between pt-4 border-t border-border/60">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Meta</div>
              <div className="text-lg tabular-nums">{fmt(goal, goal.target_profit)}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Diferença</div>
              <div className={`text-lg font-medium tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`}>
                {positive ? "+" : ""}{fmt(goal, diff)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-surface/60 p-4 hover:border-border transition-colors">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="size-3.5" />
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-surface/60 p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function FinancialFlow({ goal, m }: { goal: Goal; m: ReturnType<typeof computeMetrics> }) {
  const supplierTotal = goal.supplier_cost * goal.total_sales;
  const feesTotal = goal.sale_price * (goal.fees_pct / 100) * goal.total_sales;
  const steps = [
    { label: "Receita bruta", value: fmt(goal, goal.total_revenue), tone: "primary" },
    { label: "Fornecedor", value: `−${fmt(goal, supplierTotal)}`, tone: "muted" },
    { label: "Taxas", value: `−${fmt(goal, feesTotal)}`, tone: "muted" },
    { label: "Marketing", value: `−${fmt(goal, goal.total_marketing)}`, tone: "muted" },
    { label: "Lucro atual", value: fmt(goal, m.accumulatedProfit), tone: "success" },
  ];
  return (
    <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-surface to-surface/30 p-7">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-5">Resumo financeiro</div>
      <div className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className={`size-2 rounded-full ${s.tone === "primary" ? "bg-primary" : s.tone === "success" ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />
              <div className="text-sm">{s.label}</div>
            </div>
            <div className={`tabular-nums text-lg font-medium ${s.tone === "success" ? "text-emerald-400" : s.tone === "primary" ? "text-foreground" : "text-muted-foreground"}`}>
              {s.value}
            </div>
            {i < steps.length - 1 && (
              <div className="absolute" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScaleSimulator({ goal, m, value, onChange }: {
  goal: Goal;
  m: ReturnType<typeof computeMetrics>;
  value: number;
  onChange: (v: number | null) => void;
}) {
  const min = 0;
  const max = Math.max(goal.daily_budget * 3, m.dailyInvestNeeded * 2, 100);
  const projectedSales = m.cpa > 0 ? (value / m.cpa) * m.daysRemaining : 0;
  const additionalProfit = projectedSales * m.profitPerSale;
  const newProjection = m.accumulatedProfit + additionalProfit;
  const reachDate = m.profitPerSale > 0 && value > 0 && m.cpa > 0
    ? (() => {
        const dailyProfit = (value / m.cpa) * m.profitPerSale;
        if (dailyProfit <= 0) return null;
        const daysToGoal = Math.ceil(m.remainingProfit / dailyProfit);
        return new Date(Date.now() + daysToGoal * 86400000);
      })()
    : null;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-surface via-surface/80 to-surface/30 p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_100%,oklch(0.6_0.22_285/0.15),transparent_60%)] pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Simulador de escala</div>
          <button onClick={() => onChange(null)} className="text-xs text-muted-foreground hover:text-foreground">resetar</button>
        </div>
        <div className="text-sm text-muted-foreground mb-6">Arraste para simular um novo investimento diário.</div>

        <div className="flex items-baseline gap-3 mb-4">
          <div className="text-4xl font-semibold tabular-nums">{fmt(goal, value)}</div>
          <div className="text-sm text-muted-foreground">/ dia</div>
        </div>

        <Slider
          value={[value]}
          min={min}
          max={max}
          step={Math.max(1, Math.round(max / 200))}
          onValueChange={(v) => onChange(v[0])}
          className="my-6"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
          <Small label="Lucro projetado" value={fmt(goal, newProjection)} />
          <Small label="Data estimada p/ meta" value={reachDate ? reachDate.toLocaleDateString("pt-BR") : "—"} />
          <Small label="Nova projeção final" value={fmt(goal, additionalProfit + m.accumulatedProfit)} />
        </div>
      </div>
    </div>
  );
}

// ---------------- config dialog ----------------
function ConfigDialog({ open, onOpenChange, initial, onSave, saving, liveStats }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Goal;
  onSave: (g: Goal) => void;
  saving: boolean;
  liveStats?: LiveStats;
}) {
  const [g, setG] = useState<Goal>(initial);
  useEffect(() => { setG(initial); }, [initial, open]);
  const set = <K extends keyof Goal>(k: K, v: Goal[K]) => setG((p) => ({ ...p, [k]: v }));

  const fees = (g.sale_price || 0) * ((g.fees_pct || 0) / 100);
  const computedMaxCpa = Math.max(0, (g.sale_price || 0) - (g.supplier_cost || 0) - fees);

  useEffect(() => {
    if (Math.abs((g.max_cpa || 0) - computedMaxCpa) > 0.001) {
      setG((p) => ({ ...p, max_cpa: computedMaxCpa }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.sale_price, g.supplier_cost, g.fees_pct]);

  const currencyFmt = (n: number) => {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: g.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `$${n.toFixed(2)}`;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurar Meta de Lucro</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          <Section title="Meta">
            <Field label="Meta de lucro total">
              <MoneyInput currency={g.currency} value={g.target_profit} onChange={(v) => set("target_profit", v)} />
            </Field>
            <Field label="Moeda">
              <Input value={g.currency} onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 4))} />
            </Field>
            <Field label="Data inicial">
              <Input type="date" value={g.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </Field>
            <Field label="Data final">
              <Input type="date" value={g.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </Field>
          </Section>

          <Section title="Economia da venda">
            <Field label="Preço de venda">
              <MoneyInput currency={g.currency} value={g.sale_price} onChange={(v) => set("sale_price", v)} />
            </Field>
            <Field label="Custo do fornecedor">
              <MoneyInput currency={g.currency} value={g.supplier_cost} onChange={(v) => set("supplier_cost", v)} />
            </Field>
            <Field label="Taxas (%)">
              <DecimalInput value={g.fees_pct} onChange={(v) => set("fees_pct", v)} suffix="%" />
            </Field>
            <Field label="CPA máximo permitido" hint="Calculado: preço − custo − taxas">
              <div className="flex items-center justify-end h-10 w-full rounded-xl border border-border bg-muted/30 px-3.5 text-sm tabular-nums text-muted-foreground">
                {currencyFmt(computedMaxCpa)}
              </div>
            </Field>
          </Section>

          <Section title="Operacional">
            <Field
              label="Vendas acumuladas"
              hint={liveStats?.connected
                ? `Sincronizado da Shopify (${liveStats.sales} itens · ${liveStats.orders_count} pedidos)`
                : "Conecte a Shopify na aba Pedidos para puxar automaticamente"}
            >
              {liveStats?.connected ? (
                <div className="flex items-center justify-between h-10 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 text-sm tabular-nums">
                  <span className="text-emerald-500 text-[10px] uppercase tracking-wider flex items-center gap-1"><Link2 className="size-3" />auto</span>
                  <span className="text-foreground font-medium">{new Intl.NumberFormat("pt-BR").format(liveStats.sales)}</span>
                </div>
              ) : (
                <IntInput value={g.total_sales} onChange={(v) => set("total_sales", v)} />
              )}
            </Field>
            <Field
              label="Receita acumulada"
              hint={liveStats?.connected ? "Sincronizado da Shopify" : "Conecte a Shopify na aba Pedidos para puxar automaticamente"}
            >
              {liveStats?.connected ? (
                <div className="flex items-center justify-between h-10 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 text-sm tabular-nums">
                  <span className="text-emerald-500 text-[10px] uppercase tracking-wider flex items-center gap-1"><Link2 className="size-3" />auto</span>
                  <span className="text-foreground font-medium">{currencyFmt(liveStats.revenue)}</span>
                </div>
              ) : (
                <MoneyInput currency={g.currency} value={g.total_revenue} onChange={(v) => set("total_revenue", v)} />
              )}
            </Field>
            <Field label="Marketing acumulado" hint="Em breve: integração Meta Ads">
              <MoneyInput currency={g.currency} value={g.total_marketing} onChange={(v) => set("total_marketing", v)} />
            </Field>
            <Field label="Orçamento diário atual">
              <MoneyInput currency={g.currency} value={g.daily_budget} onChange={(v) => set("daily_budget", v)} />
            </Field>
          </Section>
        </div>


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSave({ ...g, max_cpa: computedMaxCpa })} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">{title}</div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

// ---------- pt-BR friendly number/money inputs ----------
function parseLocaleNumber(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d,.-]/g, "");
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }
  const n = parseFloat(normalized);
  return isFinite(n) ? n : 0;
}

function MoneyInput({ currency, value, onChange }: { currency: string; value: number; onChange: (n: number) => void }) {
  const format = (n: number) => {
    try {
      return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    } catch {
      return n.toFixed(2);
    }
  };
  const symbol = (() => {
    try {
      const parts = new Intl.NumberFormat("pt-BR", { style: "currency", currency }).formatToParts(0);
      return parts.find((p) => p.type === "currency")?.value ?? currency;
    } catch {
      return currency;
    }
  })();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(format(value || 0));
  useEffect(() => { if (!focused) setDraft(format(value || 0)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value, focused, currency]);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{symbol}</span>
      <Input
        inputMode="decimal"
        value={draft}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onBlur={() => {
          setFocused(false);
          const n = parseLocaleNumber(draft);
          onChange(n);
          setDraft(format(n));
        }}
        onChange={(e) => setDraft(e.target.value)}
        className="pl-12 text-right tabular-nums"
        placeholder="0,00"
      />
    </div>
  );
}

function DecimalInput({ value, onChange, suffix }: { value: number; onChange: (n: number) => void; suffix?: string }) {
  const format = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(format(value || 0));
  useEffect(() => { if (!focused) setDraft(format(value || 0)); }, [value, focused]);
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        value={draft}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onBlur={() => {
          setFocused(false);
          const n = parseLocaleNumber(draft);
          onChange(n);
          setDraft(format(n));
        }}
        onChange={(e) => setDraft(e.target.value)}
        className={`text-right tabular-nums ${suffix ? "pr-8" : ""}`}
        placeholder="0"
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{suffix}</span>}
    </div>
  );
}

function IntInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const format = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(format(value || 0));
  useEffect(() => { if (!focused) setDraft(format(value || 0)); }, [value, focused]);
  return (
    <Input
      inputMode="numeric"
      value={draft}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => {
        setFocused(false);
        const n = Math.round(parseLocaleNumber(draft));
        onChange(n);
        setDraft(format(n));
      }}
      onChange={(e) => setDraft(e.target.value)}
      className="text-right tabular-nums"
      placeholder="0"
    />
  );
}

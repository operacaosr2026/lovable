import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DollarSign, Megaphone, Users, ShoppingCart,
  Store, TrendingUp, AlertTriangle, RefreshCw,
  Target, Calendar, ArrowUpRight, ArrowDownRight,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  getLgOverviewMetrics,
  getLgAccumulatedLucro,
  getLgCardGoal,
  upsertLgCardGoal,
} from "@/lib/lg-overview.functions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToday() {
  return new Date().toLocaleDateString("en-CA");
}

function fmt(n: number, opts?: { decimals?: number; prefix?: string }) {
  const v = Math.abs(n);
  let s: string;
  if (v >= 1_000_000) s = `${(v / 1_000_000).toFixed(opts?.decimals ?? 1)}M`;
  else if (v >= 1_000) s = `${(v / 1_000).toFixed(opts?.decimals ?? 1)}k`;
  else s = v.toFixed(opts?.decimals ?? 2);
  return `${n < 0 ? "-" : ""}${opts?.prefix ?? ""}${s}`;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number) {
  return `${n.toFixed(2)}%`;
}

function daysBetween(from: string, to: string) {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400_000);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

// ─── Section container ────────────────────────────────────────────────────────

function Section({
  title, icon, children, badge,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center">
            {icon}
          </div>
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

// ─── Metric cell ──────────────────────────────────────────────────────────────

function MetricCell({
  label, value, sub, valueClass = "", loading,
}: {
  label: string; value: string; sub?: string; valueClass?: string; loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {loading
        ? <Skeleton className="h-6 w-20 mt-1" />
        : <span className={`text-lg font-bold leading-tight ${valueClass}`}>{value}</span>
      }
      {sub && !loading && (
        <span className="text-xs text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}

// ─── KPI card (for Marketing + Loja containers) ───────────────────────────────

function KpiCard({
  icon, label, value, sub, loading,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; loading?: boolean;
}) {
  return (
    <div className="bg-background border border-border rounded-xl p-3 flex flex-col gap-2">
      <div className="size-8 rounded-lg bg-muted grid place-items-center text-muted-foreground">
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading
          ? <Skeleton className="h-5 w-16 mt-1" />
          : <p className="text-base font-bold text-foreground">{value}</p>
        }
        {sub && !loading && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Derived metric cell (for Meta container) ─────────────────────────────────

function DerivedCell({
  label, value, icon, loading,
}: {
  label: string; value: string; icon?: React.ReactNode; loading?: boolean;
}) {
  return (
    <div className="bg-background border border-border rounded-xl p-3">
      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
        {icon}
        {label}
      </p>
      {loading
        ? <Skeleton className="h-5 w-20" />
        : <p className="text-base font-bold text-foreground">{value}</p>
      }
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LgOverview({ card, shopIds }: { card: any; shopIds: string[] }) {
  const queryClient = useQueryClient();
  const hasShops = shopIds.length > 0;

  const getMetricsFn = useServerFn(getLgOverviewMetrics);
  const getAccFn = useServerFn(getLgAccumulatedLucro);
  const getGoalFn = useServerFn(getLgCardGoal);
  const upsertGoalFn = useServerFn(upsertLgCardGoal);

  // ── Main metrics query ────────────────────────────────────────────────────
  const { data: metricsData, isLoading: loadingMetrics } = useQuery({
    queryKey: ["lg-overview-metrics", shopIds.join(",")],
    queryFn: () => getMetricsFn({ data: { shop_ids: shopIds } }),
    enabled: hasShops,
    staleTime: 3 * 60_000,
  });

  // ── Goal query ────────────────────────────────────────────────────────────
  const { data: goalData, isLoading: loadingGoal } = useQuery({
    queryKey: ["lg-card-goal", card.id],
    queryFn: () => getGoalFn({ data: { card_id: card.id } }),
    staleTime: 60_000,
  });

  const savedGoal = goalData?.goal as any ?? null;

  // ── Accumulated lucro (from goal start_date) ──────────────────────────────
  const { data: accData, isLoading: loadingAcc } = useQuery({
    queryKey: ["lg-acc-lucro", shopIds.join(","), savedGoal?.start_date],
    queryFn: () => getAccFn({ data: { shop_ids: shopIds, start_date: savedGoal.start_date } }),
    enabled: hasShops && !!savedGoal,
    staleTime: 3 * 60_000,
  });

  // ── Meta form state ───────────────────────────────────────────────────────
  const [metaInput, setMetaInput] = useState("");
  const [prazoInput, setPrazoInput] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    if (savedGoal) {
      setMetaInput(String(savedGoal.meta ?? ""));
      setPrazoInput(savedGoal.prazo ?? "");
    }
  }, [savedGoal]);

  async function handleSaveGoal(resetStart = false) {
    const meta = parseFloat(metaInput);
    if (!meta || meta <= 0) { toast.error("Informe um valor de meta válido"); return; }
    if (!prazoInput) { toast.error("Informe o prazo"); return; }
    setSavingGoal(true);
    try {
      await upsertGoalFn({ data: { card_id: card.id, meta, prazo: prazoInput, reset_start: resetStart } });
      await queryClient.invalidateQueries({ queryKey: ["lg-card-goal", card.id] });
      await queryClient.invalidateQueries({ queryKey: ["lg-acc-lucro"] });
      toast.success(resetStart ? "Nova meta iniciada" : "Meta salva");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar meta");
    } finally {
      setSavingGoal(false);
    }
  }

  // ── Derived meta calculations ─────────────────────────────────────────────
  const derived = useMemo(() => {
    if (!savedGoal || !metricsData || !accData) return null;

    const meta = Number(savedGoal.meta ?? 0);
    const lucroAcumulado = accData.lucro ?? 0;
    const lucroRestante = meta - lucroAcumulado;

    const today = isoToday();
    const diasRestantes = daysBetween(today, savedGoal.prazo);

    const { pedidos: pedidosMes, lucro: lucroMes, cpa: cpaMes } = metricsData.month;
    const lucroPorPedido = pedidosMes > 0 ? lucroMes / pedidosMes : 0;

    if (lucroPorPedido <= 0) {
      return { error: "Sem dados suficientes para calcular (nenhum lucro por pedido este mês)." };
    }

    if (diasRestantes <= 0) {
      return { vencida: true, lucroAcumulado, meta };
    }

    const vendasFaltam = Math.max(0, lucroRestante / lucroPorPedido);
    const vendasPorDia = vendasFaltam / diasRestantes;
    const investimentoPorDia = vendasPorDia * cpaMes;

    return {
      lucroAcumulado,
      vendasFaltam: Math.round(vendasFaltam),
      vendasPorDia,
      investimentoPorDia,
      diasRestantes,
      meta,
      batida: lucroAcumulado >= meta,
    };
  }, [savedGoal, metricsData, accData]);

  // ─────────────────────────────────────────────────────────────────────────

  const m = metricsData;
  const loading = loadingMetrics;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

      {/* ── Container Lucro ─────────────────────────────────────────────── */}
      <Section title="Lucro" icon={<TrendingUp className="size-4" />}>
        {!hasShops ? (
          <p className="text-xs text-muted-foreground">Nenhuma loja vinculada a este card.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <MetricCell
              label="Hoje"
              value={loading ? "" : fmtMoney(m!.today.lucro)}
              sub="aprox."
              valueClass={!loading && m!.today.lucro >= 0 ? "text-success" : "text-destructive"}
              loading={loading}
            />
            <MetricCell
              label="Semana"
              value={loading ? "" : fmtMoney(m!.week.lucro)}
              sub="aprox."
              valueClass={!loading && m!.week.lucro >= 0 ? "text-success" : "text-destructive"}
              loading={loading}
            />
            <MetricCell
              label="Mês"
              value={loading ? "" : fmtMoney(m!.month.lucro)}
              valueClass={!loading && m!.month.lucro >= 0 ? "text-success" : "text-destructive"}
              loading={loading}
            />
          </div>
        )}
      </Section>

      {/* ── Container Marketing ──────────────────────────────────────────── */}
      <Section title="Marketing" icon={<Megaphone className="size-4" />}
        badge={<span className="text-xs text-muted-foreground">hoje</span>}
      >
        {!hasShops ? (
          <p className="text-xs text-muted-foreground">Nenhuma loja vinculada a este card.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <KpiCard
              icon={<DollarSign className="size-4" />}
              label="Faturamento"
              value={loading ? "" : fmtMoney(m!.today.faturamento)}
              loading={loading}
            />
            <KpiCard
              icon={<Megaphone className="size-4" />}
              label="Gasto em Anúncios"
              value={loading ? "" : (m!.today.anuncios > 0 ? fmtMoney(m!.today.anuncios) : "—")}
              loading={loading}
            />
            <KpiCard
              icon={<Users className="size-4" />}
              label="CPA"
              value={loading ? "" : (m!.today.cpa > 0 ? fmtMoney(m!.today.cpa) : "—")}
              sub={m?.today.cpa ? "custo por pedido" : undefined}
              loading={loading}
            />
            <KpiCard
              icon={<ShoppingCart className="size-4" />}
              label="Pedidos"
              value={loading ? "" : String(m!.today.pedidos)}
              loading={loading}
            />
          </div>
        )}
      </Section>

      {/* ── Container Loja ───────────────────────────────────────────────── */}
      <Section title="Loja" icon={<Store className="size-4" />}
        badge={<span className="text-xs text-muted-foreground">histórico</span>}
      >
        {!hasShops ? (
          <p className="text-xs text-muted-foreground">Nenhuma loja vinculada a este card.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <KpiCard
              icon={<DollarSign className="size-4" />}
              label="Faturamento Total"
              value={loading ? "" : fmtMoney(m!.allTime.faturamento)}
              sub="bruto, histórico"
              loading={loading}
            />
            <KpiCard
              icon={<ShoppingCart className="size-4" />}
              label="Pedidos Totais"
              value={loading ? "" : String(m!.allTime.pedidos)}
              sub="histórico"
              loading={loading}
            />
            <KpiCard
              icon={<RefreshCw className="size-4" />}
              label="% Reembolsos"
              value={loading ? "" : fmtPct(m!.month.reembolsoRate)}
              sub="este mês"
              loading={loading}
            />
            <KpiCard
              icon={<AlertTriangle className="size-4" />}
              label="% Estornos"
              value={loading ? "" : fmtPct(m!.allTime.percentEstornos)}
              sub="histórico"
              loading={loading}
            />
          </div>
        )}
      </Section>

      {/* ── Container Meta ───────────────────────────────────────────────── */}
      <Section
        title="Meta"
        icon={<Target className="size-4" />}
        badge={
          derived && (derived as any).vencida
            ? <span className="text-xs font-medium text-destructive bg-destructive/10 rounded-full px-2 py-0.5">Meta vencida</span>
            : (derived as any)?.batida
            ? <span className="text-xs font-medium text-success bg-success/10 rounded-full px-2 py-0.5">Meta batida!</span>
            : undefined
        }
      >
        {/* Form */}
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Meta de lucro (USD)</label>
              <input
                type="number"
                min="0"
                step="100"
                placeholder="ex: 5000"
                value={metaInput}
                onChange={e => setMetaInput(e.target.value)}
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-full"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Prazo</label>
              <input
                type="date"
                value={prazoInput}
                min={isoToday()}
                onChange={e => setPrazoInput(e.target.value)}
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-full"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleSaveGoal(false)}
              disabled={savingGoal}
              className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {savingGoal ? "Salvando..." : "Salvar meta"}
            </button>
            {savedGoal && (
              <button
                onClick={() => handleSaveGoal(true)}
                disabled={savingGoal}
                title="Reinicia o período de acúmulo a partir de hoje"
                className="h-9 px-3 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 text-sm transition-colors"
              >
                <RotateCcw className="size-4" />
              </button>
            )}
          </div>
          {savedGoal && (
            <p className="text-xs text-muted-foreground">
              Período: {new Date(savedGoal.start_date + "T00:00:00Z").toLocaleDateString("pt-BR")} → {new Date(savedGoal.prazo + "T00:00:00Z").toLocaleDateString("pt-BR")}
            </p>
          )}
        </div>

        {/* Derived metrics */}
        {savedGoal && (
          <div className="flex flex-col gap-3 pt-1 border-t border-border">
            {(derived as any)?.error ? (
              <p className="text-xs text-muted-foreground">{(derived as any).error}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <DerivedCell
                    label="Lucro acumulado"
                    icon={<TrendingUp className="size-3" />}
                    value={loadingAcc ? "" : fmtMoney(accData?.lucro ?? 0)}
                    loading={loadingAcc}
                  />
                  <DerivedCell
                    label="Vendas que faltam"
                    icon={<ShoppingCart className="size-3" />}
                    value={
                      !derived ? ""
                      : (derived as any).vencida ? "—"
                      : (derived as any).batida ? "0"
                      : String((derived as any).vendasFaltam ?? "—")
                    }
                    loading={!derived && loadingAcc}
                  />
                  <DerivedCell
                    label="Vendas por dia"
                    icon={<Calendar className="size-3" />}
                    value={
                      !derived ? ""
                      : (derived as any).vencida || (derived as any).batida ? "—"
                      : fmt((derived as any).vendasPorDia ?? 0, { decimals: 1 })
                    }
                    loading={!derived && loadingAcc}
                  />
                  <DerivedCell
                    label="Investimento/dia"
                    icon={<Megaphone className="size-3" />}
                    value={
                      !derived ? ""
                      : (derived as any).vencida || (derived as any).batida ? "—"
                      : metricsData && metricsData.month.cpa > 0
                        ? fmtMoney((derived as any).investimentoPorDia ?? 0)
                        : "Sem CPA"
                    }
                    loading={!derived && loadingAcc}
                  />
                </div>
                {(derived as any)?.diasRestantes != null && !(derived as any).vencida && !(derived as any).batida && (
                  <p className="text-xs text-muted-foreground">
                    {(derived as any).diasRestantes} {(derived as any).diasRestantes === 1 ? "dia restante" : "dias restantes"} · CPA base: {metricsData && metricsData.month.cpa > 0 ? fmtMoney(metricsData.month.cpa) : "—"}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Section>

    </div>
  );
}

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  RefreshCw, DollarSign, Percent, Shield, Megaphone,
  Users, TrendingUp, Package, ShoppingCart, CreditCard,
  Tag, ChevronDown, Info, Plus, ArrowUpRight, ArrowDownRight,
  BarChart3, Repeat2, Pencil, Check, X, CalendarDays,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { getShopDashboardMetrics, upsertOrderSettings, syncShopifyPaymentsFees, syncShopifyChargebacks, syncShopifyRefunds } from "@/lib/shop-orders.functions";
import { syncMetaAdsSpend } from "@/lib/meta-ads.functions";
import { toast } from "sonner";

// ─── Period helpers ───────────────────────────────────────────────────────────

function isoToday() { return new Date().toLocaleDateString("en-CA"); }
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

function getPeriodRange(period: string, custom?: { from: string; to: string }): { from: string; to: string; prevFrom: string; prevTo: string } {
  const today = isoToday();
  let from = today, to = today;
  if (period === "ontem")  { from = addDays(today, -1); to = addDays(today, -1); }
  if (period === "7d")     { from = addDays(today, -6); }
  if (period === "30d")    { from = addDays(today, -29); }
  if (period === "mes")    {
    const d = new Date(); from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; to = today;
  }
  if (period === "custom" && custom) { from = custom.from; to = custom.to; }
  const days = Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86400_000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from, to, prevFrom, prevTo };
}

function formatDateLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtCurrency(n: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type IconColor = "primary" | "success" | "destructive" | "warning" | "info";

function MetricIcon({ children, color = "primary" }: { children: React.ReactNode; color?: IconColor }) {
  const cls: Record<IconColor, string> = {
    primary:     "bg-primary/10 text-primary",
    success:     "bg-success/15 text-success",
    destructive: "bg-destructive/10 text-destructive",
    warning:     "bg-warning/15 text-warning",
    info:        "bg-info/10 text-info",
  };
  return <div className={`size-9 rounded-xl grid place-items-center shrink-0 ${cls[color]}`}>{children}</div>;
}

function Delta({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${pos ? "text-success" : "text-destructive"}`}>
      {pos ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {pos ? "+" : ""}{value}%
    </span>
  );
}

function KpiCard({
  icon, iconColor = "primary", label, value, delta, highlighted = false,
  tooltip, badge, extra, loading,
}: {
  icon: React.ReactNode; iconColor?: IconColor; label: string; value: string;
  delta: number; highlighted?: boolean; tooltip?: string;
  badge?: React.ReactNode; extra?: React.ReactNode; loading?: boolean;
}) {
  return (
    <div className={`relative flex flex-col gap-3 rounded-2xl p-4 border transition-all duration-200 group hover:scale-[1.01] hover:shadow-md ${
      highlighted
        ? "bg-success text-success-foreground border-success/30 shadow-md shadow-success/20"
        : "bg-card border-border hover:border-primary/20"
    }`}>
      <div className="flex items-start justify-between gap-2">
        {highlighted
          ? <div className="size-9 rounded-xl bg-white/20 grid place-items-center">{icon}</div>
          : <MetricIcon color={iconColor}>{icon}</MetricIcon>
        }
        {tooltip && (
          <button className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
            <Info className={`size-3.5 ${highlighted ? "text-white/60" : "text-muted-foreground/50"}`} />
          </button>
        )}
        {badge && <div className={tooltip ? "" : "ml-auto"}>{badge}</div>}
      </div>
      <div>
        <p className={`text-xs font-medium mb-0.5 ${highlighted ? "text-white/80" : "text-muted-foreground"}`}>{label}</p>
        {loading
          ? <div className="h-7 w-24 bg-muted animate-pulse rounded-lg mt-1" />
          : <p className={`text-xl font-bold tracking-tight ${highlighted ? "text-white" : "text-foreground"}`}>{value}</p>
        }
        <div className="mt-1"><Delta value={delta} /></div>
      </div>
      {extra}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">{children}</p>;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-card border border-border p-3 shadow-lg text-xs">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">{p.dataKey}</span>
          <span className="font-semibold text-foreground ml-auto">${p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Unit cost inline editor ──────────────────────────────────────────────────

function UnitCostEditor({ shopId, currentCost, onSaved }: { shopId: string; currentCost: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(currentCost));
  const qc = useQueryClient();
  const upsert = useServerFn(upsertOrderSettings);

  const save = async () => {
    const v = parseFloat(draft);
    if (isNaN(v) || v < 0) return;
    await upsert({ data: { shop_id: shopId, patch: { default_unit_cost: v } } });
    qc.invalidateQueries({ queryKey: ["shop-dashboard", shopId] });
    onSaved();
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(currentCost)); setEditing(true); }}
        className="flex items-center gap-1.5 bg-card border border-border hover:border-primary/30 text-foreground text-xs rounded-xl px-3 h-8 transition-all"
      >
        <Package className="size-3 text-muted-foreground" />
        Custo unit.: <span className="font-semibold">${currentCost.toFixed(2)}</span>
        <Pencil className="size-3 text-muted-foreground ml-1" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">$</span>
      <input
        autoFocus
        type="number" min="0" step="0.01"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="w-20 h-8 text-xs rounded-xl border border-primary bg-card text-foreground px-2 focus:outline-none"
      />
      <button onClick={save} className="size-8 rounded-xl bg-primary grid place-items-center text-primary-foreground hover:opacity-90 transition-opacity">
        <Check className="size-3.5" />
      </button>
      <button onClick={() => setEditing(false)} className="size-8 rounded-xl bg-muted border border-border grid place-items-center text-muted-foreground transition-colors">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ShopDashboard({ shopIds, shopName }: { shopIds: string[]; shopName: string }) {
  const isConsolidated = shopIds.length > 1;
  const cacheKey = shopIds.slice().sort().join(",");
  const [period, setPeriod] = useState("30d");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const [calOpen, setCalOpen] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [activeLines, setActiveLines] = useState({ faturamento: true, lucro: true, custo: false });

  const { from, to, prevFrom, prevTo } = useMemo(
    () => getPeriodRange(period, customRange),
    [period, customRange],
  );

  const periodLabel = useMemo(() => {
    if (period === "hoje")   return "Hoje";
    if (period === "ontem")  return "Ontem";
    if (period === "7d")     return "Últimos 7 dias";
    if (period === "30d")    return "Últimos 30 dias";
    if (period === "mes")    return "Este mês";
    if (period === "custom" && customRange)
      return `${formatDateLabel(customRange.from)} → ${formatDateLabel(customRange.to)}`;
    return "Personalizado";
  }, [period, customRange]);

  const getMetrics   = useServerFn(getShopDashboardMetrics);
  const syncFeesFn      = useServerFn(syncShopifyPaymentsFees);
  const syncCbFn        = useServerFn(syncShopifyChargebacks);
  const syncRefundsFn   = useServerFn(syncShopifyRefunds);
  const syncAdsFn       = useServerFn(syncMetaAdsSpend);
  const qc           = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["shop-dashboard", cacheKey, from, to],
    queryFn: () => getMetrics({ data: { shop_ids: shopIds, from, to, prev_from: prevFrom, prev_to: prevTo } }),
  });

  const [syncing, setSyncing] = useState(false);
  const syncFees = async (silent = false) => {
    setSyncing(true);
    try {
      const sinceDays = Math.max(30, Math.ceil((Date.now() - new Date(from + "T00:00:00").getTime()) / 86_400_000) + 2);
      const results = await Promise.all(
        shopIds.map((shopId) =>
          Promise.all([
            syncFeesFn({ data: { shop_id: shopId } }).catch(() => null),
            syncCbFn({ data: { shop_id: shopId } }).catch(() => null),
            syncRefundsFn({ data: { shop_id: shopId } }).catch(() => null),
            syncAdsFn({ data: { shop_id: shopId, since_days: sinceDays } }).catch(() => null),
          ])
        )
      );
      qc.invalidateQueries({ queryKey: ["shop-dashboard", cacheKey] });
      const total = results.flat().reduce((s, r: any) => s + (r?.synced ?? 0), 0);
      if (!silent || total > 0)
        toast.success(total > 0 ? `${total} lançamentos sincronizados` : "Tudo já sincronizado");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao sincronizar taxas");
    } finally {
      setSyncing(false);
    }
  };

  const m = data?.metrics;
  const fmt = (n: number) => fmtCurrency(n, currency);

  // Goal %
  const goalRevenue = Number(data?.goal?.total_revenue ?? 0);
  const goalPct = goalRevenue > 0 ? Math.min(100, Math.round((m?.faturamento ?? 0) / goalRevenue * 100)) : 0;
  const circumference = 2 * Math.PI * 32;

  const funnelData = [
    { stage: "Página de Vendas", value: 0, pct: 100,  colorVar: "var(--color-primary)" },
    { stage: "Checkout",         value: 0, pct: 0,    colorVar: "var(--color-info)" },
    { stage: "Compra",           value: m?.pedidos ?? 0, pct: 0, colorVar: "var(--color-success)" },
  ];

  return (
    <div className="rounded-2xl space-y-4">

      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-auto">
          <div className="size-7 rounded-full bg-primary grid place-items-center text-primary-foreground text-xs font-bold">
            {shopName?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Bem-vindo,</p>
            <p className="text-sm font-semibold text-foreground leading-tight">{shopName}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          {formatDateLabel(from)}{from !== to ? ` → ${formatDateLabel(to)}` : ""}
        </div>

        <button
          onClick={() => syncFees(false)}
          disabled={syncing}
          className="size-8 rounded-xl bg-muted border border-border hover:border-primary/30 disabled:opacity-50 grid place-items-center text-muted-foreground hover:text-foreground transition-all"
        >
          <RefreshCw className={`size-3.5 ${(isLoading || syncing) ? "animate-spin" : ""}`} />
        </button>

        {/* Period selector */}
        <div className="relative">
          <select
            value={period}
            onChange={e => {
              setPeriod(e.target.value);
              if (e.target.value !== "custom") {
                setCustomRange(undefined);
                syncFees(true);
              }
            }}
            className="appearance-none bg-card border border-border hover:border-primary/30 text-foreground text-xs rounded-xl px-3 pr-7 h-8 cursor-pointer focus:outline-none focus:border-primary transition-all"
          >
            <option value="hoje">Hoje</option>
            <option value="ontem">Ontem</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="mes">Este mês</option>
            <option value="custom">Personalizado</option>
          </select>
          <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Custom date range picker */}
        {period === "custom" && (
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 bg-card border border-primary/40 text-foreground text-xs rounded-xl px-3 h-8 transition-all hover:border-primary">
                <CalendarDays className="size-3.5 text-primary" />
                {customRange
                  ? `${formatDateLabel(customRange.from)} → ${formatDateLabel(customRange.to)}`
                  : "Selecionar datas"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                numberOfMonths={2}
                disabled={{ after: new Date() }}
                selected={customRange ? {
                  from: new Date(customRange.from + "T00:00:00"),
                  to:   new Date(customRange.to   + "T00:00:00"),
                } : undefined}
                onSelect={(range: DateRange | undefined) => {
                  if (range?.from && range?.to) {
                    setCustomRange({
                      from: range.from.toISOString().slice(0, 10),
                      to:   range.to.toISOString().slice(0, 10),
                    });
                    setCalOpen(false);
                    syncFees(true);
                  } else if (range?.from) {
                    setCustomRange({
                      from: range.from.toISOString().slice(0, 10),
                      to:   range.from.toISOString().slice(0, 10),
                    });
                  }
                }}
              />
            </PopoverContent>
          </Popover>
        )}

        <div className="relative">
          <select value={currency} onChange={e => setCurrency(e.target.value)}
            className="appearance-none bg-card border border-border hover:border-primary/30 text-foreground text-xs rounded-xl px-3 pr-7 h-8 cursor-pointer focus:outline-none focus:border-primary transition-all">
            <option value="USD">🇺🇸 USD</option>
            <option value="BRL">🇧🇷 BRL</option>
            <option value="EUR">🇪🇺 EUR</option>
          </select>
          <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {data !== undefined && !isConsolidated && (
          <UnitCostEditor shopId={shopIds[0]} currentCost={data.unitCost} onSaved={() => refetch()} />
        )}
      </div>

      {/* ── KPI row 1 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard highlighted loading={isLoading} icon={<DollarSign className="size-4" />}
          label="Lucro" value={fmt(m?.lucro ?? 0)} delta={m?.lucroDelta ?? 0} tooltip="Faturamento − custo de produto − taxas − chargeback − reembolso − anúncios" />
        <KpiCard loading={isLoading} icon={<DollarSign className="size-4" />} iconColor="primary"
          label="Faturamento" value={fmt(m?.faturamento ?? 0)} delta={m?.faturamentoDelta ?? 0} tooltip="Receita total de pedidos" />
        <KpiCard loading={isLoading} icon={<DollarSign className="size-4" />} iconColor="info"
          label="Custos Totais" value={fmt(m?.custoProduto ?? 0)} delta={m?.custoProdutoDelta ?? 0} tooltip="Custo de produto no período" />
        <KpiCard loading={isLoading} icon={<Shield className="size-4" />} iconColor="warning"
          label="Taxas" value={m?.taxas ? fmt(m.taxas) : "—"} delta={m?.taxasDelta ?? 0}
          tooltip="Taxas Shopify Payments · clique em Sync Fees para atualizar" />
        <KpiCard loading={isLoading} icon={<Percent className="size-4" />} iconColor="primary"
          label="Margem" value={`${(m?.margem ?? 0).toFixed(1)}%`} delta={m?.margemDelta ?? 0} tooltip="Lucro ÷ Faturamento × 100" />
      </div>

      {/* ── Chart + Custos Adicionais ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <SectionLabel>Evolução</SectionLabel>
              <p className="text-sm font-semibold text-foreground -mt-1">Faturamento vs Lucro</p>
            </div>
            <div className="flex items-center gap-2">
              {(["faturamento", "lucro", "custo"] as const).map(key => {
                const colors = { faturamento: "var(--color-primary)", lucro: "var(--color-success)", custo: "var(--color-warning)" };
                const labels = { faturamento: "Faturamento", lucro: "Lucro", custo: "Custo" };
                const active = activeLines[key];
                return (
                  <button key={key}
                    onClick={() => setActiveLines(p => ({ ...p, [key]: !p[key] }))}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-all ${active ? "border-border bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    <span className="size-2 rounded-full transition-colors" style={{ background: active ? colors[key] : "var(--color-border)" }} />
                    {labels[key]}
                  </button>
                );
              })}
            </div>
          </div>

          {isLoading ? (
            <div className="h-[220px] bg-muted animate-pulse rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data?.chartData ?? []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  {(["faturamento","lucro","custo"] as const).map(k => {
                    const c = { faturamento: "var(--color-primary)", lucro: "var(--color-success)", custo: "var(--color-warning)" }[k];
                    return (
                      <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={c} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={c} stopOpacity={0} />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
                {activeLines.faturamento && <Area type="monotone" dataKey="faturamento" stroke="var(--color-primary)" strokeWidth={2} fill="url(#grad-faturamento)" dot={false} activeDot={{ r: 4, fill: "var(--color-primary)" }} />}
                {activeLines.lucro       && <Area type="monotone" dataKey="lucro"       stroke="var(--color-success)" strokeWidth={2} fill="url(#grad-lucro)"       dot={false} activeDot={{ r: 4, fill: "var(--color-success)" }} />}
                {activeLines.custo       && <Area type="monotone" dataKey="custo"       stroke="var(--color-warning)" strokeWidth={2} fill="url(#grad-custo)"       dot={false} activeDot={{ r: 4, fill: "var(--color-warning)" }} />}
              </AreaChart>
            </ResponsiveContainer>
          )}

          {/* Funnel */}
          <div className="mt-5 pt-4 border-t border-border">
            <SectionLabel>Funil de Conversão</SectionLabel>
            {funnelData.map(stage => (
              <div key={stage.stage} className="flex items-center gap-3 mb-2.5">
                <span className="text-xs text-muted-foreground w-32 shrink-0">{stage.stage}</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${stage.pct}%`, background: stage.colorVar }} />
                </div>
                <span className="text-xs text-muted-foreground w-14 text-right">{stage.value.toLocaleString()}</span>
                <span className="text-xs font-semibold text-foreground w-12 text-right">
                  {stage.pct > 0 ? `${stage.pct}%` : "—"}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground/60 mt-2">Página de vendas e checkout requerem rastreamento de pixel.</p>
          </div>
        </div>

        {/* Custos Adicionais */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <MetricIcon color="info"><BarChart3 className="size-4" /></MetricIcon>
            <div>
              <p className="text-xs text-muted-foreground">Custos Adicionais</p>
              <p className="text-lg font-bold text-foreground">
                {(m?.chargeback || m?.reembolso)
                  ? fmt((m?.chargeback ?? 0) + (m?.reembolso ?? 0))
                  : "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <div className="size-3.5 rounded border border-border bg-card" />
            <span className="text-xs text-muted-foreground">Descontar Custos Adicionais</span>
          </div>

          <div className="space-y-0.5">
            {[
              { label: "Chargeback",  icon: <Repeat2 className="size-3.5" />,   value: m?.chargeback ? fmt(m.chargeback) : "—", color: m?.chargeback ? "text-destructive" : "text-muted-foreground" },
              { label: "Reembolso",   icon: <CreditCard className="size-3.5" />, value: m?.reembolso ? fmt(m.reembolso) : "—", color: m?.reembolso ? "text-destructive" : "text-muted-foreground" },
              { label: "Impostos",    icon: <Shield className="size-3.5" />,     value: "—", color: "text-muted-foreground", hasAdd: true },
              { label: "Operacional", icon: <Package className="size-3.5" />,    value: "—", color: "text-muted-foreground", hasAdd: true },
              { label: "Garantia",    icon: <Shield className="size-3.5" />,     value: "Sem Garantia", color: "text-success", hasAdd: true },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="text-xs text-muted-foreground flex-1">{item.label}</span>
                {item.hasAdd && (
                  <button className="size-4 rounded-md bg-muted hover:bg-accent grid place-items-center text-muted-foreground transition-colors">
                    <Plus className="size-2.5" />
                  </button>
                )}
                <span className={`text-xs font-medium ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>

          {/* Meta de Faturamento */}
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-foreground">Meta de Faturamento</p>
              <button className="size-5 rounded-md bg-muted hover:bg-accent grid place-items-center text-muted-foreground transition-colors">
                <Plus className="size-3" />
              </button>
            </div>
            {goalRevenue > 0
              ? <p className="text-xs text-muted-foreground mb-4">{fmt(m?.faturamento ?? 0)} de {fmt(goalRevenue)}</p>
              : <p className="text-xs text-muted-foreground mb-4">Nenhuma meta cadastrada</p>
            }
            <div className="relative size-20 mx-auto">
              <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                <circle cx="40" cy="40" r="32" fill="none" stroke="var(--color-border)" strokeWidth="8" />
                <circle cx="40" cy="40" r="32" fill="none" stroke="var(--color-primary)" strokeWidth="8"
                  strokeDasharray={`${circumference * goalPct / 100} ${circumference}`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-foreground">{goalPct}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI row 2: Ads ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard loading={isLoading} icon={<Megaphone className="size-4" />} iconColor="primary"
          label="Anúncios"
          value={m?.anuncios ? fmt(m.anuncios) : "—"}
          delta={m?.anunciosDelta ?? 0}
          tooltip="Gasto Meta Ads no período"
          badge={!m?.anuncios ? <span className="text-[10px] bg-muted text-muted-foreground rounded-lg px-1.5 py-0.5">Pendente</span> : undefined}
        />
        <KpiCard loading={isLoading} icon={<Users className="size-4" />} iconColor="primary"
          label="CPA"
          value={m?.cpa ? fmt(m.cpa) : "—"}
          delta={m?.cpaDelta ?? 0}
          tooltip="Custo por aquisição (Anúncios ÷ Pedidos)" />
        <KpiCard loading={isLoading} icon={<TrendingUp className="size-4" />} iconColor="info"
          label="ROI"
          value={m?.roi && m.anuncios ? `${m.roi.toFixed(1)}%` : "—"}
          delta={0}
          tooltip="Retorno sobre investimento em anúncios" />
        <KpiCard loading={isLoading} icon={<BarChart3 className="size-4" />} iconColor="warning"
          label="ROAS"
          value={m?.roas && m.anuncios ? `${m.roas.toFixed(2)}x` : "—"}
          delta={m?.roasDelta ?? 0}
          tooltip="Retorno sobre gasto em anúncios (Faturamento ÷ Anúncios)" />
      </div>

      {/* ── KPI row 3: Operations ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard loading={isLoading} icon={<DollarSign className="size-4" />} iconColor="destructive"
          label="C. de Produto" value={fmt(m?.custoProduto ?? 0)} delta={m?.custoProdutoDelta ?? 0}
          tooltip="Custo unitário × unidades vendidas"
          badge={
            <div className="flex gap-1">
              <button className="size-5 rounded-lg bg-muted hover:bg-accent grid place-items-center text-muted-foreground transition-colors"><Repeat2 className="size-3" /></button>
              <button className="size-5 rounded-lg bg-muted hover:bg-accent grid place-items-center text-muted-foreground transition-colors"><Plus className="size-3" /></button>
            </div>
          }
        />
        <KpiCard loading={isLoading} icon={<ShoppingCart className="size-4" />} iconColor="primary"
          label="Pedidos" value={String(m?.pedidos ?? 0)} delta={m?.pedidosDelta ?? 0}
          tooltip="Total de pedidos sincronizados"
        />
        <KpiCard loading={isLoading} icon={<CreditCard className="size-4" />} iconColor="info"
          label="Ticket Médio" value={fmt(m?.ticketMedio ?? 0)} delta={m?.ticketMedioDelta ?? 0}
          tooltip="Faturamento ÷ Pedidos" />
        <KpiCard loading={isLoading} icon={<Tag className="size-4" />} iconColor="primary"
          label="Unidades Vendidas" value={String(m?.unidades ?? 0)} delta={m?.unidadesDelta ?? 0}
          tooltip="Total de itens nos pedidos" />
      </div>
    </div>
  );
}

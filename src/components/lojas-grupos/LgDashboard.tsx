import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  RefreshCw, DollarSign, Percent, Shield, Megaphone,
  Users, TrendingUp, Package, ShoppingCart,
  Tag, ChevronDown, Info, ArrowUpRight, ArrowDownRight,
  BarChart3, CalendarDays,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getShopDashboardMetrics, syncShopifyPaymentsFees, syncShopifyOrders,
} from "@/lib/shop-orders.functions";
import { syncMetaAdsSpend } from "@/lib/meta-ads.functions";
import {
  getLgCurrencyRates, saveLgCurrencyRates,
} from "@/lib/lg-cards.functions";
import { toast } from "sonner";

// ─── Period helpers ───────────────────────────────────────────────────────────

function isoToday() { return new Date().toLocaleDateString("en-CA"); }
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function getPeriodRange(period: string, custom?: { from: string; to: string }) {
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
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function fmtCurrency(n: number, currency: string, rate = 1) {
  return new Intl.NumberFormat(currency === "BRL" ? "pt-BR" : "en-US", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(n * rate);
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
  highlightedVariant = "success", tooltip, badge, loading, onClick,
}: {
  icon: React.ReactNode; iconColor?: IconColor; label: string; value: string;
  delta: number; highlighted?: boolean; highlightedVariant?: "success" | "destructive";
  tooltip?: string; badge?: React.ReactNode; loading?: boolean; onClick?: () => void;
}) {
  const hlClass = highlightedVariant === "destructive"
    ? "bg-destructive text-destructive-foreground border-destructive/30 shadow-md shadow-destructive/20"
    : "bg-success text-success-foreground border-success/30 shadow-md shadow-success/20";
  return (
    <div
      onClick={onClick}
      className={`relative flex flex-col gap-3 rounded-2xl p-4 border transition-all duration-200 group hover:scale-[1.01] hover:shadow-md ${
        highlighted ? hlClass : "bg-card border-border hover:border-primary/20"
      } ${onClick ? "cursor-pointer" : ""}`}
    >
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
      {onClick && !loading && (
        <div className={`absolute bottom-2 right-2 text-[10px] ${highlighted ? "text-white/50" : "text-muted-foreground/40"} opacity-0 group-hover:opacity-100 transition-opacity`}>
          detalhes →
        </div>
      )}
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

// ─── Date range picker (reusable) ────────────────────────────────────────────

export function DateRangePicker({
  period, setPeriod, customRange, setCustomRange, onApply,
}: {
  period: string;
  setPeriod: (p: string) => void;
  customRange: { from: string; to: string } | undefined;
  setCustomRange: (r: { from: string; to: string } | undefined) => void;
  onApply?: () => void;
}) {
  const [calOpen,      setCalOpen]      = useState(false);
  const [pendingRange, setPendingRange] = useState<{ from: string; to: string } | undefined>();

  const apply = (r: { from: string; to: string }) => {
    setCustomRange(r);
    setPendingRange(undefined);
    setCalOpen(false);
    onApply?.();
  };

  return (
    <>
      <div className="relative">
        <select
          value={period}
          onChange={e => {
            setPeriod(e.target.value);
            if (e.target.value !== "custom") { setCustomRange(undefined); onApply?.(); }
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

      {period === "custom" && (
        <Popover open={calOpen} onOpenChange={(o) => { setCalOpen(o); if (!o) setPendingRange(undefined); }}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1.5 bg-card border border-primary/40 text-foreground text-xs rounded-xl px-3 h-8 hover:border-primary">
              <CalendarDays className="size-3.5 text-primary" />
              {customRange ? `${fmtDate(customRange.from)} → ${fmtDate(customRange.to)}` : "Selecionar datas"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={(() => {
                const r = pendingRange ?? customRange;
                return r ? { from: new Date(r.from + "T00:00:00"), to: new Date(r.to + "T00:00:00") } : undefined;
              })()}
              onSelect={(range: DateRange | undefined) => {
                if (!range?.from) { setPendingRange(undefined); return; }
                const fromStr = range.from.toISOString().slice(0, 10);
                const toStr   = range.to ? range.to.toISOString().slice(0, 10) : fromStr;
                const sameDay = fromStr === toStr;
                setPendingRange({ from: fromStr, to: toStr });
                if (!sameDay) apply({ from: fromStr, to: toStr });
              }}
            />
            {pendingRange && pendingRange.from === pendingRange.to && (
              <div className="border-t border-border px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{fmtDate(pendingRange.from)}</span>
                <button
                  onClick={() => apply(pendingRange)}
                  className="text-xs px-3 py-1 bg-primary text-primary-foreground rounded-lg"
                >
                  Aplicar
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

// ─── Per-shop breakdown dialog ────────────────────────────────────────────────

function BreakdownDialog({
  open, onClose, label, shopIds, shopNamesMap, from, to, prevFrom, prevTo, metric,
  currency, currencyRate,
}: {
  open: boolean; onClose: () => void; label: string;
  shopIds: string[]; shopNamesMap: Record<string, string>;
  from: string; to: string; prevFrom: string; prevTo: string;
  metric: "faturamento" | "taxas" | "pedidos" | "custoProduto";
  currency: string; currencyRate: number;
}) {
  const getMetricsFn = useServerFn(getShopDashboardMetrics);

  const queries = shopIds.map((shopId) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ["lg-dash-breakdown", shopId, from, to],
      queryFn:  () => getMetricsFn({ data: { shop_ids: [shopId], from, to, prev_from: prevFrom, prev_to: prevTo } }),
      enabled:  open,
    })
  );

  const rows = shopIds.map((shopId, i) => ({
    shopId, name: shopNamesMap[shopId] ?? shopId,
    data: queries[i].data?.metrics, loading: queries[i].isLoading,
  }));

  const getValue = (m: any) => {
    if (!m) return null;
    if (metric === "faturamento")   return m.faturamento;
    if (metric === "taxas")         return m.taxas;
    if (metric === "pedidos")       return m.pedidos;
    if (metric === "custoProduto")  return m.custoProduto;
    return null;
  };

  const formatValue = (v: number | null) => {
    if (v === null || v === undefined) return "—";
    if (metric === "pedidos") return String(v);
    return fmtCurrency(v, currency, currencyRate);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{label} — por loja</DialogTitle></DialogHeader>
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.shopId} className="flex items-center gap-3 py-3">
              <div className="size-7 rounded-lg bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">
                {row.name?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{row.name}</p>
              </div>
              <div className="text-sm font-semibold text-foreground">
                {row.loading
                  ? <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                  : formatValue(getValue(row.data))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{fmtDate(from)} → {fmtDate(to)}</p>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LgDashboard({
  cardId, shopIds, cardName, shopNamesMap, isConsolidated,
}: {
  cardId: string;
  shopIds: string[];
  cardName: string;
  shopNamesMap: Record<string, string>;
  isConsolidated: boolean;
}) {
  const cacheKey = shopIds.slice().sort().join(",");
  const [period, setPeriod]           = useState("hoje");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const [currency, setCurrency]       = useState("USD");
  const [brlRate, setBrlRate]         = useState(5.0);
  const [eurRate, setEurRate]         = useState(0.92);
  const [rateOpen, setRateOpen]       = useState(false);
  const rateDebounce                  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeLines, setActiveLines] = useState({ faturamento: true, lucro: true, custo: false, anuncios: false });
  const [breakdown, setBreakdown]     = useState<null | {
    metric: "faturamento" | "taxas" | "pedidos" | "custoProduto";
    label:  string;
  }>(null);

  const { from, to, prevFrom, prevTo } = useMemo(
    () => getPeriodRange(period, customRange),
    [period, customRange],
  );

  const getRatesFn   = useServerFn(getLgCurrencyRates);
  const saveRatesFn  = useServerFn(saveLgCurrencyRates);
  const getMetrics   = useServerFn(getShopDashboardMetrics);
  const syncOrdersFn = useServerFn(syncShopifyOrders);
  const syncFeesFn   = useServerFn(syncShopifyPaymentsFees);
  const syncAdsFn    = useServerFn(syncMetaAdsSpend);
  const qc           = useQueryClient();

  // Load saved currency rates
  useEffect(() => {
    getRatesFn({ data: { card_id: cardId } }).then((r) => {
      if (r) { setBrlRate(Number(r.brl_rate)); setEurRate(Number(r.eur_rate)); }
    }).catch(() => null);
  }, [cardId]);

  const saveRates = (brl: number, eur: number) => {
    if (rateDebounce.current) clearTimeout(rateDebounce.current);
    rateDebounce.current = setTimeout(() => {
      saveRatesFn({ data: { card_id: cardId, brl_rate: brl, eur_rate: eur } }).catch(() => null);
    }, 1000);
  };

  const currencyRate = currency === "BRL" ? brlRate : currency === "EUR" ? eurRate : 1;

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["lg-dashboard", cacheKey, from, to],
    queryFn:  () => getMetrics({ data: { shop_ids: shopIds, from, to, prev_from: prevFrom, prev_to: prevTo } }),
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: true,
  });

  // Gráfico "Evolução": quando o período é "Hoje" (1 dia só), mostra os últimos
  // 7 dias em vez de um único ponto. Qualquer outro período selecionado usa o
  // mesmo range escolhido pelo usuário.
  const isToday = period === "hoje";
  const chartRange = useMemo(
    () => isToday ? getPeriodRange("7d") : { from, to, prevFrom, prevTo },
    [isToday, from, to, prevFrom, prevTo],
  );
  const { data: chartQueryData, isLoading: chartQueryLoading } = useQuery({
    queryKey: ["lg-dashboard-chart", cacheKey, chartRange.from, chartRange.to],
    queryFn:  () => getMetrics({ data: { shop_ids: shopIds, from: chartRange.from, to: chartRange.to, prev_from: chartRange.prevFrom, prev_to: chartRange.prevTo } }),
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: true,
    enabled: isToday,
  });
  const chartData = isToday ? (chartQueryData?.chartData ?? []) : (data?.chartData ?? []);
  const chartLoading = isToday ? chartQueryLoading : isLoading;

  const [syncing, setSyncing] = useState(false);
  const syncData = async (silent = false) => {
    setSyncing(true);
    try {
      const sinceDays = Math.max(1, Math.ceil((Date.now() - new Date(from + "T00:00:00").getTime()) / 86_400_000) + 2);
      const results   = await Promise.all(
        shopIds.map((shopId) => Promise.all([
          syncOrdersFn({ data: { shop_id: shopId, since_days: sinceDays } }).catch(() => null),
          syncFeesFn({ data: { shop_id: shopId } }).catch(() => null),
          syncAdsFn({ data: { shop_id: shopId, from_date: from, to_date: to } }).catch(() => null),
        ]))
      );
      qc.invalidateQueries({ queryKey: ["lg-dashboard", cacheKey] });
      qc.invalidateQueries({ queryKey: ["lg-note-metrics"] });
      const total = results.flat().reduce((s, r: any) => s + (r?.synced ?? 0), 0);
      if (!silent)
        toast.success(total > 0 ? `${total} lançamentos sincronizados` : "Tudo já sincronizado");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  const m   = data?.metrics;
  const fmt = (n: number) => fmtCurrency(n, currency, currencyRate);

  const openBreakdown = (metric: NonNullable<typeof breakdown>["metric"], label: string) => {
    if (isConsolidated) setBreakdown({ metric, label });
  };

  const CHART_LINES = [
    { key: "faturamento" as const, label: "Faturamento", color: "var(--color-primary)" },
    { key: "lucro"       as const, label: "Lucro",       color: "var(--color-success)" },
    { key: "custo"       as const, label: "Custo",       color: "var(--color-warning)" },
    { key: "anuncios"    as const, label: "Ads",         color: "oklch(0.65 0.22 300)" },
  ];

  return (
    <div className="space-y-4">

      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-auto">
          <div className="size-7 rounded-full bg-primary grid place-items-center text-primary-foreground text-xs font-bold">
            {cardName?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Dashboard</p>
            <p className="text-sm font-semibold text-foreground leading-tight">{cardName}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          {fmtDate(from)}{from !== to ? ` → ${fmtDate(to)}` : ""}
        </div>

        <div className="flex items-center gap-1.5">
          {dataUpdatedAt > 0 && (
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {new Date(dataUpdatedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => syncData(false)}
            disabled={syncing}
            className="size-8 rounded-xl bg-muted border border-border hover:border-primary/30 disabled:opacity-50 grid place-items-center text-muted-foreground hover:text-foreground transition-all"
          >
            <RefreshCw className={`size-3.5 ${(isLoading || syncing) ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Period + date picker */}
        <DateRangePicker
          period={period} setPeriod={setPeriod}
          customRange={customRange} setCustomRange={setCustomRange}
          onApply={() => syncData(true)}
        />

        {/* Currency selector */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <select
              value={currency}
              onChange={e => { setCurrency(e.target.value); if (e.target.value !== "USD") setRateOpen(true); else setRateOpen(false); }}
              className="appearance-none bg-card border border-border hover:border-primary/30 text-foreground text-xs rounded-xl px-3 pr-7 h-8 cursor-pointer focus:outline-none focus:border-primary transition-all"
            >
              <option value="USD">🇺🇸 USD</option>
              <option value="BRL">🇧🇷 BRL</option>
              <option value="EUR">🇪🇺 EUR</option>
            </select>
            <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          {currency !== "USD" && (
            <div className="flex items-center gap-1 h-8 px-2 rounded-xl border border-border bg-card text-xs">
              <span className="text-muted-foreground">1 USD =</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={currency === "BRL" ? brlRate : eurRate}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!v || v <= 0) return;
                  if (currency === "BRL") { setBrlRate(v); saveRates(v, eurRate); }
                  else { setEurRate(v); saveRates(brlRate, v); }
                }}
                className="w-16 bg-transparent text-foreground focus:outline-none text-right"
              />
              <span className="text-muted-foreground">{currency}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── KPI row 1 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard highlighted highlightedVariant={(m?.lucro ?? 0) < 0 ? "destructive" : "success"} loading={isLoading}
          icon={<DollarSign className="size-4" />}
          label="Lucro" value={fmt(m?.lucro ?? 0)} delta={m?.lucroDelta ?? 0}
          tooltip="Faturamento líquido − custo − taxas − anúncios"
        />
        <KpiCard loading={isLoading}
          icon={<DollarSign className="size-4" />} iconColor="primary"
          label="Faturamento" value={fmt(m?.faturamento ?? 0)} delta={m?.faturamentoDelta ?? 0}
          tooltip="Receita de pedidos descontados reembolsos e chargebacks"
          onClick={isConsolidated ? () => openBreakdown("faturamento", "Faturamento") : undefined}
        />
        <KpiCard loading={isLoading}
          icon={<DollarSign className="size-4" />} iconColor="info"
          label="Custo Total" value={fmt(m?.custoTotal ?? 0)} delta={m?.custoTotalDelta ?? 0}
          tooltip="Anúncios + Taxas + Custo de Produto"
        />
        <KpiCard loading={isLoading}
          icon={<Shield className="size-4" />} iconColor="warning"
          label="Taxas" value={m?.taxas ? fmt(m.taxas) : "—"} delta={m?.taxasDelta ?? 0}
          tooltip="Taxas Shopify Payments"
          onClick={isConsolidated ? () => openBreakdown("taxas", "Taxas") : undefined}
        />
        <KpiCard loading={isLoading}
          icon={<Percent className="size-4" />} iconColor="primary"
          label="Margem" value={`${(m?.margem ?? 0).toFixed(1)}%`} delta={m?.margemDelta ?? 0}
          tooltip="Lucro ÷ Faturamento × 100"
        />
      </div>

      {/* ── Chart + Custos Adicionais ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <SectionLabel>Evolução</SectionLabel>
              <p className="text-sm font-semibold text-foreground -mt-1">Faturamento vs Lucro</p>
            </div>
            <div className="flex items-center gap-2">
              {CHART_LINES.map(({ key, label, color }) => {
                const active = activeLines[key];
                return (
                  <button key={key}
                    onClick={() => setActiveLines(p => ({ ...p, [key]: !p[key] }))}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-all ${active ? "border-border bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    <span className="size-2 rounded-full" style={{ background: active ? color : "var(--color-border)" }} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {chartLoading ? (
            <div className="h-[220px] bg-muted animate-pulse rounded-xl" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  {CHART_LINES.map(({ key, color }) => (
                    <linearGradient key={key} id={`lg-grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
                {CHART_LINES.map(({ key, color }) =>
                  activeLines[key] && (
                    <Area key={key} type="monotone" dataKey={key} stroke={color} strokeWidth={2}
                      fill={`url(#lg-grad-${key})`} dot={false} activeDot={{ r: 4, fill: color }} />
                  )
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Custos Adicionais */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <MetricIcon color="info"><BarChart3 className="size-4" /></MetricIcon>
            <div>
              <p className="text-xs text-muted-foreground">Custos Adicionais</p>
              <p className="text-lg font-bold text-foreground">
                {isLoading ? "—" : fmt((m?.reembolsos ?? 0) + (m?.chargebacks ?? 0))}
              </p>
            </div>
          </div>
          <div className="space-y-0.5">
            {[
              {
                label: "Reembolsos",
                value: isLoading ? "—" : (m?.reembolsos ? fmt(m.reembolsos) : "—"),
                color: m?.reembolsos ? "text-destructive" : "text-muted-foreground",
              },
              {
                label: "Chargebacks",
                value: isLoading ? "—" : (m?.chargebacks ? fmt(m.chargebacks) : "—"),
                color: m?.chargebacks ? "text-destructive" : "text-muted-foreground",
              },
              { label: "Impostos",    value: "—",            color: "text-muted-foreground" },
              { label: "Operacional", value: "—",            color: "text-muted-foreground" },
              { label: "Garantia",    value: "Sem Garantia", color: "text-emerald-500" },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
                <Package className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground flex-1">{item.label}</span>
                <span className={`text-xs font-medium ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI row 2: Ads ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard loading={isLoading} icon={<Megaphone className="size-4" />} iconColor="primary"
          label="Anúncios" value={m?.anuncios ? fmt(m.anuncios) : "—"} delta={m?.anunciosDelta ?? 0}
          tooltip="Gasto Meta Ads no período"
          badge={!m?.anuncios ? <span className="text-[10px] bg-muted text-muted-foreground rounded-lg px-1.5 py-0.5">Pendente</span> : undefined}
        />
        <KpiCard loading={isLoading} icon={<Users className="size-4" />} iconColor="primary"
          label="CPA" value={m?.cpa ? fmt(m.cpa) : "—"} delta={m?.cpaDelta ?? 0}
          tooltip="Custo por aquisição (Anúncios ÷ Pedidos)"
        />
        <KpiCard loading={isLoading} icon={<TrendingUp className="size-4" />} iconColor="info"
          label="ROI" value={m?.roi && m.anuncios ? `${m.roi.toFixed(1)}%` : "—"} delta={0}
          tooltip="Retorno sobre investimento em anúncios"
        />
        <KpiCard loading={isLoading} icon={<BarChart3 className="size-4" />} iconColor="warning"
          label="ROAS" value={m?.roas && m.anuncios ? `${m.roas.toFixed(2)}x` : "—"} delta={m?.roasDelta ?? 0}
          tooltip="Retorno sobre gasto em anúncios"
        />
      </div>

      {/* ── KPI row 3: Operations ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard loading={isLoading} icon={<DollarSign className="size-4" />} iconColor="destructive"
          label="C. de Produto" value={fmt(m?.custoProduto ?? 0)} delta={m?.custoProdutoDelta ?? 0}
          tooltip="Custo unitário × unidades vendidas"
          onClick={isConsolidated ? () => openBreakdown("custoProduto", "Custo de Produto") : undefined}
        />
        <KpiCard loading={isLoading} icon={<ShoppingCart className="size-4" />} iconColor="primary"
          label="Pedidos" value={String(m?.pedidos ?? 0)} delta={m?.pedidosDelta ?? 0}
          tooltip="Total de pedidos sincronizados"
          onClick={isConsolidated ? () => openBreakdown("pedidos", "Pedidos") : undefined}
        />
        <KpiCard loading={isLoading} icon={<TrendingUp className="size-4" />} iconColor="info"
          label="Ticket Médio" value={fmt(m?.ticketMedio ?? 0)} delta={m?.ticketMedioDelta ?? 0}
          tooltip="Faturamento ÷ Pedidos"
        />
        <KpiCard loading={isLoading} icon={<Tag className="size-4" />} iconColor="primary"
          label="Unidades Vendidas" value={String(m?.unidades ?? 0)} delta={m?.unidadesDelta ?? 0}
          tooltip="Total de itens nos pedidos"
        />
      </div>

      {/* ── Breakdown dialog ── */}
      {breakdown && (
        <BreakdownDialog
          open={Boolean(breakdown)}
          onClose={() => setBreakdown(null)}
          label={breakdown.label}
          metric={breakdown.metric}
          shopIds={shopIds}
          shopNamesMap={shopNamesMap}
          from={from} to={to} prevFrom={prevFrom} prevTo={prevTo}
          currency={currency} currencyRate={currencyRate}
        />
      )}
    </div>
  );
}

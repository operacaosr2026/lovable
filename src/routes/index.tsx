import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/PageHeader";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TrendingUp, Megaphone, Package, Wallet, RotateCcw, SlidersHorizontal } from "lucide-react";
import { listLgCardsOverview } from "@/lib/lg-cards.functions";
import { DateRangePicker } from "@/components/lojas-grupos/LgDashboard";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { redirect } from "@tanstack/react-router";

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

function isoToday() { return new Date().toLocaleDateString("en-CA"); }
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
    const d = new Date(); from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; to = today;
  }
  if (period === "custom" && custom) { from = custom.from; to = custom.to; }
  return { from, to };
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

// ─── Metric breakdown card ────────────────────────────────────────────────────

type MetricAccent = "primary" | "info" | "warning" | "success" | "destructive";

const METRIC_ACCENTS: Record<MetricAccent, { chip: string; bar: string }> = {
  primary:     { chip: "bg-primary/10 text-primary",         bar: "bg-primary" },
  info:        { chip: "bg-info/10 text-info",               bar: "bg-info" },
  warning:     { chip: "bg-warning/15 text-warning",         bar: "bg-warning" },
  success:     { chip: "bg-success/15 text-success",         bar: "bg-success" },
  destructive: { chip: "bg-destructive/10 text-destructive", bar: "bg-destructive" },
};

function MetricBreakdownCard({
  icon: Icon, accent, label, total, rows, negative, secondaryBadge, format = fmtMoney, emptyLabel = "Sem dados no período.", periodOverride,
}: {
  icon: any; accent: MetricAccent; label: string; total: number;
  rows: { id: string; name: string; value: number; sub?: string }[];
  negative?: boolean;
  secondaryBadge?: React.ReactNode;
  format?: (n: number) => string;
  emptyLabel?: string;
  periodOverride?: string;
}) {
  const a = METRIC_ACCENTS[accent];
  const maxValue = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  const sorted = [...rows].sort((x, y) => y.value - x.value);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 soft-shadow-sm min-w-0">
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`size-9 rounded-xl grid place-items-center shrink-0 ${a.chip}`}>
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{label}</p>
          <p className={`text-xl xl:text-2xl font-bold tracking-tight truncate ${negative ? "text-destructive" : "text-foreground"}`}>
            {format(total)}
          </p>
          {periodOverride && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{periodOverride}</p>}
        </div>
        {secondaryBadge && <div className="ml-auto shrink-0">{secondaryBadge}</div>}
      </div>

      {sorted.length > 0 ? (
        <div className="mt-4 space-y-2.5">
          {sorted.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <span className="text-xs text-foreground/90 truncate w-14 sm:w-16 shrink-0" title={row.name}>{row.name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[24px]">
                <div
                  className={`h-full rounded-full ${a.bar} transition-all duration-500`}
                  style={{ width: `${Math.max(2, (Math.abs(row.value) / maxValue) * 100)}%` }}
                />
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs font-semibold tabular-nums text-foreground">{format(row.value)}</span>
                {row.sub && <span className="block text-[9px] text-muted-foreground tabular-nums leading-tight truncate max-w-20">{row.sub}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mt-4">{emptyLabel}</p>
      )}
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────────

function Dashboard() {
  const { session } = useAuth();
  const listLgCardsOverviewFn = useServerFn(listLgCardsOverview);

  const [period, setPeriod] = useState("mes");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const { from, to } = useMemo(() => getPeriodRange(period, customRange), [period, customRange]);

  const { data: cardsData, isFetching } = useQuery({
    queryKey: ["lg-cards-overview", from, to],
    queryFn: () => listLgCardsOverviewFn({ data: { from, to } }),
    enabled: !!session,
  });
  const cards = (cardsData as any)?.cards ?? [];
  const shopEstorno = (cardsData as any)?.shopEstorno ?? [];

  const today = new Date();
  const dateLabel = today.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const greeting = (() => {
    const h = today.getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  })();
  const firstName = (session?.user?.user_metadata?.full_name ?? session?.user?.email?.split("@")[0] ?? "")
    .toString().split(" ")[0];

  const totalFaturamento = cards.reduce((s: number, c: any) => s + Number(c.faturamentoMes ?? 0), 0);
  const totalAds         = cards.reduce((s: number, c: any) => s + Number(c.anunciosMes ?? 0), 0);
  const totalCusto       = cards.reduce((s: number, c: any) => s + Number(c.custoProdutoMes ?? 0), 0);
  const totalLucro       = cards.reduce((s: number, c: any) => s + Number(c.lucroMes ?? 0), 0);
  const margemTotal      = totalFaturamento > 0 ? totalLucro / totalFaturamento : 0;

  const estornoTotals = shopEstorno.reduce(
    (acc: { pedidos: number; estornos: number }, s: any) => ({
      pedidos: acc.pedidos + Number(s.totalPedidos ?? 0),
      estornos: acc.estornos + Number(s.totalEstornos ?? 0),
    }),
    { pedidos: 0, estornos: 0 },
  );
  const taxaEstornoTotal = estornoTotals.pedidos > 0 ? estornoTotals.estornos / estornoTotals.pedidos : 0;

  return (
    <PageShell>
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 capitalize">{dateLabel}</p>
        </div>
      </div>

      {cards.length > 0 && (
        <div className="rounded-[1.75rem] border border-primary/15 bg-gradient-to-br from-primary/[0.05] via-card to-card p-5 sm:p-6 soft-shadow">
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                <SlidersHorizontal className="size-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground leading-tight">Visão geral</h2>
                <p className="text-[11px] text-muted-foreground leading-tight">
                  {fmtDate(from)} → {fmtDate(to)} · todas as lojas e grupos
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isFetching && <div className="size-3.5 rounded-full border-2 border-border border-t-primary animate-spin" />}
              <DateRangePicker period={period} setPeriod={setPeriod} customRange={customRange} setCustomRange={setCustomRange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <MetricBreakdownCard
              icon={TrendingUp}
              accent="primary"
              label="Faturamento total"
              total={totalFaturamento}
              rows={cards.map((c: any) => ({ id: c.id, name: c.name, value: Number(c.faturamentoMes ?? 0) }))}
            />
            <MetricBreakdownCard
              icon={Megaphone}
              accent="info"
              label="Gasto com ads"
              total={totalAds}
              rows={cards.map((c: any) => ({ id: c.id, name: c.name, value: Number(c.anunciosMes ?? 0) }))}
            />
            <MetricBreakdownCard
              icon={Package}
              accent="warning"
              label="Gasto com pedidos"
              total={totalCusto}
              rows={cards.map((c: any) => ({ id: c.id, name: c.name, value: Number(c.custoProdutoMes ?? 0) }))}
            />
            <MetricBreakdownCard
              icon={Wallet}
              accent="success"
              label="Lucro"
              total={totalLucro}
              negative={totalLucro < 0}
              secondaryBadge={
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                  margemTotal >= 0 ? "bg-success/15 text-success border-success/30" : "bg-destructive/15 text-destructive border-destructive/30"
                }`}>
                  {fmtPct(margemTotal)}
                </span>
              }
              rows={cards.map((c: any) => ({
                id: c.id, name: c.name, value: Number(c.lucroMes ?? 0),
                sub: fmtPct(Number(c.margemMes ?? 0)),
              }))}
            />
            <div className="relative rounded-2xl overflow-hidden min-w-0">
              <div className="blur-sm pointer-events-none select-none">
                <MetricBreakdownCard
                  icon={RotateCcw}
                  accent="destructive"
                  label="Taxa de estorno"
                  total={taxaEstornoTotal}
                  format={fmtPct}
                  emptyLabel="Sem pedidos nos últimos 90 dias."
                  periodOverride="Últimos 90 dias (fixo)"
                  secondaryBadge={
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border bg-destructive/15 text-destructive border-destructive/30">
                      {estornoTotals.estornos} {estornoTotals.estornos === 1 ? "estorno" : "estornos"}
                    </span>
                  }
                  rows={shopEstorno.map((s: any) => ({
                    id: s.shop_id, name: s.shop_name, value: Number(s.taxaEstorno ?? 0),
                    sub: `${s.totalEstornos ?? 0} ${Number(s.totalEstornos ?? 0) === 1 ? "estorno" : "estornos"}`,
                  }))}
                />
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/40">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-border shadow-lg">
                  <RotateCcw className="size-4 text-destructive" />
                  <span className="text-sm font-semibold text-foreground">Taxa de estorno</span>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-foreground text-background shadow-lg">
                  Em breve
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

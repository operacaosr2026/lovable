import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Copy, DollarSign, Loader2, Megaphone, Package, Search,
  Settings2, ShoppingCart, Target, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DateRangePicker } from "@/components/lojas-grupos/LgDashboard";
import { isoTodayUS } from "@/lib/timezone";
import {
  getProductCreatives, getProductDashboard, getProductFunnel, listProductAdCampaignOptions, saveProductAdCampaigns,
} from "@/lib/product-dashboard.functions";
import { funnelPixelCode, type FunnelPixelRole } from "@/lib/product-funnel-pixel";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
function periodRange(period: string, custom?: { from: string; to: string }) {
  const today = isoTodayUS();
  if (period === "ontem") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (period === "7d") return { from: addDays(today, -6), to: today };
  if (period === "30d") return { from: addDays(today, -29), to: today };
  if (period === "mes") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (period === "custom" && custom) return custom;
  return { from: today, to: today };
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);
const fmtInt = (n: number) => (n ?? 0).toLocaleString("pt-BR");

type Accent = "primary" | "info" | "warning" | "success" | "destructive";
const ACCENT: Record<Accent, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/10 text-destructive",
};

export function ProductDashboard({ productId }: { productId: string }) {
  const [period, setPeriod] = useState("mes");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const [configOpen, setConfigOpen] = useState(false);
  const range = periodRange(period, customRange);
  const fn = useServerFn(getProductDashboard);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["product-dashboard", productId, range.from, range.to],
    queryFn: () => fn({ data: { product_id: productId, ...range } }),
    staleTime: 5 * 60_000,
  });
  const t = data?.totals;
  const configured = !!data?.configured;
  const ticket = t && t.pedidos > 0 ? t.faturamento / t.pedidos : 0;
  const roas = t && t.anuncios > 0 ? t.faturamento / t.anuncios : 0;
  const cpa = t && t.pedidos > 0 ? t.anuncios / t.pedidos : 0;
  const margem = t && t.faturamento > 0 ? t.lucro / t.faturamento : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground max-w-xl">
          Vendas e custo dos pedidos em que o item é deste produto (nome ou palavras-chave). Anúncios: só as campanhas escolhidas
          pra este produto — não muda o Caixa nem os outros dashboards.
        </p>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <DateRangePicker period={period} setPeriod={setPeriod} customRange={customRange} setCustomRange={setCustomRange} />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {data && data.adsErrors.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs flex items-start gap-2">
          <AlertTriangle className="size-3.5 text-warning shrink-0 mt-0.5" />
          <span>Gasto de anúncio incompleto — {data.adsErrors.join("; ")}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi icon={DollarSign} accent="primary" label="Faturamento" loading={isLoading}
          value={fmtMoney(t?.faturamento ?? 0)} delta={t?.faturamentoDelta}
          stats={[{ label: "Ticket médio", value: fmtMoney(ticket) }, { label: "Unidades", value: fmtInt(t?.unidades ?? 0) }]} />
        <Kpi icon={ShoppingCart} accent="info" label="Pedidos" loading={isLoading}
          value={fmtInt(t?.pedidos ?? 0)} delta={t?.pedidosDelta}
          stats={[{ label: "Unidades", value: fmtInt(t?.unidades ?? 0) }, { label: "Un. por pedido", value: t && t.pedidos > 0 ? (t.unidades / t.pedidos).toFixed(2) : "—" }]} />
        <Kpi icon={Package} accent="warning" label="Custo do produto" loading={isLoading} invert
          value={fmtMoney(t?.custo ?? 0)} delta={t?.custoDelta}
          stats={[{ label: "% do faturamento", value: t && t.faturamento > 0 ? `${((t.custo / t.faturamento) * 100).toFixed(1)}%` : "—" }, { label: "Por unidade", value: t && t.unidades > 0 ? fmtMoney(t.custo / t.unidades) : "—" }]} />

        {configured ? (
          <Kpi icon={Megaphone} accent="destructive" label="Anúncios" loading={isLoading} invert
            value={fmtMoney(t?.anuncios ?? 0)} delta={t?.anunciosDelta}
            onConfigure={() => setConfigOpen(true)}
            configureLabel={`${data!.campaignCount} campanha${data!.campaignCount === 1 ? "" : "s"}`}
            stats={[{ label: "ROAS", value: roas > 0 ? `${roas.toFixed(2)}x` : "—" }, { label: "CPA", value: t && t.pedidos > 0 ? fmtMoney(cpa) : "—" }]} />
        ) : (
          <button
            onClick={() => setConfigOpen(true)}
            disabled={isLoading}
            className="rounded-2xl border border-dashed border-border bg-card p-4 text-left hover:border-primary/50 hover:bg-muted/30 transition-colors flex flex-col"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className={`size-9 rounded-xl grid place-items-center shrink-0 ${ACCENT.destructive}`}><Megaphone className="size-4.5" /></div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Anúncios</p>
            </div>
            <p className="text-sm font-semibold text-primary flex items-center gap-1.5"><Settings2 className="size-3.5" /> Configurar campanhas</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Escolha as campanhas da Meta deste produto pra ver gasto, ROAS, CPA e lucro.</p>
          </button>
        )}

        <Kpi icon={TrendingUp} accent="success" label="Lucro" loading={isLoading}
          value={configured ? fmtMoney(t?.lucro ?? 0) : "—"} delta={configured ? t?.lucroDelta : undefined}
          note={configured ? undefined : "Configure as campanhas pra calcular."}
          stats={configured ? [{ label: "Margem", value: t && t.faturamento > 0 ? `${(margem * 100).toFixed(1)}%` : "—" }, { label: "Por pedido", value: t && t.pedidos > 0 ? fmtMoney(t.lucro / t.pedidos) : "—" }] : undefined} />
        <Kpi icon={Target} accent="info" label="ROAS" loading={isLoading}
          value={configured && roas > 0 ? `${roas.toFixed(2)}x` : "—"}
          note={configured ? "Faturamento ÷ anúncios" : "Configure as campanhas pra calcular."}
          stats={configured ? [{ label: "CPA", value: t && t.pedidos > 0 ? fmtMoney(cpa) : "—" }, { label: "ROAS de equilíbrio", value: t && t.faturamento - t.custo > 0 ? `${(t.faturamento / (t.faturamento - t.custo)).toFixed(2)}x` : "—" }] : undefined} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-4 mb-3 text-xs">
          <span className="font-semibold text-sm mr-auto">Por dia</span>
          <Legend color="var(--color-primary)" label="Faturamento" />
          {configured && <Legend color="var(--color-destructive)" label="Anúncios" />}
          {configured && <Legend color="var(--color-success)" label="Lucro" />}
        </div>
        <div className="h-56">
          {isLoading ? <div className="h-full grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.chart ?? []} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pd-fat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} width={56}
                  tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)} />
                <ReferenceLine y={0} stroke="var(--color-border)" />
                <Tooltip content={<ChartTooltip configured={configured} />} cursor={{ stroke: "var(--color-border)" }} />
                <Area type="monotone" dataKey="faturamento" stroke="var(--color-primary)" strokeWidth={1.75} fill="url(#pd-fat)" isAnimationActive={false} />
                {configured && <Area type="monotone" dataKey="anuncios" stroke="var(--color-destructive)" strokeWidth={1.5} fill="none" isAnimationActive={false} />}
                {configured && <Area type="monotone" dataKey="lucro" stroke="var(--color-success)" strokeWidth={1.5} fill="none" isAnimationActive={false} />}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <FunnelCard productId={productId} range={range} />

      <CreativesTable productId={productId} range={range} />

      {configOpen && <CampaignsDialog productId={productId} onClose={() => setConfigOpen(false)} />}
    </div>
  );
}

function CreativesTable({ productId, range }: { productId: string; range: { from: string; to: string } }) {
  const fn = useServerFn(getProductCreatives);
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["product-dashboard", productId, "creatives", range.from, range.to],
    queryFn: () => fn({ data: { product_id: productId, ...range } }),
    staleTime: 5 * 60_000,
  });
  const configured = !!data?.configured;
  const rows = data?.rows ?? [];
  const th = "px-3 py-2 text-right font-medium";
  const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-sm">Por criativo</span>
        {isFetching && !isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Pela UTM do pedido (utm_content = ID do anúncio). Nome e gasto vêm da Meta{configured ? "" : " — configure as campanhas pra ver gasto, ROAS e lucro"}.
      </p>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {data && data.errors.length > 0 && (
        <div className="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs flex items-start gap-2">
          <AlertTriangle className="size-3.5 text-warning shrink-0 mt-0.5" />
          <span>Dados incompletos — {data.errors.join("; ")}</span>
        </div>
      )}
      {isLoading ? (
        <div className="py-8 flex justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma venda no período.</p>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Criativo</th>
                <th className={th}>Pedidos</th>
                <th className={th}>Faturamento</th>
                {configured && <th className={th}>Gasto</th>}
                {configured && <th className={th}>ROAS</th>}
                {configured && <th className={th}>CPA</th>}
                {configured && <th className={th}>Lucro</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const lucro = r.faturamento - r.custo - r.gasto;
                return (
                  <tr key={r.key} className="hover:bg-muted/30">
                    <td className="px-3 py-2 max-w-[280px]">
                      <p className={`truncate font-medium ${r.key === "none" ? "text-muted-foreground" : ""}`} title={r.nome}>{r.nome}</p>
                      {r.ad_id && <p className="text-[10px] text-muted-foreground truncate">{r.utm_medium && r.utm_medium !== r.nome ? `${r.utm_medium} · ` : ""}{r.ad_id}</p>}
                    </td>
                    <td className={td}>{fmtInt(r.pedidos)}</td>
                    <td className={td}>{fmtMoney(r.faturamento)}</td>
                    {configured && <td className={td}>{r.key === "none" || !r.ad_id ? "—" : fmtMoney(r.gasto)}</td>}
                    {configured && <td className={td}>{r.gasto > 0 ? `${(r.faturamento / r.gasto).toFixed(2)}x` : "—"}</td>}
                    {configured && <td className={td}>{r.gasto > 0 && r.pedidos > 0 ? fmtMoney(r.gasto / r.pedidos) : "—"}</td>}
                    {configured && <td className={`${td} font-semibold ${lucro >= 0 ? "text-success" : "text-destructive"}`}>{fmtMoney(lucro)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

function FunnelCard({ productId, range }: { productId: string; range: { from: string; to: string } }) {
  const fn = useServerFn(getProductFunnel);
  const [pixelOpen, setPixelOpen] = useState(false);
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["product-dashboard", productId, "funnel", range.from, range.to],
    queryFn: () => fn({ data: { product_id: productId, ...range } }),
    staleTime: 5 * 60_000,
  });
  const cur = data?.installed ? data.cur : null;
  const prev = data?.installed ? data.prev : null;
  const steps = cur ? [
    { label: "Sessões", value: cur.sessions, prev: prev?.sessions },
    { label: "Chegou ao checkout", value: cur.checkouts, prev: prev?.checkouts },
    { label: "Checkout concluído", value: cur.orders, prev: prev?.orders },
  ] : [];
  const base = cur?.sessions ?? 0;
  const share = (v: number) => (base > 0 ? Math.min(v / base, 1) : 0);
  const rate = cur && base > 0 ? cur.orders / base : null;
  const prevRate = prev && prev.sessions > 0 ? prev.orders / prev.sessions : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-sm">Funil de conversão</span>
        {isFetching && !isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <button onClick={() => setPixelOpen(true)} className="ml-auto text-xs text-primary hover:underline flex items-center gap-1">
          <Settings2 className="size-3.5" /> Pixels
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Sessões: visitantes da página do produto na matriz (1 por dia). Checkout: checkouts iniciados nas sublojas com o produto. Concluído: pedidos do produto.
        {data?.installed && ` Contando desde ${data.since.slice(8, 10)}/${data.since.slice(5, 7)}.`}
      </p>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading ? (
        <div className="py-8 flex justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : data && !data.installed ? (
        <div className="py-6 text-center text-xs text-muted-foreground space-y-2">
          <p>Nenhum evento recebido ainda. Instale o pixel na matriz e nas sublojas pra começar a contar.</p>
          <button onClick={() => setPixelOpen(true)} className="text-primary font-medium hover:underline">Ver código dos pixels</button>
        </div>
      ) : cur && (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-semibold tabular-nums">{rate === null ? "—" : fmtPct(rate)}</span>
            {rate !== null && prevRate !== null && prevRate > 0 && <FunnelDelta curr={rate} prev={prevRate} />}
          </div>
          <div className="grid grid-cols-3 border-t border-border">
            {steps.map((s, i) => {
              const h = share(s.value) * 100;
              const next = steps[i + 1];
              return (
                <div key={s.label} className={`min-w-0 pt-3 ${i > 0 ? "border-l border-border" : ""}`}>
                  <div className={`min-h-[3.25rem] ${i > 0 ? "pl-3" : ""}`}>
                    <p className="text-xs text-muted-foreground truncate">{s.label}</p>
                    <p className="text-sm tabular-nums flex items-center gap-2 flex-wrap">
                      <span>{base > 0 ? fmtPct(share(s.value)) : "—"} <span className="font-semibold">{fmtInt(s.value)}</span></span>
                      {s.prev !== undefined && s.prev > 0 && <FunnelDelta curr={s.value} prev={s.prev} />}
                    </p>
                  </div>
                  <div className="h-40 flex items-end mt-2">
                    <div className="h-full flex-[3] flex items-end">
                      <div className="w-full rounded-t-sm bg-primary" style={{ height: `${h}%` }} />
                    </div>
                    <div className="h-full flex-1">
                      {next && (
                        <div className="h-full bg-primary/35"
                          style={{ clipPath: `polygon(0 ${100 - h}%, 100% ${100 - share(next.value) * 100}%, 100% 100%, 0 100%)` }} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {pixelOpen && <PixelDialog onClose={() => setPixelOpen(false)} />}
    </section>
  );
}

function FunnelDelta({ curr, prev }: { curr: number; prev: number }) {
  const pct = Math.round(((curr - prev) / prev) * 100);
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${up ? "text-success" : "text-muted-foreground"}`}>
      <Icon className="size-3" />{Math.abs(pct)}%
    </span>
  );
}

function PixelDialog({ onClose }: { onClose: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const blocks: { role: FunnelPixelRole; title: string; hint: string }[] = [
    { role: "matriz", title: "Matriz", hint: "Conta as sessões (visualização da página do produto)." },
    { role: "subloja", title: "Sublojas", hint: "O mesmo código em todas as sublojas. Conta o checkout iniciado." },
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Pixels do funil</DialogTitle>
        <p className="text-xs text-muted-foreground">
          Em cada loja: Shopify → Configurações → Eventos de clientes → Adicionar pixel personalizado. Cole o código, salve e clique em Conectar.
          Vale pra todos os produtos.
        </p>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {blocks.map((b) => {
            const code = funnelPixelCode(origin, b.role);
            return (
              <div key={b.role} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{b.title}</span>
                  <span className="text-[11px] text-muted-foreground">{b.hint}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(code).then(() => toast.success("Código copiado"))}
                    className="ml-auto text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Copy className="size-3.5" /> Copiar
                  </button>
                </div>
                <pre className="rounded-xl border border-border bg-muted/40 p-3 text-[11px] leading-relaxed overflow-x-auto">{code}</pre>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full" style={{ background: color }} />{label}</span>;
}

function ChartTooltip({ active, payload, label, configured }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows: [string, number][] = [["Faturamento", p.faturamento], ["Custo", p.custo]];
  if (configured) rows.push(["Anúncios", p.anuncios], ["Lucro", p.lucro]);
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-md text-xs space-y-0.5">
      <p className="font-semibold mb-1">{label}</p>
      {rows.map(([k, v]) => <p key={k} className="text-muted-foreground">{k}: <span className="font-semibold text-foreground">{fmtMoney(v)}</span></p>)}
    </div>
  );
}

function Kpi({ icon: Icon, accent, label, value, delta, invert, stats, note, loading, onConfigure, configureLabel }: {
  icon: typeof DollarSign; accent: Accent; label: string; value: string; delta?: number; invert?: boolean;
  stats?: { label: string; value: string }[]; note?: string; loading?: boolean;
  onConfigure?: () => void; configureLabel?: string;
}) {
  const good = delta == null ? true : invert ? delta <= 0 : delta >= 0;
  const Arrow = (delta ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 soft-shadow-sm min-w-0 flex flex-col">
      <div className="flex items-center gap-2.5 mb-2 min-w-0">
        <div className={`size-9 rounded-xl grid place-items-center shrink-0 ${ACCENT[accent]}`}><Icon className="size-4.5" /></div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate flex-1">{label}</p>
        {onConfigure && (
          <button onClick={onConfigure} title="Configurar campanhas" className="h-7 px-2 rounded-lg text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 shrink-0">
            <Settings2 className="size-3.5" /> {configureLabel}
          </button>
        )}
      </div>
      {loading ? <div className="h-7 w-24 bg-muted animate-pulse rounded-lg" /> : <p className="text-xl font-bold tracking-tight truncate">{value}</p>}
      {delta != null && !loading && (
        <div className="mt-1 flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? "text-success" : "text-destructive"}`}>
            <Arrow className="size-3" />{delta >= 0 ? "+" : ""}{delta}%
          </span>
          <span className="text-[11px] text-muted-foreground">vs. período anterior</span>
        </div>
      )}
      {stats ? (
        <div className="mt-3 pt-2 border-t border-border grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <p className="text-[10px] text-muted-foreground truncate">{s.label}</p>
              <p className="text-xs font-semibold truncate">{s.value}</p>
            </div>
          ))}
        </div>
      ) : note ? <p className="mt-3 pt-2 border-t border-border text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

// ── Escolher campanhas ──

function CampaignsDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listProductAdCampaignOptions);
  const saveFn = useServerFn(saveProductAdCampaigns);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["product-ad-campaign-options", productId],
    queryFn: () => listFn({ data: { product_id: productId } }),
  });
  const selected = picked ?? new Set((data?.selected ?? []).map((c) => c.campaign_id));

  const campaignById = useMemo(() => {
    const m = new Map<string, { shop_id: string; ad_account_id: string; name: string }>();
    for (const a of data?.accounts ?? []) for (const c of a.campaigns) m.set(c.id, { shop_id: a.shop_id, ad_account_id: a.ad_account_id, name: c.name });
    return m;
  }, [data]);
  // Campanha salva que não veio da Meta (apagada, conta com erro ou
  // desconectada) continua salva até ser desmarcada.
  const missing = (data?.selected ?? []).filter((c) => !campaignById.has(c.campaign_id));

  const save = useMutation({
    mutationFn: () => {
      const saved = new Map((data?.selected ?? []).map((c) => [c.campaign_id, c]));
      const campaigns = [...selected].flatMap((id) => {
        const c = campaignById.get(id);
        if (c) return [{ shop_id: c.shop_id, ad_account_id: c.ad_account_id, campaign_id: id, campaign_name: c.name }];
        const s = saved.get(id);
        return s ? [{ shop_id: s.shop_id, ad_account_id: s.ad_account_id, campaign_id: id, campaign_name: s.campaign_name }] : [];
      });
      return saveFn({ data: { product_id: productId, campaigns } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-dashboard", productId] });
      qc.invalidateQueries({ queryKey: ["product-ad-campaign-options", productId] });
      toast.success("Campanhas salvas");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };
  const q = search.trim().toLowerCase();

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogTitle>Campanhas deste produto</DialogTitle>
        <p className="text-xs text-muted-foreground -mt-1">
          O gasto das campanhas marcadas entra em Anúncios só aqui no produto. Contas de anúncio vêm das lojas conectadas à Meta (Caixa).
        </p>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar campanha" className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50" />
          </div>
          <label className="h-9 px-3 rounded-lg border border-border text-xs flex items-center gap-2 cursor-pointer select-none shrink-0">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-primary" /> Só ativas
          </label>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-4">
          {isLoading && <div className="py-10 flex justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
          {data && data.accounts.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma conta de anúncios conectada. Conecte a Meta numa loja (Caixa) primeiro.</p>
          )}
          {data?.accounts.map((a) => {
            const list = a.campaigns.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!activeOnly || c.status === "ACTIVE" || selected.has(c.id)));
            return (
              <section key={a.ad_account_id}>
                <div className="text-xs font-semibold mb-1.5 flex items-baseline gap-2">
                  <span>{a.account_name ?? a.ad_account_id}</span>
                  <span className="text-muted-foreground font-normal">{a.shop_name}</span>
                </div>
                {a.error && <p className="text-xs text-destructive mb-1">{a.error}</p>}
                <div className="rounded-xl border border-border divide-y divide-border">
                  {list.map((c) => (
                    <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-primary" />
                      <span className="flex-1 min-w-0 truncate">{c.name}</span>
                      <span className={`text-[10px] uppercase tracking-wide shrink-0 ${c.status === "ACTIVE" ? "text-success" : "text-muted-foreground"}`}>
                        {c.status === "ACTIVE" ? "Ativa" : c.status === "PAUSED" || c.status === "CAMPAIGN_PAUSED" ? "Pausada" : c.status?.toLowerCase()}
                      </span>
                    </label>
                  ))}
                  {list.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma campanha.</p>}
                </div>
              </section>
            );
          })}
          {missing.length > 0 && (
            <section>
              <div className="text-xs font-semibold mb-1.5">Salvas, mas não encontradas na Meta agora</div>
              <div className="rounded-xl border border-warning/40 divide-y divide-border">
                {missing.map((c) => (
                  <label key={c.campaign_id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                    <input type="checkbox" checked={selected.has(c.campaign_id)} onChange={() => toggle(c.campaign_id)} className="accent-primary" />
                    <span className="flex-1 min-w-0 truncate">{c.campaign_name ?? c.campaign_id}</span>
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">{selected.size} selecionada{selected.size === 1 ? "" : "s"}</span>
          <button onClick={onClose} className="ml-auto h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || isLoading}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

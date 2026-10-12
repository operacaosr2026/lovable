import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Check, DollarSign, Loader2, Megaphone, Package, Search,
  Settings2, ShoppingCart, Target, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DateRangePicker } from "@/components/lojas-grupos/LgDashboard";
import { isoTodayUS } from "@/lib/timezone";
import {
  getProductDashboard, listProductAdCampaignOptions, saveProductAdCampaigns,
} from "@/lib/product-dashboard.functions";

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

      {configOpen && <CampaignsDialog productId={productId} onClose={() => setConfigOpen(false)} />}
    </div>
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

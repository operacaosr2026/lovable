import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDown, ArrowUp, BarChart3, Bell, Box, CalendarDays, Clock, Hourglass, List, Loader2, MessageSquare, Package, Percent,
  Search, Store, Tag, Undo2, Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getRefundAnalytics, saveRefundAlertSettings } from "@/lib/support-refund-analytics.functions";
import { REFUND_REASONS, refundReasonLabel } from "@/lib/refund-reasons";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";
import { useSupportFn } from "./demo";
import { formatMoney, fullTime } from "./utils";

// Atendimento › Aprovações › Análise de reembolsos: quanto, por quê, de qual
// produto/loja, quem pediu e o que ainda está pendente na Shopify. Inclui o
// que foi reembolsado direto na Shopify ("fora do app"). Limites do alerta de
// reembolso alto em "Alertas" (support_refund_alerts).

const PERIODS = [["7d", "Últimos 7 dias"], ["30d", "Últimos 30 dias"], ["mes", "Este mês"], ["mes_passado", "Mês passado"], ["90d", "Últimos 90 dias"]] as const;
type Period = (typeof PERIODS)[number][0];

function rangeOf(p: Period) {
  const today = isoTodayUS();
  if (p === "7d") return { from: addDaysIso(today, -6), to: today };
  if (p === "30d") return { from: addDaysIso(today, -29), to: today };
  if (p === "90d") return { from: addDaysIso(today, -89), to: today };
  const start = `${today.slice(0, 7)}-01`;
  if (p === "mes") return { from: start, to: today };
  const prevEnd = addDaysIso(start, -1);
  return { from: `${prevEnd.slice(0, 7)}-01`, to: prevEnd };
}

const usd = (v: number) => formatMoney(v, "USD");
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const reasonName = (k: string) => (k === "fora_app" ? "Feito direto na Shopify" : k === "sem" ? "Sem motivo" : refundReasonLabel(k));
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Tons dos ícones/minilinhas (texto + fundo claro; a minilinha usa currentColor).
const TONE = {
  violet: "bg-primary/10 text-primary",
  slate: "bg-muted text-foreground/70",
  amber: "bg-amber-500/10 text-amber-500",
  blue: "bg-blue-500/10 text-blue-500",
} as const;
type Tone = keyof typeof TONE;

type Data = Awaited<ReturnType<typeof getRefundAnalytics>>;

export function SupportRefundAnalytics({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const [period, setPeriod] = useState<Period>("30d");
  const range = useMemo(() => rangeOf(period), [period]);
  const fn = useSupportFn(getRefundAnalytics, "getRefundAnalytics");
  const q = useQuery({ queryKey: ["refund-analytics", range.from, range.to], queryFn: () => fn({ data: range }), staleTime: 5 * 60_000 });
  const [alertsOpen, setAlertsOpen] = useState(false);
  const d = q.data as Data | undefined;

  if (q.isLoading) return <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !d) return <div className="py-20 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>;

  return (
    <div className="space-y-4 pb-8">
      <Kpis d={d} />
      <Daily d={d} controls={
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setAlertsOpen(true)}
            className="h-9 px-3 rounded-xl border border-border bg-card text-xs font-medium flex items-center gap-1.5 hover:border-primary/40">
            <Bell className="size-3.5" /> Alertas
            <span className={`text-[10px] px-1.5 rounded-full ${d.settings.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
              {d.settings.enabled ? `acima de ${String(d.settings.product_rate_limit).replace(".", ",")}%` : "desligado"}
            </span>
          </button>
          <label className="relative">
            <CalendarDays className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} title={`${dm(range.from)} a ${dm(range.to)}`}
              className="h-9 pl-8 pr-3 rounded-xl border border-border bg-card text-xs font-medium outline-none focus:border-primary">
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
      } />
      <div className="grid gap-4 xl:grid-cols-2">
        <Reasons d={d} />
        <Shops d={d} />
      </div>
      <Products d={d} />
      <People d={d} />
      <Events d={d} onOpenConversation={onOpenConversation} />
      <AlertsDialog open={alertsOpen} onClose={() => setAlertsOpen(false)} d={d} />
    </div>
  );
}

// ─── Cartões ──────────────────────────────────────────────────────────────────

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="text-muted-foreground">sem base no período anterior</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  const good = p <= 0;
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${good ? "text-emerald-600" : "text-rose-600"}`}>
        {p <= 0 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}{Math.abs(p)}%
      </span>
      <span className="text-muted-foreground ml-1">vs. período anterior</span>
    </span>
  );
}

function Kpis({ d }: { d: Data }) {
  const k = d.kpis;
  const series = (pick: (x: Data["daily"][number]) => number | null) => d.daily.map((x) => ({ v: pick(x) }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <Kpi icon={Undo2} tone="violet" label="Reembolsado" value={usd(k.total)} spark={series((x) => x.amount)}
        sub={<>{k.count} reembolso{k.count === 1 ? "" : "s"} · <Delta cur={k.total} prev={d.prev.total} /></>} />
      <Kpi icon={Percent} tone="slate" label="Taxa de reembolso" value={pct(k.rateRevenue)} spark={series((x) => x.rate)} sparkTone="violet"
        sub={<>do faturamento · {pct(k.rateOrders)} dos pedidos (antes {pct(d.prev.rateRevenue)})</>} />
      <Kpi icon={Hourglass} tone="amber" label="Pendente na Shopify" value={usd(k.pendingAmount)} spark={series((x) => x.pending)}
        sub={<>{k.pendingCount} reembolso{k.pendingCount === 1 ? "" : "s"} ainda não concluído{k.pendingCount === 1 ? "" : "s"}</>} />
      <Kpi icon={Clock} tone="blue" label="Da compra ao reembolso" value={k.avgDaysToRefund == null ? "—" : `${k.avgDaysToRefund.toFixed(0)} dias`}
        spark={series((x) => x.avgDays)} sub={<>média entre o pedido e o reembolso</>} />
    </div>
  );
}

// Minilinha suave: média dos dias em ~8 blocos (dia a dia fica serrilhado).
function smooth(points: { v: number | null }[], buckets = 8) {
  const size = Math.max(1, Math.ceil(points.length / buckets));
  const out: { v: number }[] = [];
  for (let i = 0; i < points.length; i += size) {
    const vals = points.slice(i, i + size).map((p) => p.v).filter((v): v is number => v != null);
    out.push({ v: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0 });
  }
  return out;
}

function Kpi({ icon: Icon, tone, label, value, sub, spark, sparkTone }: {
  icon: any; tone: Tone; label: string; value: string; sub: React.ReactNode; spark: { v: number | null }[]; sparkTone?: Tone;
}) {
  const line = smooth(spark);
  const hasSpark = line.length >= 2 && line.some((p) => p.v > 0);
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-start gap-3 min-w-0">
      <span className={`size-10 shrink-0 rounded-xl grid place-items-center ${TONE[tone]}`}><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-xl font-semibold tracking-tight leading-tight whitespace-nowrap">{value}</p>
          </div>
          {/* Tendência no período (decorativa — os números estão no gráfico e nas tabelas). */}
          {hasSpark && (
            <div className={`w-20 h-9 shrink-0 ${TONE[sparkTone ?? tone].split(" ").find((c) => c.startsWith("text-"))}`} aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={line} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Line type="monotone" dataKey="v" stroke="currentColor" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground truncate">{sub}</p>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, hint, children, right }: { icon: any; title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <span className={`size-10 shrink-0 rounded-xl grid place-items-center ${TONE.violet}`}><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{title}</p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// ─── Por dia ──────────────────────────────────────────────────────────────────

const axisMoney = (v: number) => `US$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

function Daily({ d, controls }: { d: Data; controls: React.ReactNode }) {
  const data = d.daily.map((x) => ({ ...x, label: dm(x.date) }));
  const max = Math.max(0, ...data.map((x) => x.amount));
  return (
    <Card icon={BarChart3} title="Reembolsado por dia" hint="Dia em que a Shopify registrou o reembolso (horário de Nova York)" right={controls}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickFormatter={axisMoney} width={64} />
            <Tooltip cursor={{ fill: "var(--color-muted)", opacity: 0.6 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                    <p className="font-semibold mb-0.5">{p.label}</p>
                    <p className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />{usd(p.amount)} · {p.count} reembolso{p.count === 1 ? "" : "s"}</p>
                  </div>
                );
              }} />
            <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false}>
              {data.map((x) => <Cell key={x.date} fill="var(--color-primary)" fillOpacity={x.amount === max && max > 0 ? 1 : 0.7} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ─── Por motivo / loja / atendente ────────────────────────────────────────────

function Track({ value, max, danger }: { value: number; max: number; danger?: boolean }) {
  return (
    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${danger ? "bg-rose-500" : "bg-primary"}`} style={{ width: `${max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0}%` }} />
    </div>
  );
}

function HBar({ label, value, max, amount, extra, title }: { label: string; value: number; max: number; amount: string; extra: string; title?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,170px)_1fr_auto_auto] items-center gap-4 py-2 text-xs" title={title}>
      <span className="truncate">{label}</span>
      <Track value={value} max={max} />
      <span className="text-right whitespace-nowrap font-semibold">{amount}</span>
      <span className="w-16 text-right whitespace-nowrap text-muted-foreground">{extra}</span>
    </div>
  );
}

function Reasons({ d }: { d: Data }) {
  const max = Math.max(0, ...d.byReason.map((r) => r.amount));
  const total = d.kpis.total;
  return (
    <Card icon={Box} title="Por motivo" hint="Escolhido pela equipe ao pedir o reembolso">
      {d.byReason.length === 0 ? <Empty /> : d.byReason.map((r) => (
        <HBar key={r.key} label={reasonName(r.key)} value={r.amount} max={max} amount={usd(r.amount)}
          extra={`${r.count} · ${pct(total ? r.amount / total : 0, 0)}`}
          title={`${reasonName(r.key)}: ${usd(r.amount)} em ${r.count} reembolso(s)`} />
      ))}
    </Card>
  );
}

function Shops({ d }: { d: Data }) {
  const maxRate = Math.max(0, ...d.byShop.map((s) => s.rate ?? 0));
  return (
    <Card icon={Store} title="Por loja" hint="Taxa = reembolsado ÷ faturamento da loja no período">
      {d.byShop.length === 0 ? <Empty /> : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="text-left font-medium pb-2">Loja</th>
              <th className="text-right font-medium pb-2">Qtd</th>
              <th className="text-right font-medium pb-2">Valor</th>
              <th className="text-right font-medium pb-2">Taxa</th>
              <th className="w-24 sm:w-32 pb-2" />
            </tr>
          </thead>
          <tbody>
            {d.byShop.map((s) => (
              <tr key={s.key} className="border-t border-border">
                <td className="py-2.5 pr-2 truncate max-w-[180px]">{s.name}</td>
                <td className="text-right">{s.count}</td>
                <td className="text-right font-semibold whitespace-nowrap pl-3">{usd(s.amount)}</td>
                <td className="text-right pl-3">{pct(s.rate)}</td>
                <td className="pl-4"><Track value={s.rate ?? 0} max={maxRate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function People({ d }: { d: Data }) {
  const max = Math.max(0, ...d.byPerson.map((r) => r.amount));
  return (
    <Card icon={Users} title="Quem pediu" hint="Reembolso feito direto na Shopify aparece como fora do app">
      {d.byPerson.length === 0 ? <Empty /> : d.byPerson.map((r) => (
        <HBar key={r.key} label={r.key} value={r.amount} max={max} amount={usd(r.amount)} extra={`${r.count}`} />
      ))}
    </Card>
  );
}

// ─── Produtos ─────────────────────────────────────────────────────────────────

function Products({ d }: { d: Data }) {
  const st = d.settings;
  const over = (p: Data["byProduct"][number]) => st.enabled && p.rate != null && p.sold >= st.product_min_sold && p.rate * 100 > st.product_rate_limit;
  const maxRate = Math.max(0, ...d.byProduct.map((p) => p.rate ?? 0));
  return (
    <Card icon={Tag} title="Por produto" hint="Taxa = unidades reembolsadas ÷ vendidas no período. Em vermelho: acima do limite do alerta.">
      {d.byProduct.length === 0 ? <Empty /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[680px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th className="text-left font-medium pb-2">Produto</th>
                <th className="text-right font-medium pb-2">Reemb. / vendidos</th>
                <th className="text-left font-medium pb-2 pl-6">Taxa</th>
                <th className="text-right font-medium pb-2">Valor</th>
                <th className="text-left font-medium pb-2 pl-6">Motivo principal</th>
              </tr>
            </thead>
            <tbody>
              {d.byProduct.map((p) => (
                <tr key={p.key} className="border-t border-border">
                  <td className="py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {p.image
                        ? <img src={p.image} alt="" loading="lazy" className="size-9 rounded-lg object-cover border border-border shrink-0" />
                        : <span className="size-9 rounded-lg bg-muted grid place-items-center shrink-0"><Package className="size-4 text-muted-foreground" /></span>}
                      <span className="truncate max-w-[260px]">{p.name}</span>
                    </div>
                  </td>
                  <td className="text-right whitespace-nowrap">{p.units} / {p.sold || "—"}</td>
                  <td className="pl-6 w-56">
                    {p.rate == null ? <span className="text-muted-foreground">sem venda no período</span> : (
                      <div className="flex items-center gap-3">
                        <div className="flex-1"><Track value={p.rate} max={maxRate} danger={over(p)} /></div>
                        <span className={`w-12 text-right font-semibold ${over(p) ? "text-rose-600" : ""}`}>{pct(p.rate)}</span>
                      </div>
                    )}
                  </td>
                  <td className="text-right font-semibold whitespace-nowrap pl-3">{usd(p.amount)}</td>
                  <td className="pl-6 text-muted-foreground whitespace-nowrap">{p.topReason ? refundReasonLabel(p.topReason) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Lista ────────────────────────────────────────────────────────────────────

function Events({ d, onOpenConversation }: { d: Data; onOpenConversation: (id: string) => void }) {
  const [status, setStatus] = useState<"" | "pendente" | "concluido">("");
  const [reason, setReason] = useState("");
  const [term, setTerm] = useState("");
  const norm = (v: string) => v.toLowerCase().replace("#", "");
  const rows = d.events.filter((e) =>
    (!status || e.status === status)
    && (!reason || (e.reason ?? (e.source === "shopify" ? "fora_app" : "sem")) === reason)
    && (!term || [e.orderNumber, e.shop, e.product, e.requestedByName].some((v) => v && norm(v).includes(norm(term)))));
  return (
    <Card icon={List} title={`Reembolsos (${d.events.length})`} hint="Todos os reembolsos do período, do mais recente pro mais antigo"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Pedido, loja, produto…"
              className="h-9 w-48 pl-8 pr-2 rounded-xl border border-border bg-background text-xs outline-none focus:border-primary" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="h-9 rounded-xl border border-border bg-background px-2 text-xs">
            <option value="">Todos os status</option><option value="pendente">Pendente na Shopify</option><option value="concluido">Concluído</option>
          </select>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-xl border border-border bg-background px-2 text-xs max-w-[170px]">
            <option value="">Todos os motivos</option>
            {REFUND_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            <option value="fora_app">Feito direto na Shopify</option>
          </select>
        </div>
      }>
      {rows.length === 0 ? <Empty /> : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead className="sticky top-0 bg-card">
              <tr className="text-[11px] text-muted-foreground">
                {["Data", "Pedido", "Loja", "Produto", "Valor", "Status", "Motivo", "Pedido por", ""].map((h) => <th key={h} className="text-left font-medium pb-2 pr-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.key} className="border-t border-border">
                  <td className="py-2.5 pr-3 whitespace-nowrap" title={fullTime(e.at)}>{dm(e.date)}</td>
                  <td className="pr-3 font-medium whitespace-nowrap">{e.orderNumber ?? "—"}</td>
                  <td className="pr-3 whitespace-nowrap max-w-[140px] truncate">{e.shop}</td>
                  <td className="pr-3 max-w-[220px] truncate" title={e.product}>{e.product || "—"}</td>
                  <td className="pr-3 font-semibold whitespace-nowrap">{usd(e.amount)}</td>
                  <td className="pr-3 whitespace-nowrap">
                    {e.status === "pendente"
                      ? <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">Pendente{e.pendingDays ? ` há ${e.pendingDays}d` : ""}</span>
                      : <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600">Concluído</span>}
                  </td>
                  <td className="pr-3 whitespace-nowrap">{e.source === "shopify" ? <span className="text-muted-foreground">Direto na Shopify</span> : refundReasonLabel(e.reason)}</td>
                  <td className="pr-3 whitespace-nowrap">{e.requestedByName ?? <span className="text-muted-foreground">Fora do app</span>}</td>
                  <td className="text-right">
                    {e.conversationId && (
                      <button onClick={() => onOpenConversation(e.conversationId!)} title="Abrir conversa" className="text-muted-foreground hover:text-primary">
                        <MessageSquare className="size-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground py-4 text-center">Nenhum reembolso no período.</p>;
}

// ─── Limites do alerta ────────────────────────────────────────────────────────

function AlertsDialog({ open, onClose, d }: { open: boolean; onClose: () => void; d: Data }) {
  const qc = useQueryClient();
  const saveFn = useSupportFn(saveRefundAlertSettings, "saveRefundAlertSettings");
  const [f, setF] = useState(d.settings);
  useEffect(() => { if (open) setF(d.settings); }, [open, d.settings]);
  const num = (k: keyof typeof f, v: string) => setF({ ...f, [k]: Number(v.replace(",", ".")) });
  const save = useMutation({
    mutationFn: () => saveFn({ data: f }),
    onSuccess: () => {
      toast.success("Alertas salvos");
      qc.invalidateQueries({ queryKey: ["refund-analytics"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  const ro = !d.canEdit;
  const field = (label: string, hint: string, k: keyof typeof f, suffix: string, step = 1) => (
    <label className="block">
      <span className="text-xs font-semibold">{label}</span>
      <span className="block text-[11px] text-muted-foreground mb-1">{hint}</span>
      <div className="flex items-center gap-2 h-9 rounded-lg border border-border bg-background px-3 focus-within:border-primary w-40">
        <input type="number" min={step < 1 ? 0.5 : 1} step={step} disabled={ro || !f.enabled} value={String(f[k])} onChange={(e) => num(k, e.target.value)}
          className="flex-1 min-w-0 bg-transparent text-sm outline-none disabled:opacity-60" />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Bell className="size-4" /> Alertas de reembolso</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">Aviso no sino (tipo "Trocas e reembolsos"). Confere de hora em hora; some sozinho quando volta pro normal.</p>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
          <span className="text-sm font-medium">Alertas ligados</span>
          <Switch checked={f.enabled} disabled={ro} onCheckedChange={(v) => setF({ ...f, enabled: v })} />
        </label>
        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Produto com reembolso alto</p>
          {field("Limite da taxa", "Avisa quando reembolsados ÷ vendidos passar disso", "product_rate_limit", "%", 0.5)}
          <div className="grid grid-cols-2 gap-3">
            {field("Janela", "Últimos N dias", "window_days", "dias")}
            {field("Mínimo vendido", "Na janela, pra não avisar com 1 de 2", "product_min_sold", "un.")}
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Reembolso parado na Shopify</p>
          {field("Pendente há mais de", "A Shopify ainda não concluiu a devolução", "pending_days", "dias")}
        </div>
        {ro ? <p className="text-[11px] text-muted-foreground">Só quem pode aprovar reembolsos muda os limites.</p> : (
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-9 px-4 rounded-xl border border-border text-sm">Cancelar</button>
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

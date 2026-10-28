import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle, ArrowDown, ArrowUp, CalendarDays, CheckSquare, ChevronRight, CircleCheck, Hourglass, Loader2, MessageSquare,
  Package, ShieldAlert, Target, TrendingDown, TrendingUp, Truck, Undo2,
} from "lucide-react";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { isoTodayUS } from "@/lib/timezone";
import { getGerencial } from "@/lib/gerencial.functions";
import { listSupportApprovals } from "@/lib/support-approvals.functions";
import { SupportApprovalsView } from "@/components/atendimento/SupportApprovalsView";
import { SupportRefundAnalytics } from "@/components/atendimento/SupportRefundAnalytics";
import { SupportKpisView } from "@/components/atendimento/SupportKpisView";

// Gerencial: a operação do mês numa tela (contas em gerencial.functions.ts),
// mais o KPI do Atendimento e as Aprovações de troca/reembolso (fila e análise),
// que vieram do Atendimento.
// ?tab=aprovacoes / ?tab=reembolsos abre direto nelas (links das notificações).
const TAB_KEYS = ["alertas", "resultado", "aprovacoes", "reembolsos", "kpi"] as const;
type Tab = (typeof TAB_KEYS)[number];

export const Route = createFileRoute("/gerencial")({
  beforeLoad: requireAuth,
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    TAB_KEYS.includes(s.tab as Tab) ? { tab: s.tab as Tab } : {},
  head: () => ({ meta: [{ title: "Gerencial — SRX Growth" }] }),
  component: GerencialPage,
});

type Data = Awaited<ReturnType<typeof getGerencial>>;

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const usd = (v: number | null | undefined) => (v == null ? "—" : `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));

function lastMonths(n: number) {
  const today = isoTodayUS();
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); }
  return out;
}

const TABS: [Tab, string][] = [
  ["alertas", "Alertas"], ["resultado", "Resultado"], ["aprovacoes", "Fila de aprovação"],
  ["reembolsos", "Análise de reembolsos"], ["kpi", "KPI Atendimento"],
];
const APPROVAL_TABS: Tab[] = ["aprovacoes", "reembolsos"];

function GerencialPage() {
  const months = useMemo(() => lastMonths(6), []);
  const [month, setMonth] = useState(months[0]);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: Tab = search.tab ?? "alertas";
  const setTab = (t: Tab) => navigate({ search: t === "alertas" ? {} : { tab: t }, replace: true });
  const approvalsTab = APPROVAL_TABS.includes(tab);

  const fn = useServerFn(getGerencial);
  const q = useQuery({ queryKey: ["gerencial", month], queryFn: () => fn({ data: { month } }), staleTime: 5 * 60_000 });
  const d = q.data as Data | undefined;
  // Número na aba da fila (mesma consulta da tela).
  const approvalsFn = useServerFn(listSupportApprovals);
  const approvals = useQuery({ queryKey: ["support-approvals"], queryFn: () => approvalsFn(), refetchInterval: 60_000 });
  const approvalsOpen = ((approvals.data?.items ?? []) as { status: string }[]).filter((i) => i.status === "pendente" || i.status === "erro").length;
  // Conversa do cliente: abre no Atendimento.
  const openConversation = (id: string) => navigate({ to: "/atendimento", search: { c: id } as any });

  return (
    <PageShell>
      <PageHeader title="Gerencial" />
      <div className="space-y-4 pb-8">
        {/* Abas e o mês na mesma linha, com altura fixa: trocar de aba não mexe no layout
            (a Fila e a Análise de reembolsos têm o filtro delas, então o mês some ali). */}
        <div className="flex flex-wrap items-center gap-3 min-h-10">
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-muted w-fit max-w-full overflow-x-auto">
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`h-7 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${tab === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {label}
                {k === "alertas" && !!d?.alerts.length && (
                  <span className={`min-w-4 h-4 px-1 rounded-full text-[10px] grid place-items-center text-white ${d.alerts.some((a) => a.level === "critico") ? "bg-rose-500" : "bg-amber-500"}`}>{d.alerts.length}</span>
                )}
                {k === "aprovacoes" && approvalsOpen > 0 && (
                  <span className="min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold grid place-items-center">{approvalsOpen}</span>
                )}
              </button>
            ))}
          </div>
          {!approvalsTab && (
            <label className="relative ml-auto">
              <CalendarDays className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select value={month} onChange={(e) => setMonth(e.target.value)}
                className="h-10 pl-8 pr-3 rounded-xl border border-border bg-card text-sm font-medium outline-none focus:border-primary capitalize">
                {months.map((m, i) => <option key={m} value={m}>{i === 0 ? `Este mês (${monthName(m)})` : monthName(m)}</option>)}
              </select>
            </label>
          )}
        </div>
        {tab === "kpi" ? <SupportKpisView month={month} />
          : tab === "aprovacoes" ? <SupportApprovalsView onOpenConversation={openConversation} />
          : tab === "reembolsos" ? <SupportRefundAnalytics onOpenConversation={openConversation} />
          : q.isLoading ? <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          : q.isError || !d ? <div className="py-20 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>
          : tab === "alertas" ? <Alerts d={d} />
          : <Resultado d={d} />}
      </div>
    </PageShell>
  );
}

// ─── Peças ────────────────────────────────────────────────────────────────────

function Panel({ icon: Icon, title, right, children, className = "" }: { icon?: any; title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-border bg-card p-5 min-w-0 ${className}`}>
      {title && (
        <div className="flex items-center gap-2.5 mb-4">
          {Icon && <span className="size-8 rounded-xl grid place-items-center bg-primary/10 text-primary"><Icon className="size-4" /></span>}
          <p className="text-sm font-semibold">{title}</p>
          <div className="ml-auto">{right}</div>
        </div>
      )}
      {children}
    </div>
  );
}

// Subiu/caiu vs. o mês anterior. lowerIsBetter: reembolso.
function Delta({ cur, prev, lowerIsBetter, label }: { cur: number | null | undefined; prev: number | null | undefined; lowerIsBetter?: boolean; label?: string }) {
  if (cur == null || !prev) return null;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (!Number.isFinite(p)) return null;
  const good = lowerIsBetter ? p <= 0 : p >= 0;
  return (
    <span title={label} className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${good ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}>
      {p <= 0 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}{Math.abs(p)}%
    </span>
  );
}

// Barra empilhada (2px entre as partes) com legenda: cor, rótulo, valor e %.
type Seg = { key: string; label: string; value: number; color: string; hint?: string };
function StackBar({ segs, total, money = true }: { segs: Seg[]; total: number; money?: boolean }) {
  const fmt = (v: number) => (money ? usd(v) : num(v));
  return (
    <div>
      <div className="flex h-3.5 gap-0.5 rounded-full overflow-hidden bg-muted">
        {segs.filter((x) => x.value > 0).map((x) => (
          <div key={x.key} className={x.color} style={{ width: `${total > 0 ? (x.value / total) * 100 : 0}%` }}
            title={`${x.label}: ${fmt(x.value)} (${pct(total ? x.value / total : 0, 0)})`} />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 mt-4">
        {segs.map((x) => (
          <div key={x.key} className="min-w-0" title={x.hint}>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`size-2 rounded-full shrink-0 ${x.color}`} /><span className="truncate">{x.label}</span>
            </div>
            <p className="text-sm font-semibold whitespace-nowrap">
              {fmt(x.value)}
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">{pct(total ? x.value / total : 0, 0)}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Anel de progresso da meta.
function Ring({ value, tone }: { value: number; tone: string }) {
  const r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 120 120" className="size-32 -rotate-90" aria-hidden>
      <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
      <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className={tone} strokeDasharray={`${c * v} ${c}`} />
    </svg>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <div className="text-base font-semibold whitespace-nowrap">{value}</div>
      {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${max > 0 ? Math.max(3, Math.min(100, (value / max) * 100)) : 0}%` }} />
    </div>
  );
}

const Empty = ({ text = "Nada no período." }: { text?: string }) => <p className="text-xs text-muted-foreground py-3 text-center">{text}</p>;

// ─── Alertas ─────────────────────────────────────────────────────────────────
// Críticos primeiro; cada alerta com o número que resume, o porquê e o atalho.

const ALERT_ICON: Record<Data["alerts"][number]["kind"], any> = {
  meta: Target, prejuizo: TrendingDown, chargeback: ShieldAlert, produto: Package,
  reembolso: Hourglass, entrega: Truck, tarefa: CheckSquare, atendimento: MessageSquare,
};
const LEVEL = {
  critico: { label: "Crítico", icon: "bg-rose-500/10 text-rose-600", bar: "bg-rose-500", metric: "text-rose-600", btn: "bg-rose-600 text-white hover:bg-rose-700" },
  atencao: { label: "Atenção", icon: "bg-amber-500/10 text-amber-600", bar: "bg-amber-400", metric: "text-foreground", btn: "bg-muted text-foreground hover:bg-muted/70" },
} as const;

function Alerts({ d }: { d: Data }) {
  const navigate = useNavigate();
  if (!d.alerts.length) {
    return (
      <div className="rounded-3xl border border-border bg-card py-16 grid place-items-center text-center">
        <span className="size-12 rounded-2xl grid place-items-center bg-emerald-500/10 text-emerald-600 mb-3"><CircleCheck className="size-6" /></span>
        <p className="text-sm font-semibold">Tudo em ordem</p>
        <p className="text-xs text-muted-foreground">Nada pedindo decisão agora.</p>
      </div>
    );
  }
  const groups = (["critico", "atencao"] as const).map((lv) => [lv, d.alerts.filter((a) => a.level === lv)] as const).filter(([, l]) => l.length);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold">{d.alerts.length} {d.alerts.length === 1 ? "ponto pedindo" : "pontos pedindo"} decisão</p>
        {groups.map(([lv, l]) => (
          <span key={lv} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${LEVEL[lv].icon}`}>
            <span className={`size-1.5 rounded-full ${LEVEL[lv].bar}`} />{l.length} {LEVEL[lv].label.toLowerCase()}{l.length === 1 ? "" : "s"}
          </span>
        ))}
      </div>
      {groups.map(([lv, list]) => (
        <div key={lv}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{LEVEL[lv].label}</p>
          <div className="space-y-2">
            {list.map((a, i) => {
              const Icon = ALERT_ICON[a.kind] ?? AlertTriangle;
              const st = LEVEL[a.level];
              return (
                <div key={i} className="relative overflow-hidden rounded-2xl border border-border bg-card pl-5 pr-4 py-4 flex flex-wrap items-center gap-4">
                  <span className={`absolute left-0 inset-y-0 w-1 ${st.bar}`} />
                  <span className={`size-11 shrink-0 rounded-2xl grid place-items-center ${st.icon}`}><Icon className="size-5" /></span>
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="text-sm font-semibold">{a.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.detail}</p>
                  </div>
                  <div className="text-right shrink-0 min-w-[96px]">
                    <p className={`text-xl font-semibold tracking-tight whitespace-nowrap ${st.metric}`}>{a.metric}</p>
                    <p className="text-[11px] text-muted-foreground">{a.metricLabel}</p>
                  </div>
                  <button onClick={() => navigate({ href: a.link })}
                    className={`shrink-0 h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1 transition-colors ${st.btn}`}>
                    {a.action} <ChevronRight className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Resultado do mês ────────────────────────────────────────────────────────
// Cada número uma vez: lucro e para onde foram as vendas (mesma conta de Metas),
// meta, depois da venda (taxa de reembolso pela data do pedido + chargebacks),
// produtos que mais custam e entrega. Atendimento fica na subaba KPI Atendimento.

function Resultado({ d }: { d: Data }) {
  const prev = monthName(d.prevMonth);
  const vs = d.current ? `Mês em andamento contra ${prev} inteiro` : `Contra ${prev}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Money d={d} vs={vs} />
        <Meta meta={d.resultado.meta} current={d.current} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <PosVenda d={d} vs={vs} />
        <Produtos d={d} />
        <Entrega d={d} />
      </div>
      {d.resultado.byGroup.length > 1 && <Grupos d={d} />}
    </div>
  );
}

function Money({ d, vs }: { d: Data; vs: string }) {
  const a = d.resultado.atual, p = d.resultado.anterior;
  const prev = monthName(d.prevMonth);
  if (!a) return <Panel className="xl:col-span-2"><Empty /></Panel>;
  const segs: Seg[] = [
    { key: "custo", label: "Custo dos produtos", value: a.custo, color: "bg-slate-400" },
    { key: "anuncios", label: "Anúncios", value: a.anuncios, color: "bg-sky-500" },
    { key: "reembolsos", label: "Reembolsos", value: a.reembolsos, color: "bg-amber-500", hint: "Pela data em que o reembolso foi feito (mesma conta de Metas)" },
    { key: "chargebacks", label: "Chargebacks", value: a.chargebacks, color: "bg-rose-400" },
    { key: "taxas", label: "Taxas Shopify", value: a.taxas, color: "bg-violet-400" },
    { key: "lucro", label: a.lucro >= 0 ? "Lucro" : "Prejuízo", value: Math.abs(a.lucro), color: a.lucro >= 0 ? "bg-emerald-500" : "bg-rose-700" },
  ];
  // Com prejuízo, os gastos passam das vendas: a barra vai até o total dos gastos.
  const total = a.lucro >= 0 ? a.faturamento : a.faturamento - a.lucro;
  return (
    <div className="xl:col-span-2 rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6 min-w-0">
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><TrendingUp className="size-3.5" /> Lucro de {monthName(d.month)}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <p className={`text-4xl font-semibold tracking-tight ${a.lucro < 0 ? "text-rose-600" : ""}`}>{usd(a.lucro)}</p>
            <Delta cur={a.lucro} prev={p?.lucro} label={vs} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">Margem {pct(a.margem)} · {prev}: {usd(p?.lucro)} ({pct(p?.margem)})</p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:min-w-[280px]">
          <MiniStat label="Faturamento" value={<span className="inline-flex items-center gap-1.5">{usd(a.faturamento)} <Delta cur={a.faturamento} prev={p?.faturamento} label={vs} /></span>} />
          <MiniStat label="Pedidos" value={num(a.pedidos)} sub={p ? `${prev}: ${num(p.pedidos)}` : undefined} />
          <MiniStat label="Ticket médio" value={usd(a.pedidos ? a.faturamento / a.pedidos : null)} />
          <MiniStat label="Anúncio por pedido" value={usd(a.cpa)} sub={p?.cpa != null ? `${prev}: ${usd(p.cpa)}` : undefined} />
        </div>
      </div>
      <div className="mt-6">
        <p className="text-xs font-semibold mb-2">Para onde foram as vendas</p>
        <StackBar segs={segs} total={total} />
      </div>
    </div>
  );
}

function Meta({ meta: m, current }: { meta: Data["resultado"]["meta"]; current: boolean }) {
  if (!m) {
    return (
      <Panel icon={Target} title="Meta do mês">
        <div className="py-8 text-center text-sm text-muted-foreground">Sem meta pra este mês. <Link to="/metas" className="text-primary font-medium">Definir em Metas</Link></div>
      </Panel>
    );
  }
  const done = m.realizado != null && m.meta ? m.realizado / m.meta : 0;
  const onPace = m.projecao != null && m.projecao >= m.meta;
  const ok = m.status === "batida" || (current && onPace);
  const label = m.status === "batida" ? "Batida" : m.status === "nao_batida" ? "Não batida" : onPace ? "No ritmo de bater" : "Abaixo do ritmo";
  return (
    <Panel icon={Target} title="Meta do mês" right={
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}>{label}</span>
    }>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <Ring value={done} tone={ok ? "stroke-emerald-500" : "stroke-primary"} />
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className={`text-2xl font-semibold ${done < 0 ? "text-rose-600" : ""}`}>{pct(done, 0)}</p>
              <p className="text-[10px] text-muted-foreground">da meta</p>
            </div>
          </div>
        </div>
        <div className="space-y-3 min-w-0">
          <MiniStat label="Realizado" value={usd(m.realizado)} />
          <MiniStat label="Meta" value={usd(m.meta)} />
          {current && m.projecao != null && (
            <MiniStat label="Projeção no fim do mês" value={<span className={onPace ? "text-emerald-600" : "text-rose-600"}>{usd(m.projecao)}</span>} />
          )}
        </div>
      </div>
    </Panel>
  );
}

function PosVenda({ d, vs }: { d: Data; vs: string }) {
  const x = d.perdas;
  const maxReason = Math.max(0, ...x.topMotivos.map((r) => r.amount));
  const chips = [
    ["Abertos", x.chargebacks.abertos, ""],
    ["Perdidos", x.chargebacks.perdidos, "text-rose-600"],
    ["Ganhos", x.chargebacks.ganhos, "text-emerald-600"],
    ["Evitados", x.chargebacks.evitados + x.disputifier.count, "text-sky-600"],
  ] as const;
  return (
    <Panel icon={Undo2} title="Depois da venda">
      <p className="text-[11px] text-muted-foreground">Taxa de reembolso</p>
      <div className="flex items-center gap-2">
        <p className="text-3xl font-semibold tracking-tight">{pct(x.reembolsos.taxa)}</p>
        <Delta cur={x.reembolsos.taxa} prev={x.reembolsosPrev.taxa} lowerIsBetter label={vs} />
      </div>
      <p className="text-[11px] text-muted-foreground">{x.reembolsos.pedidos} dos pedidos vendidos no mês tiveram reembolso</p>
      <div className="mt-4 rounded-2xl bg-muted/50 p-3">
        <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 mb-2"><ShieldAlert className="size-3.5" /> Chargebacks abertos no mês</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {chips.map(([l, v, c]) => (
            <div key={l}>
              <p className={`text-lg font-semibold ${c}`}>{num(v)}</p>
              <p className="text-[10px] text-muted-foreground">{l}</p>
            </div>
          ))}
        </div>
        {x.disputifier.count > 0 && <p className="text-[10px] text-muted-foreground text-center mt-1.5">{x.disputifier.count} evitados pelo Disputifier</p>}
      </div>
      <p className="text-[11px] font-medium text-muted-foreground mt-4 mb-2">Motivos que mais custam</p>
      {!x.topMotivos.length ? <Empty /> : x.topMotivos.slice(0, 3).map((r) => (
        <div key={r.key} className="py-1 text-xs">
          <div className="flex items-center gap-2 mb-1">
            <span className="truncate flex-1 min-w-0">{r.label}</span>
            <span className="font-semibold whitespace-nowrap">{usd(r.amount)}</span>
          </div>
          <MiniBar value={r.amount} max={maxReason} color="bg-amber-500" />
        </div>
      ))}
    </Panel>
  );
}

function Produtos({ d }: { d: Data }) {
  const list = d.perdas.topProdutos;
  const max = Math.max(0, ...list.map((p) => p.amount));
  return (
    <Panel icon={Package} title="Produtos que mais custam">
      {!list.length ? <Empty /> : (
        <div className="space-y-3">
          {list.map((p) => (
            <div key={p.name} className="flex items-center gap-3">
              {p.image
                ? <img src={p.image} alt="" className="size-10 rounded-xl object-cover shrink-0 border border-border" />
                : <span className="size-10 rounded-xl bg-muted grid place-items-center shrink-0"><Package className="size-4 text-muted-foreground" /></span>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-medium truncate flex-1" title={p.name}>{p.name}</p>
                  <p className="text-xs font-semibold whitespace-nowrap">{usd(p.amount)}</p>
                </div>
                <MiniBar value={p.amount} max={max} />
                <p className="text-[10px] text-muted-foreground mt-1">{p.units} de {p.sold} reembolsadas · {pct(p.rate)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Entrega({ d }: { d: Data }) {
  const e = d.entrega;
  const segs: Seg[] = [
    { key: "ok", label: "Entregues", value: e.entregues, color: "bg-emerald-500" },
    { key: "transito", label: "A caminho", value: e.emTransito, color: "bg-sky-500" },
    { key: "sem", label: "Sem envio", value: e.semEnvio, color: "bg-slate-300 dark:bg-slate-600" },
    { key: "prob", label: "Com problema", value: e.problema, color: "bg-rose-500" },
  ];
  return (
    <Panel icon={Truck} title="Entrega dos pedidos do mês" right={e.atencao > 0 && (
      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-amber-500/10 text-amber-600">{e.atencao} pedindo atenção</span>
    )}>
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-2xl bg-muted/50 p-3">
          <p className="text-[11px] text-muted-foreground">Da compra à entrega</p>
          <p className="text-2xl font-semibold">{e.diasMedios == null ? "—" : `${e.diasMedios.toFixed(0)} dias`}</p>
        </div>
        <div className="rounded-2xl bg-muted/50 p-3">
          <p className="text-[11px] text-muted-foreground">Entregues em até 20 dias</p>
          <p className="text-2xl font-semibold">{pct(e.ate20dias, 0)}</p>
        </div>
      </div>
      <StackBar segs={segs} total={e.pedidos} money={false} />
    </Panel>
  );
}

// Só com mais de um grupo (com um, repetiria o lucro do topo).
function Grupos({ d }: { d: Data }) {
  return (
    <Panel title="Por grupo">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {d.resultado.byGroup.map((g) => (
          <Link key={g.id} to="/shops/lojas-grupos/$cardId" params={{ cardId: g.id }} search={{ tab: "dashboard" as const }}
            className="rounded-2xl border border-border p-4 hover:border-primary/40 transition-colors">
            <p className="text-sm font-semibold">{g.name}</p>
            <p className="text-[11px] text-muted-foreground">{g.shops} loja{g.shops === 1 ? "" : "s"} · {num(g.pedidos)} pedidos</p>
            <div className="flex items-baseline justify-between mt-2">
              <p className={`text-lg font-semibold ${g.lucro < 0 ? "text-rose-600" : ""}`}>{usd(g.lucro)}</p>
              <p className="text-xs text-muted-foreground">{pct(g.margem)} de {usd(g.faturamento)}</p>
            </div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

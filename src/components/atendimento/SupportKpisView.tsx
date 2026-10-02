import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { ArrowDown, ArrowUp, CircleCheck, Clock, Mail, MailWarning, Minus, Tag, Timer, ChevronDown, Landmark, PackageSearch, Repeat } from "lucide-react";
import type { SupportExtraKpis } from "@/lib/support-kpis-extra.server";
import { getSupportKpis } from "@/lib/atendimento.functions";
import { businessHoursLabel, type KpiGoals, type SupportKpis } from "@/lib/support-kpis";
import { useSupportFn } from "./demo";
import { formatDuration } from "./utils";

// Atendimento > KPI (mensal). Paleta categórica das lojas/tags validada
// (daltonismo e separação) contra o fundo do card nos modos claro e escuro;
// no claro, 3 cores têm contraste < 3:1 — a tabela "Desempenho por loja" e a
// legenda dão o apoio exigido.
const VIZ_CSS = `
.support-kpi { --c1:#2a78d6; --c2:#eb6834; --c3:#1baf7a; --c4:#eda100; --c5:#e87ba4; --c6:#008300; --c7:#4a3aa7; --c8:#e34948; --c-none:#9ca3af; }
.dark .support-kpi { --c1:#3987e5; --c2:#d95926; --c3:#199e70; --c4:#c98500; --c5:#d55181; --c6:#008300; --c7:#9085e9; --c8:#e66767; --c-none:#6b7280; }
`;
const slot = (i: number) => (i < 8 ? `var(--c${i + 1})` : "var(--c-none)");

const AXIS = { fill: "var(--color-muted-foreground)", fontSize: 11 };
const fmtDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`;
const MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const int = (n: number) => n.toLocaleString("pt-BR");

type Kpis = SupportKpis & { partial: boolean; goals: KpiGoals; extra?: SupportExtraKpis | null };

export function SupportKpisView({ month }: { month: string }) {
  const kpiFn = useSupportFn(getSupportKpis, "getSupportKpis");
  const q = useQuery({ queryKey: ["support-kpis", month], queryFn: () => kpiFn({ data: { month } }) as Promise<Kpis> });
  const k = q.data;
  const vs = k?.partial ? "vs mesmo período do mês anterior" : "vs mês anterior";

  if (q.isError) return <p className="text-sm text-destructive py-10 text-center">{(q.error as any)?.message ?? "Erro ao carregar"}</p>;

  return (
    <div className="support-kpi space-y-3">
      <style>{VIZ_CSS}</style>

      {/* ── Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <StatCard icon={Mail} tone="bg-primary/10 text-primary" color="var(--color-primary)" label="Total de e-mails" vs={vs}
          value={k ? int(k.cards.total.value) : undefined} delta={k && pctDelta(k.cards.total.value, k.cards.total.prev)} deltaTone="neutral"
          series={k?.cards.total.series} seriesFormat={(v) => `${v} e-mails`}
          footer={k && <Split a={["Novos", int(k.cards.total.newConversations)]} b={["Enviados", int(k.cards.total.started)]} c={["Respondidos", int(k.cards.total.replied)]} />} />
        <StatCard icon={Clock} tone="bg-success/15 text-success" color="var(--color-success)" label="Tempo médio 1ª resposta" vs={vs} hint={k ? `Horário comercial: ${businessHoursLabel(k.hours)}` : undefined}
          value={k ? formatDuration(k.cards.firstResponse.value) : undefined}
          delta={k && pctDelta(k.cards.firstResponse.value, k.cards.firstResponse.prev)} deltaTone="lower"
          series={k?.cards.firstResponse.series} seriesFormat={(v) => formatDuration(v)}
          footer={k && <Goal goalMs={k.goals.firstResponseMin * 60_000} value={k.cards.firstResponse.value} />} />
        <StatCard icon={Timer} tone="bg-amber-500/15 text-amber-600 dark:text-amber-400" color="#f59e0b" label="Tempo médio até solucionar" vs={vs} hint={k ? `Horário comercial: ${businessHoursLabel(k.hours)}` : undefined}
          value={k ? formatDuration(k.cards.resolution.value) : undefined}
          delta={k && pctDelta(k.cards.resolution.value, k.cards.resolution.prev)} deltaTone="lower"
          series={k?.cards.resolution.series} seriesFormat={(v) => formatDuration(v)}
          footer={k && <Goal goalMs={k.goals.resolutionMin * 60_000} value={k.cards.resolution.value} />} />
        <StatCard icon={CircleCheck} tone="bg-info/10 text-info" color="var(--color-info)" label="Taxa de resolução" vs={vs}
          value={k ? (k.cards.rate.value == null ? "—" : `${k.cards.rate.value.toLocaleString("pt-BR")}%`) : undefined}
          delta={k && ppDelta(k.cards.rate.value, k.cards.rate.prev)} deltaTone="higher"
          series={k?.cards.rate.series} seriesFormat={(v) => `${v}%`}
          footer={k && <Split a={["Resolvidos", int(k.cards.rate.resolved)]} b={["Pendentes", int(k.cards.rate.pending)]} />} />
        <StatCard icon={MailWarning} tone="bg-destructive/10 text-destructive" color="var(--color-destructive)" label="Em aberto" vs={vs}
          value={k ? int(k.cards.open.value) : undefined} delta={k && pctDelta(k.cards.open.value, k.cards.open.prev)} deltaTone="lower"
          series={k?.cards.open.series} seriesFormat={(v) => `${v} em aberto`}
          footer={k && <Split a={["Há mais de 12h", int(k.cards.open.over12h)]} b={["Há mais de 36h", int(k.cards.open.over36h)]} />} />
      </div>

      {/* ── Efeito no dinheiro: contato → banco, contatos por 100 pedidos, recontato ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MiniStat icon={Landmark} tone="bg-destructive/10 text-destructive" label="Contato → foi ao banco"
          value={!k ? undefined : !k.extra ? "—" : k.extra.contactToBank.contacted ? `${k.extra.contactToBank.wentToBank} de ${k.extra.contactToBank.contacted}` : "—"}
          sub={k?.extra ? `clientes que escreveram e depois abriram chargeback ou alerta${k.extra.contactToBank.avgDaysToBank != null ? ` · ${k.extra.contactToBank.avgDaysToBank.toLocaleString("pt-BR")} dias depois, em média` : ""}` : undefined}
          foot={k?.extra ? `Dos ${k.extra.contactToBank.bankEvents} chargebacks do mês, ${k.extra.contactToBank.bankWithContactBefore} escreveram antes · ${k.extra.contactToBank.refunded} viraram reembolso` : undefined} />
        <MiniStat icon={PackageSearch} tone="bg-primary/10 text-primary" label="Contatos por 100 pedidos"
          value={!k ? undefined : k.extra?.contactRate.value == null ? "—" : k.extra.contactRate.value.toLocaleString("pt-BR")}
          delta={k?.extra ? ppDelta(k.extra.contactRate.value, k.extra.contactRate.prev) : null} deltaUnit=" p.p." deltaTone="lower" vs={vs}
          sub={k?.extra ? `${k.extra.contactRate.contacts} conversas · ${k.extra.contactRate.orders} pedidos` : undefined}
          foot={k?.extra?.contactRate.rastreio != null ? `Sobre rastreio: ${k.extra.contactRate.rastreio.toLocaleString("pt-BR")} por 100 pedidos` : undefined} />
        <MiniStat icon={Repeat} tone="bg-warning/15 text-warning" label="Recontato"
          value={!k ? undefined : k.extra?.recontact.value == null ? "—" : `${k.extra.recontact.value.toLocaleString("pt-BR")}%`}
          delta={k?.extra ? ppDelta(k.extra.recontact.value, k.extra.recontact.prev) : null} deltaUnit=" p.p." deltaTone="lower" vs={vs}
          sub={k?.extra ? `${k.extra.recontact.recontacted} de ${k.extra.recontact.conversations} conversas: o cliente escreveu 2+ vezes` : undefined} />
      </div>

      {/* ── Por tag | Chegada ── */}
      <div className="grid xl:grid-cols-2 gap-3">
        <TagsCard k={k} className="" />
        <ArrivalsCard k={k} className="" />
      </div>
    </div>
  );
}

// ─── Peças ────────────────────────────────────────────────────────────────────

function MiniStat({ icon: Icon, tone, label, value, sub, foot, delta, deltaUnit = "%", deltaTone = "neutral", vs }: {
  icon: typeof Mail; tone: string; label: string; value: string | undefined; sub?: string; foot?: string;
  delta?: number | null; deltaUnit?: string; deltaTone?: "lower" | "higher" | "neutral"; vs?: string;
}) {
  const good = delta == null || delta === 0 || deltaTone === "neutral" ? null : deltaTone === "lower" ? delta < 0 : delta > 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-start gap-3 min-w-0">
      <div className={`size-10 rounded-xl grid place-items-center shrink-0 ${tone}`}><Icon className="size-[18px]" /></div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{label}</p>
        <p className="text-2xl font-bold tracking-tight leading-tight">
          {value ?? <span className="inline-block w-16 h-6 rounded bg-muted animate-pulse align-middle" />}
        </p>
        {delta != null && vs && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <span className={`inline-flex items-center font-semibold ${good == null ? "text-foreground" : good ? "text-success" : "text-destructive"}`}>
              {delta > 0 ? <ArrowUp className="size-3" /> : delta < 0 ? <ArrowDown className="size-3" /> : <Minus className="size-3" />}
              {delta > 0 ? "+" : ""}{delta.toLocaleString("pt-BR")}{deltaUnit}
            </span>
            <span className="truncate">{vs}</span>
          </p>
        )}
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
        {foot && <p className="text-[11px] text-muted-foreground mt-1 pt-1 border-t border-border">{foot}</p>}
      </div>
    </div>
  );
}

const pctDelta = (cur: number | null, prev: number | null) => (cur == null || prev == null || prev === 0 ? null : Math.round(((cur - prev) / prev) * 100));
const ppDelta = (cur: number | null, prev: number | null) => (cur == null || prev == null ? null : Math.round((cur - prev) * 10) / 10);

function StatCard({ icon: Icon, tone, color, label, value, delta, deltaTone, vs, series, seriesFormat, footer, hint }: {
  hint?: string;
  icon: typeof Mail; tone: string; color: string; label: string; value: string | undefined;
  delta: number | null | undefined; deltaTone: "lower" | "higher" | "neutral"; vs: string;
  series: { date: string; value: number | null }[] | undefined; seriesFormat: (v: number) => string; footer: React.ReactNode;
}) {
  const isPp = label === "Taxa de resolução";
  const good = delta == null || delta === 0 || deltaTone === "neutral" ? null : deltaTone === "lower" ? delta < 0 : delta > 0;
  const id = `spark-${label.replace(/\W/g, "")}`;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col min-w-0">
      <div className="flex items-start gap-3">
        <div className={`size-10 rounded-xl grid place-items-center shrink-0 ${tone}`}><Icon className="size-[18px]" /></div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate" title={hint ? `${label} — ${hint}` : label}>{label}</p>
          {hint && <p className="text-[10px] text-muted-foreground truncate -mt-0.5" title={hint}>{hint}</p>}
          <p className="text-2xl font-bold tracking-tight leading-tight">
            {value ?? <span className="inline-block w-16 h-6 rounded bg-muted animate-pulse align-middle" />}
          </p>
          {value !== undefined && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
              {delta == null ? <><Minus className="size-3" />sem comparação</> : (
                <>
                  <span className={`inline-flex items-center font-semibold ${good == null ? "text-foreground" : good ? "text-success" : "text-destructive"}`}>
                    {delta > 0 ? <ArrowUp className="size-3" /> : delta < 0 ? <ArrowDown className="size-3" /> : <Minus className="size-3" />}
                    {delta > 0 ? "+" : ""}{delta.toLocaleString("pt-BR")}{isPp ? " p.p." : "%"}
                  </span>
                  <span className="truncate">{vs}</span>
                </>
              )}
            </p>
          )}
        </div>
      </div>
      <div className="h-14 -mx-1 mt-2">
        {series && series.some((p) => p.value != null) && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip content={<SparkTip format={seriesFormat} />} cursor={{ stroke: "var(--color-border)" }} />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${id})`} connectNulls
                dot={false} activeDot={{ r: 4, stroke: "var(--color-card)", strokeWidth: 2 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 pt-2.5 border-t border-border text-[11px]">{footer ?? <span className="block h-7" />}</div>
    </div>
  );
}

function Split({ a, b, c }: { a: [string, string]; b: [string, string]; c?: [string, string] }) {
  return (
    <div className={`grid ${c ? "grid-cols-3" : "grid-cols-2"} divide-x divide-border`}>
      <div className="pr-2 min-w-0"><p className="text-muted-foreground truncate">{a[0]}</p><p className="font-semibold text-sm">{a[1]}</p></div>
      <div className={`${c ? "px-2" : "pl-3"} min-w-0`}><p className="text-muted-foreground truncate">{b[0]}</p><p className="font-semibold text-sm">{b[1]}</p></div>
      {c && <div className="pl-2 min-w-0"><p className="text-muted-foreground truncate">{c[0]}</p><p className="font-semibold text-sm">{c[1]}</p></div>}
    </div>
  );
}

function Goal({ goalMs, value }: { goalMs: number; value: number | null }) {
  const ok = value != null && value <= goalMs;
  return (
    <div className="flex items-center justify-between gap-2 min-h-[34px]">
      <span className="text-muted-foreground">Meta: {formatDuration(goalMs)}</span>
      {value != null && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 ${ok ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}>
          {ok ? <CircleCheck className="size-3" /> : <MailWarning className="size-3" />}{ok ? "Dentro da meta" : "Fora da meta"}
        </span>
      )}
    </div>
  );
}

function Card({ title, right, className = "", children }: { title: string; right?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

// Conversas por tag: filtro por loja, variação vs mês anterior e resumo.
function TagsCard({ k, className }: { k: Kpis | undefined; className: string }) {
  const [store, setStore] = useState("all");
  const stats = k ? k.tagsByStore[store] ?? k.tagsByStore.all : undefined;
  const max = stats ? Math.max(1, ...stats.tags.map((t) => t.count)) : 1;
  const classifiedDelta = stats ? ppDelta(stats.summary.classifiedPct, stats.summary.prevClassifiedPct) : null;
  return (
    <Card title="Conversas por tag" className={className} right={k && k.stores.length > 0 && (
      <div className="relative">
        <select value={store} onChange={(e) => setStore(e.target.value)}
          className="appearance-none bg-background border border-border text-[11px] rounded-lg pl-2.5 pr-7 h-7 outline-none cursor-pointer max-w-[150px] truncate">
          <option value="all">Todas as lojas</option>
          {k.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    )}>
      {!stats ? <Skeleton h={260} /> : (
        <>
          <div className="space-y-3 pt-1">
            {stats.tags.map((t, i) => {
              const none = t.tag === "Sem tag";
              const color = none ? "var(--c-none)" : slot(i);
              const d = pctDelta(t.count, t.prevCount);
              return (
                <div key={t.tag} className="grid grid-cols-[minmax(0,1fr)_32px_44px_minmax(0,1.2fr)_52px] items-center gap-2.5 text-xs"
                  title={`${t.tag}: ${t.count} conversa${t.count === 1 ? "" : "s"} (${t.pct}%) · mês anterior: ${t.prevCount}`}>
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="size-2.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="truncate">{t.tag}</span>
                  </span>
                  <span className="text-right font-semibold tabular-nums">{int(t.count)}</span>
                  <span className="text-right text-muted-foreground tabular-nums">{t.pct.toLocaleString("pt-BR")}%</span>
                  <span className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <span className="block h-full rounded-full" style={{ width: `${(t.count / max) * 100}%`, background: color }} />
                  </span>
                  <DeltaBadge value={d} />
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl bg-muted/50 p-3 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0"><Tag className="size-[18px]" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">Resumo das conversas</p>
              <div className="grid grid-cols-[1fr_1fr_1.2fr_auto] items-end gap-3">
                <SummaryItem value={int(stats.summary.withTag)} label="Com tag" />
                <SummaryItem value={int(stats.summary.withoutTag)} label="Sem tag" />
                <SummaryItem value={stats.summary.classifiedPct == null ? "—" : `${stats.summary.classifiedPct.toLocaleString("pt-BR")}%`} label="Classificadas" />
                <div className="text-right">
                  <DeltaBadge value={classifiedDelta} unit=" p.p." />
                  <p className="text-[10px] text-muted-foreground mt-0.5 whitespace-nowrap">vs mês anterior</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function SummaryItem({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-lg font-bold leading-tight tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground truncate">{label}</p>
    </div>
  );
}

// Selo de variação: verde subindo, vermelho caindo (como no mockup).
function DeltaBadge({ value, unit = "%" }: { value: number | null; unit?: string }) {
  if (value == null) return <span className="text-[10px] text-muted-foreground text-right">—</span>;
  if (value === 0) return <span className="inline-flex items-center justify-end gap-0.5 text-[10px] text-muted-foreground"><Minus className="size-3" />0{unit}</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center justify-center gap-0.5 h-5 px-1.5 rounded-md text-[10px] font-semibold tabular-nums ${up ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{Math.abs(value).toLocaleString("pt-BR")}{unit}
    </span>
  );
}

type ArrivalMode = "day" | "hour" | "weekday";
const ARRIVAL_LABELS: Record<ArrivalMode, string> = { day: "Por dia", hour: "Por hora (Nova York)", weekday: "Por dia da semana" };

function ArrivalsCard({ k, className }: { k: Kpis | undefined; className: string }) {
  const [mode, setMode] = useState<ArrivalMode>("hour");
  const data = k ? k.arrivals[mode].map((d) => ({ ...d, label: mode === "day" ? fmtDay(d.label) : d.label })) : [];
  return (
    <Card title="Histórico de chegada de e-mails" className={className} right={
      <div className="relative">
        <select value={mode} onChange={(e) => setMode(e.target.value as ArrivalMode)}
          className="appearance-none bg-background border border-border text-[11px] rounded-lg pl-2.5 pr-7 h-7 outline-none cursor-pointer">
          {(Object.keys(ARRIVAL_LABELS) as ArrivalMode[]).map((m) => <option key={m} value={m}>{ARRIVAL_LABELS[m]}</option>)}
        </select>
        <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    }>
      {!k ? <Skeleton h={220} /> : !data.some((d) => d.count) ? <Empty h={220} text="Nenhum e-mail recebido no mês" /> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }} barCategoryGap="18%">
            <defs>
              <linearGradient id="arrivals-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.95} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.45} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip content={<SimpleTip />} cursor={{ fill: "var(--color-muted)", opacity: 0.5 }} />
            <Bar dataKey="count" name="E-mails" fill="url(#arrivals-fill)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function SparkTip({ active, payload, format }: any) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="rounded-lg bg-popover border border-border px-2 py-1 shadow text-[11px]">
      <span className="text-muted-foreground mr-1.5">{fmtDay(payload[0].payload.date)}</span>
      <span className="font-semibold">{format(payload[0].value)}</span>
    </div>
  );
}

function SimpleTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-popover border border-border px-3 py-2 shadow-lg text-xs">
      <p className="text-muted-foreground mb-0.5">{label}</p>
      <p><span className="font-semibold">{payload[0].value}</span> e-mail{payload[0].value === 1 ? "" : "s"}</p>
    </div>
  );
}

const Skeleton = ({ h }: { h: number }) => <div className="rounded-xl bg-muted animate-pulse" style={{ height: h }} />;
const Empty = ({ h, text }: { h: number; text: string }) => <p className="grid place-items-center text-xs text-muted-foreground" style={{ height: h }}>{text}</p>;

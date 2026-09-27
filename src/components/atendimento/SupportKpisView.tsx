import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { ArrowDown, ArrowUp, CircleCheck, Clock, Inbox, Minus, Reply, Timer, MessageSquarePlus } from "lucide-react";
import { getSupportKpis } from "@/lib/atendimento.functions";
import type { KpiTotals, SupportKpis } from "@/lib/support-kpis";
import { useSupportFn } from "./demo";
import { formatDuration } from "./utils";
import { tagTone } from "./CustomerPanel";

// Atendimento > KPI. Cores das 2 séries (recebidos × respondidos) validadas
// (daltonismo e contraste) contra o fundo do card nos modos claro e escuro.
const VIZ_CSS = `
.support-kpi { --series-in: #2a78d6; --series-out: #eb6834; }
.dark .support-kpi { --series-in: #3987e5; --series-out: #d95926; }
`;

const AXIS = { fill: "var(--color-muted-foreground)", fontSize: 11 };
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function SupportKpisView({ range }: { range: { from: string; to: string } }) {
  const kpiFn = useSupportFn(getSupportKpis, "getSupportKpis");
  const q = useQuery({
    queryKey: ["support-kpis", range.from, range.to],
    queryFn: () => kpiFn({ data: range }) as Promise<SupportKpis>,
  });
  const k = q.data;

  if (q.isError) return <p className="text-sm text-destructive py-10 text-center">{(q.error as any)?.message ?? "Erro ao carregar"}</p>;

  return (
    <div className="support-kpi space-y-3">
      <style>{VIZ_CSS}</style>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile icon={Inbox} cls="bg-primary/10 text-primary" label="E-mails recebidos" k={k} pick={(t) => t.received} />
        <Tile icon={Reply} cls="bg-info/10 text-info" label="Respostas enviadas" k={k} pick={(t) => t.replied} />
        <Tile icon={Timer} cls="bg-violet-500/10 text-violet-600 dark:text-violet-400" label="Tempo médio de resposta"
          k={k} pick={(t) => t.avgResponseMs} format={formatDuration} lowerIsBetter />
        <Tile icon={Clock} cls="bg-warning/15 text-amber-600 dark:text-amber-400" label="Respondidos em até 24h"
          k={k} pick={(t) => t.within24hPct} format={(v) => (v == null ? "—" : `${v}%`)} />
        <Tile icon={CircleCheck} cls="bg-success/15 text-success" label="Resolvidos" k={k} pick={(t) => t.resolved} />
        <Tile icon={MessageSquarePlus} cls="bg-sky-500/10 text-sky-600 dark:text-sky-400" label="Conversas novas" k={k} pick={(t) => t.newConversations} />
      </div>

      <div className="grid xl:grid-cols-3 gap-3">
        <Card title="Recebidos × respondidos por dia" className="xl:col-span-2"
          legend={[["var(--series-in)", "Recebidos"], ["var(--series-out)", "Respondidos"]]}>
          {!k ? <Skeleton /> : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={k.daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip labelFormat={fmtDay} />} cursor={{ stroke: "var(--color-border)" }} />
                <Line type="monotone" dataKey="received" name="Recebidos" stroke="var(--series-in)" strokeWidth={2} dot={false}
                  activeDot={{ r: 5, stroke: "var(--color-card)", strokeWidth: 2 }} />
                <Line type="monotone" dataKey="replied" name="Respondidos" stroke="var(--series-out)" strokeWidth={2} dot={false}
                  activeDot={{ r: 5, stroke: "var(--color-card)", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Conversas por tag">
          {!k ? <Skeleton /> : !k.tags.length ? <Empty text="Nenhuma conversa com tag no período" /> : (
            <TagBars tags={k.tags} />
          )}
        </Card>
      </div>

      <div className="grid xl:grid-cols-2 gap-3">
        <Card title="Tempo médio de resposta por dia">
          {!k ? <Skeleton /> : !k.daily.some((d) => d.avgResponseMin != null) ? <Empty text="Nenhuma resposta no período" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={k.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                <Tooltip content={<ChartTip labelFormat={fmtDay} valueFormat={(v: number) => formatDuration(v * 60_000)} />} cursor={{ stroke: "var(--color-border)" }} />
                <Line type="monotone" dataKey="avgResponseMin" name="Tempo médio" stroke="var(--color-primary)" strokeWidth={2}
                  connectNulls dot={{ r: 3, fill: "var(--color-primary)", strokeWidth: 0 }} activeDot={{ r: 5, stroke: "var(--color-card)", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Horário de chegada dos e-mails" subtitle="horário de Nova York">
          {!k ? <Skeleton /> : <HoursChart hours={k.hours} />}
        </Card>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, cls, label, k, pick, format, lowerIsBetter }: {
  icon: typeof Inbox; cls: string; label: string; k: SupportKpis | undefined;
  pick: (t: KpiTotals) => number | null; format?: (v: number | null) => string; lowerIsBetter?: boolean;
}) {
  const cur = k ? pick(k.current) : undefined;
  const prev = k ? pick(k.previous) : undefined;
  const show = (v: number | null) => (format ? format(v) : v == null ? "—" : String(v));
  let delta: { pct: number; good: boolean } | null = null;
  if (cur != null && prev != null && prev > 0) {
    const pct = Math.round(((cur - prev) / prev) * 100);
    delta = { pct, good: lowerIsBetter ? pct < 0 : pct > 0 };
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 flex items-center gap-3 min-w-0">
      <div className={`size-10 rounded-xl grid place-items-center shrink-0 ${cls}`}><Icon className="size-[18px]" /></div>
      <div className="min-w-0">
        <p className="text-xl font-bold tracking-tight leading-tight">
          {cur === undefined ? <span className="inline-block w-10 h-5 rounded bg-muted animate-pulse align-middle" /> : show(cur)}
        </p>
        <p className="text-[11px] text-muted-foreground truncate" title={label}>{label}</p>
        {k && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-0.5" title={`Período anterior: ${show(prev ?? null)}`}>
            {!delta ? <><Minus className="size-3" /> sem comparação</> : delta.pct === 0 ? <><Minus className="size-3" /> igual ao anterior</> : (
              <>
                {delta.pct > 0 ? <ArrowUp className={`size-3 ${delta.good ? "text-success" : "text-destructive"}`} /> : <ArrowDown className={`size-3 ${delta.good ? "text-success" : "text-destructive"}`} />}
                {Math.abs(delta.pct)}% vs anterior
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function Card({ title, subtitle, legend, className = "", children }: {
  title: string; subtitle?: string; legend?: [string, string][]; className?: string; children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {legend && (
          <div className="flex items-center gap-3 shrink-0">
            {legend.map(([color, label]) => (
              <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="w-3 h-0.5 rounded-full" style={{ background: color }} />{label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function ChartTip({ active, payload, label, labelFormat, valueFormat }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-popover border border-border px-3 py-2 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1">{labelFormat ? labelFormat(label) : label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color ?? p.stroke }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-semibold text-foreground ml-auto pl-3">{p.value == null ? "—" : valueFormat ? valueFormat(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function TagBars({ tags }: { tags: { tag: string; count: number }[] }) {
  const max = Math.max(...tags.map((t) => t.count));
  return (
    <div className="space-y-2.5">
      {tags.slice(0, 10).map((t) => (
        <div key={t.tag} title={`${t.tag}: ${t.count} conversa${t.count === 1 ? "" : "s"}`}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className={`px-1.5 py-px rounded font-medium ${tagTone(t.tag)}`}>{t.tag}</span>
            <span className="font-semibold tabular-nums">{t.count}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(t.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function HoursChart({ hours }: { hours: { hour: number; count: number }[] }) {
  const peak = useMemo(() => hours.reduce((a, b) => (b.count > a.count ? b : a), hours[0]), [hours]);
  if (!hours.some((h) => h.count)) return <Empty text="Nenhum e-mail recebido no período" />;
  const data = hours.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, "0")}h` }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval={2} />
        <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTip />} cursor={{ fill: "var(--color-muted)" }} />
        <Bar dataKey="count" name="E-mails" radius={[4, 4, 0, 0]} fill="var(--color-primary)"
          shape={(props: any) => (
            <rect x={props.x} y={props.y} width={Math.max(0, props.width - 2)} height={props.height} rx={3}
              fill="var(--color-primary)" fillOpacity={props.payload.hour === peak.hour ? 1 : 0.45} />
          )} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const Skeleton = () => <div className="h-[200px] rounded-xl bg-muted animate-pulse" />;
const Empty = ({ text }: { text: string }) => <p className="h-[200px] grid place-items-center text-xs text-muted-foreground">{text}</p>;

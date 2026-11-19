import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StickyNote, X } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { SOURCE_LABEL, deriveMetrics, fmtMetric, sumCounts, type MetricDef, type MetricSource, type RawCounts } from "@/lib/experiment-metrics";
import type { ExperimentRaw } from "@/lib/product-dashboard.functions";
import { fmtDate } from "@/components/products/ProductCampaigns";

// Gráfico de linhas da aba Métricas da campanha: x = dias, uma linha por
// métrica marcada. "Separados" = um gráfico por métrica com o valor real no
// eixo (passar o mouse em um mostra o mesmo dia em todos); "Sobrepostos" =
// todas no mesmo gráfico, cada uma comparada com a própria média (100 = média),
// porque gasto em dólar e CTR em % não cabem na mesma régua.

export type DiaryChange = { date: string; at: string; content: string };
export type ChartMode = "split" | "overlay";
export const MAX_LINES = 8;

// Paleta categórica validada (claro / escuro). A cor fica presa na métrica
// enquanto ela estiver marcada (desmarcar outra não troca as cores).
const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
};
const CHANGE_COLOR = { light: "#0ea5e9", dark: "#38bdf8" };

function useIsDark() {
  const read = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

const nyTime = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

// Lista das alterações do diário de um dia (usada no balão da tabela e do gráfico).
export function DiaryChangesList({ date, notes }: { date: string; notes: DiaryChange[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-1.5">
        <StickyNote className="size-3.5 text-sky-500" /> {notes.length === 1 ? "Alteração no diário" : `${notes.length} alterações no diário`} · {fmtDate(date)}
      </p>
      <ul className="space-y-2 max-h-60 overflow-y-auto">
        {notes.map((n, i) => (
          <li key={i} className="text-[13px] leading-snug">
            <span className="text-[11px] text-muted-foreground tabular-nums mr-1.5">{nyTime(n.at)}</span>
            <span className="whitespace-pre-wrap">{n.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiaryChangeHover({ date, notes, children }: { date: string; notes: DiaryChange[]; children: ReactNode }) {
  return (
    <HoverCard openDelay={80} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80 p-3">
        <DiaryChangesList date={date} notes={notes} />
      </HoverCardContent>
    </HoverCard>
  );
}

// Marcador no topo da linha tracejada da alteração; passar o mouse abre o texto.
function ChangeMarker({ viewBox, date, notes, color }: { viewBox?: { x: number; y: number }; date: string; notes: DiaryChange[]; color: string }) {
  if (!viewBox) return null;
  const { x, y } = viewBox;
  return (
    <DiaryChangeHover date={date} notes={notes}>
      <g style={{ cursor: "help" }} aria-label={`Alteração: ${notes.map((n) => n.content).join("; ")}`}>
        <circle cx={x} cy={y - 9} r={12} fill="transparent" />
        <circle cx={x} cy={y - 9} r={7} fill={color} strokeWidth={2} style={{ stroke: "var(--background)" }} />
        {notes.length > 1 && <text x={x} y={y - 6} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">{notes.length}</text>}
      </g>
    </DiaryChangeHover>
  );
}

// ── Escolha das métricas (chips) ──

export function MetricPicker({ available, selected, colorOf, onToggle, onClear }: {
  available: MetricDef[]; selected: string[]; colorOf: (key: string) => string; onToggle: (key: string) => void; onClear: () => void;
}) {
  const full = selected.length >= MAX_LINES;
  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-3 space-y-2">
      {(["meta", "shopify", "clarity"] as MetricSource[]).map((src) => {
        const list = available.filter((m) => m.source === src);
        if (!list.length) return null;
        return (
          <div key={src} className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{SOURCE_LABEL[src]}</span>
            {list.map((m) => {
              const on = selected.includes(m.key);
              const blocked = !on && full;
              return (
                <button key={m.key} onClick={() => onToggle(m.key)} disabled={blocked} aria-pressed={on}
                  title={blocked ? `Até ${MAX_LINES} métricas por vez — desmarque uma` : m.hint}
                  className={`h-7 px-2.5 rounded-full border text-xs font-medium flex items-center gap-1.5 transition-colors ${on
                    ? "border-foreground/25 bg-foreground/[0.06] text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"} ${blocked ? "opacity-40 cursor-not-allowed" : ""}`}>
                  <span className="size-2 rounded-full" style={{ background: on ? colorOf(m.key) : "transparent", boxShadow: on ? undefined : "inset 0 0 0 1.5px currentColor" }} />
                  {m.label}
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
        <span>{selected.length ? `${selected.length} de até ${MAX_LINES} métricas no gráfico` : "Marque as métricas que quer ver como linha"}</span>
        {selected.length > 0 && (
          <button onClick={onClear} className="flex items-center gap-1 hover:text-foreground"><X className="size-3" /> Desmarcar todas</button>
        )}
      </div>
    </div>
  );
}

// Cor fixa por métrica: cada uma marcada ganha a primeira cor livre.
export function useLineColors(slots: Record<string, number>) {
  const dark = useIsDark();
  const pal = dark ? PALETTE.dark : PALETTE.light;
  return { colorOf: (key: string) => pal[(slots[key] ?? 0) % pal.length], changeColor: dark ? CHANGE_COLOR.dark : CHANGE_COLOR.light, dark };
}

// ── Gráfico de um grupo (campanha ou conjunto) ──

export function MetricsChart({ id, title, dates, rows, periodReach, metrics, colorOf, changeColor, dark, changes, partialDays, mode }: {
  id: string; title: string | null; dates: string[]; rows: Map<string, ExperimentRaw>; periodReach: number | undefined;
  metrics: MetricDef[]; colorOf: (key: string) => string; changeColor: string; dark: boolean;
  changes: Map<string, DiaryChange[]>; partialDays: Set<string>; mode: ChartMode;
}) {
  // Valores reais por dia + índice (valor ÷ média do período × 100) pro modo sobreposto.
  const { data, total } = useMemo(() => {
    const perDay = dates.map((d) => {
      const r = rows.get(d);
      return { date: d, v: r ? deriveMetrics(r) : null };
    });
    const means: Record<string, number> = {};
    for (const m of metrics) {
      const vals = perDay.map((p) => p.v?.[m.key]).filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x));
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      means[m.key] = mean;
    }
    const data = perDay.map(({ date, v }) => {
      const point: Record<string, string | number | null> = { date };
      for (const m of metrics) {
        const val = v?.[m.key] ?? null;
        point[m.key] = val;
        point[`i_${m.key}`] = val === null || !means[m.key] ? null : (val / means[m.key]) * 100;
      }
      return point;
    });
    const sum = sumCounts([...rows.values()] as RawCounts[]);
    const total = deriveMetrics(sum);
    if (periodReach) total.frequency = sum.impressions / periodReach;
    return { data, total };
  }, [dates, rows, metrics, periodReach]);

  const axisColor = dark ? "#8f8e86" : "#7a7970";
  const gridColor = dark ? "#2c2c2a" : "#e1e0d9";
  const tick = { fontSize: 11, fill: axisColor };
  const xTick = (d: string) => `${fmtDate(d).slice(0, 5)}${partialDays.has(d) ? "*" : ""}`;
  const changeLines = (withMarker: boolean) => [...changes.entries()]
    .filter(([d]) => dates.includes(d))
    .map(([d, notes]) => (
      <ReferenceLine key={d} x={d} stroke={changeColor} strokeDasharray="4 4" strokeOpacity={0.7} ifOverflow="extendDomain"
        label={withMarker ? <ChangeMarker date={d} notes={notes} color={changeColor} /> : undefined} />
    ));

  const tooltipBox = "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg px-3 py-2 text-xs max-w-[300px]";
  const ChangesInTooltip = ({ d }: { d: string }) => {
    const notes = changes.get(d);
    if (!notes) return null;
    return (
      <div className="mt-2 pt-2 border-t border-border">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400 flex items-center gap-1 mb-0.5"><StickyNote className="size-3" /> Diário</p>
        {notes.map((n, i) => <p key={i} className="line-clamp-3 leading-snug">{n.content}</p>)}
      </div>
    );
  };

  if (!metrics.length) {
    return (
      <section className="mt-4">
        {title && <h3 className="text-sm font-semibold mb-1.5">{title}</h3>}
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">Marque pelo menos uma métrica acima para ver o gráfico.</div>
      </section>
    );
  }

  if (mode === "overlay") {
    const single = metrics.length === 1 ? metrics[0] : null;
    return (
      <section className="mt-4 min-w-0">
        {title && <h3 className="text-sm font-semibold mb-1.5">{title}</h3>}
        <div className="rounded-xl border border-border bg-card p-3 pt-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 mb-2">
            {metrics.map((m) => (
              <span key={m.key} className="flex items-center gap-1.5 text-xs">
                <span className="w-3 h-0.5 rounded-full" style={{ background: colorOf(m.key) }} />
                <span className="text-muted-foreground">{m.label}</span>
                <span className="font-semibold tabular-nums">{fmtMetric(total[m.key], m.format)}</span>
              </span>
            ))}
          </div>
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 24, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" tickFormatter={xTick} tick={tick} tickLine={false} axisLine={{ stroke: gridColor }} minTickGap={16} />
                <YAxis tick={tick} tickLine={false} axisLine={false} width={single ? 72 : 44}
                  tickFormatter={(v: number) => (single ? fmtMetric(v, single.format) : `${Math.round(v)}`)} domain={single ? ["auto", "auto"] : [0, "auto"]} />
                {!single && <ReferenceLine y={100} stroke={axisColor} strokeOpacity={0.5} />}
                {changeLines(true)}
                <Tooltip
                  cursor={{ stroke: axisColor, strokeOpacity: 0.4 }}
                  content={({ active, label }) => {
                    if (!active || !label) return null;
                    const p = data.find((x) => x.date === label);
                    return (
                      <div className={tooltipBox}>
                        <p className="font-semibold mb-1">{fmtDate(String(label))}{partialDays.has(String(label)) ? " · Clarity parcial" : ""}</p>
                        {metrics.map((m) => {
                          const idx = p?.[`i_${m.key}`] as number | null;
                          return (
                            <p key={m.key} className="flex items-center gap-2 py-px">
                              <span className="size-2 rounded-full shrink-0" style={{ background: colorOf(m.key) }} />
                              <span className="text-muted-foreground flex-1 truncate">{m.label}</span>
                              <span className="font-semibold tabular-nums">{fmtMetric(p?.[m.key] as number | null, m.format)}</span>
                              {!single && idx !== null && idx !== undefined && (
                                <span className="text-[10.5px] text-muted-foreground tabular-nums w-10 text-right">{idx >= 100 ? "+" : ""}{Math.round(idx - 100)}%</span>
                              )}
                            </p>
                          );
                        })}
                        <ChangesInTooltip d={String(label)} />
                      </div>
                    );
                  }} />
                {metrics.map((m) => (
                  <Line key={m.key} dataKey={single ? m.key : `i_${m.key}`} name={m.label} stroke={colorOf(m.key)} strokeWidth={2}
                    dot={dates.length <= 31 ? { r: 2.5, strokeWidth: 0, fill: colorOf(m.key) } : false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: dark ? "#1a1a19" : "#fff" }} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 px-1">
            {single ? "Valor real da métrica em cada dia." : "Cada linha é comparada com a própria média no período (100 = média; 120 = 20% acima). Passe o mouse para ver os valores reais."}
            {" "}Bolinha azul = alteração do diário (passe o mouse para ler).
          </p>
        </div>
      </section>
    );
  }

  // Separados: um gráfico pequeno por métrica, com o eixo no valor real.
  return (
    <section className="mt-4 min-w-0">
      {title && <h3 className="text-sm font-semibold mb-1.5">{title}</h3>}
      <div className="grid gap-3 lg:grid-cols-2">
        {metrics.map((m) => (
          <div key={m.key} className="rounded-xl border border-border bg-card p-3 min-w-0">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <span className="flex items-center gap-1.5 text-[13px] font-medium min-w-0" title={m.hint}>
                <span className="w-3 h-0.5 rounded-full shrink-0" style={{ background: colorOf(m.key) }} />
                <span className="truncate">{m.label}</span>
                <span className="text-[10.5px] text-muted-foreground font-normal">{SOURCE_LABEL[m.source]}</span>
              </span>
              <span className="text-xs text-muted-foreground shrink-0">Total <span className="font-semibold text-foreground tabular-nums">{fmtMetric(total[m.key], m.format)}</span></span>
            </div>
            <div className="h-[180px] mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} syncId={`campaign-${id}`} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={gridColor} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={xTick} tick={tick} tickLine={false} axisLine={{ stroke: gridColor }} minTickGap={20} />
                  <YAxis tick={tick} tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} tickCount={4}
                    tickFormatter={(v: number) => fmtMetric(v, m.format)} />
                  {changeLines(true)}
                  <Tooltip
                    cursor={{ stroke: axisColor, strokeOpacity: 0.4 }}
                    content={({ active, label }) => {
                      if (!active || !label) return null;
                      const p = data.find((x) => x.date === label);
                      return (
                        <div className={tooltipBox}>
                          <p className="text-muted-foreground">{fmtDate(String(label))}</p>
                          <p className="font-semibold tabular-nums text-sm">{fmtMetric(p?.[m.key] as number | null, m.format)}</p>
                          <ChangesInTooltip d={String(label)} />
                        </div>
                      );
                    }} />
                  <Line dataKey={m.key} name={m.label} stroke={colorOf(m.key)} strokeWidth={2}
                    dot={dates.length <= 31 ? { r: 2.5, strokeWidth: 0, fill: colorOf(m.key) } : false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: dark ? "#1a1a19" : "#fff" }} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">Passe o mouse em um gráfico e o mesmo dia aparece marcado em todos. Bolinha azul = alteração do diário (passe o mouse para ler).</p>
    </section>
  );
}

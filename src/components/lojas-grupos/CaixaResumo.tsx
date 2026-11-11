import { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot, ReferenceLine } from "recharts";
import { AlertTriangle, TrendingDown } from "lucide-react";

// Caixa Geral › Resumo: em vez da grade dia a dia (que continua na aba Semana e
// no caixa de cada loja), responde três perguntas — pra onde vai o saldo nos
// próximos 30 dias (e quando aperta), no que entrou/saiu dinheiro e por loja.
// Usa os mesmos lançamentos já expandidos (recorrências) da grade, então o
// saldo de hoje bate com o "Saldo do dia" da Semana.

export type ResumoItem = {
  date: string; kind: "income" | "expense"; amount: number;
  category: string | null; description: string | null; shop_id?: string; source?: string | null;
};

const DAYS_AHEAD = 30;
const LINE = "#3b6fe8"; // mesmo azul do card Saldo atual
const EST = "#8b5cf6";  // estimativa: violeta (mesmo do card A receber), tracejada
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1000 ? `$${(a / 1000).toLocaleString("en-US", { maximumFractionDigits: a >= 10_000 ? 0 : 1 })}k` : `$${a.toFixed(0)}`;
  return n < 0 ? `-${s}` : s;
};
const signed = (n: number) => `${n < 0 ? "-" : "+"}${money(Math.abs(n))}`;
const dm = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
const addDays = (k: string, n: number) => {
  const d = new Date(`${k}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const signedAmount = (e: ResumoItem) => (e.kind === "income" ? Number(e.amount) : -Number(e.amount));
// Mesmo nome do chip na grade: categoria; em "Outros", a descrição.
const labelOf = (e: ResumoItem) => {
  const cat = e.category ?? (e.kind === "income" ? "Entrada" : "Saída");
  const desc = (e.description ?? "").trim();
  return /^outros?\b/i.test(cat) && desc ? desc : cat;
};

export function CaixaResumo({ items, opening, todayKey, shopIds, shopNamesMap, perShopReceivable, lucroDia }: {
  items: ResumoItem[]; opening: number; todayKey: string;
  shopIds: string[]; shopNamesMap: Record<string, string>;
  perShopReceivable: { shop_id: string; amount: number }[];
  // Lucro médio por dia (últimos 3 dias fechados) — mesma base da "Projeção do
  // mês" das Metas. undefined = carregando; null = sem lojas na meta.
  lucroDia: number | null | undefined;
}) {
  const receivableTotal = useMemo(() => perShopReceivable.reduce((s, p) => s + Number(p.amount ?? 0), 0), [perShopReceivable]);
  const estReady = lucroDia != null;

  // ── Projeção: saldo no fim de cada dia, de hoje até +30 ──
  // · Lançado: o que já está no caixa (repasses agendados, contas, recorrentes).
  // · Estimado: Saldo total de hoje (saldo + a receber) + lucro médio/dia × dias.
  //   Não soma os lançamentos futuros: o lucro já desconta fornecedor e anúncios
  //   (somar seria contar duas vezes).
  const projection = useMemo(() => {
    const end = addDays(todayKey, DAYS_AHEAD);
    let bal = opening;
    const byDay = new Map<string, ResumoItem[]>();
    for (const e of items) {
      if (e.date <= todayKey) bal += signedAmount(e);
      else if (e.date <= end) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    }
    const base = bal + receivableTotal;
    let n = 0;
    const points: { key: string; label: string; saldo: number; estimado: number; entradas: number; saidas: number; maiorSaida: string | null }[] = [
      { key: todayKey, label: dm(todayKey), saldo: bal, estimado: base, entradas: 0, saidas: 0, maiorSaida: null },
    ];
    for (let k = addDays(todayKey, 1); k <= end; k = addDays(k, 1)) {
      n++;
      const list = byDay.get(k) ?? [];
      const entradas = list.filter((e) => e.kind === "income").reduce((s, e) => s + Number(e.amount), 0);
      const saidas = list.filter((e) => e.kind === "expense").reduce((s, e) => s + Number(e.amount), 0);
      const top = list.filter((e) => e.kind === "expense").sort((a, b) => Number(b.amount) - Number(a.amount))[0];
      bal += entradas - saidas;
      points.push({ key: k, label: dm(k), saldo: Math.round(bal * 100) / 100, estimado: Math.round((base + (lucroDia ?? 0) * n) * 100) / 100,
        entradas, saidas, maiorSaida: top ? `${labelOf(top)} ${money(Number(top.amount))}` : null });
    }
    // Dia mais apertado: pelo lançado (o que já tem data pra sair).
    const min = points.reduce((m, p) => (p.saldo < m.saldo ? p : m), points[0]);
    return { points, min, last: points[points.length - 1], first: points[0] };
  }, [items, opening, todayKey, receivableTotal, lucroDia]);

  // ── Período dos totais: semana atual (seg–dom) ou mês atual ──
  const [range, setRange] = useState<"semana" | "mes">("semana");
  const [from, to] = useMemo(() => {
    if (range === "mes") {
      const start = `${todayKey.slice(0, 7)}-01`;
      const d = new Date(`${start}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
      return [start, d.toISOString().slice(0, 10)];
    }
    const wd = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
    const monday = addDays(todayKey, wd === 0 ? -6 : -(wd - 1));
    return [monday, addDays(monday, 6)];
  }, [range, todayKey]);
  const inRange = useMemo(() => items.filter((e) => e.date >= from && e.date <= to && Number(e.amount) !== 0), [items, from, to]);

  const byCategory = useMemo(() => {
    const m = new Map<string, { label: string; kind: "income" | "expense"; total: number }>();
    for (const e of inRange) {
      const label = labelOf(e);
      const k = `${e.kind}:${label}`;
      const row = m.get(k) ?? { label, kind: e.kind, total: 0 };
      row.total += Number(e.amount);
      m.set(k, row);
    }
    const rows = [...m.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    return {
      income: rows.filter((r) => r.kind === "income"),
      expense: rows.filter((r) => r.kind === "expense"),
      result: inRange.reduce((s, e) => s + signedAmount(e), 0),
    };
  }, [inRange]);

  const byShop = useMemo(() => {
    const rec = new Map(perShopReceivable.map((p) => [p.shop_id, Number(p.amount ?? 0)]));
    const ids = [...shopIds];
    if (inRange.some((e) => !e.shop_id || !shopIds.includes(e.shop_id))) ids.push("");
    return ids.map((id) => {
      const list = inRange.filter((e) => (id ? e.shop_id === id : !e.shop_id || !shopIds.includes(e.shop_id)));
      const entradas = list.filter((e) => e.kind === "income").reduce((s, e) => s + Number(e.amount), 0);
      const saidas = list.filter((e) => e.kind === "expense").reduce((s, e) => s + Number(e.amount), 0);
      return { id, name: id ? shopNamesMap[id] ?? id : "Sem loja", entradas, saidas, resultado: entradas - saidas, receber: rec.get(id) ?? 0 };
    }).filter((r) => r.entradas || r.saidas || r.receber)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" }));
  }, [inRange, perShopReceivable, shopIds, shopNamesMap]);

  const { points, min, last, first } = projection;
  const tight = min.saldo < 0;
  const ticks = points.filter((_, i) => i % 5 === 0).map((p) => p.label);

  return (
    <div className="space-y-4">
      {/* ── Projeção ── */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold">Projeção de saldo · próximos {DAYS_AHEAD} dias</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: LINE }} />Lançado no caixa</span>
              {estReady && (
                <span className="flex items-center gap-1.5" title="Saldo total de hoje (saldo + a receber) + lucro médio por dia dos últimos 3 dias fechados — a mesma base da Projeção do mês nas Metas. Saídas fora do lucro (retiradas, ferramentas) não entram.">
                  <span className="w-4 border-t-2 border-dashed" style={{ borderColor: EST }} />Estimado · saldo total + lucro de ~{money(lucroDia!)}/dia
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-5 text-right">
            <Stat label="Hoje" value={money(first.saldo)} />
            <Stat label={`Em ${dm(last.key)}${estReady ? " · est." : ""}`} value={money(estReady ? last.estimado : last.saldo)} />
            <Stat label={`Menor lançado · ${dm(min.key)}`} value={money(min.saldo)} danger={tight} />
          </div>
        </div>

        {min.key !== first.key && (
          <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${tight ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"}`}>
            {tight ? <AlertTriangle className="size-3.5 shrink-0" /> : <TrendingDown className="size-3.5 shrink-0 text-muted-foreground" />}
            <span>
              {tight ? "Saldo fica negativo" : "Saldo mais baixo"} em <strong>{dm(min.key)}</strong>: {money(min.saldo)}
              {min.maiorSaida && <span className="text-muted-foreground"> · maior saída do dia: {min.maiorSaida}</span>}
            </span>
          </div>
        )}

        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="caixa-proj" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={LINE} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={LINE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.6} />
              <XAxis dataKey="label" ticks={ticks} tickLine={false} axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              <YAxis width={52} tickLine={false} axisLine={false} tickFormatter={moneyShort}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
              {tight && <ReferenceLine y={0} stroke="var(--color-destructive)" strokeDasharray="4 4" />}
              <Tooltip cursor={{ stroke: "var(--color-muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  const p = active && payload?.[0]?.payload as (typeof points)[number] | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md space-y-0.5">
                      <p className="font-semibold">{p.key === todayKey ? `Hoje (${p.label})` : p.label}</p>
                      <p>Lançado: <span className="font-semibold tabular-nums">{money(p.saldo)}</span></p>
                      {estReady && <p>Estimado: <span className="font-semibold tabular-nums">{money(p.estimado)}</span></p>}
                      {p.entradas > 0 && <p className="text-muted-foreground tabular-nums">Entradas lançadas {signed(p.entradas)}</p>}
                      {p.saidas > 0 && <p className="text-muted-foreground tabular-nums">Saídas lançadas {signed(-p.saidas)}</p>}
                      {p.maiorSaida && <p className="text-muted-foreground">Maior saída: {p.maiorSaida}</p>}
                    </div>
                  );
                }} />
              <Area type="monotone" dataKey="saldo" stroke={LINE} strokeWidth={2} fill="url(#caixa-proj)" isAnimationActive={false}
                activeDot={{ r: 4, fill: LINE, stroke: "var(--color-card)", strokeWidth: 2 }} />
              {estReady && <Line type="monotone" dataKey="estimado" stroke={EST} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}
                activeDot={{ r: 4, fill: EST, stroke: "var(--color-card)", strokeWidth: 2 }} />}
              <ReferenceDot x={min.label} y={min.saldo} r={5} fill={tight ? "var(--color-destructive)" : LINE} stroke="var(--color-card)" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Totais do período ── */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
          {([["semana", "Esta semana"], ["mes", "Este mês"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setRange(k)}
              className={`h-7 px-3 rounded-md font-medium ${range === k ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">{dm(from)} a {dm(to)}</span>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-semibold mb-3">Por categoria</p>
          {!inRange.length ? <p className="text-xs text-muted-foreground py-6 text-center">Nenhum lançamento no período.</p> : (
            <div className="space-y-3 text-sm">
              <CategoryBlock title="Entradas" rows={byCategory.income} sign={1} />
              <CategoryBlock title="Saídas" rows={byCategory.expense} sign={-1} />
              <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
                <span>Resultado</span>
                <span className={`tabular-nums ${byCategory.result < 0 ? "text-destructive" : "text-emerald-600"}`}>{signed(byCategory.result)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-semibold mb-3">Por loja</p>
          {!byShop.length ? <p className="text-xs text-muted-foreground py-6 text-center">Nenhum lançamento no período.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-left font-medium pb-2">Loja</th>
                    <th className="text-center font-medium pb-2">Entradas</th>
                    <th className="text-center font-medium pb-2">Saídas</th>
                    <th className="text-center font-medium pb-2">Resultado</th>
                    <th className="text-center font-medium pb-2" title="Saldo na Shopify aguardando repasse (agora)">A receber</th>
                  </tr>
                </thead>
                <tbody>
                  {byShop.map((r) => (
                    <tr key={r.id || "none"} className="border-t border-border">
                      <td className="py-2 pr-2 truncate max-w-[160px]">{r.name}</td>
                      <td className="text-center tabular-nums">{r.entradas ? money(r.entradas) : "—"}</td>
                      <td className="text-center tabular-nums">{r.saidas ? money(r.saidas) : "—"}</td>
                      <td className={`text-center tabular-nums font-semibold ${r.resultado < 0 ? "text-destructive" : ""}`}>{r.entradas || r.saidas ? signed(r.resultado) : "—"}</td>
                      <td className="text-center tabular-nums text-muted-foreground">{r.receber ? money(r.receber) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${danger ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function CategoryBlock({ title, rows, sign }: { title: string; rows: { label: string; total: number }[]; sign: 1 | -1 }) {
  const sum = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
        <span>{title}</span><span className="tabular-nums">{rows.length ? signed(sign * sum) : "—"}</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between py-0.5">
          <span className="truncate pr-2">{r.label}</span>
          <span className="tabular-nums">{signed(sign * r.total)}</span>
        </div>
      ))}
    </div>
  );
}

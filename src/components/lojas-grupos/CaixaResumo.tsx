import { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import {
  ArrowDown, ArrowDownLeft, ArrowLeftRight, ArrowUp, ArrowUpRight, BarChart3, CalendarDays, Coins, Layers, LayoutGrid, Megaphone,
  Package, RefreshCcw, ShoppingBag, Store, Undo2, Wallet,
} from "lucide-react";

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
// Verde = saldo positivo / entrada, vermelho = negativo / saída (mesma regra da aba Wise).
const LINE = "#10b981"; // lançado no caixa (linha cheia)
const EST = "#059669";  // estimativa: verde mais escuro, tracejada (a legenda diferencia)
const NEG = "#f43f5e";
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

export function CaixaResumo({ items, opening, todayKey, shopIds, shopNamesMap, perShopReceivable, lucroDia, saldoAtual, alert }: {
  items: ResumoItem[]; opening: number; todayKey: string;
  shopIds: string[]; shopNamesMap: Record<string, string>;
  perShopReceivable: { shop_id: string; amount: number }[];
  // Lucro médio por dia (últimos 7 dias fechados).
  // undefined = carregando; null = sem lojas na meta.
  lucroDia: number | null | undefined;
  // Mesmo número do card Saldo atual (só conciliados) — no Resumo os 3 cards
  // de cima saem e os números vêm pra cá.
  saldoAtual: number;
  alert?: { label: string; detail: string; onClick?: () => void };
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
    const base = saldoAtual + receivableTotal;
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
  }, [items, opening, todayKey, receivableTotal, lucroDia, saldoAtual]);

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

  const { points, min, last } = projection;
  const tight = min.saldo < 0;
  const ticks = points.filter((_, i) => i % 5 === 0).map((p) => p.label);
  // Onde o zero cai na altura de cada linha (0 = topo, 1 = base): ali o verde vira vermelho.
  const zeroOf = (v: number[]) => {
    const max = Math.max(0, ...v), lo = Math.min(0, ...v);
    return max <= 0 ? 0 : lo >= 0 ? 1 : max / (max - lo);
  };
  const zeroAt = zeroOf(points.map((p) => p.saldo));
  const zeroEst = zeroOf(points.map((p) => p.estimado));

  const saldoTotal = saldoAtual + receivableTotal;
  const estValue = estReady ? last.estimado : last.saldo;
  const totIn = byCategory.income.reduce((t, r) => t + r.total, 0);
  const totOut = byCategory.expense.reduce((t, r) => t + r.total, 0);

  return (
    <div className="space-y-4">
      {alert && (
        <button type="button" onClick={alert.onClick} title={alert.detail}
          className="w-full text-left rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/15">
          <span className="font-semibold">{alert.label}:</span> {alert.detail}
        </button>
      )}

      {/* ── Números de hoje ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-sm bg-gradient-to-br ${saldoAtual < 0 ? "from-rose-500 to-red-700" : "from-emerald-500 to-emerald-700"}`}>
          <Wallet className="absolute -right-3 -bottom-4 size-24 opacity-10" />
          <div className="flex items-center gap-3">
            <span className="hidden sm:grid size-11 shrink-0 rounded-xl bg-white/15 place-items-center"><Wallet className="size-5" /></span>
            <div className="min-w-0">
              <p className="text-sm font-medium opacity-90">Saldo Atual</p>
              <p className="text-xl sm:text-2xl font-bold tabular-nums leading-tight truncate">{money(saldoAtual)}</p>
            </div>
          </div>
        </div>
        <KpiCard icon={<ArrowDown className="size-5" />} label="A Receber" value={money(receivableTotal)} negative={receivableTotal < 0}
          title="Saldo na Shopify aguardando repasse (agora)" />
        <KpiCard icon={<Layers className="size-5" />} label="Saldo Total" value={money(saldoTotal)} negative={saldoTotal < 0}
          title="Saldo atual + a receber" />
        <KpiCard icon={<BarChart3 className="size-5" />} label={`${estReady ? "Estimativa" : "Lançado"} ${dm(last.key)}`} value={money(estValue)} negative={estValue < 0}
          title={estReady ? `Saldo total + lucro médio de 7 dias sem reembolsos (~${money(lucroDia!)}/dia) × ${DAYS_AHEAD} dias` : "Saldo com o que já está lançado no caixa"} />
      </div>

      {/* ── Projeção (no celular só os números de cima) ── */}
      <div className="hidden md:block rounded-2xl border border-border bg-card shadow-sm p-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3">
          <p className="text-sm font-semibold flex items-center gap-2">
            <IconTile><BarChart3 className="size-4" /></IconTile> Projeção de saldo · próximos {DAYS_AHEAD} dias
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded" style={{ background: LINE }} />Lançado no caixa</span>
            {estReady && (
              <span className="flex items-center gap-1.5" title="Saldo total de hoje (saldo + a receber) + lucro médio por dia dos últimos 7 dias fechados (hoje não entra: ainda está em andamento). Saídas fora do lucro (retiradas, ferramentas) não entram.">
                <span className="w-4 border-t-2 border-dashed" style={{ borderColor: EST }} />Estimado · saldo total + lucro médio de 7 dias sem reembolsos (~{money(lucroDia!)}/dia)
              </span>
            )}
          </div>
        </div>

        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <defs>
                {/* Abaixo de zero vira vermelho (corte na altura do zero do eixo). */}
                <linearGradient id="caixa-proj" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={zeroAt > 0 ? LINE : NEG} stopOpacity={0.22} />
                  <stop offset={zeroAt} stopColor={zeroAt > 0 ? LINE : NEG} stopOpacity={0.02} />
                  <stop offset={zeroAt} stopColor={NEG} stopOpacity={0.02} />
                  <stop offset="100%" stopColor={NEG} stopOpacity={0.22} />
                </linearGradient>
                <linearGradient id="caixa-proj-line" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={zeroAt} stopColor={zeroAt > 0 ? LINE : NEG} />
                  <stop offset={zeroAt} stopColor={zeroAt < 1 ? NEG : LINE} />
                </linearGradient>
                <linearGradient id="caixa-proj-est" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={zeroEst} stopColor={zeroEst > 0 ? EST : NEG} />
                  <stop offset={zeroEst} stopColor={zeroEst < 1 ? NEG : EST} />
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
                    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-md space-y-1">
                      <p className="font-semibold flex items-center gap-1.5"><CalendarDays className="size-3.5 text-muted-foreground" />{p.key === todayKey ? `Hoje (${p.label})` : p.label}</p>
                      <p className="flex items-center gap-1.5"><Dot color={p.saldo < 0 ? NEG : LINE} />Lançado: <span className="font-semibold tabular-nums">{money(p.saldo)}</span></p>
                      {estReady && <p className="flex items-center gap-1.5"><Dot color={p.estimado < 0 ? NEG : EST} hollow />Estimado: <span className="font-semibold tabular-nums">{money(p.estimado)}</span></p>}
                      {p.entradas > 0 && <p className="text-muted-foreground tabular-nums">Entradas lançadas {signed(p.entradas)}</p>}
                      {p.saidas > 0 && <p className="text-muted-foreground tabular-nums">Saídas lançadas {signed(-p.saidas)}</p>}
                      {p.maiorSaida && <p className="text-muted-foreground">Maior saída: {p.maiorSaida}</p>}
                    </div>
                  );
                }} />
              <Area type="monotone" dataKey="saldo" stroke="url(#caixa-proj-line)" strokeWidth={2} fill="url(#caixa-proj)" isAnimationActive={false}
                activeDot={{ r: 4, fill: LINE, stroke: "var(--color-card)", strokeWidth: 2 }} />
              {estReady && <Line type="monotone" dataKey="estimado" stroke="url(#caixa-proj-est)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}
                activeDot={{ r: 4, fill: "var(--color-card)", stroke: EST, strokeWidth: 2 }} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      {estReady && (
        <p className="md:hidden text-[11px] text-muted-foreground leading-snug">
          Estimativa: saldo total + lucro médio de 7 dias sem reembolsos (~{money(lucroDia!)}/dia).
        </p>
      )}

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
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <p className="text-sm font-semibold mb-3 flex items-center gap-2"><IconTile><LayoutGrid className="size-4" /></IconTile> Por categoria</p>
          {!inRange.length ? <p className="text-xs text-muted-foreground py-6 text-center">Nenhum lançamento no período.</p> : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <TotalTile icon={<ArrowUp className="size-4" />} label="Entradas" value={signed(totIn)} tone="pos" />
                <TotalTile icon={<ArrowDown className="size-4" />} label="Saídas" value={signed(-totOut)} tone="neg" />
                <TotalTile icon={<Coins className="size-4" />} label="Resultado" value={signed(byCategory.result)} tone={byCategory.result < 0 ? "neg" : "pos"} />
              </div>
              <CategoryBlock title="Entradas" rows={byCategory.income} sign={1} bar="bg-emerald-500" />
              <CategoryBlock title="Saídas" rows={byCategory.expense} sign={-1} bar="bg-rose-500" />
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <p className="text-sm font-semibold mb-3 flex items-center gap-2"><IconTile><Store className="size-4" /></IconTile> Por loja</p>
          {!byShop.length ? <p className="text-xs text-muted-foreground py-6 text-center">Nenhum lançamento no período.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] text-muted-foreground">
                    <th className="text-left font-medium pb-2">Loja</th>
                    <th className="text-right font-medium pb-2 hidden sm:table-cell">Entradas</th>
                    <th className="text-right font-medium pb-2 hidden sm:table-cell">Saídas</th>
                    <th className="text-right font-medium pb-2">Resultado</th>
                    <th className="text-right font-medium pb-2" title="Saldo na Shopify aguardando repasse (agora)">A receber</th>
                  </tr>
                </thead>
                <tbody>
                  {byShop.map((r) => (
                    <tr key={r.id || "none"} className="border-t border-border">
                      <td className="py-2 pr-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="size-6 shrink-0 rounded-md bg-emerald-500/10 text-emerald-600 grid place-items-center"><ShoppingBag className="size-3.5" /></span>
                          <span className="truncate max-w-[150px] font-medium">{r.name}</span>
                        </span>
                      </td>
                      <td className="text-right tabular-nums hidden sm:table-cell">{r.entradas ? money(r.entradas) : "—"}</td>
                      <td className="text-right tabular-nums hidden sm:table-cell">{r.saidas ? money(r.saidas) : "—"}</td>
                      <td className={`text-right tabular-nums font-semibold ${r.resultado < 0 ? "text-rose-600" : "text-emerald-600"}`}>{r.entradas || r.saidas ? signed(r.resultado) : "—"}</td>
                      <td className="text-right tabular-nums text-muted-foreground">{r.receber ? money(r.receber) : "—"}</td>
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

function IconTile({ children }: { children: React.ReactNode }) {
  return <span className="size-7 rounded-lg bg-muted text-muted-foreground grid place-items-center">{children}</span>;
}

function Dot({ color, hollow }: { color: string; hollow?: boolean }) {
  return <span className="size-2.5 rounded-full shrink-0 border-2" style={{ borderColor: color, background: hollow ? "transparent" : color }} />;
}

// Card branco com ícone redondo; verde no positivo, vermelho no negativo.
function KpiCard({ icon, label, value, negative, title }: { icon: React.ReactNode; label: string; value: string; negative?: boolean; title?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 min-w-0" title={title}>
      <div className="flex items-center gap-3">
        <span className={`hidden sm:grid size-11 shrink-0 rounded-full place-items-center ${negative ? "bg-rose-500/10 text-rose-600" : "bg-emerald-500/10 text-emerald-600"}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{label}</p>
          <p className={`text-xl sm:text-2xl font-bold tabular-nums leading-tight truncate ${negative ? "text-rose-600" : ""}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

function TotalTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "pos" | "neg" }) {
  const cls = tone === "neg" ? "bg-rose-500/10 text-rose-600" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  return (
    <div className={`rounded-xl px-2 sm:px-3 py-2.5 min-w-0 flex items-center gap-2 ${cls}`}>
      <span className="hidden sm:grid size-7 shrink-0 rounded-full bg-white/60 dark:bg-white/10 place-items-center">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] opacity-80">{label}</p>
        <p className="text-xs sm:text-base font-bold tabular-nums truncate">{value}</p>
      </div>
    </div>
  );
}

// Ícone por categoria (as que mais aparecem); o resto pela direção.
function categoryIcon(label: string, sign: 1 | -1) {
  const l = label.toLowerCase();
  if (/shopify|dep[oó]sito|payout/.test(l)) return ShoppingBag;
  if (/reembolso fornecedor/.test(l)) return RefreshCcw;
  if (/fornecedor/.test(l)) return Package;
  if (/facebook|meta|ads|an[uú]ncio/.test(l)) return Megaphone;
  if (/reembolso|chargeback|estorno/.test(l)) return Undo2;
  if (/retirada/.test(l)) return Wallet;
  if (/transfer/.test(l)) return ArrowLeftRight;
  return sign > 0 ? ArrowDownLeft : ArrowUpRight;
}

// Cada categoria com a fatia dela dentro do grupo (barra fina + %).
function CategoryBlock({ title, rows, sign, bar }: { title: string; rows: { label: string; total: number }[]; sign: 1 | -1; bar: string }) {
  const sum = rows.reduce((t, r) => t + Math.abs(r.total), 0);
  if (!rows.length) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const share = sum > 0 ? Math.abs(r.total) / sum : 0;
          const Icon = categoryIcon(r.label, sign);
          return (
            <div key={r.label} className="flex items-center gap-2.5 text-xs">
              <span className={`size-7 shrink-0 rounded-lg grid place-items-center ${sign > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}><Icon className="size-3.5" /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{r.label}</span>
                  <span className="shrink-0 tabular-nums font-semibold">{signed(sign * r.total)}
                    <span className="ml-1.5 font-normal text-muted-foreground">{Math.round(share * 100)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(2, share * 100)}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

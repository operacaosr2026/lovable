import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowDown, ArrowDownLeft, ArrowRight, ArrowUp, ArrowUpDown, ArrowUpRight, BarChart3, CheckCircle2, ChevronLeft, ChevronRight,
  Circle, Landmark, Layers, StickyNote, List as ListIcon, Loader2, Pencil, PieChart as PieIcon, Plus, Search, Tag, Trash2, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  createWiseEntry, deleteWiseEntry, getWiseCash, updateWiseEntry, type WiseEntry, type WisePendingTransfer,
} from "@/lib/wise-cash.functions";
import { isoTodayUS } from "@/lib/timezone";

// Caixa Geral › Wise (R$): conta no Brasil. Entra o que sai do caixa em dólar,
// sai funcionário, contabilidade etc. Saldo atual = conciliados; o resto é a
// pagar / a confirmar.

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const usd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rate = (r: number) => r.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
// "1.234,56" / "1234.56" / "1234,5" → número.
const parseMoney = (s: string) => {
  const t = s.trim().replace(/[^\d.,-]/g, "");
  if (!t) return NaN;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return Number(norm);
};

const FIXED_CATS = ["Retirada Sergio", "Retirada Rodrigo"];
const EXPENSE_CATS = ["Funcionário", "Contabilidade", "Impostos", "Ferramentas", "Pró-labore", "Retirada Sergio", "Retirada Rodrigo", "Outros"];
const INCOME_CATS = ["Envio do caixa (US$)", "Saldo inicial", "Outros"];

type Draft = {
  id?: string; kind: "income" | "expense"; amount: string; date: string; category: string; description: string; note: string;
  reconciled: boolean; usd: string; source_cash_id: string | null; repeat: number;
  // Envio do caixa sendo convertido (só pra mostrar quanto falta no diálogo).
  closes_transfer: boolean; transfer?: WisePendingTransfer;
};

export function WiseCash() {
  const qc = useQueryClient();
  const getFn = useServerFn(getWiseCash);
  const q = useQuery({ queryKey: ["wise-cash"], queryFn: () => getFn() });
  const today = isoTodayUS();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | "income" | "expense" | "aberto">("todos");
  const [asc, setAsc] = useState(false);

  const updateFn = useServerFn(updateWiseEntry);
  const deleteFn = useServerFn(deleteWiseEntry);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["wise-cash"] });
    qc.invalidateQueries({ queryKey: ["dashboard-balances"] });
  };
  const toggle = useMutation({
    mutationFn: (e: WiseEntry) => updateFn({ data: { id: e.id, patch: { reconciled: !e.reconciled } } }),
    onSuccess: refresh, onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Lançamento excluído"); refresh(); }, onError: (e: Error) => toast.error(e.message),
  });

  const entries = q.data?.entries ?? [];
  const pending = q.data?.pending ?? [];
  const stats = useMemo(() => {
    const sign = (e: WiseEntry) => (e.kind === "income" ? e.amount : -e.amount);
    const saldo = entries.filter((e) => e.reconciled).reduce((s, e) => s + sign(e), 0);
    // A pagar / a receber só do mês escolhido (os meses seguintes do "repetir todo mês" ficam no mês deles).
    const open = entries.filter((e) => !e.reconciled && e.date.startsWith(month));
    const aPagar = open.filter((e) => e.kind === "expense").reduce((s, e) => s + e.amount, 0);
    const aReceber = open.filter((e) => e.kind === "income").reduce((s, e) => s + e.amount, 0);
    const inMonth = entries.filter((e) => e.date.startsWith(month));
    const entradas = inMonth.filter((e) => e.kind === "income").reduce((s, e) => s + e.amount, 0);
    const saidas = inMonth.filter((e) => e.kind === "expense").reduce((s, e) => s + e.amount, 0);
    const fx = inMonth.filter((e) => e.kind === "income" && e.usd_amount);
    const fxBrl = fx.reduce((s, e) => s + e.amount, 0);
    const fxUsd = fx.reduce((s, e) => s + (e.usd_amount ?? 0), 0);
    // Retiradas dos sócios sempre aparecem (mesmo zeradas no mês).
    const byCat = new Map<string, number>(FIXED_CATS.map((c) => [c, 0]));
    for (const e of inMonth) if (e.kind === "expense") byCat.set(e.category || "Sem categoria", (byCat.get(e.category || "Sem categoria") ?? 0) + e.amount);

    // Saldo no fim de cada dia do mês (só conciliados, como o Saldo atual); o
    // mês corrente para em hoje. Variação: fim deste mês (ou hoje) vs fim do anterior.
    const conc = entries.filter((e) => e.reconciled);
    const saldoAte = (d: string) => conc.filter((e) => e.date <= d).reduce((s, e) => s + sign(e), 0);
    const [yy, mm] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const days: { key: string; label: string; saldo: number }[] = [];
    for (let d = 1; d <= lastDay; d++) {
      const key = `${month}-${String(d).padStart(2, "0")}`;
      if (key > today) break;
      days.push({ key, label: dm(key), saldo: saldoAte(key) });
    }
    const prevEnd = saldoAte(`${month}-00`);
    const end = days.length ? days[days.length - 1].saldo : prevEnd;
    const delta = conc.some((e) => e.date < `${month}-01`) && prevEnd > 0 ? (end - prevEnd) / prevEnd : null;

    return {
      saldo, aPagar, aReceber, entradas, saidas, fxUsd, cambio: fxUsd > 0 ? fxBrl / fxUsd : null,
      inMonth, days, delta, cats: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [entries, month, today]);

  const rows = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return stats.inMonth
      .filter((e) => filter === "todos" || (filter === "aberto" ? !e.reconciled : e.kind === filter))
      .filter((e) => !words.length || words.every((w) => `${e.description ?? ""} ${e.category ?? ""} ${e.note ?? ""}`.toLowerCase().includes(w)))
      .sort((a, b) => (asc ? 1 : -1) * (a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)));
  }, [stats.inMonth, search, filter, asc]);

  // Saldo previsto: atual + o que falta conciliar no mês.
  const previsto = stats.saldo - stats.aPagar + stats.aReceber;
  const resultado = stats.entradas - stats.saidas;
  const share = (v: number) => (stats.saidas > 0 ? v / stats.saidas : 0);
  // Posição do zero na altura do gráfico (0 = topo, 1 = base): onde o verde vira vermelho.
  const zeroAt = (() => {
    const v = stats.days.map((d) => d.saldo);
    const max = Math.max(0, ...v), min = Math.min(0, ...v);
    return max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);
  })();
  const newDraft = (kind: "income" | "expense", over: Partial<Draft> = {}): Draft => ({
    kind, amount: "", date: today, category: kind === "expense" ? "" : "Envio do caixa (US$)", description: "", note: "",
    reconciled: true, usd: "", source_cash_id: null, repeat: 1, closes_transfer: false, ...over,
  });
  const fromTransfer = (t: WisePendingTransfer) => newDraft("income", {
    // Converte aos poucos: já vem com o que falta em dólar; a data é hoje (o dia da conversão).
    date: t.parts ? today : t.date, usd: t.remaining.toFixed(2).replace(".", ","), source_cash_id: t.id, transfer: t,
    description: `Envio do caixa ${dm(t.date)}${t.shop ? ` (${t.shop})` : ""}`,
  });

  // Mês + Entrada/Saída na linha das abas do Caixa Geral (shops.caixa.index.tsx).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Confere a cada render: o espaço pode aparecer depois (troca de aba, recarga da página).
  useEffect(() => {
    const el = document.getElementById("caixa-tab-actions");
    if (el !== slot) setSlot(el);
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Carregando...</div>;
  if (q.isError) return <div className="text-sm text-destructive">{(q.error as Error).message}</div>;

  const [y, m] = month.split("-").map(Number);
  const monthName = MONTHS[m - 1];
  const actions = (
    // Mesmos botões do Caixa (LgCashflowView).
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        <button onClick={() => setMonth(shiftMonth(month, -1))} className="size-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" aria-label="Mês anterior"><ChevronLeft className="size-3.5" /></button>
        <span className="text-xs font-medium w-24 text-center whitespace-nowrap">{monthName} {y}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} className="size-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" aria-label="Próximo mês"><ChevronRight className="size-3.5" /></button>
      </div>
      <Button variant="outline" size="sm" className="text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/5" onClick={() => setDraft(newDraft("income"))}>
        <Plus className="size-3.5" /> Entrada
      </Button>
      <Button variant="outline" size="sm" className="text-neutral-600 dark:text-neutral-400 border-neutral-400/30 hover:bg-neutral-500/5" onClick={() => setDraft(newDraft("expense"))}>
        <Plus className="size-3.5" /> Saída
      </Button>
    </div>
  );

  return (
    <div className="space-y-4 pb-6">
      {slot ? createPortal(actions, slot) : <div className="flex justify-end">{actions}</div>}

      {pending.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4 space-y-2">
          <p className="text-sm font-semibold">Envios do caixa que ainda não chegaram na Wise</p>
          <p className="text-xs text-muted-foreground">Saídas "Retirada Empresa" do caixa em dólar. Registre quanto caiu em reais pra entrar no saldo (e ver o câmbio). Pode converter aos poucos: o envio fica aqui até converter tudo.</p>
          <div className="space-y-1.5">
            {pending.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-background/70 border border-border px-3 py-2 text-sm">
                <span className="font-medium tabular-nums">{dm(t.date)}</span>
                <span className="font-semibold tabular-nums">{usd(t.amount)}</span>
                {t.shop && <span className="text-xs text-muted-foreground">{t.shop}</span>}
                {t.converted > 0 && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Convertido {usd(t.converted)} ({t.parts} {t.parts === 1 ? "vez" : "vezes"}) • <span className="font-semibold text-amber-700 dark:text-amber-400">falta {usd(t.remaining)}</span>
                  </span>
                )}
                <button onClick={() => setDraft(fromTransfer(t))}
                  className="ml-auto h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium">{t.converted > 0 ? "Converti mais" : "Chegou quanto em R$?"}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Verde com saldo positivo (ou zero), vermelho negativo. */}
        <div className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-sm bg-gradient-to-br ${stats.saldo < 0 ? "from-rose-500 to-red-700" : "from-emerald-500 to-emerald-700"}`}>
          <Wallet className="absolute -right-3 -bottom-4 size-24 opacity-10" />
          <div className="flex items-start gap-3">
            <span className="size-11 shrink-0 rounded-xl bg-white/15 grid place-items-center"><Wallet className="size-5" /></span>
            <div className="min-w-0">
              <p className="text-sm font-medium opacity-90">Saldo Atual</p>
              <p className="text-2xl font-bold tabular-nums leading-tight">{brl(stats.saldo)}</p>
              <p className="text-xs opacity-80 mt-0.5">Só conciliados</p>
            </div>
          </div>
        </div>
        <Kpi icon={<ArrowDown className="size-5" />} tone="bg-emerald-500/10 text-emerald-600" title={`A Pagar em ${monthName}`} value={brl(stats.aPagar)}
          note={stats.aPagar || stats.aReceber ? `Saldo depois de pagar: ${brl(previsto)}` : "Tudo do mês já conciliado"} />
        <Kpi icon={<ArrowRight className="size-5" />} tone="bg-sky-500/10 text-sky-600" title={`Entrou em ${monthName}`} value={brl(stats.entradas)}
          note={stats.cambio ? `${usd(stats.fxUsd)} • Câmbio ${rate(stats.cambio)}` : "Sem envio do caixa no mês"} />
        <Kpi icon={<ArrowUp className="size-5" />} tone="bg-rose-500/10 text-rose-600" title={`Saiu em ${monthName}`} value={brl(stats.saidas)}
          note={stats.saidas > 0 ? `Maior: ${stats.cats[0][0]}` : "Sem saídas no mês"} />
      </div>

      {/* ── Gráficos ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        <Card icon={<BarChart3 className="size-4" />} title="Evolução do Caixa" right={stats.delta != null && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md font-semibold ${stats.delta >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"}`}>
              {stats.delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {stats.delta >= 0 ? "+" : ""}{(stats.delta * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            </span>
            vs. mês anterior
          </span>
        )}>
          {stats.days.length === 0 ? (
            <p className="h-48 grid place-items-center text-xs text-muted-foreground">Mês ainda não começou.</p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    {/* Verde acima de zero, vermelho abaixo (corte no zero do eixo). */}
                    <linearGradient id="wiseLine" x1="0" y1="0" x2="0" y2="1">
                      <stop offset={zeroAt} stopColor={zeroAt > 0 ? POS : NEG} />
                      <stop offset={zeroAt} stopColor={zeroAt < 1 ? NEG : POS} />
                    </linearGradient>
                    <linearGradient id="wiseArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={zeroAt > 0 ? POS : NEG} stopOpacity={0.25} />
                      <stop offset={zeroAt} stopColor={zeroAt > 0 ? POS : NEG} stopOpacity={0.03} />
                      <stop offset={zeroAt} stopColor={zeroAt < 1 ? NEG : POS} stopOpacity={0.03} />
                      <stop offset="1" stopColor={zeroAt < 1 ? NEG : POS} stopOpacity={0.25} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} width={64}
                    tickFormatter={(v: number) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} />
                  <Tooltip cursor={{ stroke: "var(--color-muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
                    content={({ active, payload }: any) => active && payload?.length ? (
                      <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                        <p className="font-semibold">{payload[0].payload.label}</p>
                        <p className="text-muted-foreground">Saldo: <span className="font-semibold text-foreground tabular-nums">{brl(payload[0].value)}</span></p>
                      </div>
                    ) : null} />
                  <Area type="monotone" dataKey="saldo" stroke="url(#wiseLine)" strokeWidth={2} fill="url(#wiseArea)"
                    dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-card)" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card icon={<PieIcon className="size-4" />} title="Fluxo do Mês">
          <div className="flex items-center gap-4">
            <div className="relative size-40 shrink-0">
              {stats.entradas + stats.saidas > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[{ name: "Entradas", value: stats.entradas }, { name: "Saídas", value: stats.saidas }]} dataKey="value"
                      innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="var(--color-card)" strokeWidth={2} isAnimationActive={false}>
                      <Cell fill={POS} />
                      <Cell fill={NEG} />
                    </Pie>
                    <Tooltip content={({ active, payload }: any) => active && payload?.length ? (
                      <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                        {payload[0].name}: <span className="font-semibold tabular-nums">{brl(payload[0].value)}</span>
                      </div>
                    ) : null} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="size-full rounded-full border-[14px] border-muted" />}
              <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">
                <div>
                  <p className="text-sm font-bold tabular-nums">{brl(stats.entradas)}</p>
                  <p className="text-[10px] text-muted-foreground">Entradas</p>
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-0 divide-y divide-border text-sm">
              <LegendRow dot={POS} label="Entradas" value={brl(stats.entradas)} />
              <LegendRow dot={NEG} label="Saídas" value={brl(stats.saidas)} />
              <LegendRow dot={resultado >= 0 ? POS : NEG} label="Resultado"
                value={<span className={resultado >= 0 ? "text-emerald-600" : "text-destructive"}>{brl(resultado)}</span>} />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Lançamentos + categorias ── */}
      {/* Lançamentos acompanham a altura das Saídas por categoria (rola por dentro). */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden flex flex-col min-h-0">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold flex items-center gap-2 mr-auto">
              <span className="size-7 rounded-lg bg-muted text-muted-foreground grid place-items-center"><ListIcon className="size-4" /></span> Lançamentos
            </p>
            <div className="flex items-center gap-1.5 h-8 w-44 rounded-lg border border-border bg-background px-2">
              <Search className="size-3.5 text-muted-foreground shrink-0" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar lançamento..." className="flex-1 min-w-0 bg-transparent text-xs outline-none" />
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
              <option value="todos">Todos</option>
              <option value="income">Entradas</option>
              <option value="expense">Saídas</option>
              <option value="aberto">Não conciliados</option>
            </select>
            <button onClick={() => setAsc((v) => !v)} title={asc ? "Mais antigo primeiro" : "Mais recente primeiro"}
              className="size-8 grid place-items-center rounded-lg border border-border hover:bg-muted"><ArrowUpDown className="size-3.5" /></button>
          </div>
          {stats.inMonth.length === 0 ? (
            <div className="p-10 text-center">
              <Landmark className="size-8 mx-auto text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground mt-2">Nada lançado neste mês.</p>
              {entries.length === 0 && <p className="text-xs text-muted-foreground mt-1">Comece com uma Entrada "Saldo inicial" com o que tem hoje na Wise.</p>}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Nenhum lançamento com esse filtro.</p>
          ) : (
            <div className="relative flex-1 min-h-[280px]">
             <div className="max-h-[420px] lg:max-h-none lg:absolute lg:inset-0 overflow-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="text-[11px] text-muted-foreground shadow-[inset_0_-1px_0_var(--color-border)]">
                    <th className="w-10" />
                    <th className="text-left font-medium py-2 w-14">Data</th>
                    <th className="w-8" />
                    <th className="text-left font-medium py-2">Descrição</th>
                    <th className="text-right font-medium py-2 pr-2">Valor</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((e) => (
                    <tr key={e.id} className={e.reconciled ? "" : "bg-muted/30"}>
                      <td className="pl-4 pr-2 py-2">
                        <button onClick={() => toggle.mutate(e)} disabled={toggle.isPending} className={`align-middle ${e.reconciled ? "text-emerald-600" : "text-muted-foreground hover:text-foreground"}`}
                          title={e.reconciled ? "Conciliado (bateu com a Wise) — clique pra desfazer" : "Ainda não saiu/entrou — clique quando bater com a Wise"}>
                          {e.reconciled ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                        </button>
                      </td>
                      <td className="py-2 text-xs tabular-nums text-muted-foreground">{dm(e.date)}</td>
                      <td className="py-2">
                        <span className={`size-6 rounded-md grid place-items-center ${e.kind === "income" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}>
                          {e.kind === "income" ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                        </span>
                      </td>
                      <td className="py-2 pl-1 max-w-0 w-full">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{e.description || e.category || (e.kind === "income" ? "Entrada" : "Saída")}</span>
                          {e.category && e.category !== e.description && (
                            <span className="shrink-0 h-5 px-2 rounded-md bg-muted text-[10px] text-muted-foreground inline-flex items-center">{e.category}</span>
                          )}
                          {!e.reconciled && <span className="shrink-0 text-[10px] text-amber-600">{e.kind === "expense" ? "a pagar" : "a confirmar"}</span>}
                        </div>
                        {e.usd_amount ? <p className="text-[11px] text-muted-foreground truncate">{usd(e.usd_amount)} • Câmbio {rate(e.amount / e.usd_amount)}</p> : null}
                        {e.note ? <p className="text-[11px] text-amber-700 dark:text-amber-400 truncate" title={e.note}><StickyNote className="size-3 inline -mt-0.5 mr-1" />{e.note}</p> : null}
                      </td>
                      <td className={`py-2 pr-2 text-right font-semibold tabular-nums whitespace-nowrap ${e.kind === "income" ? "text-emerald-600" : "text-rose-600"}`}>
                        {e.kind === "income" ? "+" : "−"}{brl(e.amount)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">
                        <button onClick={() => setDraft({
                          id: e.id, kind: e.kind, amount: e.amount.toFixed(2).replace(".", ","), date: e.date, category: e.category ?? "",
                          description: e.description ?? "", note: e.note ?? "", reconciled: e.reconciled, usd: e.usd_amount ? e.usd_amount.toFixed(2) : "",
                          source_cash_id: e.source_cash_id, repeat: 1, closes_transfer: e.closes_transfer,
                        })} className="size-7 inline-grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" aria-label="Editar">
                          <Pencil className="size-3.5" />
                        </button>
                        <button onClick={() => { if (confirm("Excluir este lançamento da Wise?")) remove.mutate(e.id); }}
                          className="size-7 inline-grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted" aria-label="Excluir">
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
             </div>
            </div>
          )}
        </div>

        <Card icon={<Layers className="size-4" />} title="Saídas por Categoria">
          {(

            <div className="space-y-4">
              {stats.cats.map(([cat, v]) => (
                <div key={cat}>
                  <div className="flex items-baseline gap-2 text-sm mb-1.5">
                    <span className="flex-1 truncate">{cat}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{(share(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                    <span className="font-semibold tabular-nums w-28 text-right">{brl(v)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-rose-500" style={{ width: `${share(v) * 100}%` }} /></div>
                </div>
              ))}
              <div className="flex items-center gap-2 rounded-xl bg-rose-500/5 border border-rose-500/20 px-4 py-3">
                <Tag className="size-4 text-rose-600" />
                <span className="text-sm font-medium flex-1">Total de Saídas</span>
                <span className="text-lg font-bold tabular-nums text-rose-600">{brl(stats.saidas)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {draft && <EntryDialog draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); refresh(); }}
        categories={[...new Set([...(draft.kind === "expense" ? EXPENSE_CATS : INCOME_CATS), ...entries.filter((e) => e.kind === draft.kind).map((e) => e.category).filter(Boolean) as string[]])]} />}
    </div>
  );
}

// Entrada/saldo positivo verde, saída/saldo negativo vermelho (mesmas cores da tabela).
const POS = "#10b981";
const NEG = "#f43f5e";

function Card({ icon, title, right, children }: { icon: React.ReactNode; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="size-7 rounded-lg bg-muted text-muted-foreground grid place-items-center">{icon}</span>
        <p className="text-sm font-semibold mr-auto">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

function LegendRow({ dot, label, value }: { dot: string; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="size-2.5 rounded-full shrink-0" style={{ background: dot }} />
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Kpi({ icon, tone, title, value, note }: { icon: React.ReactNode; tone: string; title: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 min-w-0">
      <div className="flex items-start gap-3">
        <span className={`size-11 shrink-0 rounded-full grid place-items-center ${tone}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-2xl font-bold tabular-nums leading-tight truncate">{value}</p>
          {note && <p className="text-xs text-muted-foreground mt-0.5 truncate" title={note}>{note}</p>}
        </div>
      </div>
    </div>
  );
}

function EntryDialog({ draft, categories, onClose, onSaved }: { draft: Draft; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(draft);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const createFn = useServerFn(createWiseEntry);
  const updateFn = useServerFn(updateWiseEntry);
  const amount = parseMoney(d.amount);
  const usdAmount = d.kind === "income" && d.usd.trim() ? parseMoney(d.usd) : null;
  const ok = amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && (usdAmount == null || usdAmount > 0);
  // Conversão de um envio do caixa: quanto ainda sobraria depois desta.
  const t = d.transfer;
  const sobra = t && usdAmount ? Math.round((t.remaining - usdAmount) * 100) / 100 : null;
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        kind: d.kind, amount, date: d.date, category: d.category.trim() || null, description: d.description.trim() || null,
        note: d.note.trim() || null,
        reconciled: d.reconciled, usd_amount: usdAmount, source_cash_id: d.source_cash_id,
        closes_transfer: !!d.source_cash_id && d.closes_transfer,
      };
      if (d.id) return updateFn({ data: { id: d.id, patch: body } });
      return createFn({ data: { ...body, repeatMonths: d.kind === "expense" ? d.repeat : 1 } });
    },
    onSuccess: () => { toast.success(d.id ? "Lançamento salvo" : "Lançamento criado"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const income = d.kind === "income";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.id ? "Editar lançamento" : income ? "Entrada na Wise" : "Saída da Wise"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Valor (R$)"><input autoFocus value={d.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" placeholder="0,00" className={INPUT} /></Field>
            <Field label="Data"><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} className={INPUT} /></Field>
          </div>
          {t && (
            <div className="rounded-lg bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground">
              Envio de {dm(t.date)}: <span className="font-semibold text-foreground tabular-nums">{usd(t.amount)}</span>
              {t.converted > 0 && <> • já convertido {usd(t.converted)}</>} • falta <span className="font-semibold text-foreground tabular-nums">{usd(t.remaining)}</span>
            </div>
          )}
          {income && (
            <Field label={t ? "Quanto converteu agora em dólar" : "Valor enviado em dólar (opcional, pro câmbio)"}>
              <input value={d.usd} onChange={(e) => set({ usd: e.target.value })} inputMode="decimal" placeholder="US$" className={INPUT} />
              {usdAmount && amount > 0 ? <p className="text-[11px] text-muted-foreground mt-1">Câmbio: {rate(amount / usdAmount)}</p> : null}
              {sobra != null && sobra > 0.005 && !d.closes_transfer && <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">Sobram {usd(sobra)} pra converter depois (o envio continua na lista).</p>}
              {sobra != null && sobra < -0.005 && <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">Passa {usd(-sobra)} do que falta converter neste envio.</p>}
            </Field>
          )}
          {income && d.source_cash_id && (!t || (sobra != null && sobra > 0.005) || d.closes_transfer) && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={d.closes_transfer} onChange={(e) => set({ closes_transfer: e.target.checked })} className="size-3.5 accent-primary" />
              Encerrar este envio (o resto foi taxa / não vou converter)
            </label>
          )}
          <Field label="Categoria">
            <input value={d.category} onChange={(e) => set({ category: e.target.value })} list="wise-cats" placeholder={income ? "Envio do caixa (US$)" : "Funcionário, Contabilidade…"} className={INPUT} />
            <datalist id="wise-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {categories.slice(0, 12).map((c) => (
                <button key={c} type="button" onClick={() => set({ category: c })}
                  className={`h-6 px-2 rounded-md border text-[11px] ${d.category === c ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{c}</button>
              ))}
            </div>
          </Field>
          <Field label="Descrição (opcional)"><input value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} placeholder={income ? "" : "Ex.: salário João — novembro"} className={INPUT} /></Field>
          <Field label="Nota (opcional)">
            <textarea value={d.note} onChange={(e) => set({ note: e.target.value })} maxLength={2000} rows={3}
              placeholder="Detalhes, combinados, pra que foi…" className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary resize-y" />
          </Field>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={d.reconciled} onChange={(e) => set({ reconciled: e.target.checked })} className="size-3.5 accent-primary" />
            {income ? "Já caiu na Wise (conciliado)" : "Já saiu da Wise (conciliado)"}
          </label>
          {!income && !d.id && (
            <Field label="Repetir todo mês">
              <select value={d.repeat} onChange={(e) => set({ repeat: Number(e.target.value) })} className={INPUT}>
                <option value={1}>Não repetir</option>
                {[3, 6, 12].map((n) => <option key={n} value={n}>Por {n} meses (os próximos entram como a pagar)</option>)}
              </select>
            </Field>
          )}
          <button onClick={() => save.mutate()} disabled={!ok || save.isPending}
            className="h-9 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const INPUT = "w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs text-muted-foreground mb-1">{label}</span>{children}</label>;
}

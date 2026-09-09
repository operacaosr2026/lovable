import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Plus, Trash2, AlertTriangle, CheckCircle2, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  listSimulatedExpenses, createSimulatedExpense, deleteSimulatedExpense,
  getCaixaSimulation, SIM_RECURRENCE,
} from "@/lib/caixa-simulator.functions";

const RECURRENCE_LABELS: Record<(typeof SIM_RECURRENCE)[number], string> = {
  none: "Uma vez",
  daily: "Diário",
  weekly: "Semanal",
  monthly: "Mensal",
};

const PERIODS = [
  { days: 30, label: "30 dias" },
  { days: 60, label: "60 dias" },
  { days: 90, label: "90 dias" },
];

function fmt(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div className="rounded-xl bg-card border border-border p-3 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1 font-medium">{label}</p>
      <p className={`font-semibold ${value < 0 ? "text-destructive" : "text-foreground"}`}>{fmt(value)}</p>
    </div>
  );
}

export function CaixaSimulator() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [periodDays, setPeriodDays] = useState(90);

  const today = isoDate(new Date());
  const from = today;
  const to = addDays(today, periodDays);

  const listFn = useServerFn(listSimulatedExpenses);
  const createFn = useServerFn(createSimulatedExpense);
  const deleteFn = useServerFn(deleteSimulatedExpense);
  const simFn = useServerFn(getCaixaSimulation);

  const { data: expenses = [] } = useQuery({
    queryKey: ["simulated-expenses"],
    queryFn: () => listFn(),
  }) as { data: any[] };

  const { data: simulation, isLoading: simLoading } = useQuery({
    queryKey: ["caixa-simulation", periodDays],
    queryFn: () => simFn({ data: { from, to } }),
  }) as { data: any; isLoading: boolean };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["simulated-expenses"] });
    qc.invalidateQueries({ queryKey: ["caixa-simulation"] });
  };

  const create = useMutation({
    mutationFn: (input: any) => createFn({ data: input }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e.message ?? "Erro ao adicionar gasto"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: refresh,
  });

  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [recurrence, setRecurrence] = useState<(typeof SIM_RECURRENCE)[number]>("none");
  const [until, setUntil] = useState("");

  const addExpense = () => {
    const amt = parseFloat(amount.replace(",", "."));
    if (!desc.trim() || !amt || amt <= 0 || !date) return;
    create.mutate({
      description: desc.trim(),
      amount: amt,
      start_date: date,
      recurrence,
      recurrence_until: recurrence !== "none" && until ? until : null,
    });
    setDesc(""); setAmount(""); setRecurrence("none"); setUntil("");
  };

  const series = simulation?.series ?? [];
  const zeroOffset = useMemo(() => {
    const values = series.map((s: any) => Number(s.saldo) || 0);
    const max = Math.max(0, ...values);
    const min = Math.min(0, ...values);
    return max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);
  }, [series]);

  const chartData = series.map((s: any) => ({
    date: s.date.slice(5).split("-").reverse().join("/"),
    saldo: s.saldo,
  }));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Saldo atual</div>
          <div className="text-xl font-semibold">{simulation ? fmt(simulation.startingBalance) : "—"}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Gastos simulados</div>
          <div className="text-xl font-semibold text-destructive">{simulation ? fmt(simulation.simulatedTotal) : "—"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{simulation?.simulatedCount ?? 0} {simulation?.simulatedCount === 1 ? "gasto cadastrado" : "gastos cadastrados"}</div>
        </div>
        <div className={`rounded-2xl border p-4 ${simulation?.negativeFrom ? "border-destructive/30 bg-destructive/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
          {simulation?.negativeFrom ? (
            <>
              <div className="flex items-center gap-1.5 text-destructive text-[11px] uppercase tracking-wider font-medium mb-1">
                <AlertTriangle className="size-3.5" /> Fica negativo
              </div>
              <div className="text-sm font-semibold text-destructive">
                em {simulation.negativeFrom.slice(8, 10)}/{simulation.negativeFrom.slice(5, 7)}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-emerald-600 text-[11px] uppercase tracking-wider font-medium mb-1">
                <CheckCircle2 className="size-3.5" /> Caixa suporta
              </div>
              <div className="text-sm font-semibold text-emerald-600">nos próximos {periodDays} dias</div>
            </>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">Saldo projetado</p>
          <div className="flex items-center gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setPeriodDays(p.days)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  periodDays === p.days ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {simLoading ? (
          <div className="h-[220px] bg-muted animate-pulse rounded-xl" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="sim-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={`${Math.min(5, zeroOffset * 100)}%`} stopColor="var(--color-primary)" stopOpacity={0.25} />
                  <stop offset={`${zeroOffset * 100}%`} stopColor="var(--color-primary)" stopOpacity={0} />
                  <stop offset={`${zeroOffset * 100}%`} stopColor="var(--color-destructive)" stopOpacity={0} />
                  <stop offset={`${Math.max(95, zeroOffset * 100)}%`} stopColor="var(--color-destructive)" stopOpacity={0.25} />
                </linearGradient>
                <linearGradient id="sim-stroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={`${zeroOffset * 100}%`} stopColor="var(--color-primary)" />
                  <stop offset={`${zeroOffset * 100}%`} stopColor="var(--color-destructive)" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <ReferenceLine y={0} stroke="var(--color-border)" strokeDasharray="3 3" />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
              <Area type="monotone" dataKey="saldo" stroke="url(#sim-stroke)" strokeWidth={2} fill="url(#sim-grad)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Add expense form */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
          <FlaskConical className="size-4 text-muted-foreground" /> Gastos simulados
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mb-3">
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Descrição (ex: Ads, Fornecedor...)"
            className="sm:col-span-4 h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Valor"
            inputMode="decimal"
            className="sm:col-span-2 h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="sm:col-span-2 h-9 px-2 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
          />
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as any)}
            className="sm:col-span-2 h-9 px-2 rounded-lg bg-background border border-border text-sm outline-none"
          >
            {SIM_RECURRENCE.map((r) => <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}
          </select>
          {recurrence !== "none" ? (
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              placeholder="Até quando"
              title="Repetir até (opcional)"
              className="sm:col-span-1 h-9 px-1 rounded-lg bg-background border border-border text-xs outline-none focus:border-primary/50"
            />
          ) : (
            <div className="sm:col-span-1" />
          )}
          <button
            onClick={addExpense}
            disabled={create.isPending}
            className="sm:col-span-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <Plus className="size-4" />
          </button>
        </div>

        {expenses.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Nenhum gasto simulado ainda. Adicione acima para ver o impacto no caixa.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {expenses.map((e: any) => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 truncate">{e.description}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {e.start_date.slice(8, 10)}/{e.start_date.slice(5, 7)}
                  {e.recurrence !== "none" && ` · ${RECURRENCE_LABELS[e.recurrence as keyof typeof RECURRENCE_LABELS]}`}
                </span>
                <span className="font-medium text-destructive shrink-0">{fmt(Number(e.amount))}</span>
                <button
                  onClick={async () => {
                    if (await confirm(`Remover "${e.description}"?`)) remove.mutate(e.id);
                  }}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

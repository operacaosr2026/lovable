import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFinanceDashboard } from "@/lib/finance.functions";
import { requireAuth } from "@/lib/route-guards";
import { AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp, Target, ArrowRight, AlertCircle, Plus } from "lucide-react";

export const Route = createFileRoute("/finance/")({
  beforeLoad: requireAuth,
  component: FinanceDashboard,
});

const fmtBRL = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCur = (v: number, cur: string) =>
  cur === "USD"
    ? `US$ ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : fmtBRL(v);

function FinanceDashboard() {
  const get = useServerFn(getFinanceDashboard);
  const { data, isLoading } = useQuery({ queryKey: ["finance-dash"], queryFn: () => get() });

  if (isLoading || !data)
    return (
      <div className="grid place-items-center h-64">
        <div className="size-6 rounded-full border-2 border-border border-t-primary animate-spin" />
      </div>
    );

  const { accounts, totalBRL, fx, history, upcoming, cashflow, monthlyGoal, yearlyGoal } = data;

  const chartHistory = history.map((h: any) => ({ d: h.date.slice(5), v: h.brl }));
  const monthlyPct = monthlyGoal ? Math.min(100, (totalBRL / Number(monthlyGoal.target_amount_brl)) * 100) : 0;
  const yearlyPct = yearlyGoal ? Math.min(100, (totalBRL / Number(yearlyGoal.target_amount_brl)) * 100) : 0;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Patrimônio total */}
      <section className="col-span-12 lg:col-span-7 rounded-2xl bg-surface border border-border p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Patrimônio total</div>
        <div className="mt-2 text-5xl font-bold tracking-tight tabular-nums">{fmtBRL(totalBRL)}</div>
        <div className="text-xs text-muted-foreground mt-1.5">
          USD→BRL: <span className="font-medium text-foreground tabular-nums">{fx.toFixed(4)}</span>
          <Link to="/finance/settings" className="ml-2 underline-offset-4 hover:underline">ajustar</Link>
        </div>

        <div className="mt-5 h-40 -mx-2">
          {chartHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartHistory}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.6 0.22 285)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.6 0.22 285)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="d" stroke="oklch(0.62 0.012 270)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                  formatter={(v: number) => [fmtBRL(Number(v)), "Patrimônio"]}
                />
                <Area type="monotone" dataKey="v" stroke="oklch(0.6 0.22 285)" strokeWidth={2} fill="url(#nw)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">
              Adicione lançamentos para ver evolução
            </div>
          )}
        </div>
      </section>

      {/* Metas */}
      <section className="col-span-12 lg:col-span-5 rounded-2xl bg-surface border border-border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-primary" />
            <div className="text-sm font-semibold">Metas</div>
          </div>
          <Link to="/finance/settings" className="text-xs text-muted-foreground hover:text-foreground">configurar</Link>
        </div>

        <div className="mt-4 space-y-5">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Meta mensal</span>
              <span className="tabular-nums">{monthlyGoal ? `${fmtBRL(totalBRL)} / ${fmtBRL(Number(monthlyGoal.target_amount_brl))}` : "—"}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${monthlyPct}%`, background: "oklch(0.62 0.14 155)" }} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Meta anual</span>
              <span className="tabular-nums">{yearlyGoal ? `${fmtBRL(totalBRL)} / ${fmtBRL(Number(yearlyGoal.target_amount_brl))}` : "—"}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all gradient-primary" style={{ width: `${yearlyPct}%` }} />
            </div>
          </div>
        </div>
      </section>

      {/* Contas */}
      <section className="col-span-12 rounded-2xl bg-surface border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="text-sm font-semibold">Saldo das contas</div>
          <Link to="/finance/accounts" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            Gerenciar <ArrowRight className="size-3" />
          </Link>
        </div>
        {accounts.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma conta ainda.
            <Link to="/finance/accounts" className="ml-1 text-primary font-medium">Criar a primeira</Link>.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border">
            {accounts.map((a: any) => (
              <div key={a.id} className="bg-surface p-4">
                <div className="flex items-center gap-2.5">
                  {a.icon_url ? (
                    <img src={a.icon_url} alt="" className="size-7 rounded-lg object-cover bg-muted" />
                  ) : (
                    <div className="size-7 rounded-lg" style={{ background: a.color }} />
                  )}
                  <div className="text-sm font-medium truncate">{a.name}</div>
                  <span className="text-[10px] text-muted-foreground ml-auto">{a.currency}</span>
                </div>
                <div className="mt-2 text-lg font-semibold tabular-nums">{fmtCur(a.balance, a.currency)}</div>
                {a.currency === "USD" && (
                  <div className="text-[11px] text-muted-foreground tabular-nums">≈ {fmtBRL(a.balanceBRL)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Fluxo de caixa */}
      <section className="col-span-12 lg:col-span-7 rounded-2xl bg-surface border border-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="size-4 text-primary" />
          <div className="text-sm font-semibold">Fluxo de caixa — próximos 12 meses</div>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cashflow} barCategoryGap="20%">
              <XAxis dataKey="month" stroke="oklch(0.62 0.012 270)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="oklch(0.62 0.012 270)" fontSize={10} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
              <Tooltip
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                formatter={(v: number, name: string) => [fmtBRL(Number(v)), name === "income" ? "Entradas" : name === "expense" ? "Saídas" : "Saldo proj."]}
              />
              <Bar dataKey="income" fill="oklch(0.62 0.14 155)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expense" fill="oklch(0.65 0.16 25)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Saldo final projetado: <span className="text-foreground font-semibold tabular-nums">{fmtBRL(cashflow[cashflow.length - 1]?.balance ?? 0)}</span>
        </div>
      </section>

      {/* Contas a pagar */}
      <section className="col-span-12 lg:col-span-5 rounded-2xl bg-surface border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-warning" />
            <div className="text-sm font-semibold">Contas a pagar</div>
          </div>
          <Link to="/finance/transactions" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Plus className="size-3" /> Novo
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nada a pagar nos próximos 60 dias.</div>
        ) : (
          <ul className="divide-y divide-border max-h-80 overflow-y-auto">
            {upcoming.map((u: any, i: number) => (
              <li key={`${u.source}-${u.id}-${i}`} className="px-5 py-3 flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground tabular-nums w-12 shrink-0">
                  {new Date(u.date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </span>
                <span className="text-sm flex-1 truncate">{u.name}</span>
                {u.source === "recurrence" && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">rec</span>}
                <span className="text-sm tabular-nums font-medium">{fmtCur(u.amount, u.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

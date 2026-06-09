import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ListChecks, Repeat, Package, AlertCircle, CheckCircle2, Circle, Clock, Calendar as CalIcon, Wallet, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { listShopTasks, updateShopTask } from "@/lib/shop-tasks.functions";
import { listShopRoutines, completeShopRoutine } from "@/lib/shop-routines.functions";
import { listShopProducts } from "@/lib/shop-products.functions";
import { listShopCash } from "@/lib/shop-cash.functions";

export function ShopOverview({ shopId, onGoTab }: { shopId: string; onGoTab: (t: any) => void }) {
  const qc = useQueryClient();
  const tasksFn = useServerFn(listShopTasks);
  const routinesFn = useServerFn(listShopRoutines);
  const productsFn = useServerFn(listShopProducts);
  const cashFn = useServerFn(listShopCash);
  const updateTaskFn = useServerFn(updateShopTask);
  const completeRoutineFn = useServerFn(completeShopRoutine);

  const tasks = useQuery({ queryKey: ["shop-tasks", shopId], queryFn: () => tasksFn({ data: { shop_id: shopId } }) });
  const routines = useQuery({ queryKey: ["shop-routines", shopId], queryFn: () => routinesFn({ data: { shop_id: shopId } }) });
  const products = useQuery({ queryKey: ["shop-products", shopId], queryFn: () => productsFn({ data: { shop_id: shopId } }) });
  const cash = useQuery({ queryKey: ["shop-cash", shopId], queryFn: () => cashFn({ data: { shop_id: shopId } }) });

  const allTasks = (tasks.data?.tasks ?? []) as any[];
  const allRoutines = (routines.data?.routines ?? []) as any[];
  const allProducts = (products.data?.products ?? []) as any[];

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);

  const overdue = allTasks.filter((t) => t.overdue);
  const dueToday = allTasks.filter((t) => t.status !== "done" && t.due_at && new Date(t.due_at) >= today && new Date(t.due_at) <= endToday);
  const upcoming = allTasks.filter((t) => t.status !== "done" && t.due_at && new Date(t.due_at) > endToday && new Date(t.due_at) <= in7);
  const pending = allTasks.filter((t) => t.status !== "done");
  const routinesToday = allRoutines.filter((r) => !r.due_at || new Date(r.due_at) <= endToday);
  const routinesDoneToday = routinesToday.filter((r) => r.done_today).length;

  const productsByStage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of allProducts) m[p.status] = (m[p.status] ?? 0) + 1;
    return m;
  }, [allProducts]);

  const cashStats = useMemo(() => {
    const entries = (cash.data?.entries ?? []) as any[];
    const opening = Number(cash.data?.opening_balance ?? 0);
    const weekendShift = Boolean(cash.data?.weekend_payouts_to_monday);
    const todayStr = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    // Effective date: shift income on Fri/Sat/Sun to Monday when rule is on
    const eff = (e: any): string => {
      if (!weekendShift || e.kind !== "income" || e.skip_weekend_rule) return e.date;
      const d = new Date(e.date + "T12:00:00Z");
      const wd = d.getUTCDay();
      if (wd === 5) d.setUTCDate(d.getUTCDate() + 3);
      else if (wd === 6) d.setUTCDate(d.getUTCDate() + 2);
      else if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
      else return e.date;
      return d.toISOString().slice(0, 10);
    };
    let balance = opening, todayIn = 0, todayOut = 0, tomorrowIn = 0, tomorrowOut = 0, weekIn = 0, weekOut = 0;
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);
    for (const e of entries) {
      const d = eff(e);
      const amt = Number(e.amount ?? 0);
      if (d <= todayStr) balance += e.kind === "income" ? amt : -amt;
      if (d === todayStr) { if (e.kind === "income") todayIn += amt; else todayOut += amt; }
      if (d === tomorrowStr) { if (e.kind === "income") tomorrowIn += amt; else tomorrowOut += amt; }
      if (d >= weekAgoStr && d <= todayStr) { if (e.kind === "income") weekIn += amt; else weekOut += amt; }
    }
    return { balance, todayIn, todayOut, tomorrowBalance: balance + tomorrowIn - tomorrowOut, weekIn, weekOut };
  }, [cash.data]);

  const fmt = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const refreshTasks = () => qc.invalidateQueries({ queryKey: ["shop-tasks", shopId] });
  const refreshRoutines = () => qc.invalidateQueries({ queryKey: ["shop-routines", shopId] });

  const toggleTask = useMutation({
    mutationFn: (t: any) => updateTaskFn({ data: { id: t.id, patch: { status: t.status === "done" ? "todo" : "done" } } }),
    onSuccess: refreshTasks,
  });
  const completeRoutine = useMutation({
    mutationFn: (id: string) => completeRoutineFn({ data: { id } }),
    onSuccess: refreshRoutines,
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard icon={ListChecks} label="Tarefas pendentes" value={pending.length} accent="oklch(0.55 0.2 250)" onClick={() => onGoTab("tasks")} />
        <SummaryCard icon={AlertCircle} label="Vencidas" value={overdue.length} accent="oklch(0.6 0.18 25)" onClick={() => onGoTab("tasks")} danger={overdue.length > 0} />
        <SummaryCard icon={Repeat} label="Rotinas hoje" value={`${routinesDoneToday}/${routinesToday.length}`} accent="oklch(0.55 0.16 285)" onClick={() => onGoTab("routines")} />
        <SummaryCard icon={Package} label="Produtos" value={allProducts.length} accent="oklch(0.55 0.13 155)" onClick={() => onGoTab("products")} />
      </div>

      <button
        onClick={() => onGoTab("cash")}
        className="w-full text-left rounded-2xl border border-border bg-surface p-5 hover:border-primary/40 transition-colors"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="inline-flex items-center gap-2 text-sm font-semibold">
            <Wallet className="size-4 text-primary" /> Caixa
          </div>
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            Ver detalhes <ArrowRight className="size-3" />
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CashStat label="Saldo atual" value={fmt(cashStats.balance)} highlight />
          <CashStat label="Saldo amanhã" value={fmt(cashStats.tomorrowBalance)} />
          <CashStat
            label="Hoje"
            value={
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5"><TrendingUp className="size-3" />{fmt(cashStats.todayIn)}</span>
                <span className="text-destructive inline-flex items-center gap-0.5"><TrendingDown className="size-3" />{fmt(cashStats.todayOut)}</span>
              </span>
            }
          />
          <CashStat
            label="Últimos 7 dias"
            value={
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5"><TrendingUp className="size-3" />{fmt(cashStats.weekIn)}</span>
                <span className="text-destructive inline-flex items-center gap-0.5"><TrendingDown className="size-3" />{fmt(cashStats.weekOut)}</span>
              </span>
            }
          />
        </div>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Hoje</div>
            <span className="text-xs text-muted-foreground tabular-nums">{dueToday.length + routinesToday.length}</span>
          </div>
          <div className="space-y-1.5">
            {routinesToday.map((r) => (
              <RoutineRow key={r.id} r={r} onComplete={() => completeRoutine.mutate(r.id)} />
            ))}
            {dueToday.map((t) => (
              <TaskRow key={t.id} t={t} onToggle={() => toggleTask.mutate(t)} />
            ))}
            {dueToday.length === 0 && routinesToday.length === 0 && (
              <div className="text-xs text-muted-foreground py-6 text-center">Nada agendado para hoje 🎉</div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {overdue.length > 0 && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="text-sm font-semibold text-destructive mb-2 inline-flex items-center gap-1.5">
                <AlertCircle className="size-4" /> Tarefas vencidas
              </div>
              <div className="space-y-1.5">
                {overdue.slice(0, 5).map((t) => <TaskRow key={t.id} t={t} onToggle={() => toggleTask.mutate(t)} />)}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="text-sm font-semibold mb-3">Próximas (7 dias)</div>
            <div className="space-y-1.5">
              {upcoming.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">Sem tarefas nos próximos dias.</div>
              ) : upcoming.slice(0, 6).map((t) => <TaskRow key={t.id} t={t} onToggle={() => toggleTask.mutate(t)} />)}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="text-sm font-semibold mb-3">Esteira de produtos</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(productsByStage).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-background border border-border px-3 py-2 flex items-center justify-between">
                  <span className="text-xs capitalize text-muted-foreground">{k}</span>
                  <span className="text-sm font-semibold tabular-nums">{v}</span>
                </div>
              ))}
              {Object.keys(productsByStage).length === 0 && (
                <div className="col-span-2 text-xs text-muted-foreground py-2 text-center">Sem produtos ainda.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, accent, danger, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-2xl border p-4 transition-colors hover:border-primary/40 ${danger ? "border-destructive/40 bg-destructive/5" : "border-border bg-surface"}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
        <Icon className="size-3.5" style={{ color: accent }} />
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </button>
  );
}

function TaskRow({ t, onToggle }: { t: any; onToggle: () => void }) {
  const time = t.due_at ? new Date(t.due_at).toTimeString().slice(0, 5) : null;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <button onClick={onToggle} className="text-muted-foreground hover:text-primary shrink-0">
        {t.status === "done" ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4" />}
      </button>
      <div className={`text-sm flex-1 truncate ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
      {time && time !== "23:59" && time !== "00:00" && (
        <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 tabular-nums">
          <Clock className="size-3" /> {time}
        </span>
      )}
      {t.overdue && <span className="text-[10px] px-1.5 rounded bg-destructive/15 text-destructive font-medium">atrasada</span>}
    </div>
  );
}

function RoutineRow({ r, onComplete }: { r: any; onComplete: () => void }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <button onClick={onComplete} className="text-muted-foreground hover:text-primary shrink-0">
        {r.done_today ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4" />}
      </button>
      <Repeat className="size-3 text-muted-foreground shrink-0" />
      <div className={`text-sm flex-1 truncate ${r.done_today ? "line-through text-muted-foreground" : ""}`}>{r.title}</div>
      {r.time && (
        <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 tabular-nums">
          <Clock className="size-3" /> {r.time}
        </span>
      )}
      {r.streak > 0 && <span className="text-[10px] px-1.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-medium">🔥 {r.streak}</span>}
    </div>
  );
}

function CashStat({ label, value, highlight }: { label: string; value: import("react").ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-background"}`}>
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

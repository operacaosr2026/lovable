import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/PageHeader";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles, Plus, Check, Flame,
  Calendar as CalIcon, ListChecks, Repeat, ChevronRight,
  CheckCircle2, Circle, Clock, Store,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import {
  getDashboard, createTask, toggleTask,
  toggleHabitToday,
} from "@/lib/dashboard.functions";
import { saveGratitudeEntry } from "@/lib/gratitude.functions";
import { listTasks, updateTask, getRoutineLogs } from "@/lib/tasks.functions";
import { updateShopTask } from "@/lib/shop-tasks.functions";
import { listShops } from "@/lib/shops.functions";
import { getShopifyChargebackRate } from "@/lib/shop-orders.functions";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login" });
    }
  },
  head: () => ({
    meta: [
      { title: "Dashboard — SRX Growth" },
      { name: "description", content: "Visão rápida do seu dia." },
    ],
  }),
  component: Dashboard,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-muted-foreground">
      Erro ao carregar: {error?.message ?? "tente recarregar"}
    </div>
  ),
});

function SectionHead({ icon: Icon, title, count, tint, iconColor }: any) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 rounded-t-[1.25rem] border-b border-border" style={{ background: `var(${tint})` }}>
      <div className="size-8 rounded-lg grid place-items-center bg-surface border border-border" style={{ color: iconColor }}>
        <Icon className="size-4" />
      </div>
      <div className="text-[15px] font-semibold tracking-tight flex-1">{title}</div>
      {count !== undefined && count !== null && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
    </div>
  );
}

function ShopRow({ s }: { s: any }) {
  const chargebackFn = useServerFn(getShopifyChargebackRate);
  const { data: chargeback } = useQuery({
    queryKey: ["shop-chargeback-rate", s.id],
    queryFn: () => chargebackFn({ data: { shop_id: s.id } }),
    staleTime: 5 * 60_000,
  });

  return (
    <Link
      to="/shops/$shopId"
      params={{ shopId: s.id }}
      className="flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 hover:bg-surface-hover transition-colors"
    >
      <div className="flex items-center gap-2.5 flex-1 min-w-0 basis-full sm:basis-auto">
        <div className="size-8 rounded-lg grid place-items-center bg-primary/10 text-primary shrink-0 text-xs font-semibold">
          {s.name?.[0]?.toUpperCase() ?? <Store className="size-3.5" />}
        </div>
        <span className="text-sm font-medium truncate">{s.name}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 w-full sm:flex sm:w-auto sm:gap-4 shrink-0">
        <div className="text-right sm:w-28 sm:shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo atual</div>
          <div className={`text-sm font-semibold tabular-nums ${Number(s.balance) < 0 ? "text-rose-500" : "text-foreground"}`}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(s.balance ?? 0))}
          </div>
        </div>
        <div className="text-right sm:w-28 sm:shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lucro do mês</div>
          <div className={`text-sm font-semibold tabular-nums ${Number(s.monthProfit) < 0 ? "text-rose-500" : "text-emerald-500"}`}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(s.monthProfit ?? 0))}
          </div>
        </div>
        <div className="text-right sm:w-24 sm:shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Estorno</div>
          <div className={`text-sm font-semibold tabular-nums ${(chargeback?.rate ?? 0) > 0.5 ? "text-rose-500" : "text-foreground"}`}>
            {chargeback?.connected && chargeback.rate != null ? `${chargeback.rate.toFixed(2)}%` : "—"}
          </div>
        </div>
      </div>
    </Link>
  );
}

function Dashboard() {
  const { session } = useAuth();
  const qc = useQueryClient();

  const getDashboardFn = useServerFn(getDashboard);
  const createTaskFn = useServerFn(createTask);
  const toggleTaskFn = useServerFn(toggleTask);
  const updateShopTaskFn = useServerFn(updateShopTask);
  const saveGratitudeFn = useServerFn(saveGratitudeEntry);
  const toggleHabitFn = useServerFn(toggleHabitToday);
  const listTasksFn = useServerFn(listTasks);
  const updateTaskFn = useServerFn(updateTask);
  const getLogsFn = useServerFn(getRoutineLogs);
  const listShopsFn = useServerFn(listShops);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    enabled: !!session,
  });
  const { data: tasksData } = useQuery({
    queryKey: ["tasks"], queryFn: () => listTasksFn(), enabled: !!session,
  });
  const { data: routineLogsData } = useQuery({
    queryKey: ["routine-logs"], queryFn: () => getLogsFn(), enabled: !!session,
  });
  const { data: shopsData } = useQuery({
    queryKey: ["shops"], queryFn: () => listShopsFn(), enabled: !!session,
  });
  const shops = ((shopsData as any)?.shops ?? []).filter((s: any) => s.status === "ativa");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dashboard"] });
  const invalidateRoutines = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["routine-logs"] });
  };

  const mCreateTask = useMutation({ mutationFn: (d: any) => createTaskFn({ data: d }), onSuccess: invalidate });
  const mToggleTask = useMutation({ mutationFn: (d: any) => toggleTaskFn({ data: d }), onSuccess: invalidate });
  const mToggleShopTask = useMutation({
    mutationFn: (d: { id: string; done: boolean }) => updateShopTaskFn({ data: { id: d.id, patch: { status: d.done ? "done" : "todo" } } }),
    onSuccess: invalidate,
  });
  const mGratitude = useMutation({
    mutationFn: (d: { content: string }) => {
      const todayStr = new Date().toISOString().slice(0, 10);
      return saveGratitudeFn({ data: { date: todayStr, content: d.content } });
    },
    onSuccess: () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["gratitude-entry", todayStr] });
      qc.invalidateQueries({ queryKey: ["gratitude-history"] });
    },
  });
  const mToggleHabit = useMutation({ mutationFn: (d: any) => toggleHabitFn({ data: d }), onSuccess: invalidate });
  const mToggleRoutine = useMutation({
    mutationFn: (d: any) => updateTaskFn({ data: d }), onSuccess: invalidateRoutines,
  });

  const [gratitude, setGratitude] = useState("");
  const [newTask, setNewTask] = useState("");
  const [openTask, setOpenTask] = useState<{ id: string; source: "task" | "shop_task" } | null>(null);

  // Sync gratitude
  const todayGratitude = data?.gratitude?.content ?? "";
  if (gratitude === "" && todayGratitude && !mGratitude.isPending) {
    // initial hydration only
    setTimeout(() => setGratitude(todayGratitude), 0);
  }

  const today = new Date();
  const dateLabel = today.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const greeting = (() => {
    const h = today.getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  })();
  const firstName = (data?.profile?.full_name ?? session?.user?.user_metadata?.full_name ?? session?.user?.email?.split("@")[0] ?? "")
    .toString().split(" ")[0];



  // Habits progress (week)
  const habitProgress = (data?.habits ?? []).map((h: any) => {
    const count = (data?.habitLogs ?? []).filter((l: any) => l.habit_id === h.id).length;
    const goal = h.weekly_goal || 7;
    const pct = Math.min(100, Math.round((count / goal) * 100));
    const todayDone = (data?.habitLogs ?? []).some((l: any) => l.habit_id === h.id && l.date === data?.todayStr);
    return { ...h, count, pct, todayDone };
  });

  // Routines expected today
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();
  const allTasksList: any[] = (tasksData as any)?.tasks ?? [];
  const routineLogs: any[] = (routineLogsData as any)?.logs ?? [];
  const logsByTask: Record<string, Set<string>> = {};
  for (const l of routineLogs) {
    (logsByTask[l.task_id] ||= new Set()).add(l.completed_on);
  }
  const dow = new Date().getDay();
  const todayRoutines = allTasksList.filter((t) => {
    if (!t.recurrence_frequency) return false;
    if (t.recurrence_frequency === "daily") return true;
    if (t.recurrence_frequency === "custom") return (t.recurrence_weekdays ?? []).includes(dow);
    if (t.recurrence_frequency === "weekly") {
      if (!t.due_at) return false;
      return new Date(t.due_at).getDay() === dow;
    }
    if (t.recurrence_frequency === "monthly") {
      if (!t.due_at) return false;
      return new Date(t.due_at).getDate() === new Date().getDate();
    }
    return false;
  }).sort((a, b) => (a.recurrence_time ?? "99").localeCompare(b.recurrence_time ?? "99"));
  const routinesDone = todayRoutines.filter((t) => logsByTask[t.id]?.has(todayKey)).length;

  if (isLoading || !data) {
    return (
      <PageShell>
        <div className="grid place-items-center h-64">
          <div className="size-6 rounded-full border-2 border-border border-t-primary animate-spin" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 capitalize">{dateLabel}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lojas */}
        {shops.length > 0 && (
          <section className="h-[280px] rounded-[1.5rem] bg-surface border border-border overflow-hidden soft-shadow flex flex-col">
            <SectionHead icon={Store} title="Lojas" count={`${shops.length} ${shops.length === 1 ? "loja" : "lojas"}`} tint="--tint-indigo" iconColor="oklch(0.55 0.22 285)" />
            <div className="divide-y divide-border flex-1 overflow-y-auto">
              {shops.map((s: any) => (
                <ShopRow key={s.id} s={s} />
              ))}
            </div>
          </section>
        )}

        {/* Tarefas de hoje */}
        <section className="h-[280px] rounded-[1.5rem] bg-surface border border-border overflow-hidden soft-shadow flex flex-col">
          <SectionHead icon={ListChecks} title="Tarefas de hoje"
            count={`${data.tasks.filter((t: any) => !t.done).length + (data.shopTasksToday?.length ?? 0)} pendentes`}
            tint="--tint-blue" iconColor="oklch(0.55 0.2 250)" />
          <div className="p-3 flex-1 flex flex-col overflow-y-auto">
            <ul className="flex-1">
              {data.tasks.filter((t: any) => !t.done).map((t: any) => (
                <li key={t.id} className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-surface-hover transition-colors group">
                  <button
                    onClick={() => mToggleTask.mutate({ id: t.id, done: !t.done })}
                    className={`size-5 rounded-full border-2 grid place-items-center transition-colors ${t.done ? "bg-success border-success" : "border-border group-hover:border-primary"}`}>
                    {t.done && <Check className="size-3 text-background" strokeWidth={3} />}
                  </button>
                  <button
                    onClick={() => setOpenTask({ id: t.id, source: "task" })}
                    className={`text-[15px] flex-1 text-left hover:underline underline-offset-2 ${t.done ? "line-through text-muted-foreground" : ""}`}
                  >{t.title}</button>
                  {t.scheduled_time && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1 tabular-nums">
                      <CalIcon className="size-3" /> {t.scheduled_time}
                    </span>
                  )}
                </li>
              ))}
              {(data.shopTasksToday ?? []).map((t: any) => (
                <li key={t.id} className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-surface-hover transition-colors group">
                  <button
                    onClick={() => mToggleShopTask.mutate({ id: t.id, done: true })}
                    className="size-5 rounded-full border-2 grid place-items-center transition-colors border-border group-hover:border-primary">
                  </button>
                  <button
                    onClick={() => setOpenTask({ id: t.id, source: "shop_task" })}
                    className="text-[15px] flex-1 text-left hover:underline underline-offset-2"
                  >{t.title}</button>
                  {t.shop_name && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Store className="size-3" /> {t.shop_name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTask.trim()) return;
                mCreateTask.mutate({ title: newTask.trim() });
                setNewTask("");
              }}
              className="flex items-center gap-2 px-3 py-2 mt-1"
            >
              <Plus className="size-4 text-muted-foreground" />
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder="Adicionar tarefa..."
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/70"
              />
            </form>

            {todayRoutines.length > 0 && (
              <div className="mt-2 pt-3 border-t border-border">
                <div className="flex items-center gap-2 px-3 mb-1.5">
                  <Repeat className="size-3.5 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">Rotinas de hoje</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{routinesDone}/{todayRoutines.length}</span>
                </div>
                <ul className="space-y-0.5">
                  {todayRoutines.map((t: any) => {
                    const done = logsByTask[t.id]?.has(todayKey) ?? false;
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-surface-hover group">
                        <button
                          disabled={done || mToggleRoutine.isPending}
                          onClick={() => mToggleRoutine.mutate({ id: t.id, patch: { status: "done" } })}
                          className={`shrink-0 transition-transform active:scale-90 ${done ? "text-success" : "text-muted-foreground hover:text-primary"}`}
                          aria-label="Concluir rotina"
                        >
                          {done ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
                        </button>
                        <span className={`text-[14px] flex-1 truncate ${done ? "line-through text-muted-foreground" : ""}`}>{t.title}</span>
                        {t.recurrence_time && (
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1 tabular-nums">
                            <Clock className="size-3" /> {t.recurrence_time}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* Gratidão */}
        <section className="h-[280px] rounded-[1.5rem] bg-surface border border-border overflow-hidden soft-shadow flex flex-col">
          <SectionHead icon={Sparkles} title="Gratidão" tint="--tint-amber" iconColor="oklch(0.55 0.16 65)" />
          <div className="p-6 flex flex-col flex-1 overflow-y-auto">
            <textarea
              value={gratitude}
              onChange={(e) => setGratitude(e.target.value)}
              placeholder="Pelo que você é grato hoje?"
              className="flex-1 resize-none bg-transparent outline-none text-[15px] leading-relaxed placeholder:text-muted-foreground/70"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
              <Link to="/gratitude" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <span>Ver histórico</span>
                <ChevronRight className="size-3" />
              </Link>
              <button
                disabled={!gratitude.trim() || mGratitude.isPending}
                onClick={() => mGratitude.mutate({ content: gratitude.trim() })}
                className="text-primary font-semibold hover:underline disabled:opacity-50"
              >
                {mGratitude.isPending ? "Salvando..." : data.gratitude ? "Atualizar" : "Salvar"}
              </button>
            </div>
          </div>
        </section>

        {/* Hábitos */}
        <section className="h-[280px] rounded-[1.5rem] bg-surface border border-border overflow-hidden soft-shadow flex flex-col">
          <SectionHead icon={Repeat} title="Hábitos" count={<span className="flex items-center gap-1 text-warning"><Flame className="size-3" /> semana</span> as any}
            tint="--tint-green" iconColor="oklch(0.5 0.13 155)" />
          <div className="p-6 space-y-5 flex-1 overflow-y-auto">
            {habitProgress.length === 0 && (
              <div className="text-sm text-muted-foreground">Nenhum hábito ainda. Adicione em /habits.</div>
            )}
            {habitProgress.map((h: any) => (
              <div key={h.id}>
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => mToggleHabit.mutate({ habit_id: h.id })}
                    className={`text-[15px] flex items-center gap-2 ${h.todayDone ? "text-foreground" : "text-foreground hover:text-primary"}`}
                  >
                    <span className={`size-4 rounded-full border-2 grid place-items-center ${h.todayDone ? "bg-success border-success" : "border-border"}`}>
                      {h.todayDone && <Check className="size-2.5 text-background" strokeWidth={3} />}
                    </span>
                    {h.name}
                  </button>
                  <span className="text-xs text-muted-foreground tabular-nums">{h.count}/{h.weekly_goal} · {h.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all gradient-primary" style={{ width: `${h.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <TaskDetailDialog
        open={!!openTask}
        onOpenChange={(o) => { if (!o) setOpenTask(null); }}
        source={openTask?.source ?? "task"}
        id={openTask?.id ?? null}
        invalidateKeys={[["dashboard"], ["tasks"], ["shop-tasks"]]}
      />
    </PageShell>
  );
}

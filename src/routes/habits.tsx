import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/PageHeader";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Pencil, Check, X, Flame } from "lucide-react";
import { listHabitsWithLogs, updateHabit, deleteHabit, toggleHabitOnDate } from "@/lib/habits.functions";
import { createHabit } from "@/lib/dashboard.functions";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/habits")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Hábitos — SRX Growth" }] }),
  component: HabitsPage,
});

function dateOffset(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const DAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function ProgressBar({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const color = pct >= 1 ? "bg-success" : pct >= 0.6 ? "bg-primary" : pct >= 0.3 ? "bg-primary/70" : "bg-primary/40";
  return (
    <div className={`h-1.5 rounded-full bg-muted overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

function HabitsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listHabitsWithLogs);
  const create = useServerFn(createHabit);
  const update = useServerFn(updateHabit);
  const del = useServerFn(deleteHabit);
  const toggle = useServerFn(toggleHabitOnDate);

  const { data, isLoading } = useQuery({ queryKey: ["habits-full"], queryFn: () => list() });
  const inv = () => qc.invalidateQueries({ queryKey: ["habits-full"] });
  const mCreate = useMutation({ mutationFn: (d: any) => create({ data: d }), onSuccess: inv });
  const mUpdate = useMutation({ mutationFn: (d: any) => update({ data: d }), onSuccess: inv });
  const mDel = useMutation({ mutationFn: (d: any) => del({ data: d }), onSuccess: inv });
  const mToggle = useMutation({ mutationFn: (d: any) => toggle({ data: d }), onSuccess: inv });

  const today = dateOffset(0);
  const [tab, setTab] = useState<"hoje" | "historico">("hoje");
  const [selectedDate, setSelectedDate] = useState(today);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(7);
  const [annualGoalInput, setAnnualGoalInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editGoal, setEditGoal] = useState(7);
  const [editAnnualGoal, setEditAnnualGoal] = useState("");

  if (isLoading || !data) return (
    <PageShell>
      <div className="grid place-items-center h-64">
        <div className="size-6 rounded-full border-2 border-border border-t-primary animate-spin" />
      </div>
    </PageShell>
  );

  const dateStrip = Array.from({ length: 8 }, (_, i) => dateOffset(i - 7));
  const thisWeekDays = Array.from({ length: 7 }, (_, i) => dateOffset(i - 6));

  const now = new Date();
  const yearPrefix = `${now.getFullYear()}-`;
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);

  const computeStreak = (habitId: string) => {
    let s = 0;
    const set = new Set(data.logs.filter((l: any) => l.habit_id === habitId).map((l: any) => l.date));
    let cursor = today;
    while (set.has(cursor)) { s++; cursor = dateOffset(-s); }
    return s;
  };

  const selectedDateObj = new Date(selectedDate + "T00:00:00");
  const isSelectedToday = selectedDate === today;

  const doneTodayCount = data.habits.filter((h: any) =>
    data.logs.some((l: any) => l.habit_id === h.id && l.date === selectedDate)
  ).length;

  const avgMonthPct = data.habits.length === 0 ? 0 : Math.round(
    data.habits.reduce((sum: number, h: any) => {
      const done = data.logs.filter((l: any) => l.habit_id === h.id && l.date.startsWith(monthPrefix)).length;
      const monthGoal = Math.round(h.weekly_goal * (daysInMonth / 7));
      return sum + (monthGoal > 0 ? Math.min(done / monthGoal, 1) : 0);
    }, 0) / data.habits.length * 100
  );

  const EditRow = ({ h }: { h: any }) => (
    <div className="py-3 border-b border-border space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input value={editName} onChange={(e) => setEditName(e.target.value)}
          className="h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary flex-1 min-w-[140px]" autoFocus />
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button key={n} onClick={() => setEditGoal(n)}
              className={`size-8 rounded-lg text-xs font-medium transition-colors ${editGoal === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <input value={editAnnualGoal} onChange={(e) => setEditAnnualGoal(e.target.value)} placeholder="Meta anual (ex: 200)"
          className="h-9 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary w-48" type="number" min={1} />
        <button onClick={() => {
          mUpdate.mutate({ id: h.id, patch: { name: editName.trim(), weekly_goal: editGoal, annual_goal: editAnnualGoal ? parseInt(editAnnualGoal) : null } });
          setEditingId(null);
        }} className="size-9 rounded-xl bg-success/15 text-success grid place-items-center"><Check className="size-4" /></button>
        <button onClick={() => setEditingId(null)} className="size-9 rounded-xl bg-muted text-muted-foreground grid place-items-center"><X className="size-4" /></button>
      </div>
    </div>
  );

  return (
    <PageShell>
      {/* Header */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold leading-tight">
            Hábitos{tab === "hoje" && isSelectedToday && <span className="text-primary"> · Hoje</span>}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tab === "hoje"
              ? `${doneTodayCount}/${data.habits.length} concluído${doneTodayCount !== 1 ? "s" : ""}${!isSelectedToday ? ` · ${DAYS_PT[selectedDateObj.getDay()]}, ${selectedDateObj.getDate()} ${MONTHS_PT[selectedDateObj.getMonth()]}` : ""}`
              : `Progresso médio este mês: ${avgMonthPct}%`}
          </p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="size-10 rounded-full bg-primary text-primary-foreground grid place-items-center hover:bg-primary/90 transition-colors shadow-md">
          <Plus className="size-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted mb-5 w-fit">
        {(["hoje", "historico"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 h-8 rounded-lg text-sm font-medium transition-all ${tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "hoje" ? "Hoje" : "Histórico"}
          </button>
        ))}
      </div>

      {/* ── HOJE ── */}
      {tab === "hoje" && (
        <>
          <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
            {dateStrip.map((d) => {
              const dt = new Date(d + "T00:00:00");
              const isToday = d === today;
              const isSelected = d === selectedDate;
              const hasActivity = data.habits.some((h: any) => data.logs.some((l: any) => l.habit_id === h.id && l.date === d));
              return (
                <button key={d} onClick={() => setSelectedDate(d)}
                  className={`flex-1 min-w-[44px] flex flex-col items-center pt-2 pb-2.5 rounded-2xl transition-all ${
                    isSelected ? "bg-primary text-primary-foreground" : isToday ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                  }`}>
                  <span className="text-[10px] font-semibold uppercase tracking-wide">{DAYS_PT[dt.getDay()]}</span>
                  <span className="text-lg font-bold leading-tight">{dt.getDate()}</span>
                  <span className={`mt-1 size-1.5 rounded-full ${hasActivity ? isSelected ? "bg-primary-foreground/60" : "bg-primary" : "bg-transparent"}`} />
                </button>
              );
            })}
          </div>

          <div>
            {data.habits.length === 0 && (
              <div className="py-16 text-center">
                <div className="text-4xl mb-3">🔥</div>
                <div className="text-sm font-semibold mb-1">Nenhum hábito ainda</div>
                <div className="text-xs text-muted-foreground">Toque no + para criar o primeiro.</div>
              </div>
            )}
            {data.habits.map((h: any, idx: number) => {
              const logged = new Set(data.logs.filter((l: any) => l.habit_id === h.id).map((l: any) => l.date));
              const streak = computeStreak(h.id);
              const doneThisWeek = thisWeekDays.filter((d) => logged.has(d)).length;
              const doneSel = logged.has(selectedDate);
              const isLast = idx === data.habits.length - 1;
              if (editingId === h.id) return <EditRow key={h.id} h={h} />;
              return (
                <div key={h.id} className={`flex items-center gap-4 py-4 group ${!isLast ? "border-b border-border" : ""}`}>
                  <button onClick={() => mToggle.mutate({ habit_id: h.id, date: selectedDate })}
                    className={`size-7 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${doneSel ? "bg-primary border-primary" : "border-border hover:border-primary"}`}>
                    {doneSel && <Check className="size-3.5 text-primary-foreground" strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${doneSel ? "text-primary" : ""}`}>{h.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {streak > 0 ? `${streak} dia${streak !== 1 ? "s" : ""} seguidos` : "Sem sequência"}
                    </div>
                    <ProgressBar value={doneThisWeek} max={h.weekly_goal} className="mt-2" />
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold ${doneSel ? "text-primary" : ""}`}>
                      {doneThisWeek}<span className="text-muted-foreground font-normal">/{h.weekly_goal}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">esta semana</div>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditingId(h.id); setEditName(h.name); setEditGoal(h.weekly_goal); setEditAnnualGoal(h.annual_goal ? String(h.annual_goal) : ""); }}
                      className="size-8 rounded-lg text-muted-foreground hover:bg-muted grid place-items-center"><Pencil className="size-3.5" /></button>
                    <button onClick={() => { if (confirm(`Excluir "${h.name}"?`)) mDel.mutate({ id: h.id }); }}
                      className="size-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid place-items-center"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── HISTÓRICO ── */}
      {tab === "historico" && (
        <div className="space-y-px">
          {data.habits.length === 0 && (
            <div className="py-16 text-center">
              <div className="text-4xl mb-3">🔥</div>
              <div className="text-sm font-semibold mb-1">Nenhum hábito ainda</div>
            </div>
          )}

          {data.habits.map((h: any, idx: number) => {
            const logsForHabit = data.logs.filter((l: any) => l.habit_id === h.id);
            const doneMonth = logsForHabit.filter((l: any) => l.date.startsWith(monthPrefix)).length;
            const doneYear = logsForHabit.filter((l: any) => l.date.startsWith(yearPrefix)).length;
            const streak = computeStreak(h.id);

            const monthGoal = Math.round(h.weekly_goal * (daysInMonth / 7));
            const yearGoal = h.annual_goal ?? h.weekly_goal * 52;

            const monthPct = monthGoal > 0 ? Math.round(Math.min(doneMonth / monthGoal, 1) * 100) : 0;
            const yearPct = yearGoal > 0 ? Math.round(Math.min(doneYear / yearGoal, 1) * 100) : 0;

            // Projected by end of year
            const yearProjected = dayOfYear > 0 ? Math.round((doneYear / dayOfYear) * 365) : 0;

            const isLast = idx === data.habits.length - 1;
            if (editingId === h.id) return <EditRow key={h.id} h={h} />;

            return (
              <div key={h.id} className={`py-4 group ${!isLast ? "border-b border-border" : ""}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-semibold">{h.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {streak > 0 && (
                        <span className="flex items-center gap-1 text-xs text-orange-500 font-medium">
                          <Flame className="size-3" />{streak} dias
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">Meta: {h.weekly_goal}x/sem</span>
                    </div>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditingId(h.id); setEditName(h.name); setEditGoal(h.weekly_goal); setEditAnnualGoal(h.annual_goal ? String(h.annual_goal) : ""); }}
                      className="size-8 rounded-lg text-muted-foreground hover:bg-muted grid place-items-center"><Pencil className="size-3.5" /></button>
                    <button onClick={() => { if (confirm(`Excluir "${h.name}"?`)) mDel.mutate({ id: h.id }); }}
                      className="size-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid place-items-center"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>

                {/* Este mês */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Este mês</span>
                    <span className="text-xs font-semibold">
                      {doneMonth}<span className="text-muted-foreground font-normal">/{monthGoal}</span>
                      <span className={`ml-1.5 ${monthPct >= 100 ? "text-success" : "text-primary"}`}>{monthPct}%</span>
                    </span>
                  </div>
                  <ProgressBar value={doneMonth} max={monthGoal} />
                </div>

                {/* Este ano */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Este ano</span>
                    <span className="text-xs font-semibold">
                      {doneYear}<span className="text-muted-foreground font-normal">/{yearGoal}</span>
                      <span className={`ml-1.5 ${yearPct >= 100 ? "text-success" : "text-primary"}`}>{yearPct}%</span>
                    </span>
                  </div>
                  <ProgressBar value={doneYear} max={yearGoal} />
                  {yearProjected > 0 && yearPct < 100 && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      No ritmo atual: {yearProjected}/{yearGoal} ao fim do ano
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New habit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md bg-background rounded-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Novo hábito</h2>
              <button onClick={() => setShowForm(false)} className="size-7 rounded-full bg-muted grid place-items-center text-muted-foreground"><X className="size-4" /></button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                mCreate.mutate({ name: name.trim(), weekly_goal: goal, annual_goal: annualGoalInput ? parseInt(annualGoalInput) : undefined });
                setName(""); setGoal(7); setAnnualGoalInput(""); setShowForm(false);
              }}
              className="space-y-4"
            >
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do hábito"
                className="w-full h-11 px-4 rounded-xl bg-muted border border-border text-sm outline-none focus:border-primary" autoFocus />

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Quantas vezes por semana?</label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <button key={n} type="button" onClick={() => setGoal(n)}
                      className={`flex-1 h-9 rounded-xl text-sm font-medium transition-colors ${goal === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">
                  Meta anual personalizada <span className="opacity-60">(opcional)</span>
                </label>
                <input
                  value={annualGoalInput}
                  onChange={(e) => setAnnualGoalInput(e.target.value)}
                  placeholder={`Padrão: ${goal * 52}x (${goal}x/sem × 52)`}
                  className="w-full h-11 px-4 rounded-xl bg-muted border border-border text-sm outline-none focus:border-primary"
                  type="number"
                  min={1}
                />
                {annualGoalInput && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Meta mensal proporcional: ~{Math.round(parseInt(annualGoalInput) / 12)}x/mês
                  </p>
                )}
              </div>

              <button type="submit" className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
                Criar hábito
              </button>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/PageHeader";
import { Calendar as CalIcon, AlertCircle, Clock, ChevronRight, ListChecks } from "lucide-react";
import { getTasksSummary, listTaskLists } from "@/lib/task-lists.functions";

export const Route = createFileRoute("/tasks/")({
  head: () => ({ meta: [{ title: "Tarefas — Resumo" }] }),
  component: TasksDashboard,
});

function StatCard({ label, count, icon: Icon, tint, accent, href }: any) {
  return (
    <Link
      to={href ?? "/tasks"}
      className="rounded-2xl border border-border bg-surface p-5 hover:border-primary/40 transition-colors block"
      style={{ background: `linear-gradient(180deg, var(${tint}) 0%, var(--surface) 100%)` }}
    >
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg grid place-items-center bg-surface border border-border" style={{ color: accent }}>
          <Icon className="size-4" />
        </div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold tabular-nums mt-0.5">{count}</div>
        </div>
      </div>
    </Link>
  );
}

function TasksDashboard() {
  const summaryFn = useServerFn(getTasksSummary);
  const listsFn = useServerFn(listTaskLists);
  const { data: summary } = useQuery({ queryKey: ["tasks-summary"], queryFn: () => summaryFn() });
  const { data: listsData } = useQuery({ queryKey: ["task-lists"], queryFn: () => listsFn() });

  const counts = (summary as any)?.counts ?? { today: 0, next7: 0, next30: 0, overdue: 0 };
  const today = (summary as any)?.today ?? [];
  const overdue = (summary as any)?.overdue ?? [];
  const lists = (listsData as any)?.lists ?? [];

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const t = d.toTimeString().slice(0, 5);
    const dateStr = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return t === "23:59" || t === "00:00" ? dateStr : `${dateStr} · ${t}`;
  };

  return (
    <PageShell>
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Tarefas</h1>
        <p className="text-sm text-muted-foreground mt-1.5">Visão geral do seu workspace</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Hoje" count={counts.today} icon={CalIcon} tint="--tint-blue" accent="oklch(0.55 0.2 250)" />
        <StatCard label="Próx. 7 dias" count={counts.next7} icon={Clock} tint="--tint-indigo" accent="oklch(0.55 0.22 285)" />
        <StatCard label="Próx. 30 dias" count={counts.next30} icon={Clock} tint="--tint-green" accent="oklch(0.5 0.13 155)" />
        <StatCard label="Atrasadas" count={counts.overdue} icon={AlertCircle} tint="--tint-amber" accent="oklch(0.6 0.22 25)" />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-12 lg:col-span-7 rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
            <CalIcon className="size-4 text-primary" />
            <div className="text-sm font-semibold flex-1">Hoje</div>
            <span className="text-xs text-muted-foreground tabular-nums">{today.length}</span>
          </div>
          <ul className="divide-y divide-border">
            {today.length === 0 && (
              <li className="px-5 py-8 text-sm text-muted-foreground text-center">Nada para hoje 🎉</li>
            )}
            {today.map((t: any) => (
              <li key={`${t.kind}-${t.id}`} className="px-5 py-3 flex items-center gap-3 hover:bg-surface-hover">
                <span className="size-2 rounded-full bg-primary shrink-0" />
                <span className="text-sm flex-1 truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{fmt(t.due_at)}</span>
              </li>
            ))}
          </ul>

          {overdue.length > 0 && (
            <>
              <div className="px-5 py-3.5 border-y border-border flex items-center gap-2 bg-destructive/5">
                <AlertCircle className="size-4 text-destructive" />
                <div className="text-sm font-semibold flex-1">Atrasadas</div>
                <span className="text-xs text-destructive tabular-nums">{overdue.length}</span>
              </div>
              <ul className="divide-y divide-border">
                {overdue.slice(0, 8).map((t: any) => (
                  <li key={`${t.kind}-${t.id}`} className="px-5 py-3 flex items-center gap-3 hover:bg-surface-hover">
                    <AlertCircle className="size-3.5 text-destructive shrink-0" />
                    <span className="text-sm flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-destructive tabular-nums">{fmt(t.due_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="col-span-12 lg:col-span-5 rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
            <ListChecks className="size-4 text-primary" />
            <div className="text-sm font-semibold flex-1">Listas</div>
            <span className="text-xs text-muted-foreground tabular-nums">{lists.length}</span>
          </div>
          <ul className="divide-y divide-border">
            {lists.map((l: any) => (
              <li key={l.id}>
                <Link
                  to="/tasks/$listId"
                  params={{ listId: l.id }}
                  className="px-5 py-3 flex items-center gap-3 hover:bg-surface-hover group"
                >
                  <span className="size-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                  <span className="text-sm flex-1 truncate">{l.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {l.open_count}/{l.total_count}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
}

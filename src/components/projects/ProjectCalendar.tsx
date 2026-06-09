import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listProjectTasks } from "@/lib/project-tasks.functions";

export function ProjectCalendar({ projectId }: { projectId: string }) {
  const list = useServerFn(listProjectTasks);
  const { data } = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const tasks = (data?.tasks ?? []).filter((t: any) => t.due_at);

  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });

  const cells = useMemo(() => {
    const first = new Date(cursor); first.setDate(1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const arr: { date: Date | null; tasks: any[] }[] = [];
    for (let i = 0; i < startWeekday; i++) arr.push({ date: null, tasks: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), d);
      const dayTasks = tasks.filter((t: any) => {
        const td = new Date(t.due_at);
        return td.getFullYear() === date.getFullYear() && td.getMonth() === date.getMonth() && td.getDate() === d;
      });
      arr.push({ date, tasks: dayTasks });
    }
    return arr;
  }, [cursor, tasks]);

  const today = new Date();
  const monthLabel = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="size-8 rounded-md grid place-items-center hover:bg-muted">
          <ChevronLeft className="size-4" />
        </button>
        <div className="text-sm font-semibold capitalize">{monthLabel}</div>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="size-8 rounded-md grid place-items-center hover:bg-muted">
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[11px] text-muted-foreground mb-1">
        {["D","S","T","Q","Q","S","S"].map((d, i) => <div key={i} className="text-center font-medium">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          const isToday = c.date && c.date.toDateString() === today.toDateString();
          return (
            <div key={i} className={`min-h-[80px] rounded-lg p-1.5 border ${c.date ? "border-border bg-background" : "border-transparent"} ${isToday ? "ring-2 ring-primary" : ""}`}>
              {c.date && (
                <>
                  <div className="text-[11px] font-medium tabular-nums mb-1">{c.date.getDate()}</div>
                  <div className="space-y-0.5">
                    {c.tasks.slice(0, 3).map((t: any) => (
                      <div key={t.id} className={`text-[10px] truncate px-1 py-0.5 rounded ${t.status === "done" ? "bg-muted text-muted-foreground line-through" : t.overdue ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"}`}>
                        {t.title}
                      </div>
                    ))}
                    {c.tasks.length > 3 && <div className="text-[10px] text-muted-foreground">+{c.tasks.length - 3}</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

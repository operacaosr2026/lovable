import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { PageShell } from "@/components/PageHeader";
import { Calendar as CalIcon, AlertCircle, Clock, Repeat, GripVertical, Trash2, Plus } from "lucide-react";
import { getTasksSummary, listTaskLists } from "@/lib/task-lists.functions";
import { listAllTasks, createListTask, updateListTask, deleteListTask } from "@/lib/workspace-tasks.functions";
import { useKanbanColumns, useColumnDnD, ColumnControls } from "@/components/kanban/useKanbanColumns";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/tasks/")({
  head: () => ({ meta: [{ title: "Tarefas — Resumo" }] }),
  component: TasksDashboard,
});

const DEFAULT_COLUMNS = [
  { id: "todo", label: "A fazer", tint: "oklch(0.97 0.012 250)", accent: "oklch(0.55 0.2 250)" },
  { id: "doing", label: "Fazendo", tint: "oklch(0.97 0.03 75)", accent: "oklch(0.6 0.16 65)" },
  { id: "done", label: "Concluído", tint: "oklch(0.97 0.025 155)", accent: "oklch(0.5 0.13 155)" },
];

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

function fmtDue(due: string | null) {
  if (!due) return null;
  const d = new Date(due);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  const time = d.toTimeString().slice(0, 5);
  const hasTime = time !== "23:59" && time !== "00:00";
  let label: string;
  if (diff === 0) label = "Hoje";
  else if (diff === 1) label = "Amanhã";
  else if (diff === -1) label = "Ontem";
  else label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return hasTime ? `${label} · ${time}` : label;
}

function TasksDashboard() {
  const qc = useQueryClient();
  const summaryFn = useServerFn(getTasksSummary);
  const listsFn = useServerFn(listTaskLists);
  const tasksFn = useServerFn(listAllTasks);
  const updateFn = useServerFn(updateListTask);
  const deleteFn = useServerFn(deleteListTask);

  const { data: summary } = useQuery({ queryKey: ["tasks-summary"], queryFn: () => summaryFn() });
  const { data: listsData } = useQuery({ queryKey: ["task-lists"], queryFn: () => listsFn() });
  const { data: tasksData } = useQuery({ queryKey: ["all-tasks"], queryFn: () => tasksFn() });

  const [openTask, setOpenTask] = useState<{ id: string | null; source: "task" | "shop_task"; createListId?: string } | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ id: string; source: "task" | "shop_task" } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const confirm = useConfirm();

  const counts = (summary as any)?.counts ?? { today: 0, next7: 0, next30: 0, overdue: 0 };
  const lists = (listsData as any)?.lists ?? [];
  const tasks = useMemo(() => (tasksData as any)?.tasks ?? [], [tasksData]);

  const listById = useMemo(() => {
    const m = new Map<string, any>();
    for (const l of lists) m.set(l.id, l);
    return m;
  }, [lists]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["all-tasks"] });
    qc.invalidateQueries({ queryKey: ["task-lists"] });
    qc.invalidateQueries({ queryKey: ["tasks-summary"] });
  };
  const mUpdate = useMutation({ mutationFn: (d: any) => updateFn({ data: d }), onSuccess: invalidate, onError: (e: any) => toast.error(e.message) });
  const mDelete = useMutation({ mutationFn: (d: any) => deleteFn({ data: d }), onSuccess: invalidate, onError: (e: any) => toast.error(e.message) });

  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const handleAddTask = (listId: string) => {
    setAddMenuOpen(false);
    setOpenTask({ id: null, source: "task", createListId: listId });
  };

  const cols = useKanbanColumns({
    boardType: "tasks_dashboard",
    boardId: "all",
    defaults: DEFAULT_COLUMNS,
  });
  const dnd = useColumnDnD(cols.columns, cols.reorder);

  const groupedByStatus = cols.columns.map((c) => ({
    ...c,
    tasks: tasks.filter((t: any) => t.status === c.id),
  }));

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Tarefas</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Visão geral do seu workspace</p>
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            disabled={lists.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 transition-colors disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Adicionar tarefa
          </button>
          {addMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAddMenuOpen(false)} />
              <div className="absolute right-0 top-10 z-40 w-56 rounded-xl bg-popover border border-border shadow-xl p-1.5">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">Categoria</div>
                {lists.map((l: any) => (
                  <button
                    key={l.id}
                    onClick={() => handleAddTask(l.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-muted transition-colors text-left"
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ background: l.color }} />
                    <span className="truncate">{l.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Hoje" count={counts.today} icon={CalIcon} tint="--tint-blue" accent="oklch(0.55 0.2 250)" />
        <StatCard label="Próx. 7 dias" count={counts.next7} icon={Clock} tint="--tint-indigo" accent="oklch(0.55 0.22 285)" />
        <StatCard label="Próx. 30 dias" count={counts.next30} icon={Clock} tint="--tint-green" accent="oklch(0.5 0.13 155)" />
        <StatCard label="Atrasadas" count={counts.overdue} icon={AlertCircle} tint="--tint-amber" accent="oklch(0.6 0.22 25)" />
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) => {
          const t = tasks.find((x: any) => x.id === e.active.id);
          if (t) setActiveDrag({ id: t.id, source: t.source });
        }}
        onDragEnd={(e: DragEndEvent) => {
          const drag = activeDrag;
          setActiveDrag(null);
          if (!e.over || !drag) return;
          const newStatus = String(e.over.id);
          const t = tasks.find((x: any) => x.id === drag.id);
          if (!t || t.status === newStatus) return;
          mUpdate.mutate({ id: drag.id, source: drag.source, patch: { status: newStatus } });
        }}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {groupedByStatus.map((col) => {
            const def = cols.columns.find((c) => c.id === col.id)!;
            const headerProps = dnd.headerDragProps(def);
            const isColOver = dnd.overKey === col.id;
            const isColDragging = dnd.draggingKey === col.id;
            return (
              <KanbanColumn
                key={col.id}
                col={col}
                def={def}
                cols={cols}
                headerProps={headerProps}
                isColOver={isColOver}
                isColDragging={isColDragging}
                listById={listById}
                onCardClick={(t: any) => setOpenTask({ id: t.id, source: t.source })}
                onCardDelete={(t: any) => { confirm("Excluir esta tarefa?").then((ok) => { if (ok) mDelete.mutate({ id: t.id, source: t.source }); }); }}
              />
            );
          })}
        </div>
        <DragOverlay>
          {activeDrag && (() => {
            const t = tasks.find((x: any) => x.id === activeDrag.id);
            if (!t) return null;
            return (
              <div className="rounded-xl bg-surface border border-primary/40 p-3 shadow-lg w-[260px]">
                <div className="text-sm leading-snug">{t.title}</div>
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>

      <TaskDetailDialog
        open={!!openTask}
        onOpenChange={(o) => { if (!o) setOpenTask(null); }}
        source={openTask?.source ?? "task"}
        id={openTask?.id ?? null}
        createListId={openTask?.createListId ?? null}
        invalidateKeys={[["all-tasks"], ["task-lists"], ["tasks-summary"]]}
      />
    </PageShell>
  );
}

function KanbanColumn({
  col, def, cols, headerProps, isColOver, isColDragging, listById,
  onCardClick, onCardDelete,
}: any) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div
      className={`flex flex-col rounded-2xl border bg-surface min-w-[280px] flex-1 transition-all overflow-hidden ${isColOver ? "border-primary/60 ring-2 ring-primary/30" : "border-border"} ${isColDragging ? "opacity-50" : ""}`}
    >
      <div
        {...headerProps}
        className="flex items-center gap-2 px-4 py-3 border-b border-border select-none active:cursor-grabbing"
        style={{ background: col.tint }}
        title="Arraste para reordenar"
      >
        <GripVertical className="size-3.5 text-muted-foreground/60" />
        <span className="size-2 rounded-full" style={{ background: col.accent }} />
        <div className="text-sm font-semibold flex-1 truncate">{col.label}</div>
        <span className="text-xs text-muted-foreground tabular-nums">{col.tasks.length}</span>
        <ColumnControls
          col={def}
          itemCount={col.tasks.length}
          onRename={(label: string) => cols.rename(def, label)}
          onRecolor={(c: string) => cols.recolor(def, c)}
          onDelete={() => cols.remove(def)}
        />
      </div>
      <div
        ref={setNodeRef}
        className={`p-2 space-y-2 flex-1 min-h-[120px] transition-colors ${isOver ? "bg-primary/5" : ""}`}
      >
        {col.tasks.map((t: any) => (
          <DraggableTaskCard
            key={t.id}
            t={t}
            list={listById.get(t.list_id)}
            onClick={() => onCardClick(t)}
            onDelete={() => onCardDelete(t)}
          />
        ))}
        {col.tasks.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            Arraste tarefas aqui
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableTaskCard({ t, list, onClick, onDelete }: { t: any; list: any; onClick: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: t.id });
  const due = fmtDue(t.due_at);
  const accent = list?.color ?? "oklch(0.6 0.02 260)";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { if (!isDragging) { e.stopPropagation(); onClick(); } }}
      className={`group rounded-xl bg-surface border p-3 cursor-grab active:cursor-grabbing select-none transition-all border-l-4 ${
        t.overdue ? "border-destructive/60 bg-destructive/5" : "border-border hover:border-primary/40"
      } ${isDragging ? "opacity-40" : ""}`}
      style={{ borderLeftColor: accent }}
    >
      <div className="flex items-start gap-2">
        <div className={`text-sm flex-1 leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
          {t.title}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {list && (
          <span
            className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md"
            style={{ background: `color-mix(in oklch, ${accent} 15%, white)`, color: accent }}
          >
            {list.name}
          </span>
        )}
        {due && (
          <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md tabular-nums ${
            t.overdue ? "bg-destructive/15 text-destructive font-medium" : "bg-muted text-muted-foreground"
          }`}>
            {t.overdue && <AlertCircle className="size-3" />}
            <CalIcon className="size-3" /> {due}
          </span>
        )}
        {t.recurrence_frequency && <Repeat className="size-3 text-primary" />}
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { PageShell } from "@/components/PageHeader";
import {
  Plus, Trash2, Calendar as CalIcon, AlertCircle, Repeat, KanbanSquare, List as ListIcon, GripVertical,
} from "lucide-react";
import {
  listListTasks, createListTask, updateListTask, deleteListTask,
} from "@/lib/workspace-tasks.functions";
import { useKanbanColumns, useColumnDnD, ColumnControls, AddColumnButton } from "@/components/kanban/useKanbanColumns";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/tasks/$listId")({
  head: () => ({ meta: [{ title: "Lista — Tarefas" }] }),
  component: ListPage,
});

const DEFAULT_COLUMNS = [
  { id: "todo", label: "A fazer", tint: "oklch(0.97 0.012 250)", accent: "oklch(0.55 0.2 250)" },
  { id: "doing", label: "Fazendo", tint: "oklch(0.97 0.03 75)", accent: "oklch(0.6 0.16 65)" },
  { id: "done", label: "Concluído", tint: "oklch(0.97 0.025 155)", accent: "oklch(0.5 0.13 155)" },
];

type View = "list" | "kanban";

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

function ListPage() {
  const { listId } = Route.useParams();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("list");
  const [openTask, setOpenTask] = useState<{ id: string; source: "task" | "shop_task" } | null>(null);

  const listFn = useServerFn(listListTasks);
  const createFn = useServerFn(createListTask);
  const updateFn = useServerFn(updateListTask);
  const deleteFn = useServerFn(deleteListTask);

  const { data, isLoading } = useQuery({
    queryKey: ["list-tasks", listId],
    queryFn: () => listFn({ data: { list_id: listId } }),
  });

  const list = (data as any)?.list;
  const tasks = useMemo(() => (data as any)?.tasks ?? [], [data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["list-tasks", listId] });
    qc.invalidateQueries({ queryKey: ["task-lists"] });
    qc.invalidateQueries({ queryKey: ["tasks-summary"] });
  };
  const mCreate = useMutation({ mutationFn: (d: any) => createFn({ data: d }), onSuccess: invalidate, onError: (e: any) => toast.error(e.message) });
  const mUpdate = useMutation({ mutationFn: (d: any) => updateFn({ data: d }), onSuccess: invalidate, onError: (e: any) => toast.error(e.message) });
  const mDelete = useMutation({ mutationFn: (d: any) => deleteFn({ data: d }), onSuccess: invalidate, onError: (e: any) => toast.error(e.message) });

  const handleAddTask = async () => {
    try {
      const result: any = await mCreate.mutateAsync({ list_id: listId, title: "Nova tarefa", status: "todo" });
      if (result?.task) setOpenTask({ id: result.task.id, source: result.source });
    } catch {}
  };

  const [activeDrag, setActiveDrag] = useState<{ id: string; source: "task" | "shop_task" } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const confirm = useConfirm();

  const cols = useKanbanColumns({
    boardType: "task_list",
    boardId: listId,
    defaults: DEFAULT_COLUMNS,
  });
  const dnd = useColumnDnD(cols.columns, cols.reorder);

  if (isLoading || !list) {
    return (
      <PageShell>
        <div className="grid place-items-center h-64">
          <div className="size-6 rounded-full border-2 border-border border-t-primary animate-spin" />
        </div>
      </PageShell>
    );
  }

  const groupedByStatus = cols.columns.map((c) => ({
    ...c,
    tasks: tasks.filter((t: any) => t.status === c.id),
  }));

  const isShop = !!list.shop_id;

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <span className="size-3 rounded-full shrink-0" style={{ background: list.color }} />
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight truncate">{list.name}</h1>
            <p className="text-xs text-muted-foreground mt-1">
              {isShop ? "Lista vinculada à loja · " : ""}
              {tasks.length} tarefa{tasks.length === 1 ? "" : "s"}
              {isShop && (
                <>
                  {" · "}
                  <Link to="/shops/$shopId" params={{ shopId: list.shop_id }} className="text-primary hover:underline">
                    abrir loja
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg bg-muted p-0.5 text-xs">
            {([
              ["list", ListIcon, "Lista"],
              ["kanban", KanbanSquare, "Kanban"],
            ] as const).map(([id, Icon, lbl]) => (
              <button
                key={id}
                onClick={() => setView(id as View)}
                className={`h-8 px-3 rounded-md inline-flex items-center gap-1.5 transition-colors ${
                  view === id ? "bg-surface shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {lbl}
              </button>
            ))}
          </div>
          <button
            onClick={handleAddTask}
            className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
          >
            <Plus className="size-3.5" /> Adicionar tarefa
          </button>
        </div>
      </div>

      {view === "list" && (
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
            const overId = String(e.over.id);
            const newStatus = overId.startsWith("list-") ? overId.slice(5) : overId;
            const t = tasks.find((x: any) => x.id === drag.id);
            if (!t || t.status === newStatus) return;
            mUpdate.mutate({ id: drag.id, source: drag.source, patch: { status: newStatus } });
          }}
        >
          <div className="space-y-4">
            {groupedByStatus.map((col) => (
              <ListDroppableSection key={col.id} col={col}>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border" style={{ background: col.tint }}>
                  <span className="size-2 rounded-full" style={{ background: col.accent }} />
                  <div className="text-sm font-semibold flex-1">{col.label}</div>
                  <span className="text-xs text-muted-foreground tabular-nums">{col.tasks.length}</span>
                </div>
                <ul className="divide-y divide-border min-h-[40px]">
                  {col.tasks.map((t: any) => (
                    <TaskRow
                      key={t.id}
                      t={t}
                      onUpdate={mUpdate.mutateAsync}
                      onOpen={(task) => setOpenTask({ id: task.id, source: task.source })}
                      onDelete={(task) => { confirm("Excluir esta tarefa?").then((ok) => { if (ok) mDelete.mutate({ id: task.id, source: task.source }); }); }}
                    />
                  ))}
                  {col.tasks.length === 0 && (
                    <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                      Arraste tarefas aqui
                    </li>
                  )}
                </ul>
              </ListDroppableSection>
            ))}
          </div>
          <DragOverlay>
            {activeDrag && (() => {
              const t = tasks.find((x: any) => x.id === activeDrag.id);
              if (!t) return null;
              return (
                <div className="rounded-lg bg-surface border border-primary/40 px-3 py-2 shadow-lg text-sm">
                  {t.title}
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>
      )}

      {view === "kanban" && (
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
                  onCardClick={(t: any) => setOpenTask({ id: t.id, source: t.source })}
                  onCardDelete={(t: any) => { confirm("Excluir esta tarefa?").then((ok) => { if (ok) mDelete.mutate({ id: t.id, source: t.source }); }); }}
                />
              );
            })}
            <AddColumnButton onAdd={cols.add} />
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
      )}

      <TaskDetailDialog
        open={!!openTask}
        onOpenChange={(o) => { if (!o) setOpenTask(null); }}
        source={openTask?.source ?? "task"}
        id={openTask?.id ?? null}
        invalidateKeys={[["list-tasks", listId], ["task-lists"], ["tasks-summary"]]}
      />
    </PageShell>
  );
}

function ListDroppableSection({ col, children }: { col: any; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `list-${col.id}` });
  return (
    <section
      ref={setNodeRef}
      className={`rounded-2xl border bg-surface overflow-hidden transition-colors ${isOver ? "border-primary/60 ring-2 ring-primary/30" : "border-border"}`}
    >
      {children}
    </section>
  );
}

function TaskRow({ t, onUpdate, onOpen, onDelete }: {
  t: any;
  onUpdate: (input: any) => Promise<any>;
  onOpen: (t: any) => void;
  onDelete: (t: any) => void;
}) {
  const due = fmtDue(t.due_at);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: t.id });
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover select-none cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : ""}`}
    >
      <GripVertical className="size-3.5 text-muted-foreground/40 shrink-0" />
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={async (e) => {
          e.stopPropagation();
          const completing = t.status !== "done";
          try {
            const result: any = await onUpdate({
              id: t.id, source: t.source,
              patch: { status: completing ? "done" : "todo" },
            });
            if (completing) {
              if (result?.recurrence_next_due_at) {
                const next = new Date(result.recurrence_next_due_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                toast.success(`Tarefa concluída! Próxima ocorrência: ${next}`);
              } else {
                toast.success("Tarefa concluída!");
              }
            }
          } catch {}
        }}
        className={`size-4 rounded-full border-2 grid place-items-center shrink-0 ${
          t.status === "done" ? "bg-success border-success" : "border-border hover:border-primary"
        }`}
      />
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onOpen(t); }}
        className={`text-sm flex-1 text-left truncate hover:text-primary ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}
      >
        {t.title}
      </button>
      {due && (
        <span className={`text-[11px] tabular-nums px-1.5 py-0.5 rounded-md ${
          t.overdue ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"
        }`}>
          {t.overdue && <AlertCircle className="size-3 inline mr-0.5" />}
          {due}
        </span>
      )}
      {t.recurrence_frequency && <Repeat className="size-3 text-primary" />}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(t); }}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

function KanbanColumn({
  col, def, cols, headerProps, isColOver, isColDragging,
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
          <DraggableTaskCard key={t.id} t={t} onClick={() => onCardClick(t)} onDelete={() => onCardDelete(t)} />
        ))}
      </div>
    </div>
  );
}

function DraggableTaskCard({ t, onClick, onDelete }: { t: any; onClick: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: t.id });
  const due = fmtDue(t.due_at);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { if (!isDragging) { e.stopPropagation(); onClick(); } }}
      className={`group rounded-xl bg-surface border p-3 cursor-grab active:cursor-grabbing select-none transition-all ${
        t.overdue ? "border-destructive/60 bg-destructive/5" : "border-border hover:border-primary/40"
      } ${isDragging ? "opacity-40" : ""}`}
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
      {due && (
        <div className="mt-2">
          <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md tabular-nums ${
            t.overdue ? "bg-destructive/15 text-destructive font-medium" : "bg-muted text-muted-foreground"
          }`}>
            {t.overdue && <AlertCircle className="size-3" />}
            <CalIcon className="size-3" /> {due}
          </span>
        </div>
      )}
    </div>
  );
}

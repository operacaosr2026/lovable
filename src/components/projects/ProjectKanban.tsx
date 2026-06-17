import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  Plus, Trash2, X, Calendar as CalIcon, AlertCircle, Repeat, ListChecks, Check,
} from "lucide-react";
import {
  listProjectTasks, createProjectTask, updateProjectTask, deleteProjectTask, reorderProjectTasks,
} from "@/lib/project-tasks.functions";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";

const COLUMNS = [
  { id: "todo",  label: "A fazer",   tint: "oklch(0.97 0.012 250)", accent: "oklch(0.55 0.2 250)" },
  { id: "doing", label: "Fazendo",   tint: "oklch(0.97 0.03 75)",   accent: "oklch(0.6 0.16 65)" },
  { id: "done",  label: "Concluído", tint: "oklch(0.97 0.025 155)", accent: "oklch(0.5 0.13 155)" },
] as const;

type Frequency = "daily" | "weekly" | "monthly" | "custom";
type ChecklistItem = { id: string; text: string; done: boolean };
type Task = {
  id: string; title: string; description: string | null;
  status: "todo" | "doing" | "done"; position: number;
  due_at: string | null; checklist: ChecklistItem[];
  recurrence_frequency: Frequency | null;
  recurrence_weekdays: number[];
  recurrence_time: string | null;
  parent_task_id: string | null;
  overdue?: boolean;
};

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const FREQ_LABEL: Record<Frequency, string> = {
  daily: "diária", weekly: "semanal", monthly: "mensal", custom: "personalizada",
};

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

export function ProjectKanban({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProjectTasks);
  const createFn = useServerFn(createProjectTask);
  const updateFn = useServerFn(updateProjectTask);
  const deleteFn = useServerFn(deleteProjectTask);
  const reorderFn = useServerFn(reorderProjectTasks);

  const { data } = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const tasks = (data?.tasks ?? []) as Task[];

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of tasks) if (!t.parent_task_id) g[t.status]?.push(t);
    return g;
  }, [tasks]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });

  const create = useMutation({ mutationFn: (input: any) => createFn({ data: { project_id: projectId, ...input } }), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });
  const reorder = useMutation({ mutationFn: (updates: any[]) => reorderFn({ data: { updates } }), onSuccess: refresh });

  const [editing, setEditing] = useState<Task | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const confirm = useConfirm();

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const task = tasks.find(t => t.id === active.id);
    const newStatus = String(over.id) as Task["status"];
    if (!task || task.status === newStatus) return;
    const newPosition = ((grouped[newStatus]?.[0]?.position ?? 0) - 1);
    reorder.mutate([{ id: task.id, status: newStatus, position: newPosition }]);
  };

  const activeTask = tasks.find(t => t.id === activeId) ?? null;

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              col={col}
              tasks={grouped[col.id] ?? []}
              onAdd={(title: string) => create.mutate({ title, status: col.id })}
              onCardClick={(t: Task) => setEditing(t)}
              onDelete={(id: string) => { confirm("Excluir esta tarefa?").then((ok) => { if (ok) remove.mutate(id); }); }}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && <TaskCard t={activeTask} onClick={() => {}} onDelete={() => {}} />}
        </DragOverlay>
      </DndContext>

      <TaskDetailDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        source="project_task"
        id={editing?.id ?? null}
        projectId={projectId}
        invalidateKeys={[["project-tasks", projectId]]}
      />
    </>
  );
}

function Column({ col, tasks, onAdd, onCardClick, onDelete }: any) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface min-h-0 flex-1 min-w-[280px] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border" style={{ background: col.tint }}>
        <span className="size-2 rounded-full" style={{ background: col.accent }} />
        <div className="text-sm font-semibold flex-1">{col.label}</div>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
        <button onClick={() => setAdding(true)} className="size-6 rounded-md hover:bg-surface grid place-items-center text-muted-foreground">
          <Plus className="size-3.5" />
        </button>
      </div>
      <div ref={setNodeRef} className={`p-2 space-y-2 min-h-[120px] transition-colors ${isOver ? "bg-primary/5" : ""}`}>
        {adding && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (val.trim()) { onAdd(val.trim()); setVal(""); } setAdding(false); }}
          >
            <input
              ref={inputRef}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={() => { if (val.trim()) onAdd(val.trim()); setVal(""); setAdding(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setVal(""); } }}
              placeholder="Nova tarefa..."
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
            />
          </form>
        )}
        {tasks.map((t: Task) => (
          <TaskCard key={t.id} t={t} onClick={() => onCardClick(t)} onDelete={() => onDelete(t.id)} />
        ))}
        {tasks.length === 0 && !adding && (
          <button onClick={() => setAdding(true)} className="w-full text-xs text-muted-foreground py-3 hover:text-foreground rounded-lg border border-dashed border-border">
            + Adicionar tarefa
          </button>
        )}
      </div>
    </div>
  );
}

function TaskCard({ t, onClick, onDelete }: { t: Task; onClick: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: t.id });
  const due = fmtDue(t.due_at);
  const totalChecks = t.checklist?.length ?? 0;
  const doneChecks = t.checklist?.filter(c => c.done).length ?? 0;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { if (!isDragging) { e.stopPropagation(); onClick(); } }}
      className={`group rounded-xl bg-background border p-3 cursor-grab active:cursor-grabbing transition-all ${
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
      {(due || totalChecks > 0 || t.recurrence_frequency) && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {due && (
            <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md tabular-nums ${
              t.overdue ? "bg-destructive/15 text-destructive font-medium" : "bg-muted text-muted-foreground"
            }`}>
              {t.overdue && <AlertCircle className="size-3" />}
              <CalIcon className="size-3" /> {due}
            </span>
          )}
          {totalChecks > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
              <ListChecks className="size-3" /> {doneChecks}/{totalChecks}
            </span>
          )}
          {t.recurrence_frequency && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-accent text-accent-foreground">
              <Repeat className="size-3" /> {FREQ_LABEL[t.recurrence_frequency]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TaskEditor({ task, onClose, onSave, onDelete }: {
  task: Task; onClose: () => void;
  onSave: (patch: any) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState(task.status);
  const [dueDate, setDueDate] = useState(task.due_at ? task.due_at.slice(0, 10) : "");
  const [dueTime, setDueTime] = useState(task.due_at ? new Date(task.due_at).toTimeString().slice(0, 5) : "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist ?? []);
  const [newCheck, setNewCheck] = useState("");
  const [freq, setFreq] = useState<Frequency | "">(task.recurrence_frequency ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(task.recurrence_weekdays ?? []);
  const [recTime, setRecTime] = useState(task.recurrence_time ?? "");

  useEscapeToClose(onClose);

  const save = async () => {
    let due_at: string | null = null;
    if (dueDate) {
      const t = dueTime || "23:59";
      due_at = new Date(`${dueDate}T${t}:00`).toISOString();
    }
    await onSave({
      title: title.trim() || task.title,
      description: description.trim() || null,
      status,
      due_at,
      checklist,
      recurrence_frequency: freq || null,
      recurrence_weekdays: freq === "custom" ? weekdays : [],
      recurrence_time: recTime && /^\d{2}:\d{2}$/.test(recTime) ? recTime : null,
    });
  };

  const addCheck = () => {
    if (!newCheck.trim()) return;
    setChecklist([...checklist, { id: crypto.randomUUID(), text: newCheck.trim(), done: false }]);
    setNewCheck("");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-popover z-10">
          <div className="text-base font-semibold">Editar tarefa</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-base font-medium bg-transparent outline-none border-b border-border pb-2 focus:border-primary"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Adicionar descrição..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50 resize-none"
          />

          <div className="grid grid-cols-3 gap-2">
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none">
                {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Data">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none" />
            </Field>
            <Field label="Hora">
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none" />
            </Field>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Checklist</div>
            <div className="space-y-1.5">
              {checklist.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const nc = [...checklist]; nc[i] = { ...c, done: !c.done }; setChecklist(nc);
                    }}
                    className={`size-4 rounded border grid place-items-center shrink-0 ${c.done ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}
                  >
                    {c.done && <Check className="size-3" />}
                  </button>
                  <input
                    value={c.text}
                    onChange={(e) => {
                      const nc = [...checklist]; nc[i] = { ...c, text: e.target.value }; setChecklist(nc);
                    }}
                    className={`flex-1 bg-transparent text-sm outline-none ${c.done ? "line-through text-muted-foreground" : ""}`}
                  />
                  <button onClick={() => setChecklist(checklist.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newCheck}
                  onChange={(e) => setNewCheck(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCheck(); } }}
                  placeholder="Adicionar item..."
                  className="flex-1 px-2 h-8 rounded-md bg-surface border border-border text-sm outline-none focus:border-primary/50"
                />
                <button type="button" onClick={addCheck} className="h-8 px-3 rounded-md bg-muted text-sm">Add</button>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Recorrência</div>
            <div className="flex gap-1.5 flex-wrap">
              {(["", "daily", "weekly", "monthly", "custom"] as const).map((f) => (
                <button
                  key={f || "none"}
                  type="button"
                  onClick={() => setFreq(f)}
                  className={`px-3 h-8 rounded-md text-xs border ${freq === f ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground"}`}
                >
                  {f === "" ? "Nenhuma" : FREQ_LABEL[f as Frequency]}
                </button>
              ))}
            </div>
            {freq === "custom" && (
              <div className="flex gap-1 mt-2">
                {WEEKDAY_LABELS.map((l, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter(d => d !== i) : [...weekdays, i])}
                    className={`size-8 rounded-md text-xs font-medium ${weekdays.includes(i) ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            {freq && (
              <input
                type="time"
                value={recTime}
                onChange={(e) => setRecTime(e.target.value)}
                className="mt-2 h-8 px-2 rounded-md bg-surface border border-border text-sm outline-none"
                placeholder="Hora"
              />
            )}
          </div>
        </div>

        <div className="flex justify-between items-center px-5 py-3 border-t border-border sticky bottom-0 bg-popover">
          <button onClick={onDelete} className="text-sm text-destructive hover:underline">Excluir</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
            <button onClick={save} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{label}</div>
      {children}
    </div>
  );
}

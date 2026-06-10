import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  Plus, Trash2, X, Calendar as CalIcon, AlertCircle, ListChecks, Check, Flame, User, MessageSquare, Bell,
} from "lucide-react";
import {
  listShopTasks, createShopTask, updateShopTask, deleteShopTask, reorderShopTasks,
  listTaskComments, addTaskComment, deleteTaskComment,
  TASK_PRIORITIES,
} from "@/lib/shop-tasks.functions";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";

const COLUMNS = [
  { id: "todo",  label: "Para fazer", tint: "oklch(0.97 0.012 250)", accent: "oklch(0.55 0.2 250)" },
  { id: "doing", label: "Fazendo",    tint: "oklch(0.97 0.03 75)",   accent: "oklch(0.6 0.16 65)" },
  { id: "done",  label: "Finalizado", tint: "oklch(0.97 0.025 155)", accent: "oklch(0.5 0.13 155)" },
] as const;

const PRIO_META: Record<string, { tint: string; accent: string }> = {
  alta:  { tint: "oklch(0.95 0.05 25)",  accent: "oklch(0.55 0.18 25)" },
  media: { tint: "oklch(0.96 0.04 75)",  accent: "oklch(0.55 0.15 65)" },
  baixa: { tint: "oklch(0.95 0.02 200)", accent: "oklch(0.5 0.12 220)" },
};

type ChecklistItem = { id: string; text: string; done: boolean };
type Task = {
  id: string; title: string; description: string | null;
  status: "todo" | "doing" | "done"; position: number;
  priority: "baixa" | "media" | "alta";
  due_at: string | null; checklist: ChecklistItem[];
  assignee: string | null; reminder_minutes: number[];
  parent_task_id: string | null; overdue?: boolean;
};

function fmtDue(due: string | null) {
  if (!due) return null;
  const d = new Date(due);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  const time = d.toTimeString().slice(0, 5);
  const hasTime = time !== "23:59" && time !== "00:00";
  let label = diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : diff === -1 ? "Ontem" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return hasTime ? `${label} · ${time}` : label;
}

export function ShopTaskKanban({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listShopTasks);
  const createFn = useServerFn(createShopTask);
  const updateFn = useServerFn(updateShopTask);
  const deleteFn = useServerFn(deleteShopTask);
  const reorderFn = useServerFn(reorderShopTasks);

  const [editing, setEditing] = useState<Task | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "today" | "overdue" | "upcoming">("all");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data } = useQuery({ queryKey: ["shop-tasks", shopId], queryFn: () => list({ data: { shop_id: shopId } }) });
  const tasks = (data?.tasks ?? []) as Task[];

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);

  const filtered = useMemo(() => tasks.filter((t) => {
    if (t.parent_task_id) return false;
    if (filter === "today") return t.due_at && new Date(t.due_at) >= today && new Date(t.due_at) <= endToday;
    if (filter === "overdue") return t.overdue;
    if (filter === "upcoming") return t.due_at && new Date(t.due_at) > endToday && new Date(t.due_at) <= in7;
    return true;
  }), [tasks, filter]);

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of filtered) g[t.status]?.push(t);
    return g;
  }, [filtered]);

  const counts = {
    today: tasks.filter((t) => !t.parent_task_id && t.status !== "done" && t.due_at && new Date(t.due_at) >= today && new Date(t.due_at) <= endToday).length,
    overdue: tasks.filter((t) => !t.parent_task_id && t.overdue).length,
    upcoming: tasks.filter((t) => !t.parent_task_id && t.status !== "done" && t.due_at && new Date(t.due_at) > endToday && new Date(t.due_at) <= in7).length,
  };

  const queryKey = ["shop-tasks", shopId];
  const refresh = () => qc.invalidateQueries({ queryKey });
  const create = useMutation({ mutationFn: (input: any) => createFn({ data: { shop_id: shopId, ...input } }), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      qc.setQueryData<any>(queryKey, (old: any) => old?.tasks ? { ...old, tasks: old.tasks.filter((t: any) => t.id !== id) } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev); },
    onSettled: refresh,
  });
  const reorder = useMutation({
    mutationFn: (updates: any[]) => reorderFn({ data: { updates } }),
    onMutate: async (updates: any[]) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      qc.setQueryData<any>(queryKey, (old: any) => {
        if (!old?.tasks) return old;
        const map = new Map(updates.map((u) => [u.id, u]));
        return { ...old, tasks: old.tasks.map((t: any) => map.has(t.id) ? { ...t, ...map.get(t.id) } : t) };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev); },
    onSettled: refresh,
  });

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const t = tasks.find((x) => x.id === active.id);
    const newStatus = String(over.id) as Task["status"];
    if (!t || t.status === newStatus) return;
    const newPosition = ((grouped[newStatus]?.[0]?.position ?? 0) - 1);
    reorder.mutate([{ id: t.id, status: newStatus, position: newPosition }]);
  };

  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  const handleAddTask = async () => {
    const result: any = await create.mutateAsync({ title: "Nova tarefa", status: "todo" });
    if (result?.task) setEditing(result.task);
  };

  return (
    <>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>Todas</Chip>
        <Chip active={filter === "today"} onClick={() => setFilter("today")}>Hoje · {counts.today}</Chip>
        <Chip active={filter === "overdue"} onClick={() => setFilter("overdue")} danger={counts.overdue > 0}>Vencidas · {counts.overdue}</Chip>
        <Chip active={filter === "upcoming"} onClick={() => setFilter("upcoming")}>Próximas · {counts.upcoming}</Chip>
        <div className="flex-1" />
        <button onClick={handleAddTask} className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 transition-colors">
          <Plus className="size-3.5" /> Adicionar tarefa
        </button>
      </div>

      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <Column key={col.id} col={col} tasks={grouped[col.id] ?? []}
              onCardClick={(t: Task) => setEditing(t)}
              onDelete={(id: string) => remove.mutate(id)}
            />
          ))}
        </div>
        <DragOverlay>{activeTask && <TaskCard t={activeTask} onClick={() => {}} onDelete={() => {}} />}</DragOverlay>
      </DndContext>

      <TaskDetailDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        source="shop_task"
        id={editing?.id ?? null}
        invalidateKeys={[["shop-tasks", shopId]]}
      />
    </>
  );
}

function Chip({ active, onClick, children, danger }: any) {
  return (
    <button onClick={onClick} className={`text-xs px-3 h-8 rounded-full border transition-colors ${active ? (danger ? "bg-destructive/10 border-destructive/40 text-destructive" : "bg-primary/10 border-primary/40 text-primary") : "border-border bg-surface text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

function Column({ col, tasks, onCardClick, onDelete }: any) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface min-h-0 flex-1 min-w-[280px]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border" style={{ background: col.tint }}>
        <span className="size-2 rounded-full" style={{ background: col.accent }} />
        <div className="text-sm font-semibold flex-1">{col.label}</div>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className={`p-2 space-y-2 min-h-[120px] transition-colors ${isOver ? "bg-primary/5" : ""}`}>
        {tasks.map((t: Task) => <TaskCard key={t.id} t={t} onClick={() => onCardClick(t)} onDelete={() => onDelete(t.id)} />)}
      </div>
    </div>
  );
}

function TaskCard({ t, onClick, onDelete }: { t: Task; onClick: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: t.id });
  const due = fmtDue(t.due_at);
  const totalChecks = t.checklist?.length ?? 0;
  const doneChecks = t.checklist?.filter((c) => c.done).length ?? 0;
  const prio = PRIO_META[t.priority] ?? PRIO_META.media;
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      onClick={(e) => { if (!isDragging) { e.stopPropagation(); onClick(); } }}
      className={`group rounded-xl bg-background border p-3 cursor-grab active:cursor-grabbing transition-all ${t.overdue ? "border-destructive/60 bg-destructive/5" : "border-border hover:border-primary/40"} ${isDragging ? "opacity-40" : ""}`}>
      <div className="flex items-start gap-2">
        <div className={`text-sm flex-1 leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0">
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: prio.tint, color: prio.accent }}>
          <Flame className="size-2.5" /> {t.priority}
        </span>
        {due && (
          <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md tabular-nums ${t.overdue ? "bg-destructive/15 text-destructive font-medium" : "bg-muted text-muted-foreground"}`}>
            {t.overdue && <AlertCircle className="size-3" />}<CalIcon className="size-3" /> {due}
          </span>
        )}
        {totalChecks > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground"><ListChecks className="size-3" /> {doneChecks}/{totalChecks}</span>
        )}
        {t.assignee && (
          <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground"><User className="size-3" /> {t.assignee}</span>
        )}
      </div>
    </div>
  );
}

function TaskEditor({ task, shopId, onClose, onSave, onDelete }: any) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [dueDate, setDueDate] = useState(task.due_at ? task.due_at.slice(0, 10) : "");
  const [dueTime, setDueTime] = useState(task.due_at ? new Date(task.due_at).toTimeString().slice(0, 5) : "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist ?? []);
  const [newCheck, setNewCheck] = useState("");
  const [reminders, setReminders] = useState<number[]>(task.reminder_minutes ?? []);

  const commentsFn = useServerFn(listTaskComments);
  const addCommentFn = useServerFn(addTaskComment);
  const delCommentFn = useServerFn(deleteTaskComment);
  const { data: cdata } = useQuery({ queryKey: ["shop-task-comments", task.id], queryFn: () => commentsFn({ data: { task_id: task.id } }) });
  const comments = cdata?.comments ?? [];
  const refreshC = () => qc.invalidateQueries({ queryKey: ["shop-task-comments", task.id] });
  const addC = useMutation({ mutationFn: (content: string) => addCommentFn({ data: { task_id: task.id, content } }), onSuccess: refreshC });
  const delC = useMutation({ mutationFn: (id: string) => delCommentFn({ data: { id } }), onSuccess: refreshC });
  const [newComment, setNewComment] = useState("");

  const save = () => {
    let due_at: string | null = null;
    if (dueDate) {
      const t = dueTime || "23:59";
      due_at = new Date(`${dueDate}T${t}:00`).toISOString();
    }
    onSave({
      title: title.trim() || task.title,
      description: description.trim() || null,
      status, priority,
      assignee: assignee.trim() || null,
      due_at, checklist,
      reminder_minutes: reminders,
    });
  };

  const addCheck = () => {
    if (!newCheck.trim()) return;
    setChecklist([...checklist, { id: crypto.randomUUID(), text: newCheck.trim(), done: false }]);
    setNewCheck("");
  };

  const REMINDER_OPTS = [{ v: 15, l: "15m" }, { v: 60, l: "1h" }, { v: 1440, l: "1d" }];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-popover z-10">
          <div className="text-base font-semibold">Editar tarefa</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-base font-medium bg-transparent outline-none border-b border-border pb-2 focus:border-primary" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição..." rows={2} className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none resize-none" />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none">
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Prioridade">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none">
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Data"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none" /></Field>
            <Field label="Hora"><input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none" /></Field>
            <Field label="Responsável"><input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Nome..." className="w-full h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none" /></Field>
            <Field label="Lembretes">
              <div className="flex gap-1.5">
                {REMINDER_OPTS.map((r) => (
                  <button key={r.v} type="button" onClick={() => setReminders(reminders.includes(r.v) ? reminders.filter((x) => x !== r.v) : [...reminders, r.v])} className={`px-2 h-7 rounded-md text-xs border ${reminders.includes(r.v) ? "bg-primary text-primary-foreground border-primary" : "border-border bg-surface text-muted-foreground"}`}>
                    <Bell className="size-3 inline mr-0.5" />{r.l}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div>
            <Label>Checklist</Label>
            <div className="space-y-1.5">
              {checklist.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2">
                  <button onClick={() => { const nc = [...checklist]; nc[i] = { ...c, done: !c.done }; setChecklist(nc); }} className={`size-4 rounded border grid place-items-center shrink-0 ${c.done ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                    {c.done && <Check className="size-3" />}
                  </button>
                  <input value={c.text} onChange={(e) => { const nc = [...checklist]; nc[i] = { ...c, text: e.target.value }; setChecklist(nc); }} className={`flex-1 bg-transparent text-sm outline-none ${c.done ? "line-through text-muted-foreground" : ""}`} />
                  <button onClick={() => setChecklist(checklist.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                </div>
              ))}
              <div className="flex gap-2">
                <input value={newCheck} onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCheck(); } }} placeholder="Adicionar item..." className="flex-1 px-2 h-8 rounded-md bg-surface border border-border text-sm outline-none" />
                <button type="button" onClick={addCheck} className="h-8 px-3 rounded-md bg-muted text-sm">Add</button>
              </div>
            </div>
          </div>

          <div>
            <Label><MessageSquare className="size-3 inline mr-1" />Comentários</Label>
            <div className="space-y-2">
              {comments.map((c: any) => (
                <div key={c.id} className="group flex items-start gap-2 text-sm rounded-lg bg-surface border border-border p-2">
                  <div className="flex-1">
                    <div>{c.content}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(c.created_at).toLocaleString("pt-BR")}</div>
                  </div>
                  <button onClick={() => delC.mutate(c.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"><X className="size-3" /></button>
                </div>
              ))}
              <div className="flex gap-2">
                <input value={newComment} onChange={(e) => setNewComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newComment.trim()) { addC.mutate(newComment.trim()); setNewComment(""); } }} placeholder="Adicionar comentário..." className="flex-1 px-2 h-8 rounded-md bg-surface border border-border text-sm outline-none" />
                <button onClick={() => { if (newComment.trim()) { addC.mutate(newComment.trim()); setNewComment(""); } }} className="h-8 px-3 rounded-md bg-muted text-sm">Enviar</button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-between items-center px-5 py-3 border-t border-border sticky bottom-0 bg-popover">
          <button onClick={onDelete} className="text-sm text-destructive hover:underline">Excluir</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
            <button onClick={save} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{label}</div>
      {children}
    </div>
  );
}
function Label({ children }: any) {
  return <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">{children}</div>;
}

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, X, Repeat, Clock, CheckCircle2, Circle, Flame, Pencil } from "lucide-react";
import {
  listShopRoutines, createShopRoutine, updateShopRoutine, completeShopRoutine, deleteShopRoutine,
  ROUTINE_FREQUENCIES,
} from "@/lib/shop-routines.functions";

const FREQ_LABEL: Record<string, string> = { daily: "Diária", weekly: "Semanal", monthly: "Mensal", custom: "Personalizada" };
const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

export function ShopRoutines({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listShopRoutines);
  const createFn = useServerFn(createShopRoutine);
  const updateFn = useServerFn(updateShopRoutine);
  const completeFn = useServerFn(completeShopRoutine);
  const deleteFn = useServerFn(deleteShopRoutine);

  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({ queryKey: ["shop-routines", shopId], queryFn: () => list({ data: { shop_id: shopId } }) });
  const routines = (data?.routines ?? []) as any[];

  const queryKey = ["shop-routines", shopId];
  const refresh = () => qc.invalidateQueries({ queryKey });
  const create = useMutation({ mutationFn: (input: any) => createFn({ data: { shop_id: shopId, ...input } }), onSuccess: () => { refresh(); setCreating(false); } });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }), onSuccess: () => { refresh(); setEditing(null); } });
  const complete = useMutation({
    mutationFn: (id: string) => completeFn({ data: { id } }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      qc.setQueryData<any>(queryKey, (old: any) => {
        if (!old?.routines) return old;
        const todayKey = new Date().toISOString().slice(0, 10);
        return {
          ...old,
          routines: old.routines.map((r: any) =>
            r.id === id
              ? { ...r, done_today: true, streak: (r.streak ?? 0) + (r.done_today ? 0 : 1), recent_logs: Array.from(new Set([...(r.recent_logs ?? []), todayKey])) }
              : r,
          ),
        };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev); },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      qc.setQueryData<any>(queryKey, (old: any) => old?.routines ? { ...old, routines: old.routines.filter((r: any) => r.id !== id) } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev); },
    onSettled: refresh,
  });

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = { daily: [], weekly: [], monthly: [], custom: [] };
    for (const r of routines) (g[r.frequency] ??= []).push(r);
    return g;
  }, [routines]);

  const doneToday = routines.filter((r) => r.done_today).length;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm text-muted-foreground">Progresso de hoje</div>
          <div className="text-lg font-semibold tabular-nums">{doneToday}/{routines.length} concluídas</div>
        </div>
        <button onClick={() => setCreating(true)} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5">
          <Plus className="size-4" /> Nova rotina
        </button>
      </div>

      {routines.length > 0 && (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-5">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${routines.length ? (doneToday / routines.length) * 100 : 0}%` }} />
        </div>
      )}

      {routines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Repeat className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma rotina criada ainda.</p>
          <button onClick={() => setCreating(true)} className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5">
            <Plus className="size-4" /> Criar primeira rotina
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {(["daily", "weekly", "monthly", "custom"] as const).map((freq) => {
            const items = grouped[freq] ?? [];
            if (items.length === 0) return null;
            return (
              <div key={freq}>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-2">{FREQ_LABEL[freq]}</div>
                <div className="space-y-2">
                  {items.map((r) => (
                    <RoutineCard key={r.id} r={r}
                      onComplete={() => complete.mutate(r.id)}
                      onEdit={() => setEditing(r)}
                      onDelete={() => { if (confirm(`Remover "${r.title}"?`)) remove.mutate(r.id); }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <RoutineEditor
          routine={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={(patch: any) => editing ? update.mutate({ id: editing.id, patch }) : create.mutate(patch)}
        />
      )}
    </>
  );
}

function formatNextDue(iso: string) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dKey = new Date(d); dKey.setHours(0,0,0,0);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (dKey.getTime() === tomorrow.getTime()) return `amanhã ${time}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + ` ${time}`;
}

function RoutineCard({ r, onComplete, onEdit, onDelete }: any) {
  const recent = (r.recent_logs ?? []) as string[];
  const days: { date: string; done: boolean }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, done: recent.includes(key) });
  }
  return (
    <div className={`group flex items-center gap-3 rounded-xl border p-3 transition-all ${r.done_today ? "border-primary/30 bg-primary/5" : "border-border bg-surface"}`}>
      <button onClick={onComplete} className="shrink-0 text-muted-foreground hover:text-primary transition-transform active:scale-90 duration-150">
        {r.done_today ? <CheckCircle2 className="size-6 text-primary" /> : <Circle className="size-6" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${r.done_today ? "line-through text-muted-foreground" : ""}`}>{r.title}</div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
          {r.time && <span className="inline-flex items-center gap-0.5"><Clock className="size-3" /> {r.time}</span>}
          {r.frequency === "custom" && r.weekdays?.length > 0 && (
            <span>{r.weekdays.map((d: number) => WEEKDAY_LABELS[d]).join("·")}</span>
          )}
          {r.done_today && r.next_due_at && (
            <span className="text-primary">Próxima: {formatNextDue(r.next_due_at)}</span>
          )}
          {r.streak > 0 && <span className="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-400 font-medium"><Flame className="size-3" /> {r.streak}</span>}
        </div>
      </div>
      <div className="hidden sm:flex gap-0.5">
        {days.map((d) => (
          <div key={d.date} className={`size-3 rounded-sm ${d.done ? "bg-primary" : "bg-muted"}`} title={d.date} />
        ))}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100">
        <button onClick={onEdit} className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted"><Pencil className="size-3.5" /></button>
        <button onClick={onDelete} className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
      </div>
    </div>
  );
}

function RoutineEditor({ routine, onClose, onSave }: any) {
  const [title, setTitle] = useState(routine?.title ?? "");
  const [description, setDescription] = useState(routine?.description ?? "");
  const [frequency, setFrequency] = useState<string>(routine?.frequency ?? "daily");
  const [weekdays, setWeekdays] = useState<number[]>(routine?.weekdays ?? []);
  const [time, setTime] = useState(routine?.time ?? "");
  const [reminders, setReminders] = useState<number[]>(routine?.reminder_minutes ?? []);

  const REMINDER_OPTS = [{ v: 15, l: "15min antes" }, { v: 60, l: "1h antes" }, { v: 1440, l: "1 dia antes" }];

  const save = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      frequency,
      weekdays: frequency === "custom" ? weekdays : [],
      time: time && /^\d{2}:\d{2}$/.test(time) ? time : null,
      reminder_minutes: reminders,
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-base font-semibold">{routine ? "Editar rotina" : "Nova rotina"}</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da rotina..." className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição..." rows={2} className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none resize-none" />

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Frequência</div>
            <div className="flex gap-1.5 flex-wrap">
              {ROUTINE_FREQUENCIES.map((f) => (
                <button key={f} type="button" onClick={() => setFrequency(f)} className={`px-3 h-8 rounded-md text-xs border ${frequency === f ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground"}`}>
                  {FREQ_LABEL[f]}
                </button>
              ))}
            </div>
            {frequency === "custom" && (
              <div className="flex gap-1 mt-2">
                {WEEKDAY_LABELS.map((l, i) => (
                  <button key={i} type="button" onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((d) => d !== i) : [...weekdays, i])} className={`size-8 rounded-md text-xs font-medium ${weekdays.includes(i) ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground"}`}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Horário</div>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none" />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Lembretes</div>
            <div className="flex gap-1.5 flex-wrap">
              {REMINDER_OPTS.map((r) => (
                <button key={r.v} type="button" onClick={() => setReminders(reminders.includes(r.v) ? reminders.filter((x) => x !== r.v) : [...reminders, r.v])} className={`px-3 h-8 rounded-md text-xs border ${reminders.includes(r.v) ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground"}`}>
                  {r.l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
          <button onClick={save} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
        </div>
      </div>
    </div>
  );
}

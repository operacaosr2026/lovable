import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock, Check, ChevronLeft, ChevronRight, Circle, CircleDot, Flag, Layers, Loader2, Pencil, Plus, Target, Trash2, User,
} from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isoTodayUS } from "@/lib/timezone";
import { listTaskAssignees } from "@/lib/tasks.functions";
import {
  deleteStrategyItem, getStrategy, saveInitiative, saveKeyResult, saveObjective, setInitiativeStatus, setKeyResultValue,
  type InitiativeStatus, type KrUnit, type StrategyInitiative, type StrategyKr, type StrategyObjective,
} from "@/lib/strategy.functions";

// Gerencial › Planejamento: objetivos do trimestre com resultados-chave
// (início → meta, valor atual) e iniciativas (responsável, prazo, status,
// projeto ligado). Progresso do objetivo = média dos resultados-chave; sem
// resultado-chave, a parte das iniciativas concluídas.

const quarterOf = (iso: string) => `${iso.slice(0, 4)}-T${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
const shiftQuarter = (q: string, n: number) => {
  const i = Number(q.slice(0, 4)) * 4 + Number(q.slice(6)) - 1 + n;
  return `${Math.floor(i / 4)}-T${(i % 4) + 1}`;
};
const quarterLabel = (q: string) => `${q.slice(6)}º trimestre de ${q.slice(0, 4)}`;
const quarterEnd = (q: string) => {
  const m = Number(q.slice(6)) * 3;
  return new Date(Date.UTC(Number(q.slice(0, 4)), m, 0)).toISOString().slice(0, 10);
};

const fmtVal = (v: number, u: KrUnit) =>
  u === "usd" ? `US$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`
  : u === "pct" ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
  : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const krProgress = (k: StrategyKr) => {
  const span = k.target_value - k.start_value;
  if (span === 0) return k.current_value >= k.target_value ? 1 : 0;
  return Math.max(0, Math.min(1, (k.current_value - k.start_value) / span));
};
const objProgress = (o: StrategyObjective) => {
  if (o.krs.length) return o.krs.reduce((s, k) => s + krProgress(k), 0) / o.krs.length;
  if (o.initiatives.length) return o.initiatives.filter((i) => i.status === "concluida").length / o.initiatives.length;
  return 0;
};
const tone = (p: number) => (p >= 0.7 ? "text-emerald-600" : p >= 0.4 ? "text-amber-600" : "text-rose-600");
const barTone = (p: number) => (p >= 0.7 ? "bg-emerald-500" : p >= 0.4 ? "bg-amber-500" : "bg-rose-500");
const pct = (p: number) => `${Math.round(p * 100)}%`;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const STATUS: Record<InitiativeStatus, { label: string; icon: any; cls: string; next: InitiativeStatus }> = {
  a_fazer: { label: "A fazer", icon: Circle, cls: "text-muted-foreground", next: "em_andamento" },
  em_andamento: { label: "Em andamento", icon: CircleDot, cls: "text-sky-600", next: "concluida" },
  concluida: { label: "Concluída", icon: Check, cls: "text-emerald-600", next: "a_fazer" },
};

function Ring({ value, size = 44 }: { value: number; size?: number }) {
  const r = 18, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 44 44" className="size-full -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`}
          className={value >= 0.7 ? "stroke-emerald-500" : value >= 0.4 ? "stroke-amber-500" : "stroke-rose-500"} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums">{pct(value)}</span>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
);

type Editing =
  | { kind: "objective"; item?: StrategyObjective }
  | { kind: "kr"; objectiveId: string; item?: StrategyKr }
  | { kind: "initiative"; objectiveId: string; item?: StrategyInitiative };

export function StrategyView() {
  const [quarter, setQuarter] = useState(() => quarterOf(isoTodayUS()));
  const [editing, setEditing] = useState<Editing | null>(null);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const fn = useServerFn(getStrategy);
  const membersFn = useServerFn(listTaskAssignees);
  const q = useQuery({ queryKey: ["strategy", quarter], queryFn: () => fn({ data: { quarter } }), placeholderData: keepPreviousData });
  const members = useQuery({ queryKey: ["task-assignees"], queryFn: () => membersFn(), staleTime: 10 * 60_000 });
  const nameOf = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.name])), [members.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["strategy"] });

  const delFn = useServerFn(deleteStrategyItem);
  const statusFn = useServerFn(setInitiativeStatus);
  const valueFn = useServerFn(setKeyResultValue);
  const onErr = (e: Error) => toast.error(e.message);
  const del = useMutation({ mutationFn: (v: { kind: "objective" | "kr" | "initiative"; id: string }) => delFn({ data: v }), onSuccess: refresh, onError: onErr });
  const setStatus = useMutation({ mutationFn: (v: { id: string; status: InitiativeStatus }) => statusFn({ data: v }), onSuccess: refresh, onError: onErr });
  const setValue = useMutation({ mutationFn: (v: { id: string; current_value: number }) => valueFn({ data: v }), onSuccess: refresh, onError: onErr });

  const remove = async (kind: "objective" | "kr" | "initiative", id: string, what: string) => {
    if (await confirm({ title: `Excluir ${what}?`, description: kind === "objective" ? "Os resultados-chave e as iniciativas dele também saem." : undefined, confirmText: "Excluir", variant: "destructive" })) {
      del.mutate({ kind, id });
    }
  };

  const objs = q.data?.objectives ?? [];
  const today = isoTodayUS();
  const allInits = objs.flatMap((o) => o.initiatives);
  const late = allInits.filter((i) => i.status !== "concluida" && i.due_date && i.due_date < today).length;
  const overall = objs.length ? objs.reduce((s, o) => s + objProgress(o), 0) / objs.length : 0;
  // Quanto do trimestre já passou (pra comparar com o progresso).
  const qStart = `${quarter.slice(0, 4)}-${String((Number(quarter.slice(6)) - 1) * 3 + 1).padStart(2, "0")}-01`;
  const qEnd = quarterEnd(quarter);
  const elapsed = Math.max(0, Math.min(1, (Date.parse(today) - Date.parse(qStart)) / (Date.parse(qEnd) - Date.parse(qStart) + 86_400_000)));

  return (
    <div className="space-y-4">
      {/* Trimestre e resumo */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-xl border border-border bg-card h-9">
          <button onClick={() => setQuarter((x) => shiftQuarter(x, -1))} className="h-full px-2 text-muted-foreground hover:text-foreground" aria-label="Trimestre anterior"><ChevronLeft className="size-4" /></button>
          <span className="px-2 text-xs font-semibold whitespace-nowrap min-w-[150px] text-center">{quarterLabel(quarter)}</span>
          <button onClick={() => setQuarter((x) => shiftQuarter(x, 1))} className="h-full px-2 text-muted-foreground hover:text-foreground" aria-label="Próximo trimestre"><ChevronRight className="size-4" /></button>
        </div>
        {objs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="h-9 px-3 rounded-xl border border-border bg-card inline-flex items-center gap-1.5">
              Progresso <b className={`tabular-nums ${tone(overall)}`}>{pct(overall)}</b>
              {quarter === quarterOf(today) && <span className="text-muted-foreground">· {pct(elapsed)} do tri passou</span>}
            </span>
            <span className="h-9 px-3 rounded-xl border border-border bg-card inline-flex items-center gap-1.5">
              Iniciativas <b className="tabular-nums">{allInits.filter((i) => i.status === "concluida").length}/{allInits.length}</b>
            </span>
            {late > 0 && <span className="h-9 px-3 rounded-xl bg-rose-500/10 text-rose-600 font-semibold inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" />{late} atrasada{late > 1 ? "s" : ""}</span>}
          </div>
        )}
        <button onClick={() => setEditing({ kind: "objective" })}
          className="ml-auto h-9 px-3.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5">
          <Plus className="size-4" /> Objetivo
        </button>
      </div>

      {q.isLoading ? <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError ? <div className="py-20 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>
        : !objs.length ? (
          <div className="rounded-3xl border border-dashed border-border bg-card py-14 grid place-items-center text-center px-4">
            <span className="size-11 rounded-2xl grid place-items-center bg-primary/10 text-primary mb-3"><Target className="size-5" /></span>
            <p className="text-sm font-semibold">Nenhum objetivo no {quarterLabel(quarter)}</p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">Defina 2 a 4 objetivos, cada um com resultados-chave medidos e as iniciativas que vão fazer ele andar.</p>
            <button onClick={() => setEditing({ kind: "objective" })} className="mt-4 h-9 px-3.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground inline-flex items-center gap-1.5">
              <Plus className="size-4" /> Criar objetivo
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {objs.map((o, idx) => {
              const p = objProgress(o);
              return (
                <div key={o.id} className="rounded-2xl sm:rounded-3xl border border-border bg-card">
                  {/* Cabeçalho do objetivo */}
                  <div className="flex items-start gap-3 p-4 sm:px-5 border-b border-border/60">
                    <Ring value={p} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Objetivo {idx + 1}</p>
                      <p className="text-sm sm:text-base font-semibold leading-snug">{o.title}</p>
                      {o.description && <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>}
                    </div>
                    {o.owner_id && (
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium shrink-0"><User className="size-3" />{nameOf.get(o.owner_id) ?? "—"}</span>
                    )}
                    <div className="flex items-center shrink-0">
                      <button onClick={() => setEditing({ kind: "objective", item: o })} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted" title="Editar"><Pencil className="size-3.5" /></button>
                      <button onClick={() => remove("objective", o.id, "objetivo")} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10" title="Excluir"><Trash2 className="size-3.5" /></button>
                    </div>
                  </div>

                  <div className="grid lg:grid-cols-2 lg:divide-x divide-border/60">
                    {/* Resultados-chave */}
                    <div className="p-4 sm:px-5">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Flag className="size-3.5 text-primary" /> Resultados-chave</p>
                      <div className="space-y-1">
                        {o.krs.map((k) => {
                          const kp = krProgress(k);
                          return (
                            <div key={k.id} className="group rounded-xl px-2 py-1.5 -mx-2 hover:bg-muted/40">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-medium flex-1 min-w-0 truncate" title={k.title}>{k.title}</p>
                                <KrValue kr={k} onSave={(v) => setValue.mutate({ id: k.id, current_value: v })} />
                                <span className="text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">/ {fmtVal(k.target_value, k.unit)}</span>
                                <span className={`text-[11px] font-semibold tabular-nums w-9 text-right ${tone(kp)}`}>{pct(kp)}</span>
                                <div className="flex opacity-0 group-hover:opacity-100 max-md:opacity-100">
                                  <button onClick={() => setEditing({ kind: "kr", objectiveId: o.id, item: k })} className="size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground"><Pencil className="size-3" /></button>
                                  <button onClick={() => remove("kr", k.id, "resultado-chave")} className="size-6 rounded grid place-items-center text-muted-foreground hover:text-rose-600"><Trash2 className="size-3" /></button>
                                </div>
                              </div>
                              <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden"><div className={`h-full rounded-full ${barTone(kp)}`} style={{ width: `${kp * 100}%` }} /></div>
                            </div>
                          );
                        })}
                      </div>
                      <button onClick={() => setEditing({ kind: "kr", objectiveId: o.id })} className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline"><Plus className="size-3.5" /> Resultado-chave</button>
                    </div>

                    {/* Iniciativas */}
                    <div className="p-4 sm:px-5 border-t lg:border-t-0 border-border/60">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Layers className="size-3.5 text-primary" /> Iniciativas</p>
                      <div className="space-y-0.5">
                        {o.initiatives.map((i) => {
                          const st = STATUS[i.status];
                          const isLate = i.status !== "concluida" && !!i.due_date && i.due_date < today;
                          return (
                            <div key={i.id} className="group flex items-center gap-2 rounded-xl px-2 py-1.5 -mx-2 hover:bg-muted/40">
                              <button onClick={() => setStatus.mutate({ id: i.id, status: st.next })} title={`${st.label} — clique pra mudar`}
                                className={`size-5 shrink-0 rounded-full grid place-items-center ${i.status === "concluida" ? "bg-emerald-500 text-white" : st.cls}`}>
                                <st.icon className={i.status === "concluida" ? "size-3" : "size-4"} />
                              </button>
                              <div className="min-w-0 flex-1">
                                <p className={`text-xs font-medium truncate ${i.status === "concluida" ? "line-through text-muted-foreground" : ""}`} title={i.title}>{i.title}</p>
                                {(i.project || i.owner_id) && (
                                  <p className="text-[10px] text-muted-foreground truncate">
                                    {i.owner_id && <span>{nameOf.get(i.owner_id) ?? "—"}</span>}
                                    {i.owner_id && i.project && <span> · </span>}
                                    {i.project && <span>Projeto {i.project.name} ({i.project.progress}%)</span>}
                                  </p>
                                )}
                              </div>
                              {i.due_date && (
                                <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 whitespace-nowrap tabular-nums ${isLate ? "bg-rose-500/10 text-rose-600" : "bg-muted text-muted-foreground"}`}>{dm(i.due_date)}</span>
                              )}
                              <div className="flex opacity-0 group-hover:opacity-100 max-md:opacity-100">
                                <button onClick={() => setEditing({ kind: "initiative", objectiveId: o.id, item: i })} className="size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground"><Pencil className="size-3" /></button>
                                <button onClick={() => remove("initiative", i.id, "iniciativa")} className="size-6 rounded grid place-items-center text-muted-foreground hover:text-rose-600"><Trash2 className="size-3" /></button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <button onClick={() => setEditing({ kind: "initiative", objectiveId: o.id })} className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline"><Plus className="size-3.5" /> Iniciativa</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {editing && (
        <EditDialog editing={editing} quarter={quarter} members={members.data ?? []} projects={q.data?.projects ?? []}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
    </div>
  );
}

// Valor atual do resultado-chave: clique pra editar na linha.
function KrValue({ kr, onSave }: { kr: StrategyKr; onSave: (v: number) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (edit == null) {
    return (
      <button onClick={() => setEdit(String(kr.current_value))} title="Atualizar valor atual"
        className="text-xs font-semibold tabular-nums whitespace-nowrap rounded-md px-1.5 py-0.5 hover:bg-background border border-transparent hover:border-border">
        {fmtVal(kr.current_value, kr.unit)}
      </button>
    );
  }
  const commit = () => {
    const v = Number(edit.replace(",", "."));
    if (Number.isFinite(v) && v !== kr.current_value) onSave(v);
    setEdit(null);
  };
  return (
    <input autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(null); }}
      inputMode="decimal" className="w-20 h-6 rounded-md border border-primary bg-background px-1.5 text-xs font-semibold tabular-nums outline-none" />
  );
}

function EditDialog({ editing, quarter, members, projects, onClose, onSaved }: {
  editing: Editing; quarter: string; members: { id: string; name: string }[]; projects: { id: string; name: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const objFn = useServerFn(saveObjective);
  const krFn = useServerFn(saveKeyResult);
  const initFn = useServerFn(saveInitiative);
  const it: any = editing.item ?? {};
  const [title, setTitle] = useState<string>(it.title ?? "");
  const [description, setDescription] = useState<string>(it.description ?? "");
  const [owner, setOwner] = useState<string>(it.owner_id ?? "");
  const [unit, setUnit] = useState<KrUnit>(it.unit ?? "numero");
  const [start, setStart] = useState<string>(it.start_value != null ? String(it.start_value) : "0");
  const [target, setTarget] = useState<string>(it.target_value != null ? String(it.target_value) : "");
  const [current, setCurrent] = useState<string>(it.current_value != null ? String(it.current_value) : "0");
  const [due, setDue] = useState<string>(it.due_date ?? "");
  const [status, setStatusV] = useState<InitiativeStatus>(it.status ?? "a_fazer");
  const [project, setProject] = useState<string>(it.project?.id ?? "");
  const n = (s: string) => Number(s.replace(",", "."));

  const save = useMutation({
    mutationFn: async () => {
      if (editing.kind === "objective") {
        return objFn({ data: { id: editing.item?.id, quarter: editing.item?.quarter ?? quarter, title, description: description || null, owner_id: owner || null } });
      }
      if (editing.kind === "kr") {
        if (!Number.isFinite(n(target)) || target.trim() === "") throw new Error("Informe a meta");
        return krFn({ data: { id: editing.item?.id, objective_id: editing.objectiveId, title, unit, start_value: n(start) || 0, target_value: n(target), current_value: n(current) || 0 } });
      }
      return initFn({ data: { id: editing.item?.id, objective_id: editing.objectiveId, title, owner_id: owner || null, due_date: due || null, status, project_id: project || null } });
    },
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  });

  const heading = { objective: "objetivo", kr: "resultado-chave", initiative: "iniciativa" }[editing.kind];
  const placeholder = {
    objective: "Ex.: Reduzir reembolsos e chargebacks",
    kr: "Ex.: Taxa de reembolso abaixo de",
    initiative: "Ex.: Trocar fornecedor do produto X",
  }[editing.kind];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{editing.item ? "Editar" : "Novo"} {heading}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (title.trim()) save.mutate(); }}>
          <Field label="Título"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} className={inputCls} maxLength={160} /></Field>
          {editing.kind === "objective" && (
            <Field label="Por que importa (opcional)"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none" /></Field>
          )}
          {editing.kind === "kr" && (
            <>
              <Field label="Unidade">
                <select value={unit} onChange={(e) => setUnit(e.target.value as KrUnit)} className={inputCls}>
                  <option value="numero">Número</option><option value="pct">Porcentagem (%)</option><option value="usd">Dinheiro (US$)</option>
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Início"><input value={start} onChange={(e) => setStart(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
                <Field label="Atual"><input value={current} onChange={(e) => setCurrent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
                <Field label="Meta"><input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              </div>
              <p className="text-[11px] text-muted-foreground">Pra meta de baixar (ex.: reembolso de 8% pra 4%), coloque início 8 e meta 4.</p>
            </>
          )}
          {editing.kind !== "kr" && (
            <Field label="Responsável">
              <select value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls}>
                <option value="">Ninguém</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          )}
          {editing.kind === "initiative" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Prazo"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} /></Field>
                <Field label="Status">
                  <select value={status} onChange={(e) => setStatusV(e.target.value as InitiativeStatus)} className={inputCls}>
                    {(Object.keys(STATUS) as InitiativeStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Projeto ligado (opcional)">
                <select value={project} onChange={(e) => setProject(e.target.value)} className={inputCls}>
                  <option value="">Nenhum</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </>
          )}
          <DialogFooter className="pt-1">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-xl text-xs font-medium bg-muted hover:bg-muted/70">Cancelar</button>
            <button type="submit" disabled={!title.trim() || save.isPending}
              className="h-9 px-4 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Check, ChevronDown, ChevronRight, Circle, CheckCircle2, Copy, Download, FileText,
  LayoutTemplate, ListChecks, Loader2, Pencil, Plus, ScrollText, Settings2, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { listTaskAssignees } from "@/lib/tasks.functions";
import {
  getProduction, setProductionValue, createProductionTask, updateProductionTask, deleteProductionTask,
  applyProductionTemplate,
  createProductionUpload, registerProductionFile, getProductionFileUrl, deleteProductionFile,
  saveProductionPolicy, deleteProductionPolicy,
  type ChecklistItem, type ProductionKind, type ProductionField, type ProductionPolicy, type ProductionTask,
} from "@/lib/store-production.functions";

type Assignee = { id: string; name: string; avatar_url: string | null };
type TaskPatch = Partial<Pick<ProductionTask, "title" | "description" | "assignee_id" | "due_date" | "done" | "checklist">>;

const newId = () => crypto.randomUUID();
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
const fmtSize = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

type Target = { kind: ProductionKind; id: string };

export function ProductionTab({ kind, targetId }: { kind: ProductionKind; targetId: string }) {
  const target: Target = { kind, id: targetId };
  const qc = useQueryClient();
  const queryKey = ["production", kind, targetId];
  const getFn = useServerFn(getProduction);
  const assigneesFn = useServerFn(listTaskAssignees);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getFn({ data: { kind, target_id: targetId } }),
  });
  const { data: assignees = [] } = useQuery({ queryKey: ["task-assignees"], queryFn: () => assigneesFn(), staleTime: 5 * 60_000 });

  const refresh = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["production-progress"] });
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as any)?.message ?? "Não foi possível carregar a produção."}</p>;

  const done = data.tasks.filter((t) => t.done).length;
  const total = data.tasks.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {total > 0 ? (
            <>
              <div className="flex items-baseline justify-between text-xs mb-1">
                <span className="font-medium">{done === total ? "Produção concluída" : "Progresso"}</span>
                <span className="text-muted-foreground tabular-nums">{done}/{total} etapas</span>
              </div>
              <ProgressBar value={done} total={total} />
            </>
          ) : <p className="text-xs text-muted-foreground">Nenhuma etapa de produção.</p>}
        </div>
        <ApplyTemplateMenu target={target} presets={data.presets} onApplied={refresh} />
      </div>

      <InfoSection target={target} fields={data.fields} values={data.values} onSaved={refresh} />
      <TasksSection target={target} tasks={data.tasks} assignees={assignees} queryKey={queryKey} onChanged={refresh} />
      <FilesSection target={target} files={data.files} onChanged={refresh} />
      <PoliciesSection target={target} policies={data.policies} onChanged={refresh} />
    </div>
  );
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Preenche campos vazios, adiciona etapas e acessos que faltam — nunca apaga.
function ApplyTemplateMenu({ target, presets, onApplied }: {
  target: Target; presets: { id: string; name: string; is_default: boolean }[]; onApplied: () => void;
}) {
  const qc = useQueryClient();
  const applyFn = useServerFn(applyProductionTemplate);
  const apply = useMutation({
    mutationFn: (preset: { id: string; name: string }) => applyFn({ data: { kind: target.kind, target_id: target.id, preset_id: preset.id } }),
    onSuccess: (_, preset) => {
      onApplied();
      if (target.kind === "store") qc.invalidateQueries({ queryKey: ["store-credentials", target.id] });
      toast.success(`Template "${preset.name}" aplicado`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={apply.isPending}
          className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted shrink-0 disabled:opacity-50"
        >
          {apply.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <LayoutTemplate className="size-3.5" />} Aplicar template
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {presets.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => apply.mutate(p)}>
            <span className="flex-1 truncate">{p.name}</span>
            {p.is_default && <span className="text-[10px] text-muted-foreground">padrão</span>}
          </DropdownMenuItem>
        ))}
        {presets.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum template criado.</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/templates" search={{ tipo: target.kind === "product" ? "produtos" : "lojas" }}><Settings2 className="size-3.5" /> Gerenciar templates</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <h3 className="text-sm font-semibold">{children}</h3>
      {action}
    </div>
  );
}

// ── Informações ──

function InfoSection({ target, fields, values, onSaved }: {
  target: Target; fields: ProductionField[]; values: Record<string, string>; onSaved: () => void;
}) {
  const setFn = useServerFn(setProductionValue);
  const save = useMutation({
    mutationFn: (input: { field_id: string; value: string }) => setFn({ data: { ...input, kind: target.kind, target_id: target.id } }),
    onSuccess: onSaved,
    onError: (e: any) => toast.error(e.message),
  });

  if (fields.length === 0) return null;
  return (
    <section>
      <SectionTitle>Informações</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
        {fields.map((f) => (
          <FieldInput key={f.id} field={f} value={values[f.id] ?? ""} onSave={(value) => save.mutate({ field_id: f.id, value })} />
        ))}
      </div>
    </section>
  );
}

// Campo Moeda: grava em dólar com 2 casas ("1234.50"). Aceita "12,50",
// "1,234.50", "1.234,50", "$ 99"... — o último separador é o decimal.
// Texto que não é número fica como foi digitado.
export function normalizeUsd(raw: string): string {
  const t = raw.replace(/[$\s]|US/gi, "");
  if (!t) return "";
  const decimalComma = t.lastIndexOf(",") > t.lastIndexOf(".");
  const n = Number(decimalComma ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : raw.trim();
}
const fmtUsdField = (v: string) => {
  const n = Number(v);
  return v && Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v;
};

function FieldInput({ field, value, onSave }: { field: ProductionField; value: string; onSave: (v: string) => void }) {
  const currency = field.type === "currency";
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => {
    setFocused(false);
    const next = currency ? normalizeUsd(text) : text.trim();
    setText(next);
    if (next !== value) onSave(next);
  };
  const copy = () => {
    navigator.clipboard.writeText(text.trim()).then(
      () => toast.success(`${field.label} copiado`),
      () => toast.error("Não foi possível copiar"),
    );
  };

  return (
    <label className="block min-w-0">
      <span className="text-xs text-muted-foreground">{field.label}</span>
      <div className="group relative mt-1">
        {currency && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>}
        <input
          value={currency && !focused ? fmtUsdField(text) : text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          type={field.type === "email" ? "email" : "text"}
          inputMode={currency ? "decimal" : undefined}
          className={`w-full h-9 pr-9 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 ${currency ? "pl-7 tabular-nums" : "pl-3"}`}
        />
        {text.trim() && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); copy(); }}
            title="Copiar"
            className="absolute right-1 top-1/2 -translate-y-1/2 size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Copy className="size-3.5" />
          </button>
        )}
      </div>
    </label>
  );
}

// ── Etapas ──

function TasksSection({ target, tasks, assignees, queryKey, onChanged }: {
  target: Target; tasks: ProductionTask[]; assignees: Assignee[]; queryKey: unknown[]; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const createFn = useServerFn(createProductionTask);
  const updateFn = useServerFn(updateProductionTask);
  const deleteFn = useServerFn(deleteProductionTask);
  const [newTitle, setNewTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (title: string) => createFn({ data: { kind: target.kind, target_id: target.id, title } }),
    onSuccess: () => { setNewTitle(""); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });
  // Otimista: marcar etapa/checklist responde na hora.
  const update = useMutation({
    mutationFn: (input: { id: string; patch: TaskPatch }) => updateFn({ data: { ...input, kind: target.kind } }),
    onMutate: ({ id, patch }) => {
      qc.setQueryData(queryKey, (old: any) => old && {
        ...old, tasks: old.tasks.map((t: ProductionTask) => (t.id === id ? { ...t, ...patch } : t)),
      });
    },
    onSettled: onChanged,
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { kind: target.kind, id } }),
    onSuccess: onChanged,
    onError: (e: any) => toast.error(e.message),
  });
  const assigneeById = new Map(assignees.map((a) => [a.id, a]));

  return (
    <section>
      <SectionTitle>Etapas</SectionTitle>
      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">Essa loja ainda não tem etapas. Use "Aplicar template" ou adicione abaixo.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              open={openId === t.id}
              onToggleOpen={() => setOpenId(openId === t.id ? null : t.id)}
              assignee={t.assignee_id ? assigneeById.get(t.assignee_id) : undefined}
              assignees={assignees}
              onPatch={(patch) => update.mutate({ id: t.id, patch })}
              onDelete={() => confirm(`Excluir a etapa "${t.title}"?`).then((ok) => { if (ok) remove.mutate(t.id); })}
            />
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); if (newTitle.trim()) create.mutate(newTitle.trim()); }}
        className="mt-2 flex items-center gap-2"
      >
        <Plus className="size-4 text-muted-foreground shrink-0 ml-3" />
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Adicionar etapa"
          className="flex-1 h-9 px-2 rounded-lg bg-transparent text-sm outline-none focus:bg-background focus:border focus:border-primary/50"
        />
      </form>
    </section>
  );
}

function TaskRow({ task, open, onToggleOpen, assignee, assignees, onPatch, onDelete }: {
  task: ProductionTask; open: boolean; onToggleOpen: () => void; assignee: Assignee | undefined; assignees: Assignee[];
  onPatch: (patch: TaskPatch) => void; onDelete: () => void;
}) {
  const checked = task.checklist.filter((c) => c.done).length;
  const setChecklist = (checklist: ChecklistItem[]) => {
    // Último item marcado conclui a etapa; desmarcar reabre.
    const allDone = checklist.length > 0 && checklist.every((c) => c.done);
    onPatch({ checklist, ...(allDone !== task.done && checklist.length > 0 ? { done: allDone } : {}) });
  };

  return (
    <div className={open ? "bg-muted/20" : ""}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          onClick={() => onPatch({ done: !task.done })}
          title={task.done ? "Reabrir" : "Concluir"}
          className={`shrink-0 ${task.done ? "text-emerald-500" : "text-muted-foreground hover:text-primary"}`}
        >
          {task.done ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" strokeDasharray="3 3" />}
        </button>
        <button onClick={onToggleOpen} className="flex-1 min-w-0 flex items-center gap-2 text-left">
          <span className={`text-sm truncate ${task.done ? "line-through text-muted-foreground" : "font-medium"}`}>{task.title}</span>
          {task.checklist.length > 0 && (
            <span className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
              <ListChecks className="size-3.5" /> {checked}/{task.checklist.length}
            </span>
          )}
          {task.description && <FileText className="size-3.5 text-muted-foreground shrink-0" />}
        </button>
        {task.due_date && <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtDate(task.due_date)}</span>}
        <Avatar person={assignee} />
        <button onClick={onToggleOpen} className="size-6 grid place-items-center text-muted-foreground shrink-0">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      </div>
      {open && (
        <div className="px-3 pb-3 pl-10 space-y-3">
          <TextArea
            value={task.description ?? ""}
            placeholder="Descrição, instruções..."
            onSave={(v) => onPatch({ description: v || null })}
          />
          <ChecklistEditor items={task.checklist} onChange={setChecklist} />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={task.assignee_id ?? ""}
              onChange={(e) => onPatch({ assignee_id: e.target.value || null })}
              className="h-8 px-2 rounded-lg border border-border bg-background text-xs outline-none"
            >
              <option value="">Sem responsável</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input
              type="date"
              value={task.due_date ?? ""}
              onChange={(e) => onPatch({ due_date: e.target.value || null })}
              className="h-8 px-2 rounded-lg border border-border bg-background text-xs outline-none"
            />
            <button onClick={onDelete} className="ml-auto h-8 px-2.5 rounded-lg text-xs text-destructive hover:bg-destructive/10 flex items-center gap-1.5">
              <Trash2 className="size-3.5" /> Excluir etapa
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ person }: { person: Assignee | undefined }) {
  if (!person) return <span className="size-6 rounded-full border border-dashed border-border shrink-0" />;
  return person.avatar_url ? (
    <img src={person.avatar_url} alt={person.name} title={person.name} className="size-6 rounded-full object-cover shrink-0" />
  ) : (
    <span title={person.name} className="size-6 rounded-full bg-foreground text-background text-[9px] font-semibold grid place-items-center shrink-0">
      {initials(person.name)}
    </span>
  );
}

function TextArea({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== value) onSave(text.trim()); }}
      placeholder={placeholder}
      rows={2}
      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 resize-y"
    />
  );
}

function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    onChange([...items, { id: newId(), text: text.trim(), done: false }]);
    setText("");
  };
  return (
    <div className="space-y-1">
      {items.map((c) => (
        <div key={c.id} className="group flex items-start gap-2 py-0.5">
          <input
            type="checkbox"
            checked={c.done}
            onChange={() => onChange(items.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))}
            className="size-4 mt-0.5 accent-primary shrink-0"
          />
          <span className={`flex-1 min-w-0 break-words text-sm ${c.done ? "line-through text-muted-foreground" : ""}`}>{c.text}</span>
          <button
            onClick={() => onChange(items.filter((x) => x.id !== c.id))}
            className="size-6 rounded grid place-items-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
            title="Remover item"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-start gap-2">
        <Plus className="size-4 mt-1.5 text-muted-foreground shrink-0" />
        <AutoTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="Adicionar item do checklist"
          className="flex-1 min-w-0 py-1 bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  );
}

// ── Arquivos ──

function FilesSection({ target, files, onChanged }: {
  target: Target; files: FileRow[]; onChanged: () => void;
}) {
  const createUploadFn = useServerFn(createProductionUpload);
  const registerFn = useServerFn(registerProductionFile);
  const urlFn = useServerFn(getProductionFileUrl);
  const deleteFn = useServerFn(deleteProductionFile);
  return (
    <FilesManager
      files={files}
      emptyText="Tema, logo, imagens... tudo que a loja precisa fica aqui."
      onChanged={onChanged}
      upload={async (file) => {
        const { path, token } = await createUploadFn({ data: { kind: target.kind, target_id: target.id, name: file.name } });
        const { error } = await supabase.storage.from("store-production").uploadToSignedUrl(path, token, file, {
          contentType: file.type || undefined,
        });
        if (error) throw error;
        await registerFn({ data: { kind: target.kind, target_id: target.id, path, name: file.name, size: file.size, mime: file.type || null } });
      }}
      urlFor={async (id) => (await urlFn({ data: { kind: target.kind, id } })).url}
      remove={async (id) => { await deleteFn({ data: { kind: target.kind, id } }); }}
    />
  );
}

type FileRow = { id: string; name: string; size: number; created_at: string };

export function FilesManager({ files, emptyText, onChanged, upload, urlFor, remove }: {
  files: FileRow[]; emptyText: string; onChanged: () => void;
  upload: (file: File) => Promise<void>; urlFor: (id: string) => Promise<string>; remove: (id: string) => Promise<void>;
}) {
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  const send = async (list: FileList | null) => {
    if (!list?.length) return;
    const all = Array.from(list);
    setUploading(all.length);
    for (const file of all) {
      try {
        await upload(file);
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "erro ao enviar"}`);
      }
      setUploading((n) => n - 1);
    }
    onChanged();
  };

  const download = async (id: string) => {
    try {
      window.open(await urlFor(id), "_blank");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const askRemove = (f: { id: string; name: string }) => {
    confirm(`Excluir o arquivo "${f.name}"?`).then(async (ok) => {
      if (!ok) return;
      try { await remove(f.id); onChanged(); } catch (e: any) { toast.error(e.message); }
    });
  };

  return (
    <section>
      <SectionTitle
        action={
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading > 0}
            className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
          >
            {uploading > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {uploading > 0 ? `Enviando (${uploading})...` : "Enviar arquivos"}
          </button>
        }
      >
        Arquivos
      </SectionTitle>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {files.map((f) => (
            <div key={f.id} className="group rounded-xl border border-border bg-card px-3 py-2 flex items-center gap-3">
              <FileText className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{f.name}</p>
                <p className="text-[11px] text-muted-foreground">{fmtSize(f.size)} · {fmtDate(f.created_at.slice(0, 10))}</p>
              </div>
              <button onClick={() => download(f.id)} title="Baixar" className="size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
                <Download className="size-3.5" />
              </button>
              <button onClick={() => askRemove(f)} title="Excluir" className="size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Políticas ──

function PoliciesSection({ target, policies, onChanged }: { target: Target; policies: ProductionPolicy[]; onChanged: () => void }) {
  const confirm = useConfirm();
  const saveFn = useServerFn(saveProductionPolicy);
  const deleteFn = useServerFn(deleteProductionPolicy);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const save = useMutation({
    mutationFn: (input: { id?: string; title: string; content: string }) => saveFn({ data: { ...input, kind: target.kind, target_id: target.id } }),
    onSuccess: () => { setEditing(null); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { kind: target.kind, id } }),
    onSuccess: onChanged,
    onError: (e: any) => toast.error(e.message),
  });

  const copy = (p: ProductionPolicy) => {
    navigator.clipboard.writeText(p.content).then(
      () => toast.success(`${p.title} copiada`),
      () => toast.error("Não foi possível copiar"),
    );
  };

  return (
    <section>
      <SectionTitle action={editing !== "new" && <AddBtn onClick={() => setEditing("new")}>Política</AddBtn>}>Políticas</SectionTitle>
      <div className="space-y-1.5">
        {policies.map((p) => editing === p.id ? (
          <PolicyForm
            key={p.id}
            initial={p}
            saving={save.isPending}
            onCancel={() => setEditing(null)}
            onSave={(title, content) => save.mutate({ id: p.id, title, content })}
          />
        ) : (
          <div key={p.id} className="rounded-xl border border-border bg-card px-3 py-2 flex items-center gap-3">
            <ScrollText className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{p.title}</p>
              <p className="text-[11px] text-muted-foreground truncate">{p.content.trim() ? p.content.trim().split("\n")[0] : "Sem texto"}</p>
            </div>
            <button
              onClick={() => copy(p)}
              disabled={!p.content.trim()}
              className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-40"
            >
              <Copy className="size-3.5" /> Copiar
            </button>
            <button onClick={() => setEditing(p.id)} title="Editar" className="size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={() => confirm(`Excluir a política "${p.title}"?`).then((ok) => { if (ok) remove.mutate(p.id); })}
              title="Excluir"
              className="size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {editing === "new" && (
          <PolicyForm saving={save.isPending} onCancel={() => setEditing(null)} onSave={(title, content) => save.mutate({ title, content })} />
        )}
        {policies.length === 0 && editing !== "new" && (
          <p className="text-sm text-muted-foreground">Reembolso, privacidade, termos, envio... cada uma pronta pra copiar e colar na Shopify.</p>
        )}
      </div>
    </section>
  );
}

export function PolicyForm({ initial, saving, onSave, onCancel }: {
  initial?: ProductionPolicy; saving: boolean; onSave: (title: string, content: string) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  return (
    <div className="rounded-xl border border-primary/40 bg-card p-3 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nome (ex.: Política de Reembolso)"
        className="h-9 w-full px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Cole aqui o texto da política"
        rows={10}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 resize-y"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
          <X className="size-3.5" /> Cancelar
        </button>
        <button
          onClick={() => title.trim() && onSave(title.trim(), content)}
          disabled={saving || !title.trim()}
          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
        </button>
      </div>
    </div>
  );
}

// Campo de uma linha que quebra o texto e cresce em vez de esconder o fim
// (itens de checklist). Enter continua com quem usa (onKeyDown).
export function AutoTextarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} className={`resize-none overflow-hidden ${className}`} />;
}

export function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
      <Plus className="size-3.5" /> {children}
    </button>
  );
}

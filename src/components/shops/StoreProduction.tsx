import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Circle, CheckCircle2, Copy, Download, ExternalLink, FileText,
  ListChecks, Loader2, Pencil, Plus, ScrollText, Settings2, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { listTaskAssignees } from "@/lib/tasks.functions";
import {
  getStoreProduction, setProductionValue, createProductionTask, updateProductionTask, deleteProductionTask,
  applyProductionTemplate, getProductionTemplate, saveProductionTemplate,
  createProductionUpload, registerProductionFile, getProductionFileUrl, deleteProductionFile,
  saveProductionPolicy, deleteProductionPolicy,
  type ChecklistItem, type ProductionField, type ProductionPolicy, type ProductionTask, type ProductionTemplate,
} from "@/lib/store-production.functions";

type Assignee = { id: string; name: string; avatar_url: string | null };
type TaskPatch = Partial<Pick<ProductionTask, "title" | "description" | "assignee_id" | "due_date" | "done" | "checklist">>;

const newId = () => crypto.randomUUID();
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
const fmtSize = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function ProductionTab({ store }: { store: any }) {
  const qc = useQueryClient();
  const queryKey = ["store-production", store.id];
  const getFn = useServerFn(getStoreProduction);
  const assigneesFn = useServerFn(listTaskAssignees);
  const [editingTemplate, setEditingTemplate] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => getFn({ data: { shopify_store_id: store.id } }),
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
        <button
          onClick={() => setEditingTemplate(true)}
          className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted shrink-0"
        >
          <Settings2 className="size-3.5" /> Editar modelo
        </button>
      </div>

      <InfoSection storeId={store.id} fields={data.fields} values={data.values} onSaved={refresh} />
      <TasksSection storeId={store.id} tasks={data.tasks} assignees={assignees} queryKey={queryKey} onChanged={refresh} />
      <FilesSection storeId={store.id} files={data.files} onChanged={refresh} />
      <PoliciesSection storeId={store.id} policies={data.policies} onChanged={refresh} />

      {editingTemplate && <TemplateEditorDialog onClose={() => setEditingTemplate(false)} onSaved={refresh} />}
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

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <h3 className="text-sm font-semibold">{children}</h3>
      {action}
    </div>
  );
}

// ── Informações ──

function InfoSection({ storeId, fields, values, onSaved }: {
  storeId: string; fields: ProductionField[]; values: Record<string, string>; onSaved: () => void;
}) {
  const setFn = useServerFn(setProductionValue);
  const save = useMutation({
    mutationFn: (input: { field_id: string; value: string }) => setFn({ data: { ...input, shopify_store_id: storeId } }),
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

function FieldInput({ field, value, onSave }: { field: ProductionField; value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => { if (text.trim() !== value) onSave(text.trim()); };
  const href = !value ? null
    : field.type === "email" ? `mailto:${value}`
    : field.type === "link" ? (/^https?:\/\//i.test(value) ? value : `https://${value}`)
    : null;

  return (
    <label className="block min-w-0">
      <span className="text-xs text-muted-foreground">{field.label}</span>
      <div className="relative mt-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          type={field.type === "email" ? "email" : "text"}
          className={`w-full h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 ${href ? "pr-9" : ""}`}
        />
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir"
            className="absolute right-1 top-1/2 -translate-y-1/2 size-7 rounded-md grid place-items-center text-primary hover:bg-primary/10"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    </label>
  );
}

// ── Etapas ──

function TasksSection({ storeId, tasks, assignees, queryKey, onChanged }: {
  storeId: string; tasks: ProductionTask[]; assignees: Assignee[]; queryKey: unknown[]; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const createFn = useServerFn(createProductionTask);
  const updateFn = useServerFn(updateProductionTask);
  const deleteFn = useServerFn(deleteProductionTask);
  const applyFn = useServerFn(applyProductionTemplate);
  const [newTitle, setNewTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (title: string) => createFn({ data: { shopify_store_id: storeId, title } }),
    onSuccess: () => { setNewTitle(""); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });
  // Otimista: marcar etapa/checklist responde na hora.
  const update = useMutation({
    mutationFn: (input: { id: string; patch: TaskPatch }) => updateFn({ data: input }),
    onMutate: ({ id, patch }) => {
      qc.setQueryData(queryKey, (old: any) => old && {
        ...old, tasks: old.tasks.map((t: ProductionTask) => (t.id === id ? { ...t, ...patch } : t)),
      });
    },
    onSettled: onChanged,
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: onChanged,
    onError: (e: any) => toast.error(e.message),
  });
  const apply = useMutation({
    mutationFn: () => applyFn({ data: { shopify_store_id: storeId } }),
    onSuccess: () => {
      onChanged();
      qc.invalidateQueries({ queryKey: ["store-credentials", storeId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const assigneeById = new Map(assignees.map((a) => [a.id, a]));

  return (
    <section>
      <SectionTitle>Etapas</SectionTitle>
      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center space-y-2">
          <p className="text-sm text-muted-foreground">Essa loja ainda não tem etapas de produção.</p>
          <button
            onClick={() => apply.mutate()}
            disabled={apply.isPending}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {apply.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />} Aplicar modelo
          </button>
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
        <div key={c.id} className="group flex items-center gap-2 py-0.5">
          <input
            type="checkbox"
            checked={c.done}
            onChange={() => onChange(items.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))}
            className="size-4 accent-primary shrink-0"
          />
          <span className={`flex-1 text-sm ${c.done ? "line-through text-muted-foreground" : ""}`}>{c.text}</span>
          <button
            onClick={() => onChange(items.filter((x) => x.id !== c.id))}
            className="size-6 rounded grid place-items-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
            title="Remover item"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Plus className="size-4 text-muted-foreground shrink-0" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="Adicionar item do checklist"
          className="flex-1 h-8 bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  );
}

// ── Arquivos ──

function FilesSection({ storeId, files, onChanged }: {
  storeId: string; files: { id: string; name: string; size: number; created_at: string }[]; onChanged: () => void;
}) {
  const confirm = useConfirm();
  const createUploadFn = useServerFn(createProductionUpload);
  const registerFn = useServerFn(registerProductionFile);
  const urlFn = useServerFn(getProductionFileUrl);
  const deleteFn = useServerFn(deleteProductionFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const all = Array.from(list);
    setUploading(all.length);
    for (const file of all) {
      try {
        const { path, token } = await createUploadFn({ data: { shopify_store_id: storeId, name: file.name } });
        const { error } = await supabase.storage.from("store-production").uploadToSignedUrl(path, token, file, {
          contentType: file.type || undefined,
        });
        if (error) throw error;
        await registerFn({ data: { shopify_store_id: storeId, path, name: file.name, size: file.size, mime: file.type || null } });
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "erro ao enviar"}`);
      }
      setUploading((n) => n - 1);
    }
    onChanged();
  };

  const download = async (id: string) => {
    try {
      const { url } = await urlFn({ data: { id } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const remove = (f: { id: string; name: string }) => {
    confirm(`Excluir o arquivo "${f.name}"?`).then(async (ok) => {
      if (!ok) return;
      try { await deleteFn({ data: { id: f.id } }); onChanged(); } catch (e: any) { toast.error(e.message); }
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
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tema, logo, imagens... tudo que a loja precisa fica aqui.</p>
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
              <button onClick={() => remove(f)} title="Excluir" className="size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
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

function PoliciesSection({ storeId, policies, onChanged }: { storeId: string; policies: ProductionPolicy[]; onChanged: () => void }) {
  const confirm = useConfirm();
  const saveFn = useServerFn(saveProductionPolicy);
  const deleteFn = useServerFn(deleteProductionPolicy);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const save = useMutation({
    mutationFn: (input: { id?: string; title: string; content: string }) => saveFn({ data: { ...input, shopify_store_id: storeId } }),
    onSuccess: () => { setEditing(null); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
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

function PolicyForm({ initial, saving, onSave, onCancel }: {
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

// ── Modelo ──

function TemplateEditorDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getProductionTemplate);
  const saveFn = useServerFn(saveProductionTemplate);
  const { data } = useQuery({ queryKey: ["production-template"], queryFn: () => getFn() });
  const [tpl, setTpl] = useState<ProductionTemplate | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [newCred, setNewCred] = useState("");
  useEffect(() => { if (data && !tpl) setTpl(data); }, [data, tpl]);

  const save = useMutation({
    mutationFn: (t: ProductionTemplate) => saveFn({ data: t }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-template"] });
      onSaved();
      toast.success("Modelo salvo");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const move = <T,>(list: T[], i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  const submit = () => {
    if (!tpl) return;
    // Linhas em branco somem em vez de barrar o salvamento.
    save.mutate({
      fields: tpl.fields.filter((f) => f.label.trim()),
      tasks: tpl.tasks.filter((t) => t.title.trim()).map((t) => ({ ...t, checklist: t.checklist.filter((c) => c.text.trim()) })),
      credentials: tpl.credentials,
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modelo de produção</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Toda loja nova criada no quadro recebe essas etapas e acessos. Os campos de informação valem pra todas as lojas na hora; etapas mudadas aqui não alteram lojas que já estão em produção.
          </p>
        </DialogHeader>
        {!tpl ? (
          <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-6">
            <section>
              <SectionTitle
                action={<AddBtn onClick={() => setTpl({ ...tpl, fields: [...tpl.fields, { id: newId(), label: "", type: "text" }] })}>Campo</AddBtn>}
              >
                Campos de informação
              </SectionTitle>
              <div className="space-y-1.5">
                {tpl.fields.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-1.5">
                    <input
                      value={f.label}
                      autoFocus={!f.label}
                      onChange={(e) => setTpl({ ...tpl, fields: tpl.fields.map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)) })}
                      placeholder="Nome do campo"
                      className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50"
                    />
                    <select
                      value={f.type}
                      onChange={(e) => setTpl({ ...tpl, fields: tpl.fields.map((x) => (x.id === f.id ? { ...x, type: e.target.value as ProductionField["type"] } : x)) })}
                      className="h-9 px-2 rounded-lg border border-border bg-background text-sm outline-none"
                    >
                      <option value="text">Texto</option>
                      <option value="link">Link</option>
                      <option value="email">E-mail</option>
                    </select>
                    <RowActions
                      onUp={() => setTpl({ ...tpl, fields: move(tpl.fields, i, -1) })}
                      onDown={() => setTpl({ ...tpl, fields: move(tpl.fields, i, 1) })}
                      onRemove={() => setTpl({ ...tpl, fields: tpl.fields.filter((x) => x.id !== f.id) })}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionTitle
                action={
                  <AddBtn onClick={() => {
                    const id = newId();
                    setTpl({ ...tpl, tasks: [...tpl.tasks, { id, title: "", description: null, checklist: [] }] });
                    setOpenTask(id);
                  }}>Etapa</AddBtn>
                }
              >
                Etapas
              </SectionTitle>
              <div className="rounded-xl border border-border divide-y divide-border">
                {tpl.tasks.map((t, i) => {
                  const setTask = (patch: Partial<typeof t>) => setTpl({ ...tpl, tasks: tpl.tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) });
                  const isOpen = openTask === t.id;
                  return (
                    <div key={t.id} className="p-2">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setOpenTask(isOpen ? null : t.id)} className="size-7 grid place-items-center text-muted-foreground shrink-0">
                          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                        <input
                          value={t.title}
                          autoFocus={!t.title}
                          onChange={(e) => setTask({ title: e.target.value })}
                          placeholder="Nome da etapa"
                          className="flex-1 min-w-0 h-9 px-2 rounded-lg bg-transparent text-sm font-medium outline-none focus:bg-background focus:border focus:border-primary/50"
                        />
                        {t.checklist.length > 0 && (
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1 shrink-0"><ListChecks className="size-3.5" />{t.checklist.length}</span>
                        )}
                        <RowActions
                          onUp={() => setTpl({ ...tpl, tasks: move(tpl.tasks, i, -1) })}
                          onDown={() => setTpl({ ...tpl, tasks: move(tpl.tasks, i, 1) })}
                          onRemove={() => setTpl({ ...tpl, tasks: tpl.tasks.filter((x) => x.id !== t.id) })}
                        />
                      </div>
                      {isOpen && (
                        <div className="pl-9 pr-1 pt-2 space-y-2">
                          <textarea
                            value={t.description ?? ""}
                            onChange={(e) => setTask({ description: e.target.value || null })}
                            placeholder="Descrição, instruções..."
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 resize-y"
                          />
                          {t.checklist.map((c, ci) => (
                            <div key={c.id} className="flex items-center gap-1.5">
                              <span className="size-3.5 rounded border border-border shrink-0" />
                              <input
                                value={c.text}
                                autoFocus={!c.text}
                                onChange={(e) => setTask({ checklist: t.checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const next = [...t.checklist];
                                    next.splice(ci + 1, 0, { id: newId(), text: "" });
                                    setTask({ checklist: next });
                                  }
                                }}
                                placeholder="Item do checklist"
                                className="flex-1 min-w-0 h-8 px-2 rounded-md bg-transparent text-sm outline-none focus:bg-background"
                              />
                              <button
                                onClick={() => setTask({ checklist: t.checklist.filter((x) => x.id !== c.id) })}
                                className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-destructive"
                                title="Remover item"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => setTask({ checklist: [...t.checklist, { id: newId(), text: "" }] })}
                            className="h-7 px-1 text-xs text-muted-foreground hover:text-primary flex items-center gap-1.5"
                          >
                            <Plus className="size-3.5" /> Item do checklist
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {tpl.tasks.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhuma etapa.</p>}
              </div>
            </section>

            <section>
              <SectionTitle>Acessos</SectionTitle>
              <p className="text-xs text-muted-foreground mb-2">Criados vazios na aba Acessos da loja nova, pra só preencher login e senha.</p>
              <div className="flex flex-wrap gap-1.5">
                {tpl.credentials.map((c) => (
                  <span key={c} className="h-8 pl-3 pr-1 rounded-lg bg-muted text-sm inline-flex items-center gap-1">
                    {c}
                    <button
                      onClick={() => setTpl({ ...tpl, credentials: tpl.credentials.filter((x) => x !== c) })}
                      className="size-6 rounded grid place-items-center text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = newCred.trim();
                    if (v && !tpl.credentials.includes(v)) setTpl({ ...tpl, credentials: [...tpl.credentials, v] });
                    setNewCred("");
                  }}
                >
                  <input
                    value={newCred}
                    onChange={(e) => setNewCred(e.target.value)}
                    placeholder="+ Acesso (Enter)"
                    className="h-8 w-40 px-3 rounded-lg border border-dashed border-border bg-transparent text-sm outline-none focus:border-primary/50"
                  />
                </form>
              </div>
            </section>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
              <button
                onClick={submit}
                disabled={save.isPending}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar modelo
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
      <Plus className="size-3.5" /> {children}
    </button>
  );
}

function RowActions({ onUp, onDown, onRemove }: { onUp: () => void; onDown: () => void; onRemove: () => void }) {
  const cls = "size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground shrink-0";
  return (
    <>
      <button onClick={onUp} className={cls} title="Subir"><ArrowUp className="size-3.5" /></button>
      <button onClick={onDown} className={cls} title="Descer"><ArrowDown className="size-3.5" /></button>
      <button onClick={onRemove} className={`${cls} hover:!bg-destructive/10 hover:!text-destructive`} title="Remover"><Trash2 className="size-3.5" /></button>
    </>
  );
}

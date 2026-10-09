import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, LayoutTemplate, ListChecks, Loader2, Pencil, Plus, ScrollText, Star, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { listTaskAssignees } from "@/lib/tasks.functions";
import {
  listProductionTemplates, saveProductionFields, saveProductionPreset, deleteProductionPreset,
  createPresetUpload, registerPresetFile, getPresetFileUrl, deletePresetFile,
  type ProductionField, type ProductionFile, type ProductionKind, type ProductionPreset,
} from "@/lib/store-production.functions";
import { AddBtn, AutoTextarea, FilesManager, PolicyForm, SectionTitle, normalizeUsd } from "@/components/shops/StoreProduction";

type Draft = Omit<ProductionPreset, "id"> & { id?: string };

// Textos que mudam entre template de loja e de produto.
const COPY: Record<ProductionKind, { one: string; many: string; where: string; newOne: string }> = {
  store: { one: "loja", many: "lojas", where: "No card da loja", newOne: "toda loja nova do quadro" },
  product: { one: "produto", many: "produtos", where: "No produto", newOne: "todo produto novo" },
};

const newId = () => crypto.randomUUID();
const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const emptyDraft = (): Draft => ({ name: "", is_default: false, values: {}, tasks: [], credentials: [], policies: [] });

const move = <T,>(list: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export function ProductionTemplates({ kind }: { kind: ProductionKind }) {
  const listFn = useServerFn(listProductionTemplates);
  const QK = ["production-templates", kind];
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: () => listFn({ data: { kind } }) });
  const [selected, setSelected] = useState<string | "new" | null>(null);

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as any)?.message ?? "Não foi possível carregar os templates."}</p>;

  const current = selected === "new" ? emptyDraft() : (data.presets.find((p) => p.id === selected) ?? data.presets[0]);
  const activeId = selected === "new" ? "new" : current?.id;

  return (
    <div className="space-y-6">
      <FieldsCard kind={kind} fields={data.fields} />

      <section className="premium-card p-6">
        <SectionTitle action={<AddBtn onClick={() => setSelected("new")}>Template</AddBtn>}>Templates de produção</SectionTitle>
        <p className="text-xs text-muted-foreground mb-4">
          Valores dos campos, etapas com responsável{kind === "store" ? ", acessos, políticas" : ""} e arquivos. {COPY[kind].where}, "Aplicar template"
          preenche só os campos vazios e adiciona o que falta (pelo nome) — nada é apagado. O template padrão entra sozinho em {COPY[kind].newOne}.
        </p>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="md:w-52 shrink-0 space-y-1">
            {data.presets.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`w-full h-9 px-3 rounded-lg text-sm flex items-center gap-2 text-left ${
                  activeId === p.id ? "bg-primary/10 text-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <LayoutTemplate className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">{p.name}</span>
                {p.is_default && <Star className="size-3 fill-current text-amber-500 shrink-0" />}
              </button>
            ))}
            {selected === "new" && (
              <div className="h-9 px-3 rounded-lg text-sm flex items-center gap-2 bg-primary/10 font-medium">
                <Plus className="size-3.5" /> Novo template
              </div>
            )}
            {data.presets.length === 0 && selected !== "new" && <p className="text-sm text-muted-foreground px-1">Nenhum template.</p>}
          </div>
          <div className="flex-1 min-w-0">
            {current && (
              <PresetEditor
                key={activeId}
                kind={kind}
                initial={current}
                files={selected === "new" ? [] : ((current as { files?: ProductionFile[] }).files ?? [])}
                fields={data.fields}
                onSaved={(id) => setSelected(id)}
                onDeleted={() => setSelected(null)}
                onCancelNew={() => setSelected(null)}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Campos da ficha (iguais pra todas as lojas / todos os produtos) ──

function FieldsCard({ kind, fields }: { kind: ProductionKind; fields: ProductionField[] }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveProductionFields);
  const [list, setList] = useState(fields);
  useEffect(() => { setList(fields); }, [fields]);
  const dirty = JSON.stringify(list) !== JSON.stringify(fields);

  const save = useMutation({
    mutationFn: () => saveFn({ data: { kind, fields: list.filter((f) => f.label.trim()) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-templates", kind] });
      qc.invalidateQueries({ queryKey: ["production", kind] });
      toast.success("Campos salvos");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <section className="premium-card p-6">
      <SectionTitle action={<AddBtn onClick={() => setList([...list, { id: newId(), label: "", type: "text" }])}>Campo</AddBtn>}>
        Campos de informação
      </SectionTitle>
      <p className="text-xs text-muted-foreground mb-3">Aparecem em Informações na aba Produção de {kind === "store" ? "todas as lojas" : "todos os produtos"}.</p>
      <div className="space-y-1.5">
        {list.map((f, i) => (
          <div key={f.id} className="flex items-center gap-1.5">
            <input
              value={f.label}
              autoFocus={!f.label}
              onChange={(e) => setList(list.map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)))}
              placeholder="Nome do campo"
              className={`flex-1 min-w-0 ${inputCls}`}
            />
            <select
              value={f.type}
              onChange={(e) => setList(list.map((x) => (x.id === f.id ? { ...x, type: e.target.value as ProductionField["type"] } : x)))}
              className="h-9 px-2 rounded-lg border border-border bg-background text-sm outline-none"
            >
              <option value="text">Texto</option>
              <option value="link">Link</option>
              <option value="email">E-mail</option>
              <option value="currency">Moeda (US$)</option>
            </select>
            <RowActions
              onUp={() => setList(move(list, i, -1))}
              onDown={() => setList(move(list, i, 1))}
              onRemove={() => setList(list.filter((x) => x.id !== f.id))}
            />
          </div>
        ))}
      </div>
      {dirty && (
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={() => setList(fields)} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Descartar</button>
          <SaveBtn pending={save.isPending} onClick={() => save.mutate()}>Salvar campos</SaveBtn>
        </div>
      )}
    </section>
  );
}

// ── Template ──

function PresetEditor({ kind, initial, files, fields, onSaved, onDeleted, onCancelNew }: {
  kind: ProductionKind;
  initial: Draft; files: ProductionFile[]; fields: ProductionField[]; onSaved: (id: string) => void; onDeleted: () => void; onCancelNew: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const saveFn = useServerFn(saveProductionPreset);
  const deleteFn = useServerFn(deleteProductionPreset);
  const assigneesFn = useServerFn(listTaskAssignees);
  const { data: assignees = [] } = useQuery({ queryKey: ["task-assignees"], queryFn: () => assigneesFn(), staleTime: 5 * 60_000 });
  const [tpl, setTpl] = useState<Draft>(initial);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [newCred, setNewCred] = useState("");
  const [editingPolicy, setEditingPolicy] = useState<string | "new" | null>(null);
  const createUploadFn = useServerFn(createPresetUpload);
  const registerFileFn = useServerFn(registerPresetFile);
  const fileUrlFn = useServerFn(getPresetFileUrl);
  const deleteFileFn = useServerFn(deletePresetFile);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["production-templates", kind] });
    qc.invalidateQueries({ queryKey: ["production", kind] });
  };
  const save = useMutation({
    mutationFn: () => saveFn({
      data: {
        id: tpl.id,
        scope: kind,
        is_default: tpl.is_default,
        credentials: tpl.credentials,
        policies: tpl.policies,
        name: tpl.name.trim(),
        // Linhas em branco somem em vez de barrar o salvamento.
        values: Object.fromEntries(Object.entries(tpl.values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
        tasks: tpl.tasks.filter((t) => t.title.trim()).map((t) => ({ ...t, checklist: t.checklist.filter((c) => c.text.trim()) })),
      },
    }),
    onSuccess: ({ id }) => { refresh(); toast.success("Template salvo"); onSaved(id); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { refresh(); onDeleted(); },
    onError: (e: any) => toast.error(e.message),
  });

  const setTask = (id: string, patch: Partial<Draft["tasks"][number]>) =>
    setTpl({ ...tpl, tasks: tpl.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={tpl.name}
          autoFocus={!tpl.name}
          onChange={(e) => setTpl({ ...tpl, name: e.target.value })}
          placeholder="Nome do template"
          className={`flex-1 min-w-48 font-medium ${inputCls}`}
        />
        <label className="h-9 px-3 rounded-lg border border-border text-sm flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={tpl.is_default} onChange={(e) => setTpl({ ...tpl, is_default: e.target.checked })} className="accent-primary" />
          Padrão para {kind === "store" ? "lojas novas" : "produtos novos"}
        </label>
      </div>

      {fields.length > 0 && (
        <section>
          <SectionTitle>Informações</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
            {fields.map((f) => (
              <label key={f.id} className="block min-w-0">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <div className="relative mt-1">
                  {f.type === "currency" && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>}
                  <input
                    value={tpl.values[f.id] ?? ""}
                    onChange={(e) => setTpl({ ...tpl, values: { ...tpl.values, [f.id]: e.target.value } })}
                    onBlur={f.type === "currency" ? (e) => setTpl({ ...tpl, values: { ...tpl.values, [f.id]: normalizeUsd(e.target.value) } }) : undefined}
                    inputMode={f.type === "currency" ? "decimal" : undefined}
                    placeholder={`Deixe vazio se muda por ${COPY[kind].one}`}
                    className={`w-full ${inputCls} ${f.type === "currency" ? "pl-7 tabular-nums" : ""}`}
                  />
                </div>
              </label>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle
          action={
            <AddBtn onClick={() => {
              const id = newId();
              setTpl({ ...tpl, tasks: [...tpl.tasks, { id, title: "", description: null, assignee_id: null, checklist: [] }] });
              setOpenTask(id);
            }}>Etapa</AddBtn>
          }
        >
          Etapas
        </SectionTitle>
        <div className="rounded-xl border border-border divide-y divide-border">
          {tpl.tasks.map((t, i) => {
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
                    onChange={(e) => setTask(t.id, { title: e.target.value })}
                    placeholder="Nome da etapa"
                    className="flex-1 min-w-0 h-9 px-2 rounded-lg bg-transparent text-sm font-medium outline-none focus:bg-background focus:border focus:border-primary/50"
                  />
                  {t.checklist.length > 0 && (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1 shrink-0"><ListChecks className="size-3.5" />{t.checklist.length}</span>
                  )}
                  <select
                    value={t.assignee_id ?? ""}
                    onChange={(e) => setTask(t.id, { assignee_id: e.target.value || null })}
                    className="h-8 max-w-36 px-2 rounded-lg border border-border bg-background text-xs outline-none shrink-0"
                  >
                    <option value="">Sem responsável</option>
                    {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
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
                      onChange={(e) => setTask(t.id, { description: e.target.value || null })}
                      placeholder="Descrição, instruções..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 resize-y"
                    />
                    {t.checklist.map((c, ci) => (
                      <div key={c.id} className="flex items-start gap-1.5">
                        <span className="size-3.5 mt-2 rounded border border-border shrink-0" />
                        <AutoTextarea
                          value={c.text}
                          autoFocus={!c.text}
                          onChange={(e) => setTask(t.id, { checklist: t.checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const next = [...t.checklist];
                              next.splice(ci + 1, 0, { id: newId(), text: "" });
                              setTask(t.id, { checklist: next });
                            }
                          }}
                          placeholder="Item do checklist"
                          className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-transparent text-sm outline-none focus:bg-background"
                        />
                        <button
                          onClick={() => setTask(t.id, { checklist: t.checklist.filter((x) => x.id !== c.id) })}
                          className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-destructive"
                          title="Remover item"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setTask(t.id, { checklist: [...t.checklist, { id: newId(), text: "" }] })}
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

      {kind === "store" && <section>
        <SectionTitle>Acessos</SectionTitle>
        <p className="text-xs text-muted-foreground mb-2">Criados vazios na aba Acessos da loja, pra só preencher login e senha.</p>
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
      </section>}

      {kind === "store" && <section>
        <SectionTitle action={editingPolicy !== "new" && <AddBtn onClick={() => setEditingPolicy("new")}>Política</AddBtn>}>Políticas</SectionTitle>
        <div className="space-y-1.5">
          {tpl.policies.map((p) => editingPolicy === p.id ? (
            <PolicyForm
              key={p.id}
              initial={p}
              saving={false}
              onCancel={() => setEditingPolicy(null)}
              onSave={(title, content) => {
                setTpl({ ...tpl, policies: tpl.policies.map((x) => (x.id === p.id ? { ...x, title, content } : x)) });
                setEditingPolicy(null);
              }}
            />
          ) : (
            <div key={p.id} className="rounded-xl border border-border bg-card px-3 py-2 flex items-center gap-3">
              <ScrollText className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{p.title}</p>
                <p className="text-[11px] text-muted-foreground truncate">{p.content.trim() ? p.content.trim().split("\n")[0] : "Sem texto"}</p>
              </div>
              <button onClick={() => setEditingPolicy(p.id)} title="Editar" className="size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={() => setTpl({ ...tpl, policies: tpl.policies.filter((x) => x.id !== p.id) })}
                title="Remover"
                className="size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {editingPolicy === "new" && (
            <PolicyForm
              saving={false}
              onCancel={() => setEditingPolicy(null)}
              onSave={(title, content) => {
                setTpl({ ...tpl, policies: [...tpl.policies, { id: newId(), title, content }] });
                setEditingPolicy(null);
              }}
            />
          )}
          {tpl.policies.length === 0 && editingPolicy !== "new" && (
            <p className="text-sm text-muted-foreground">Reembolso, privacidade, termos, envio... copiadas pro card ao aplicar.</p>
          )}
        </div>
      </section>}

      {tpl.id ? (
        <FilesManager
          files={files}
          emptyText="Tema, logo, imagens... copiados pro card ao aplicar."
          onChanged={() => qc.invalidateQueries({ queryKey: ["production-templates", kind] })}
          upload={async (file) => {
            const { path, token } = await createUploadFn({ data: { preset_id: tpl.id!, name: file.name } });
            const { error } = await supabase.storage.from("store-production").uploadToSignedUrl(path, token, file, {
              contentType: file.type || undefined,
            });
            if (error) throw error;
            await registerFileFn({ data: { preset_id: tpl.id!, path, name: file.name, size: file.size, mime: file.type || null } });
          }}
          urlFor={async (id) => (await fileUrlFn({ data: { id } })).url}
          remove={async (id) => { await deleteFileFn({ data: { id } }); }}
        />
      ) : (
        <section>
          <SectionTitle>Arquivos</SectionTitle>
          <p className="text-sm text-muted-foreground">Salve o template pra enviar arquivos.</p>
        </section>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-border">
        {tpl.id ? (
          <button
            onClick={() => confirm(`Excluir o template "${initial.name}"?`).then((ok) => { if (ok) remove.mutate(tpl.id!); })}
            className="h-9 px-3 rounded-lg text-sm text-destructive hover:bg-destructive/10 flex items-center gap-1.5"
          >
            <Trash2 className="size-3.5" /> Excluir
          </button>
        ) : (
          <button onClick={onCancelNew} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
        )}
        <div className="ml-auto">
          <SaveBtn pending={save.isPending} disabled={!tpl.name.trim()} onClick={() => save.mutate()}>Salvar template</SaveBtn>
        </div>
      </div>
    </div>
  );
}

function SaveBtn({ pending, disabled, onClick, children }: { pending: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {children}
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

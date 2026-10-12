import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { History, ImagePlus, Loader2, Lock, Pencil, Plus, Settings2, Target, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AutoTextarea } from "@/components/shops/StoreProduction";
import {
  getProductDiary, saveProductDiaryFocus, addProductDiaryEntry, updateProductDiaryEntry, deleteProductDiaryEntry,
  createDiaryNoteType, updateDiaryNoteType, deleteDiaryNoteType,
  DIARY_COLORS, type DiaryColor, type DiaryEntry, type DiaryNoteType,
} from "@/lib/product-diary.functions";

// Diário do produto — mesma ideia do diário de campanha do Scalemoon: teste
// atual + última alteração no topo, filtro por tipo de nota, linha do tempo
// editável (texto, data, tipo, imagens) e "+ Adicionar registro" no fim.

const COLOR: Record<DiaryColor, { label: string; dot: string; badge: string }> = {
  gray: { label: "Cinza", dot: "bg-slate-400", badge: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  blue: { label: "Azul", dot: "bg-sky-500", badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  amber: { label: "Âmbar", dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  purple: { label: "Roxo", dot: "bg-violet-500", badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  green: { label: "Verde", dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  red: { label: "Vermelho", dot: "bg-rose-500", badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
};
const NO_TYPE = "__none";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
function fmtWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now)) return `Hoje · ${time}`;
  if (sameDay(d, yesterday)) return `Ontem · ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""} · ${time}`;
}
const daysSince = (iso: string) => {
  const start = new Date(iso); start.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - start.getTime()) / 86_400_000);
};
const daysAgoLabel = (n: number) => (n === 0 ? "hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`);
// "2026-10-12T14:30" no horário local, pro <input type="datetime-local">.
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ProductDiary({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const QK = ["product-diary", productId];
  const getFn = useServerFn(getProductDiary);
  const focusFn = useServerFn(saveProductDiaryFocus);
  const addFn = useServerFn(addProductDiaryEntry);
  const updateFn = useServerFn(updateProductDiaryEntry);
  const deleteFn = useServerFn(deleteProductDiaryEntry);
  const [filters, setFilters] = useState<string[]>([]);
  const [managing, setManaging] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: () => getFn({ data: { product_id: productId } }) });
  const refresh = () => qc.invalidateQueries({ queryKey: QK });
  const onError = (e: any) => toast.error(e.message);

  const saveFocus = useMutation({ mutationFn: (v: string | null) => focusFn({ data: { product_id: productId, current_test: v } }), onSuccess: refresh, onError });
  const add = useMutation({
    mutationFn: (v: { content: string; note_type_id: string | null; image_urls: string[] }) => addFn({ data: { product_id: productId, ...v } }),
    onSuccess: refresh, onError,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; content?: string; note_type_id?: string | null; image_urls?: string[]; created_at?: string }) => updateFn({ data: v }),
    onSuccess: refresh, onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh, onError });

  const noteTypes = data?.noteTypes ?? [];
  const entries = data?.entries ?? [];
  const systemType = noteTypes.find((t) => t.is_system);
  const lastChange = systemType ? entries.find((e) => e.note_type_id === systemType.id) : undefined;
  const filtered = useMemo(
    () => (filters.length === 0 ? entries : entries.filter((e) => filters.includes(e.note_type_id ?? NO_TYPE))),
    [entries, filters],
  );
  const toggle = (id: string) => setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Não foi possível carregar o diário."}</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-border bg-gradient-to-b from-muted/50 to-muted/20 p-3.5 space-y-3">
        <FocusField value={data.currentTest} onSave={(v) => saveFocus.mutate(v)} />
        <div className="flex items-start gap-1.5 border-t border-border/70 pt-2.5">
          <History className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Última alteração</span>
              {lastChange && (() => {
                const n = daysSince(lastChange.created_at);
                const cls = n >= 7 ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : n >= 1 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
                return <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{daysAgoLabel(n)}</span>;
              })()}
            </div>
            {lastChange ? (
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <p className="min-w-0 truncate text-[12.5px] text-foreground/90">{lastChange.content}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">{fmtWhen(lastChange.created_at)}</span>
              </div>
            ) : (
              <p className="mt-0.5 text-[12px] italic text-muted-foreground">Nenhuma alteração registrada ainda. Use o tipo "Alteração" nos registros.</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={filters.length === 0} onClick={() => setFilters([])} activeCls="bg-foreground text-background">Todos</Chip>
        <Chip active={filters.includes(NO_TYPE)} onClick={() => toggle(NO_TYPE)} activeCls="bg-muted-foreground/15 text-foreground" dot="bg-muted-foreground/50">Nota</Chip>
        {noteTypes.map((t) => (
          <Chip key={t.id} active={filters.includes(t.id)} onClick={() => toggle(t.id)} activeCls={COLOR[t.color].badge} dot={COLOR[t.color].dot}>{t.name}</Chip>
        ))}
        <button onClick={() => setManaging(true)} title="Tipos de nota" className="ml-auto size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
          <Settings2 className="size-3.5" />
        </button>
      </div>

      <EntryForm productId={productId} noteTypes={noteTypes} pending={add.isPending} onSubmit={(v) => add.mutate(v)} />

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">{entries.length ? "Nenhum registro com esse filtro." : "Nenhum registro ainda."}</p>
      ) : (
        <ol className="space-y-5 pt-1">
          {filtered.map((e) => (
            <EntryItem
              key={e.id}
              entry={e}
              productId={productId}
              noteTypes={noteTypes}
              onUpdate={(patch) => update.mutate({ id: e.id, ...patch })}
              onDelete={() => remove.mutate(e.id)}
            />
          ))}
        </ol>
      )}

      {managing && <NoteTypesDialog noteTypes={noteTypes} onChanged={refresh} onClose={() => setManaging(false)} />}
    </div>
  );
}

function Chip({ active, onClick, activeCls, dot, children }: { active: boolean; onClick: () => void; activeCls: string; dot?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${active ? activeCls : "bg-muted text-muted-foreground hover:text-foreground"}`}
    >
      {dot && <span className={`size-1.5 rounded-full ${dot}`} />}
      {children}
    </button>
  );
}

function FocusField({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const submit = () => {
    const v = draft.trim();
    if (v !== (value ?? "")) onSave(v || null);
    setEditing(false);
  };
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        <Target className="size-3" /> Teste atual
      </div>
      {editing ? (
        <AutoTextarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
          }}
          className="mt-0.5 w-full min-h-12 rounded-md border border-border bg-card p-1.5 text-[12.5px] outline-none"
        />
      ) : (
        <button
          onClick={() => { setDraft(value ?? ""); setEditing(true); }}
          className={`mt-0.5 block w-full rounded-md px-1.5 py-1 text-left text-[12.5px] leading-snug whitespace-pre-wrap hover:bg-muted ${value ? "text-foreground" : "italic text-muted-foreground/70"}`}
        >
          {value || "Ex: Página nova com oferta de 2 unidades"}
        </button>
      )}
    </div>
  );
}

// ── Imagens ──

function useImageUploads(productId: string, initial: string[] = []) {
  const [urls, setUrls] = useState<string[]>(initial);
  const [uploading, setUploading] = useState(false);
  const addFiles = async (files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const uploaded = await Promise.all(images.map(async (file) => {
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${u.user!.id}/products/${productId}/diary/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
        const { error } = await supabase.storage.from("project-attachments").upload(path, file);
        if (error) throw error;
        const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        if (!signed?.signedUrl) throw new Error("Falha ao gerar o link da imagem");
        return signed.signedUrl;
      }));
      setUrls((prev) => [...prev, ...uploaded]);
    } catch (e: any) {
      toast.error(`Erro ao enviar imagem: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) { e.preventDefault(); void addFiles(files); }
  };
  return { urls, setUrls, uploading, addFiles, onPaste };
}

function ImageButton({ uploading, onFiles }: { uploading: boolean; onFiles: (f: FileList) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={uploading} onClick={() => ref.current?.click()} title="Adicionar imagem (ou cole no texto)"
        className="size-7 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
        {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
      </button>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ""; }} />
    </>
  );
}

function ImageList({ urls, onRemove }: { urls: string[]; onRemove?: (url: string) => void }) {
  if (!urls.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {urls.map((url) => (
        <div key={url} className="group/img relative size-16 overflow-hidden rounded-md border border-border">
          <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="size-full object-cover" /></a>
          {onRemove && (
            <button onClick={() => onRemove(url)} title="Remover imagem"
              className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 opacity-0 transition-opacity group-hover/img:opacity-100">
              <X className="size-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function TypeSelect({ noteTypes, value, onChange }: { noteTypes: DiaryNoteType[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-7 px-2 rounded-md border border-border bg-background text-[12px] outline-none cursor-pointer"
    >
      <option value="">Nota (sem tipo)</option>
      {noteTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

// ── Novo registro ──

function EntryForm({ productId, noteTypes, pending, onSubmit }: {
  productId: string; noteTypes: DiaryNoteType[]; pending: boolean;
  onSubmit: (v: { content: string; note_type_id: string | null; image_urls: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [typeId, setTypeId] = useState<string | null>(null);
  const img = useImageUploads(productId);
  const close = () => { setValue(""); setTypeId(null); img.setUrls([]); setOpen(false); };
  const submit = () => {
    const v = value.trim();
    if (!v || img.uploading) return;
    onSubmit({ content: v, note_type_id: typeId, image_urls: img.urls });
    close();
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full rounded-md border border-dashed border-border px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
        + Adicionar registro
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-2.5">
      <AutoTextarea
        autoFocus
        placeholder="Análise, decisão, hipótese, próximo passo..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={img.onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") close();
        }}
        className="w-full min-h-20 bg-transparent text-[13px] outline-none"
      />
      <ImageList urls={img.urls} onRemove={(u) => img.setUrls(img.urls.filter((x) => x !== u))} />
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1">
          <ImageButton uploading={img.uploading} onFiles={img.addFiles} />
          <TypeSelect noteTypes={noteTypes} value={typeId} onChange={setTypeId} />
        </div>
        <div className="flex gap-1.5">
          <button onClick={close} className="h-7 px-3 rounded-md text-[12.5px] hover:bg-muted">Cancelar</button>
          <button onClick={submit} disabled={!value.trim() || img.uploading || pending}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[12.5px] font-medium disabled:opacity-50">Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ── Registro ──

function EntryItem({ entry, productId, noteTypes, onUpdate, onDelete }: {
  entry: DiaryEntry; productId: string; noteTypes: DiaryNoteType[];
  onUpdate: (patch: { content?: string; note_type_id?: string | null; image_urls?: string[]; created_at?: string }) => void;
  onDelete: () => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(entry.content);
  const [when, setWhen] = useState(toLocalInput(entry.created_at));
  const [typeId, setTypeId] = useState(entry.note_type_id);
  const img = useImageUploads(productId, entry.image_urls);
  const type = noteTypes.find((t) => t.id === entry.note_type_id);

  const startEdit = () => {
    setValue(entry.content); setWhen(toLocalInput(entry.created_at)); setTypeId(entry.note_type_id); img.setUrls(entry.image_urls);
    setEditing(true);
  };
  const submit = () => {
    const patch: Parameters<typeof onUpdate>[0] = {};
    const v = value.trim();
    if (v && v !== entry.content) patch.content = v;
    if (JSON.stringify(img.urls) !== JSON.stringify(entry.image_urls)) patch.image_urls = img.urls;
    if (typeId !== entry.note_type_id) patch.note_type_id = typeId;
    if (when && when !== toLocalInput(entry.created_at)) patch.created_at = new Date(when).toISOString();
    if (Object.keys(patch).length) onUpdate(patch);
    setEditing(false);
  };

  return (
    <li className="group/entry relative pl-4">
      <span className={`absolute left-0 top-[7px] size-1.5 rounded-full ${type ? COLOR[type.color].dot : "bg-muted-foreground/50"}`} />
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5 text-[11.5px] text-muted-foreground min-w-0">
          <span>{fmtWhen(entry.created_at)}</span>
          {entry.edited_at && <span className="text-[10.5px] italic">editado</span>}
        </div>
        {!editing && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/entry:opacity-100 shrink-0">
            <button onClick={startEdit} title="Editar" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3" /></button>
            <button
              onClick={() => confirm({ title: "Excluir registro do diário?", description: "Essa ação não pode ser desfeita." }).then((ok) => { if (ok) onDelete(); })}
              title="Excluir" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
            ><Trash2 className="size-3" /></button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-1 space-y-1.5">
          <AutoTextarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={img.onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full min-h-16 rounded-md border border-border bg-background p-2 text-[13px] outline-none focus:border-primary/50"
          />
          <ImageList urls={img.urls} onRemove={(u) => img.setUrls(img.urls.filter((x) => x !== u))} />
          <div className="flex flex-wrap items-center gap-1">
            <ImageButton uploading={img.uploading} onFiles={img.addFiles} />
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              className="h-7 px-1.5 rounded-md border border-border bg-background text-[11.5px] text-muted-foreground outline-none" />
            <TypeSelect noteTypes={noteTypes} value={typeId} onChange={setTypeId} />
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => setEditing(false)} className="h-7 px-3 rounded-md text-[12px] hover:bg-muted">Cancelar</button>
              <button onClick={submit} disabled={img.uploading} className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-0.5 space-y-1.5">
          {type && <span className={`inline-block rounded px-1.5 py-px text-[10.5px] ${COLOR[type.color].badge}`}>{type.name}</span>}
          <p className="text-[13px] leading-snug text-foreground/90 whitespace-pre-wrap">{entry.content}</p>
          <ImageList urls={entry.image_urls} />
        </div>
      )}
    </li>
  );
}

// ── Tipos de nota ──

function NoteTypesDialog({ noteTypes, onChanged, onClose }: { noteTypes: DiaryNoteType[]; onChanged: () => void; onClose: () => void }) {
  const confirm = useConfirm();
  const createFn = useServerFn(createDiaryNoteType);
  const updateFn = useServerFn(updateDiaryNoteType);
  const deleteFn = useServerFn(deleteDiaryNoteType);
  const [name, setName] = useState("");
  const [color, setColor] = useState<DiaryColor>("blue");
  const opts = { onSuccess: onChanged, onError: (e: any) => toast.error(e.message) };
  const create = useMutation({ mutationFn: () => createFn({ data: { name: name.trim(), color } }), ...opts, onSuccess: () => { setName(""); onChanged(); } });
  const update = useMutation({ mutationFn: (v: { id: string; name?: string; color?: DiaryColor }) => updateFn({ data: v }), ...opts });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), ...opts });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>Tipos de nota</DialogTitle>
        <p className="text-xs text-muted-foreground -mt-1">Valem pro diário de todos os produtos.</p>
        <div className="space-y-1 py-1">
          {noteTypes.map((t) => (
            <NoteTypeRow
              key={t.id}
              type={t}
              onRename={(n) => update.mutate({ id: t.id, name: n })}
              onRecolor={(c) => update.mutate({ id: t.id, color: c })}
              onDelete={() => confirm({ title: `Excluir o tipo "${t.name}"?`, description: "Os registros com esse tipo continuam no diário, sem tipo." })
                .then((ok) => { if (ok) remove.mutate(t.id); })}
            />
          ))}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          className="flex items-center gap-1.5 border-t border-border pt-3"
        >
          <ColorPicker value={color} onChange={setColor} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Novo tipo (ex: Ideia, Aprendizado)" maxLength={40}
            className="h-8 flex-1 min-w-0 px-2.5 rounded-md border border-border bg-background text-[13px] outline-none focus:border-primary/50" />
          <button type="submit" disabled={!name.trim() || create.isPending} title="Adicionar tipo"
            className="size-8 rounded-md bg-primary text-primary-foreground grid place-items-center shrink-0 disabled:opacity-50">
            <Plus className="size-3.5" />
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ColorPicker({ value, onChange }: { value: DiaryColor; onChange: (c: DiaryColor) => void }) {
  return (
    <div className="flex items-center gap-1">
      {DIARY_COLORS.map((c) => (
        <button key={c} type="button" title={COLOR[c].label} onClick={() => onChange(c)}
          className={`size-4 rounded-full ${COLOR[c].dot} ${value === c ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/40" : ""}`} />
      ))}
    </div>
  );
}

function NoteTypeRow({ type, onRename, onRecolor, onDelete }: {
  type: DiaryNoteType; onRename: (n: string) => void; onRecolor: (c: DiaryColor) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(type.name);
  const [picking, setPicking] = useState(false);
  const locked = type.is_system;
  const submit = () => {
    const v = value.trim();
    if (v && v !== type.name) onRename(v);
    setEditing(false);
  };
  return (
    <div className="group/type flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60">
      <div className="relative">
        <button type="button" disabled={locked} onClick={() => setPicking((p) => !p)} title="Mudar cor"
          className={`size-2.5 shrink-0 rounded-full block ${COLOR[type.color].dot} ${locked ? "cursor-default" : ""}`} />
        {picking && !locked && (
          <div className="absolute left-0 top-5 z-10 rounded-md border border-border bg-popover p-1.5 shadow-md">
            <ColorPicker value={type.color} onChange={(c) => { onRecolor(c); setPicking(false); }} />
          </div>
        )}
      </div>
      {editing ? (
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={submit} maxLength={40}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setEditing(false); }}
          className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[13px] outline-none" />
      ) : (
        <button type="button" disabled={locked} onClick={() => { setValue(type.name); setEditing(true); }}
          className={`flex-1 text-left text-[13px] ${locked ? "cursor-default" : ""}`}>{type.name}</button>
      )}
      {locked ? (
        <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Lock className="size-2.5" /> Fixo
        </span>
      ) : (
        <button type="button" onClick={onDelete} title="Excluir tipo"
          className="rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover/type:opacity-100">
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

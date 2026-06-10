import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import {
  Calendar as CalIcon, CheckSquare, Paperclip, Trash2, Upload, X, Loader2, Plus,
  FileText, ImageIcon, Download, GripVertical,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  getTaskDetail, registerTaskAttachment, deleteTaskAttachment,
  TASK_ATTACHMENT_BUCKET, type TaskSource,
} from "@/lib/task-details.functions";
import { updateListTask } from "@/lib/workspace-tasks.functions";
import { updateProjectTask } from "@/lib/project-tasks.functions";
import { updateShopTask } from "@/lib/shop-tasks.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";

type ChecklistItem = { id: string; text: string; done: boolean };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: TaskSource;
  id: string | null;
  /** Required when source === "project_task" so we can store project_id on attachment row */
  projectId?: string | null;
  /** Optional cache keys to invalidate after saves */
  invalidateKeys?: (string | undefined)[][];
};

function fmtDateTimeLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function humanSize(bytes: number | null | undefined) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function TaskDetailDialog({
  open, onOpenChange, source, id, projectId, invalidateKeys = [],
}: Props) {
  const qc = useQueryClient();

  const getDetailFn = useServerFn(getTaskDetail);
  const updListFn = useServerFn(updateListTask);
  const updProjectFn = useServerFn(updateProjectTask);
  const updShopFn = useServerFn(updateShopTask);
  const registerFn = useServerFn(registerTaskAttachment);
  const deleteAttFn = useServerFn(deleteTaskAttachment);

  const detailQ = useQuery({
    queryKey: ["task-detail", source, id],
    queryFn: () => getDetailFn({ data: { source, id: id! } }),
    enabled: !!id && open,
    staleTime: 5_000,
  });

  const task: any = (detailQ.data as any)?.task;
  const attachments: any[] = (detailQ.data as any)?.attachments ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState<string>("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [savingFlag, setSavingFlag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const initRef = useRef<string | null>(null);
  const confirm = useConfirm();

  // Hydrate local state when task loads (only once per task open)
  useEffect(() => {
    if (!task) return;
    if (initRef.current === task.id) return;
    initRef.current = task.id;
    setTitle(task.title ?? "");
    setDescription(task.description ?? "");
    setDueAt(fmtDateTimeLocal(task.due_at));
    setChecklist(Array.isArray(task.checklist) ? task.checklist : []);
  }, [task]);

  useEffect(() => { if (!open) initRef.current = null; }, [open]);

  const callUpdate = async (patch: Record<string, any>) => {
    if (!id) return;
    setSavingFlag(true);
    try {
      if (source === "project_task") {
        await updProjectFn({ data: { id, patch } });
      } else if (source === "shop_task") {
        await updShopFn({ data: { id, patch } });
      } else {
        await updListFn({ data: { id, source: "task", patch } });
      }
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["task-detail", source, id] });
    } catch (e: any) {
      toast.error("Erro ao salvar", { description: e.message });
    } finally {
      setSavingFlag(false);
    }
  };

  // Debounced auto-save for title/description
  const debounceRef = useRef<Record<string, any>>({});
  const debounceSave = (field: string, value: any, delay = 600) => {
    clearTimeout(debounceRef.current[field]);
    debounceRef.current[field] = setTimeout(() => callUpdate({ [field]: value }), delay);
  };

  const saveDueAt = (val: string) => {
    setDueAt(val);
    const iso = val ? new Date(val).toISOString() : null;
    callUpdate({ due_at: iso });
  };

  const saveChecklist = (next: ChecklistItem[]) => {
    setChecklist(next);
    callUpdate({ checklist: next });
  };

  const addChecklistItem = () => {
    const item: ChecklistItem = { id: crypto.randomUUID(), text: "", done: false };
    saveChecklist([...checklist, item]);
  };

  const updateChecklistItem = (id: string, patch: Partial<ChecklistItem>) => {
    saveChecklist(checklist.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeChecklistItem = (id: string) => {
    saveChecklist(checklist.filter((c) => c.id !== id));
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !id) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) { toast.error("Sessão expirada"); return; }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} excede 25 MB`); continue;
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${uid}/${id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(TASK_ATTACHMENT_BUCKET)
          .upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (upErr) { toast.error(`Falha em ${file.name}`, { description: upErr.message }); continue; }
        await registerFn({ data: {
          source, task_id: id,
          file_name: file.name,
          file_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          project_id: source === "project_task" ? projectId ?? null : null,
        }});
      }
      qc.invalidateQueries({ queryKey: ["task-detail", source, id] });
      toast.success("Anexos enviados");
    } catch (e: any) {
      toast.error("Erro no upload", { description: e.message });
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attId: string) => {
    if (!(await confirm("Remover este anexo?"))) return;
    await deleteAttFn({ data: { source, id: attId } });
    qc.invalidateQueries({ queryKey: ["task-detail", source, id] });
  };

  const isImage = (mime?: string | null) => !!mime && mime.startsWith("image/");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[92vw] p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Detalhes da tarefa</DialogTitle>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border flex items-center gap-3">
          <button
            onClick={() => {
              const nextStatus = task?.status === "done" ? "todo" : "done";
              callUpdate({ status: nextStatus });
            }}
            disabled={!task}
            className={`size-5 rounded-full border-2 grid place-items-center shrink-0 transition-colors ${
              task?.status === "done" ? "bg-success border-success" : "border-border hover:border-primary"
            }`}
          >
            {task?.status === "done" && <CheckSquare className="size-3 text-white" />}
          </button>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); debounceSave("title", e.target.value); }}
            onBlur={() => callUpdate({ title })}
            placeholder="Sem título"
            className="flex-1 bg-transparent outline-none text-lg font-semibold tracking-tight"
          />
          {savingFlag && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>

        {detailQ.isLoading || !task ? (
          <div className="grid place-items-center h-64">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            {/* Meta row: due date */}
            <div className="px-6 py-3 flex flex-wrap items-center gap-3 text-xs border-b border-border bg-muted/30">
              <label className="inline-flex items-center gap-2">
                <CalIcon className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Vencimento</span>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => saveDueAt(e.target.value)}
                  className="bg-surface border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary"
                />
                {dueAt && (
                  <button onClick={() => saveDueAt("")} className="text-muted-foreground hover:text-destructive">
                    <X className="size-3" />
                  </button>
                )}
              </label>
            </div>

            {/* Description */}
            <section className="px-6 py-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">
                Descrição
              </div>
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); debounceSave("description", e.target.value, 800); }}
                onBlur={() => callUpdate({ description })}
                placeholder="Adicione uma descrição detalhada..."
                rows={5}
                className="w-full bg-transparent outline-none text-sm leading-relaxed resize-y border border-transparent hover:border-border focus:border-primary rounded-lg p-2 -mx-2 transition-colors"
              />
            </section>

            {/* Checklist */}
            <section className="px-6 py-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium inline-flex items-center gap-1.5">
                  <CheckSquare className="size-3.5" />
                  Checklist
                  {checklist.length > 0 && (
                    <span className="tabular-nums text-muted-foreground">
                      ({checklist.filter((c) => c.done).length}/{checklist.length})
                    </span>
                  )}
                </div>
                <button
                  onClick={addChecklistItem}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="size-3" /> item
                </button>
              </div>

              <ul className="space-y-1">
                {checklist.map((item) => (
                  <li key={item.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50">
                    <GripVertical className="size-3 text-muted-foreground/40 shrink-0" />
                    <button
                      onClick={() => updateChecklistItem(item.id, { done: !item.done })}
                      className={`size-4 rounded border-2 grid place-items-center shrink-0 ${
                        item.done ? "bg-success border-success" : "border-border hover:border-primary"
                      }`}
                    />
                    <input
                      value={item.text}
                      onChange={(e) => updateChecklistItem(item.id, { text: e.target.value })}
                      placeholder="Novo item..."
                      className={`flex-1 bg-transparent outline-none text-sm ${
                        item.done ? "line-through text-muted-foreground" : ""
                      }`}
                    />
                    <button
                      onClick={() => removeChecklistItem(item.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
                {checklist.length === 0 && (
                  <li className="text-xs text-muted-foreground italic px-2 py-1">
                    Sem itens. Quebre a tarefa em passos clicando em "+ item".
                  </li>
                )}
              </ul>
            </section>

            {/* Attachments */}
            <section className="px-6 py-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium inline-flex items-center gap-1.5">
                  <Paperclip className="size-3.5" />
                  Anexos
                  {attachments.length > 0 && (
                    <span className="tabular-nums text-muted-foreground">({attachments.length})</span>
                  )}
                </div>
                <label className="text-xs text-primary hover:underline inline-flex items-center gap-1 cursor-pointer">
                  {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                  enviar
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {attachments.map((a) => (
                  <div key={a.id} className="group relative rounded-lg border border-border bg-surface overflow-hidden">
                    {isImage(a.mime_type) && a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" className="block aspect-video bg-muted">
                        <img src={a.url} alt={a.file_name} className="w-full h-full object-cover" />
                      </a>
                    ) : (
                      <a href={a.url ?? "#"} target="_blank" rel="noreferrer" className="block aspect-video bg-muted grid place-items-center">
                        <FileText className="size-8 text-muted-foreground" />
                      </a>
                    )}
                    <div className="p-2 flex items-center gap-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] truncate" title={a.file_name}>{a.file_name}</div>
                        <div className="text-[10px] text-muted-foreground">{humanSize(a.size_bytes)}</div>
                      </div>
                      {a.url && (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="size-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Abrir"
                        >
                          <Download className="size-3" />
                        </a>
                      )}
                      <button
                        onClick={() => removeAttachment(a.id)}
                        className="size-6 grid place-items-center rounded text-muted-foreground hover:text-destructive hover:bg-muted"
                        title="Remover"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
                {attachments.length === 0 && (
                  <label className="col-span-full border-2 border-dashed border-border rounded-lg p-6 grid place-items-center text-xs text-muted-foreground cursor-pointer hover:border-primary/50 hover:text-foreground transition-colors">
                    <div className="flex flex-col items-center gap-1">
                      <ImageIcon className="size-5" />
                      Solte arquivos ou clique para enviar
                    </div>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }}
                    />
                  </label>
                )}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus, Pencil, Check, X, StickyNote, Trash2, Paperclip, FileText,
} from "lucide-react";
import { toast } from "sonner";
import {
  listLgCardNotes, createLgCardNote, deleteLgCardNote, updateLgCardNote,
  addLgCardNoteAttachment, deleteLgCardNoteAttachment,
} from "@/lib/lg-cards.functions";
import { isoTodayUS } from "@/lib/timezone";
import { supabase } from "@/integrations/supabase/client";

// Anexos: o arquivo sobe direto pro storage (bucket privado project-attachments,
// pasta de quem envia — exigência das policies) e é registrado na nota.
const NOTE_BUCKET = "project-attachments";
const MAX_FILE_MB = 25;

function fmtSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(a: { mime_type?: string | null; file_name: string }) {
  return (a.mime_type ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/i.test(a.file_name);
}

function NoteAttachments({ attachments, onDelete }: { attachments: any[]; onDelete?: (id: string) => void }) {
  if (!attachments?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((a) =>
        isImage(a) && a.url ? (
          <div key={a.id} className="relative group/att">
            <a href={a.url} target="_blank" rel="noreferrer" title={a.file_name}>
              <img src={a.url} alt={a.file_name} className="h-20 w-28 object-cover rounded-lg border border-border" />
            </a>
            {onDelete && (
              <button onClick={() => onDelete(a.id)} title="Remover anexo"
                className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-card border border-border grid place-items-center text-muted-foreground hover:text-destructive shadow-sm">
                <X className="size-3" />
              </button>
            )}
          </div>
        ) : (
          <div key={a.id} className="flex items-center gap-2 h-9 pl-2.5 pr-2 rounded-lg border border-border bg-card max-w-[260px]">
            <FileText className="size-4 text-primary shrink-0" />
            <a href={a.url ?? undefined} target="_blank" rel="noreferrer" className="text-xs text-foreground hover:text-primary truncate" title={a.file_name}>
              {a.file_name}
            </a>
            <span className="text-[10px] text-muted-foreground shrink-0">{fmtSize(a.size_bytes)}</span>
            {onDelete && (
              <button onClick={() => onDelete(a.id)} title="Remover anexo" className="size-5 grid place-items-center text-muted-foreground hover:text-destructive shrink-0">
                <X className="size-3" />
              </button>
            )}
          </div>
        ),
      )}
    </div>
  );
}

const isoToday = isoTodayUS;
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ─── Notes section ────────────────────────────────────────────────────────────

export function LgNotesSection({
  cardId, shopIds, matrizShopId,
}: {
  cardId: string; shopIds: string[]; matrizShopId: string | null;
}) {
  const qc       = useQueryClient();
  const listFn   = useServerFn(listLgCardNotes);
  const createFn = useServerFn(createLgCardNote);
  const deleteFn = useServerFn(deleteLgCardNote);
  const updateFn = useServerFn(updateLgCardNote);
  const addAttFn = useServerFn(addLgCardNoteAttachment);
  const delAttFn = useServerFn(deleteLgCardNoteAttachment);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);

  const [content,  setContent]  = useState("");
  const [noteDate, setNoteDate] = useState(isoToday());
  const [saving,   setSaving]   = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editVisitors, setEditVisitors] = useState<string>("");

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["lg-card-notes", cardId],
    queryFn:  () => listFn({ data: { card_id: cardId } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["lg-card-notes", cardId] });

  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const tooBig = picked.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig.length) toast.error(`Arquivo acima de ${MAX_FILE_MB} MB: ${tooBig.map((f) => f.name).join(", ")}`);
    return picked.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
  };

  // Sobe os arquivos e registra na nota. Falha num arquivo não perde os outros.
  const uploadFiles = async (noteId: string, list: File[]) => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) throw new Error("Sessão expirada — entre de novo.");
    let failed = 0;
    for (const f of list) {
      try {
        const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-120);
        const path = `${uid}/lg-notes/${noteId}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage.from(NOTE_BUCKET).upload(path, f, { upsert: false, contentType: f.type || undefined });
        if (error) throw error;
        await addAttFn({ data: { note_id: noteId, file_name: f.name, file_path: path, mime_type: f.type || null, size_bytes: f.size } });
      } catch (e) {
        console.error("anexo da nota falhou", f.name, e);
        failed++;
      }
    }
    if (failed) toast.error(`${failed} anexo(s) não foram enviados.`);
  };

  const handleCreate = async () => {
    if (!content.trim() && !files.length) return;
    setSaving(true);
    try {
      const { id } = await createFn({ data: { card_id: cardId, content: content.trim(), note_date: noteDate } });
      if (files.length) await uploadFiles(id, files);
      setContent("");
      setFiles([]);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar nota");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    if (!window.confirm("Remover este anexo?")) return;
    try { await delAttFn({ data: { id } }); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Erro ao remover anexo"); }
  };

  const addToExisting = async (noteId: string, list: File[]) => {
    if (!list.length) return;
    setSaving(true);
    try { await uploadFiles(noteId, list); refresh(); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try { await deleteFn({ data: { id } }); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Erro ao excluir"); }
  };

  const startEdit = (note: any) => {
    setEditingId(note.id);
    setEditContent(note.content);
    setEditVisitors(note.visitors != null ? String(note.visitors) : "");
  };

  const cancelEdit = () => { setEditingId(null); setEditContent(""); setEditVisitors(""); };

  const saveEdit = async (id: string, hasAttachments: boolean) => {
    if (!editContent.trim() && !hasAttachments) return;
    setSaving(true);
    try {
      await updateFn({ data: {
        id,
        content:  editContent.trim(),
        visitors: editVisitors !== "" ? parseInt(editVisitors, 10) : null,
      }});
      setEditingId(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao atualizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <StickyNote className="size-4 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Diário de Operação</p>
      </div>

      {/* Input */}
      <div className="space-y-2">
        <input
          type="date"
          value={noteDate}
          onChange={(e) => setNoteDate(e.target.value)}
          className="h-8 rounded-xl border border-border bg-card text-foreground text-xs px-3 focus:outline-none focus:border-primary w-36"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="Registre alterações em campanhas, decisões estratégicas, anomalias..."
          className="w-full rounded-xl border border-border bg-card text-foreground text-sm px-3 py-2.5 focus:outline-none focus:border-primary resize-none"
        />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 h-8 pl-2.5 pr-1.5 rounded-lg border border-border bg-muted/40 max-w-[260px]">
                <FileText className="size-3.5 text-primary shrink-0" />
                <span className="text-xs text-foreground truncate" title={f.name}>{f.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{fmtSize(f.size)}</span>
                <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} title="Tirar arquivo"
                  className="size-5 grid place-items-center text-muted-foreground hover:text-destructive shrink-0">
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={(e) => { const add = pickFiles(e.target.files); setFiles((prev) => [...prev, ...add]); e.target.value = ""; }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
            className="h-8 px-3 rounded-xl border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 flex items-center gap-1.5 disabled:opacity-50"
          >
            <Paperclip className="size-3.5" /> Anexar arquivo
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || (!content.trim() && !files.length)}
            className="h-8 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <div className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            <Plus className="size-3" /> Adicionar nota
          </button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1,2].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : (notes as any[]).length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">Nenhuma nota registrada ainda.</p>
      ) : (
        <div className="space-y-2">
          {(notes as any[]).map((note: any) => (
            <div key={note.id} className="group rounded-xl border border-border bg-muted/30 p-3 gap-3">
              {editingId === note.id ? (
                /* Edit mode */
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium">{fmtDate(note.note_date)}</span>
                  </div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-border bg-card text-foreground text-sm px-3 py-2 focus:outline-none focus:border-primary resize-none"
                  />
                  <NoteAttachments attachments={note.attachments} onDelete={handleDeleteAttachment} />
                  <div className="flex items-center justify-end gap-2">
                    <input ref={editFileInputRef} type="file" multiple className="hidden"
                      onChange={(e) => { const add = pickFiles(e.target.files); e.target.value = ""; addToExisting(note.id, add); }} />
                    <button onClick={() => editFileInputRef.current?.click()} disabled={saving}
                      className="h-7 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mr-auto disabled:opacity-50">
                      <Paperclip className="size-3" /> Anexar
                    </button>
                    <button onClick={cancelEdit} className="h-7 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                    <button
                      onClick={() => saveEdit(note.id, (note.attachments ?? []).length > 0)}
                      disabled={saving || (!editContent.trim() && !(note.attachments ?? []).length)}
                      className="h-7 px-3 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-50 flex items-center gap-1"
                    >
                      <Check className="size-3" /> Salvar
                    </button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <div className="flex gap-3">
                  <div className="shrink-0 text-right min-w-[60px]">
                    <p className="text-[10px] text-muted-foreground font-medium">{fmtDate(note.note_date)}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    {note.content && <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{note.content}</p>}
                    <NoteAttachments attachments={note.attachments} />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                    <button
                      onClick={() => startEdit(note)}
                      className="size-6 rounded-lg grid place-items-center text-muted-foreground hover:text-primary"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="size-6 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

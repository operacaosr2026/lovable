import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus, Pencil, Check, X, StickyNote, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  listLgCardNotes, createLgCardNote, deleteLgCardNote, updateLgCardNote,
} from "@/lib/lg-cards.functions";
import { isoTodayUS } from "@/lib/timezone";

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

  const handleCreate = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await createFn({ data: { card_id: cardId, content: content.trim(), note_date: noteDate } });
      setContent("");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar nota");
    } finally {
      setSaving(false);
    }
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

  const saveEdit = async (id: string) => {
    if (!editContent.trim()) return;
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
        <div className="flex justify-end">
          <button
            onClick={handleCreate}
            disabled={saving || !content.trim()}
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
                  <div className="flex justify-end gap-2">
                    <button onClick={cancelEdit} className="h-7 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                    <button
                      onClick={() => saveEdit(note.id)}
                      disabled={saving || !editContent.trim()}
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
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{note.content}</p>
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

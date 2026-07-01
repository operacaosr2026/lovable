import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus, Pencil, Check, X, StickyNote, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getShopDashboardMetrics } from "@/lib/shop-orders.functions";
import {
  listLgCardNotes, createLgCardNote, deleteLgCardNote, updateLgCardNote,
  listShopDailyAnalytics,
} from "@/lib/lg-cards.functions";

function isoToday() { return new Date().toLocaleDateString("en-CA"); }
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ─── Note badges (lazy per-note metrics) ─────────────────────────────────────

function NoteBadges({
  shopIds, matrizShopId, noteDate, visitors: savedVisitors,
}: {
  shopIds: string[]; matrizShopId: string | null; noteDate: string; visitors?: number | null;
}) {
  const getMetricsFn    = useServerFn(getShopDashboardMetrics);
  const getAnalyticsFn  = useServerFn(listShopDailyAnalytics);

  const metricsQuery = useQuery({
    queryKey: ["lg-note-metrics", shopIds.join(","), noteDate],
    queryFn:  () => getMetricsFn({ data: { shop_ids: shopIds, from: noteDate, to: noteDate, prev_from: noteDate, prev_to: noteDate } }),
    staleTime: 5 * 60_000,
  });

  const analyticsQuery = useQuery({
    queryKey: ["lg-note-analytics", matrizShopId, noteDate],
    queryFn:  () => getAnalyticsFn({ data: { shop_id: matrizShopId!, from: noteDate, to: noteDate } }),
    enabled:  Boolean(matrizShopId) && !savedVisitors,
    staleTime: 5 * 60_000,
  });

  const m = metricsQuery.data?.metrics;
  const loading = metricsQuery.isLoading;

  const cpa = m && m.anuncios && m.pedidos
    ? m.anuncios / m.pedidos
    : null;

  const lucroPC = m && m.faturamento && m.faturamento > 0
    ? (m.lucro / m.faturamento) * 100
    : null;

  const sessions = savedVisitors ?? (analyticsQuery.data?.[0]?.sessions ?? null);
  const conversao = m && sessions && sessions > 0
    ? (m.pedidos / sessions) * 100
    : null;

  if (loading) return (
    <div className="flex gap-1.5 mt-1.5">
      {[0,1,2].map(i => <div key={i} className="h-4 w-14 bg-muted animate-pulse rounded-full" />)}
    </div>
  );

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-warning/30 bg-warning/10 text-warning">
        CPA {cpa !== null ? `$${cpa.toFixed(2)}` : "—"}
      </span>
      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${lucroPC !== null && lucroPC >= 0 ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
        Margem {lucroPC !== null ? `${lucroPC.toFixed(1)}%` : "—"}
      </span>
      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${conversao !== null ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}`}>
        Conv. {conversao !== null ? `${conversao.toFixed(2)}%` : "—"}
      </span>
    </div>
  );
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
                    <div className="flex items-center gap-1.5 ml-auto">
                      <label className="text-[10px] text-muted-foreground">Visitantes:</label>
                      <input
                        type="number"
                        value={editVisitors}
                        onChange={(e) => setEditVisitors(e.target.value)}
                        placeholder="0"
                        className="w-20 h-6 text-xs rounded-lg border border-border bg-card px-2 focus:outline-none focus:border-primary"
                      />
                    </div>
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
                    <NoteBadges
                      shopIds={shopIds}
                      matrizShopId={matrizShopId}
                      noteDate={note.note_date}
                      visitors={note.visitors}
                    />
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

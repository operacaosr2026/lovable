import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MoreHorizontal, Plus, Pencil, Trash2, X, Check, GripVertical } from "lucide-react";

const COL_DRAG_MIME = "application/x-kanban-col";
import {
  listKanbanColumns,
  seedKanbanColumns,
  createKanbanColumn,
  updateKanbanColumn,
  deleteKanbanColumn,
  reorderKanbanColumns,
} from "@/lib/kanban-columns.functions";

export type KanbanColumnDef = {
  id: string;        // key used to filter items (= entity status/stage)
  label: string;
  tint: string;      // soft background for header
  accent: string;    // dot/text accent color
  /** db row id when this column has been materialized (custom). null = still a default. */
  rowId: string | null;
};

export type DefaultColumn = {
  id: string;          // key
  label: string;
  tint: string;
  accent: string;
};

const PALETTE = [
  "oklch(0.6 0.22 285)",
  "oklch(0.55 0.2 250)",
  "oklch(0.5 0.15 200)",
  "oklch(0.5 0.13 155)",
  "oklch(0.6 0.16 65)",
  "oklch(0.55 0.18 25)",
  "oklch(0.45 0.02 260)",
];

function tintFromAccent(color: string) {
  // Use color-mix to derive a soft tinted bg from any accent value
  return `color-mix(in oklch, ${color} 12%, white)`;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || `col_${Date.now().toString(36)}`;
}

export function useKanbanColumns({
  boardType,
  boardId,
  defaults,
  enabled = true,
}: {
  boardType: string;
  boardId: string;
  defaults: DefaultColumn[];
  enabled?: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listKanbanColumns);
  const seedFn = useServerFn(seedKanbanColumns);
  const createFn = useServerFn(createKanbanColumn);
  const updateFn = useServerFn(updateKanbanColumn);
  const deleteFn = useServerFn(deleteKanbanColumn);
  const reorderFn = useServerFn(reorderKanbanColumns);

  const queryKey = ["kanban-columns", boardType, boardId];

  const { data } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { board_type: boardType, board_id: boardId } }),
    enabled: enabled && !!boardId,
  });

  const customs = (data?.columns ?? []) as Array<{
    id: string;
    key: string;
    label: string;
    color: string;
    position: number;
  }>;

  const columns: KanbanColumnDef[] = useMemo(() => {
    if (customs.length === 0) {
      return defaults.map((d) => ({ ...d, rowId: null }));
    }
    return customs
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        id: c.key,
        label: c.label,
        accent: c.color,
        tint: tintFromAccent(c.color),
        rowId: c.id,
      }));
  }, [customs, defaults]);

  const refresh = () => qc.invalidateQueries({ queryKey });

  // Ensure custom rows exist before applying a user edit
  const materialize = useCallback(async () => {
    if (customs.length > 0) return;
    await seedFn({
      data: {
        board_type: boardType,
        board_id: boardId,
        columns: defaults.map((d) => ({ key: d.id, label: d.label, color: d.accent })),
      },
    });
    await refresh();
    // refetch to get rowIds
    const fresh = await listFn({ data: { board_type: boardType, board_id: boardId } });
    return fresh.columns;
  }, [customs.length, seedFn, listFn, boardType, boardId, defaults]);

  const mAdd = useMutation({
    mutationFn: async (input: { label: string }) => {
      await materialize();
      const key = `${slugify(input.label)}_${Math.random().toString(36).slice(2, 6)}`;
      const lastPos = (customs[customs.length - 1]?.position ?? defaults.length - 1) + 1;
      const color = PALETTE[(customs.length + defaults.length) % PALETTE.length];
      return createFn({
        data: {
          board_type: boardType,
          board_id: boardId,
          key,
          label: input.label,
          color,
          position: lastPos,
        },
      });
    },
    onSuccess: refresh,
  });

  const mRename = useMutation({
    mutationFn: async (input: { col: KanbanColumnDef; label: string }) => {
      const rows = input.col.rowId ? null : await materialize();
      const rowId =
        input.col.rowId ??
        (rows ?? [])
          .find((c: any) => c.key === input.col.id)?.id;
      if (!rowId) throw new Error("Coluna não encontrada");
      return updateFn({ data: { id: rowId, patch: { label: input.label } } });
    },
    onSuccess: refresh,
  });

  const mRecolor = useMutation({
    mutationFn: async (input: { col: KanbanColumnDef; color: string }) => {
      const rows = input.col.rowId ? null : await materialize();
      const rowId =
        input.col.rowId ??
        (rows ?? []).find((c: any) => c.key === input.col.id)?.id;
      if (!rowId) throw new Error("Coluna não encontrada");
      return updateFn({ data: { id: rowId, patch: { color: input.color } } });
    },
    onSuccess: refresh,
  });

  const mReorder = useMutation({
    mutationFn: async (orderedKeys: string[]) => {
      const rows = (await materialize()) ?? customs;
      const byKey = new Map(rows.map((r: any) => [r.key, r]));
      const updates = orderedKeys
        .map((k, i) => {
          const r = byKey.get(k);
          return r ? { id: (r as any).id, position: i } : null;
        })
        .filter(Boolean) as { id: string; position: number }[];
      if (updates.length === 0) return;
      return reorderFn({ data: { updates } });
    },
    onMutate: async (orderedKeys: string[]) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      qc.setQueryData<any>(queryKey, (old: any) => {
        if (!old?.columns?.length) return old;
        const byKey = new Map(old.columns.map((c: any) => [c.key, c]));
        const next = orderedKeys
          .map((k, i) => {
            const c = byKey.get(k);
            return c ? { ...(c as any), position: i } : null;
          })
          .filter(Boolean);
        return { ...old, columns: next };
      });
      return { prev };
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev); },
    onSettled: refresh,
  });

  const mDelete = useMutation({
    mutationFn: async (input: { col: KanbanColumnDef }) => {
      const rows = input.col.rowId ? null : await materialize();
      const rowId =
        input.col.rowId ??
        (rows ?? []).find((c: any) => c.key === input.col.id)?.id;
      if (!rowId) throw new Error("Coluna não encontrada");
      return deleteFn({ data: { id: rowId } });
    },
    onSuccess: refresh,
  });

  return {
    columns,
    add: (label: string) => mAdd.mutateAsync({ label }),
    rename: (col: KanbanColumnDef, label: string) => mRename.mutateAsync({ col, label }),
    recolor: (col: KanbanColumnDef, color: string) => mRecolor.mutateAsync({ col, color }),
    reorder: (orderedKeys: string[]) => mReorder.mutateAsync(orderedKeys),
    remove: (col: KanbanColumnDef) => mDelete.mutateAsync({ col }),
  };
}

/* -------------------- Drag-to-reorder hook -------------------- */

export function useColumnDnD(
  columns: KanbanColumnDef[],
  onReorder: (orderedKeys: string[]) => void,
) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const headerDragProps = (col: KanbanColumnDef) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDraggingKey(col.id);
      e.dataTransfer.setData(COL_DRAG_MIME, col.id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => { setDraggingKey(null); setOverKey(null); },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(COL_DRAG_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setOverKey(col.id);
    },
    onDragLeave: () => setOverKey((k) => (k === col.id ? null : k)),
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(COL_DRAG_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      const src = e.dataTransfer.getData(COL_DRAG_MIME);
      setDraggingKey(null);
      setOverKey(null);
      if (!src || src === col.id) return;
      const keys = columns.map((c) => c.id);
      const from = keys.indexOf(src);
      const to = keys.indexOf(col.id);
      if (from < 0 || to < 0) return;
      keys.splice(from, 1);
      keys.splice(to, 0, src);
      onReorder(keys);
    },
    style: { cursor: "grab" as const },
  });

  return { headerDragProps, draggingKey, overKey };
}

/* -------------------- UI components -------------------- */

const PRESET_COLORS = [
  "oklch(0.55 0.2 250)",
  "oklch(0.6 0.16 65)",
  "oklch(0.5 0.13 155)",
  "oklch(0.6 0.22 285)",
  "oklch(0.55 0.18 25)",
  "oklch(0.5 0.15 200)",
  "oklch(0.5 0.18 285)",
  "oklch(0.45 0.02 260)",
];

export function ColumnControls({
  col,
  itemCount,
  onRename,
  onRecolor,
  onDelete,
}: {
  col: KanbanColumnDef;
  itemCount: number;
  onRename: (label: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(col.label);
  const wrapRef = useRef<HTMLDivElement>(null);

  const submitLabel = () => {
    const v = labelDraft.trim();
    if (v && v !== col.label) onRename(v);
    setEditingLabel(false);
    setOpen(false);
  };

  const confirmDelete = () => {
    if (itemCount > 0) {
      if (!confirm(`Esta coluna tem ${itemCount} item(s). Excluir mesmo assim? Os itens permanecerão no banco com o status atual.`)) return;
    }
    onDelete();
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="size-6 rounded-md hover:bg-black/5 grid place-items-center text-muted-foreground"
        title="Opções da coluna"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => { setOpen(false); setEditingLabel(false); }} />
          <div className="absolute right-0 top-7 z-40 w-56 rounded-xl bg-popover border border-border shadow-xl p-1.5 text-sm">
            {editingLabel ? (
              <div className="p-2 space-y-2">
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitLabel();
                    if (e.key === "Escape") { setEditingLabel(false); setLabelDraft(col.label); }
                  }}
                  className="w-full h-8 px-2 rounded-md border border-border bg-background outline-none focus:border-primary"
                />
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => { setEditingLabel(false); setLabelDraft(col.label); }} className="size-7 rounded-md hover:bg-muted grid place-items-center">
                    <X className="size-3.5" />
                  </button>
                  <button onClick={submitLabel} className="size-7 rounded-md bg-primary text-primary-foreground grid place-items-center">
                    <Check className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setEditingLabel(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted"
                >
                  <Pencil className="size-3.5" /> Renomear
                </button>
                <div className="px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Cor</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => { onRecolor(c); setOpen(false); }}
                        className="size-5 rounded-full ring-2 ring-transparent hover:ring-border"
                        style={{ background: c, outline: col.accent === c ? "2px solid hsl(var(--primary))" : undefined }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
                <div className="h-px bg-border my-1" />
                <div className="px-2 py-1 text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
                  <GripVertical className="size-3" /> Arraste o cabeçalho para reordenar
                </div>
                <div className="h-px bg-border my-1" />
                <button
                  onClick={confirmDelete}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                >
                  <Trash2 className="size-3.5" /> Excluir coluna
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function AddColumnButton({ onAdd, className = "" }: { onAdd: (label: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");

  const submit = () => {
    const v = val.trim();
    if (v) onAdd(v);
    setVal("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`w-72 shrink-0 rounded-2xl border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors flex items-center justify-center gap-2 h-12 text-sm ${className}`}
      >
        <Plus className="size-4" /> Nova coluna
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className={`w-72 shrink-0 rounded-2xl border border-primary/40 bg-surface p-2 ${className}`}
    >
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => { if (e.key === "Escape") { setVal(""); setOpen(false); } }}
        placeholder="Nome da coluna..."
        className="w-full h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary"
      />
    </form>
  );
}

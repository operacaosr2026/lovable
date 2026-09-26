import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, ShoppingBag, ExternalLink, Pencil, X, Trash2, Check, Clock, StickyNote, Flame, Tag, Layers,
  MoreHorizontal, MoreVertical, ShoppingCart, Store as Store3,
} from "lucide-react";
import { toast } from "sonner";
import {
  listBoardColumns, createBoardColumn, renameBoardColumn, deleteBoardColumn,
  reorderBoardColumns, moveBoardStores, setBoardColumnFeatures, setBoardColumnExcludedFromCaixa, setBoardColumnSyncPaused, setStoreBoardNote,
  type BOARD_COLUMN_FEATURES,
} from "@/lib/store-board.functions";
import { listShopifyStores, createPlaceholderStore } from "@/lib/shop-orders.functions";
import { getStoreHoldBalance, getStoreAvgDailyOrders, getStorePayoutTime } from "@/lib/store-board-metrics.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

type Store = {
  id: string;
  name: string | null;
  shop_domain: string | null;
  board_column_id: string | null;
  board_position: number;
  board_note: string | null;
  is_placeholder: boolean;
};
type ColumnFeature = (typeof BOARD_COLUMN_FEATURES)[number];
type Column = { id: string; name: string; position: number; features: ColumnFeature[]; excluded_from_caixa: boolean; sync_paused: boolean };

const FEATURE_LABELS: Record<ColumnFeature, string> = {
  hold: "Em Hold",
  avg_orders: "Média de pedidos diários",
  payout_time: "Payouts Time",
  note: "Nota",
};
const FEATURE_ORDER: ColumnFeature[] = ["hold", "avg_orders", "payout_time", "note"];

// search: filtra as lojas por nome/domínio; columnFilter: mostra só essa coluna.
export function StoreBoard({ onEditStore, search = "", columnFilter = null }: {
  onEditStore: (store: any) => void; search?: string; columnFilter?: string | null;
}) {
  const qc = useQueryClient();
  const listColumnsFn = useServerFn(listBoardColumns);
  const listStoresFn = useServerFn(listShopifyStores);
  const createPlaceholderFn = useServerFn(createPlaceholderStore);
  const createColFn = useServerFn(createBoardColumn);
  const renameColFn = useServerFn(renameBoardColumn);
  const deleteColFn = useServerFn(deleteBoardColumn);
  const reorderColsFn = useServerFn(reorderBoardColumns);
  const moveStoresFn = useServerFn(moveBoardStores);
  const setFeaturesFn = useServerFn(setBoardColumnFeatures);
  const setExcludedFn = useServerFn(setBoardColumnExcludedFromCaixa);
  const setSyncPausedFn = useServerFn(setBoardColumnSyncPaused);
  const confirm = useConfirm();

  const { data: columnsData } = useQuery({ queryKey: ["board-columns"], queryFn: () => listColumnsFn() });
  const { data: storesData } = useQuery({ queryKey: ["shopify-stores"], queryFn: () => listStoresFn() });

  const [columns, setColumns] = useState<Column[]>([]);
  const [board, setBoard] = useState<Record<string, Store[]>>({});
  const dragActive = useRef(false);
  const dragSourceCol = useRef<string | null>(null);

  const refreshStores = () => qc.invalidateQueries({ queryKey: ["shopify-stores"] });

  useEffect(() => {
    if (dragActive.current) return;
    setColumns((columnsData ?? []) as Column[]);
  }, [columnsData]);

  useEffect(() => {
    if (dragActive.current) return;
    const cols = (columnsData ?? []) as Column[];
    const stores = (storesData ?? []) as Store[];
    if (cols.length === 0) { setBoard({}); return; }
    const grouped: Record<string, Store[]> = {};
    for (const c of cols) grouped[c.id] = [];
    const orphans: Store[] = [];
    for (const s of stores) {
      if (s.board_column_id && grouped[s.board_column_id]) grouped[s.board_column_id].push(s);
      else orphans.push(s);
    }
    for (const id of Object.keys(grouped)) grouped[id].sort((a, b) => a.board_position - b.board_position);
    if (orphans.length > 0) grouped[cols[0].id] = [...grouped[cols[0].id], ...orphans];
    setBoard(grouped);
  }, [columnsData, storesData]);

  const moveStores = useMutation({ mutationFn: (updates: { id: string; board_column_id: string; board_position: number }[]) => moveStoresFn({ data: { updates } }) });

  const addPlaceholder = useMutation({
    mutationFn: (input: { name: string; board_column_id: string }) => createPlaceholderFn({ data: input }),
    onSuccess: () => refreshStores(),
    onError: (e: any) => toast.error(e.message),
  });

  // One-time repair: assign stores created before the board existed to the first column.
  useEffect(() => {
    const cols = (columnsData ?? []) as Column[];
    const stores = (storesData ?? []) as Store[];
    if (cols.length === 0) return;
    const orphans = stores.filter((s) => !s.board_column_id);
    if (orphans.length === 0) return;
    const base = stores.filter((s) => s.board_column_id === cols[0].id).length;
    moveStoresFn({ data: { updates: orphans.map((s, i) => ({ id: s.id, board_column_id: cols[0].id, board_position: base + i })) } })
      .then(refreshStores);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsData, storesData]);

  const createColumn = useMutation({
    mutationFn: (name: string) => createColFn({ data: { name } }),
  });
  const renameColumn = useMutation({
    mutationFn: (input: { id: string; name: string }) => renameColFn({ data: input }),
  });
  const removeColumn = useMutation({
    mutationFn: (id: string) => deleteColFn({ data: { id } }),
  });
  const reorderColumns = useMutation({
    mutationFn: (updates: { id: string; position: number }[]) => reorderColsFn({ data: { updates } }),
  });
  const setFeatures = useMutation({
    mutationFn: (input: { id: string; features: ColumnFeature[] }) => setFeaturesFn({ data: input }),
  });
  const setExcluded = useMutation({
    mutationFn: (input: { id: string; excluded: boolean }) => setExcludedFn({ data: input }),
  });
  const setSyncPaused = useMutation({
    mutationFn: (input: { id: string; paused: boolean }) => setSyncPausedFn({ data: input }),
  });

  const setColumnFeaturesLocal = (id: string, features: ColumnFeature[]) => {
    const prevColumns = columns;
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, features } : c)));
    setFeatures.mutate({ id, features }, {
      onError: (e: any) => { toast.error(e.message); setColumns(prevColumns); },
    });
  };

  const setColumnExcludedFromCaixaLocal = (id: string, excluded: boolean) => {
    const prevColumns = columns;
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, excluded_from_caixa: excluded } : c)));
    setExcluded.mutate({ id, excluded }, {
      onError: (e: any) => { toast.error(e.message); setColumns(prevColumns); },
    });
  };

  const setColumnSyncPausedLocal = (id: string, paused: boolean) => {
    const prevColumns = columns;
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, sync_paused: paused } : c)));
    setSyncPaused.mutate({ id, paused }, {
      onError: (e: any) => { toast.error(e.message); setColumns(prevColumns); },
    });
  };

  // Optimistic column edits: update local state immediately, let the request
  // reconcile in the background instead of waiting on invalidate+refetch.
  const addColumn = (name: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    setColumns((prev) => [...prev, { id: tempId, name, position: prev.length, features: [], excluded_from_caixa: false, sync_paused: false }]);
    setBoard((prev) => ({ ...prev, [tempId]: [] }));
    createColumn.mutate(name, {
      onSuccess: (row: any) => {
        setColumns((prev) => prev.map((c) => (c.id === tempId ? { id: row.id, name: row.name, position: row.position, features: row.features, excluded_from_caixa: row.excluded_from_caixa, sync_paused: row.sync_paused ?? false } : c)));
        setBoard((prev) => {
          const { [tempId]: items, ...rest } = prev;
          const settled = items ?? [];
          if (settled.length > 0) {
            moveStores.mutate(settled.map((s, i) => ({ id: s.id, board_column_id: row.id, board_position: i })));
          }
          return { ...rest, [row.id]: settled };
        });
      },
      onError: (e: any) => {
        toast.error(e.message);
        setColumns((prev) => prev.filter((c) => c.id !== tempId));
        setBoard((prev) => { const { [tempId]: _drop, ...rest } = prev; return rest; });
      },
    });
  };

  const renameColumnLocal = (id: string, name: string) => {
    const prevColumns = columns;
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    renameColumn.mutate({ id, name }, {
      onError: (e: any) => { toast.error(e.message); setColumns(prevColumns); },
    });
  };

  const deleteColumnLocal = (id: string) => {
    const prevColumns = columns;
    const prevBoard = board;
    setColumns((prev) => prev.filter((c) => c.id !== id));
    setBoard((prev) => { const { [id]: _drop, ...rest } = prev; return rest; });
    removeColumn.mutate(id, {
      onError: (e: any) => { toast.error(e.message); setColumns(prevColumns); setBoard(prevBoard); },
    });
  };

  const [activeCard, setActiveCard] = useState<Store | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const findColumnOf = (storeId: string): string | null => {
    for (const [colId, items] of Object.entries(board)) {
      if (items.some((s) => s.id === storeId)) return colId;
    }
    return null;
  };

  const getOverColumnId = (over: NonNullable<DragEndEvent["over"]>): string | null => {
    const t = over.data.current?.type;
    if (t === "column-drop") return over.data.current?.columnId as string;
    if (t === "card") return findColumnOf(String(over.id));
    return null;
  };

  const onDragStart = (e: DragStartEvent) => {
    dragActive.current = true;
    const type = e.active.data.current?.type;
    if (type === "column") {
      setActiveColumn(columns.find((c) => c.id === e.active.id) ?? null);
      return;
    }
    const colId = findColumnOf(String(e.active.id));
    dragSourceCol.current = colId;
    setActiveCard(colId ? board[colId].find((s) => s.id === e.active.id) ?? null : null);
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over || active.data.current?.type === "column") return;
    const activeId = String(active.id);
    const sourceCol = findColumnOf(activeId);
    const destCol = getOverColumnId(over);
    if (!sourceCol || !destCol || sourceCol === destCol) return;

    setBoard((prev) => {
      const sourceItems = prev[sourceCol] ?? [];
      const idx = sourceItems.findIndex((s) => s.id === activeId);
      if (idx === -1) return prev;
      const moved = sourceItems[idx];
      const newSource = [...sourceItems.slice(0, idx), ...sourceItems.slice(idx + 1)];
      const destItems = [...(prev[destCol] ?? [])];
      let insertAt = destItems.length;
      if (over.data.current?.type === "card") {
        const overIdx = destItems.findIndex((s) => s.id === String(over.id));
        if (overIdx !== -1) insertAt = overIdx;
      }
      destItems.splice(insertAt, 0, moved);
      return { ...prev, [sourceCol]: newSource, [destCol]: destItems };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    dragActive.current = false;
    setActiveCard(null);
    setActiveColumn(null);
    const { active, over } = e;
    if (!over) return;

    if (active.data.current?.type === "column") {
      const oldIndex = columns.findIndex((c) => c.id === active.id);
      const newIndex = columns.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(columns, oldIndex, newIndex);
      setColumns(reordered);
      reorderColumns.mutate(reordered.map((c, i) => ({ id: c.id, position: i })));
      return;
    }

    const activeId = String(active.id);
    const finalCol = findColumnOf(activeId);
    if (!finalCol) return;

    let finalItems = board[finalCol] ?? [];
    if (over.data.current?.type === "card" && String(over.id) !== activeId) {
      const oldIndex = finalItems.findIndex((s) => s.id === activeId);
      const newIndex = finalItems.findIndex((s) => s.id === String(over.id));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        finalItems = arrayMove(finalItems, oldIndex, newIndex);
        setBoard((prev) => ({ ...prev, [finalCol]: finalItems }));
      }
    }

    if (!finalCol.startsWith("temp-")) {
      moveStores.mutate(finalItems.map((s, i) => ({ id: s.id, board_column_id: finalCol, board_position: i })));
    }

    const startCol = dragSourceCol.current;
    if (startCol && startCol !== finalCol && !startCol.startsWith("temp-")) {
      const remaining = board[startCol] ?? [];
      if (remaining.length > 0) {
        moveStores.mutate(remaining.map((s, i) => ({ id: s.id, board_column_id: startCol, board_position: i })));
      }
    }
    dragSourceCol.current = null;
  };

  const q = search.trim().toLowerCase();
  const visible = (items: Store[]) => !q ? items
    : items.filter((s) => `${s.name ?? ""} ${s.shop_domain ?? ""}`.toLowerCase().includes(q));
  const shownColumns = columnFilter ? columns.filter((c) => c.id === columnFilter) : columns;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="flex gap-2.5 overflow-x-auto pb-1 items-stretch flex-1 min-h-0">
        <SortableContext items={shownColumns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {shownColumns.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              stores={visible(board[col.id] ?? [])}
              onEditStore={onEditStore}
              onAddStore={(name) => addPlaceholder.mutate({ name, board_column_id: col.id })}
              onRename={(name) => renameColumnLocal(col.id, name)}
              onFeaturesChange={(features) => setColumnFeaturesLocal(col.id, features)}
              onExcludedFromCaixaChange={(excluded) => setColumnExcludedFromCaixaLocal(col.id, excluded)}
              onSyncPausedChange={(paused) => setColumnSyncPausedLocal(col.id, paused)}
              onDelete={async () => {
                if ((board[col.id] ?? []).length > 0) {
                  toast.error("Mova ou remova as lojas desta coluna antes de excluí-la.");
                  return;
                }
                if (await confirm(`Excluir a coluna "${col.name}"?`)) deleteColumnLocal(col.id);
              }}
            />
          ))}
        </SortableContext>

        {!columnFilter && <AddColumn onAdd={addColumn} />}
      </div>

      <DragOverlay>
        {activeCard && <StoreDragCard store={activeCard} tone={columnTone(columns.find((c) => c.id === dragSourceCol.current)?.name ?? "")} dragging />}
        {activeColumn && (
          <div className="rounded-2xl border border-primary/40 bg-card shadow-xl w-[260px] px-4 py-3 font-bold text-sm">
            {activeColumn.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Visual de cada etapa (cor, ícone e descrição), pelo nome da coluna ───────
// As colunas são livres (o usuário cria/renomeia), então a cor sai do nome;
// coluna com nome desconhecido fica no roxo padrão.

export type ColumnTone = {
  icon: any | null;       // null = bolinha colorida
  dot: string;            // cor da bolinha
  iconText: string;       // cor do ícone
  chip: string;           // fundo do círculo do ícone (KPIs)
  head: string;           // fundo do cabeçalho da coluna
  body: string;           // fundo do corpo da coluna
  stripe: string;         // faixa colorida à esquerda do card
  desc: string | null;    // descrição padrão da etapa
  trend: "up" | "down";   // seta do % nos KPIs (etapa "boa" sobe)
};

const TONES: { match: RegExp; tone: ColumnTone }[] = [
  { match: /aquec/i, tone: { icon: Flame, dot: "bg-rose-500", iconText: "text-rose-500", chip: "bg-rose-500/10", head: "bg-rose-500/[0.07]", body: "bg-rose-500/[0.02]", stripe: "border-l-rose-400", desc: "Lojas sendo configuradas", trend: "up" } },
  { match: /ativ/i, tone: { icon: null, dot: "bg-emerald-500", iconText: "text-emerald-500", chip: "bg-emerald-500/10", head: "bg-emerald-500/[0.07]", body: "bg-emerald-500/[0.02]", stripe: "border-l-emerald-500", desc: "Lojas gerando pedidos", trend: "up" } },
  { match: /hold/i, tone: { icon: Clock, dot: "bg-orange-500", iconText: "text-orange-500", chip: "bg-orange-500/10", head: "bg-orange-500/[0.08]", body: "bg-orange-500/[0.02]", stripe: "border-l-orange-400", desc: "Lojas pausadas temporariamente", trend: "down" } },
  { match: /reten/i, tone: { icon: Tag, dot: "bg-violet-500", iconText: "text-violet-500", chip: "bg-violet-500/10", head: "bg-violet-500/[0.07]", body: "bg-violet-500/[0.02]", stripe: "border-l-violet-400", desc: "Notas e lojas em observação", trend: "down" } },
  { match: /cemit|encerr/i, tone: { icon: Trash2, dot: "bg-slate-500", iconText: "text-slate-500", chip: "bg-slate-500/10", head: "bg-slate-500/[0.08]", body: "bg-slate-500/[0.02]", stripe: "border-l-slate-400", desc: "Lojas encerradas", trend: "down" } },
];
const DEFAULT_TONE: ColumnTone = { icon: Layers, dot: "bg-primary", iconText: "text-primary", chip: "bg-primary/10", head: "bg-primary/[0.06]", body: "bg-primary/[0.02]", stripe: "border-l-primary/60", desc: null, trend: "up" };

export function columnTone(name: string): ColumnTone {
  return TONES.find((t) => t.match.test(name))?.tone ?? DEFAULT_TONE;
}

export function ToneIcon({ tone, className = "size-5" }: { tone: ColumnTone; className?: string }) {
  if (!tone.icon) return <span className={`size-3 rounded-full ${tone.dot}`} />;
  const Icon = tone.icon;
  return <Icon className={`${className} ${tone.iconText}`} />;
}

function BoardColumn({ column, stores, onEditStore, onAddStore, onRename, onFeaturesChange, onExcludedFromCaixaChange, onSyncPausedChange, onDelete }: {
  column: Column;
  stores: Store[];
  onEditStore: (store: any) => void;
  onAddStore?: (name: string) => void;
  onRename: (name: string) => void;
  onFeaturesChange: (features: ColumnFeature[]) => void;
  onExcludedFromCaixaChange: (excluded: boolean) => void;
  onSyncPausedChange: (paused: boolean) => void;
  onDelete: () => void;
}) {
  const isPending = column.id.startsWith("temp-");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: "column" },
    disabled: isPending,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `col-${column.id}`,
    data: { type: "column-drop", columnId: column.id },
  });
  const tone = columnTone(column.name);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  useEffect(() => { setName(column.name); }, [column.name]);

  const [addingStore, setAddingStore] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const commitAddStore = () => {
    const trimmed = newStoreName.trim();
    if (trimmed) onAddStore?.(trimmed);
    setNewStoreName("");
    setAddingStore(false);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const commitRename = () => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== column.name) onRename(trimmed);
    else setName(column.name);
  };

  // Funções da coluna (as antigas "tags" embaixo do título) — agora no menu.
  const functions = [
    ...column.features.map((f) => FEATURE_LABELS[f]),
    ...(column.excluded_from_caixa ? ["Fora do Caixa"] : []),
    ...(column.sync_paused ? ["Sync pausado"] : []),
  ];

  const addStoreInput = (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={newStoreName}
        onChange={(e) => setNewStoreName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitAddStore();
          if (e.key === "Escape") { setNewStoreName(""); setAddingStore(false); }
        }}
        onBlur={commitAddStore}
        placeholder="Nome da loja"
        className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
      />
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={commitAddStore}
        className="size-9 rounded-lg bg-primary text-primary-foreground grid place-items-center shrink-0"
      >
        <Check className="size-4" />
      </button>
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/col @container flex flex-col rounded-2xl border border-border bg-card flex-1 min-w-[170px] min-h-0 overflow-hidden"
    >
      {/* Cabeçalho (arrasta a coluna) */}
      <div
        {...attributes}
        {...listeners}
        className={`flex items-start gap-2 px-3 py-3 border-b border-border ${tone.head} ${isPending ? "cursor-wait" : "cursor-grab active:cursor-grabbing"}`}
      >
        <div className="size-5 grid place-items-center shrink-0 mt-0.5"><ToneIcon tone={tone} className="size-4.5" /></div>
        <div className="flex-1 min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setName(column.name); setRenaming(false); }
              }}
              className="w-full bg-transparent text-[15px] font-bold outline-none border-b border-primary/50"
            />
          ) : (
            <p className={`text-[13px] @[230px]:text-[15px] font-bold text-foreground truncate ${isPending ? "opacity-50" : ""}`}>{column.name}</p>
          )}
          <p className="text-[11px] text-muted-foreground truncate" title={functions.join(", ")}>
            {tone.desc ?? (functions.join(", ") || "Etapa da esteira")}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={isPending}
                className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-background/70 hover:text-foreground opacity-0 group-hover/col:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                title="Opções da coluna"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil className="size-3.5" /> Renomear
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {FEATURE_ORDER.map((f) => (
                <DropdownMenuCheckboxItem
                  key={f}
                  checked={column.features.includes(f)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...column.features, f]
                      : column.features.filter((x) => x !== f);
                    onFeaturesChange(next);
                  }}
                >
                  {FEATURE_LABELS[f]}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={column.excluded_from_caixa}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => onExcludedFromCaixaChange(checked)}
              >
                Excluir do Caixa
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={column.sync_paused}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => onSyncPausedChange(checked)}
              >
                Pausar sincronização
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="size-3.5" /> Excluir coluna
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-background/80 border border-border/60 grid place-items-center text-xs font-semibold tabular-nums text-foreground">
            {stores.length}
          </span>
        </div>
      </div>

      <div
        ref={setDropRef}
        className={`flex-1 min-h-[160px] overflow-y-auto p-2 space-y-2 transition-colors ${isOver ? "bg-primary/5" : tone.body}`}
      >
        <SortableContext items={stores.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {stores.map((s) => (
            <StoreDragCard key={s.id} store={s} tone={tone} features={column.features} onEdit={() => onEditStore(s)} />
          ))}
        </SortableContext>

        {stores.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-5 text-center">
            <Store3 className="size-8 text-muted-foreground/60 mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground/80">Nenhuma loja nesta etapa</p>
            <p className="text-xs text-muted-foreground mt-1">Arraste uma loja para cá<br />ou adicione uma nova.</p>
            {onAddStore && (
              <div className="mt-4">
                {addingStore ? addStoreInput : (
                  <button
                    onClick={() => setAddingStore(true)}
                    className="w-full h-10 rounded-lg border border-border bg-card text-sm font-medium text-primary hover:bg-primary/5 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="size-4" /> Adicionar loja
                  </button>
                )}
              </div>
            )}
          </div>
        ) : onAddStore && (addingStore ? addStoreInput : (
          <button
            onClick={() => setAddingStore(true)}
            className="w-full h-9 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center gap-1.5 opacity-0 group-hover/col:opacity-100 transition-opacity"
          >
            <Plus className="size-3.5" /> Adicionar loja
          </button>
        ))}
      </div>
    </div>
  );
}

function ShopifyMark({ muted }: { muted?: boolean }) {
  return (
    // Some quando a coluna fica estreita, pra sobrar espaço pro nome.
    <div className={`size-8 rounded-lg hidden @[230px]:grid place-items-center shrink-0 ${muted ? "bg-muted text-muted-foreground" : "bg-[#95BF47]/15 text-[#5E8E3E]"}`}>
      <ShoppingBag className="size-[18px]" strokeWidth={2.2} />
    </div>
  );
}

function StoreDragCard({ store, tone, features, onEdit, dragging }: {
  store: Store; tone?: ColumnTone; features?: ColumnFeature[]; onEdit?: () => void; dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: store.id,
    data: { type: "card" },
    disabled: dragging,
  });
  const domain = store.shop_domain ?? "";
  const storeUrl = domain ? `https://${domain}` : null;
  const t = tone ?? DEFAULT_TONE;

  const style = dragging ? undefined : {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={dragging ? undefined : setNodeRef}
      style={style}
      {...(dragging ? {} : attributes)}
      {...(dragging ? {} : listeners)}
      className={`rounded-xl bg-card border border-border border-l-4 ${t.stripe} p-2.5 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-shadow ${store.is_placeholder ? "border-dashed" : ""} ${dragging ? "shadow-xl w-[280px]" : ""}`}
    >
      <div className="flex items-start gap-2.5">
        <ShopifyMark muted={store.is_placeholder} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{store.name || domain || "Nova loja"}</div>
          {store.is_placeholder ? (
            <span className="mt-1 inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
              Aguardando Shopify
            </span>
          ) : domain && <div className="text-xs text-muted-foreground truncate mt-0.5">{domain}</div>}
        </div>
        {!dragging && (
          <div className="flex items-center shrink-0 -mr-1" onPointerDown={(e) => e.stopPropagation()}>
            {storeUrl && (
              <a
                href={storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="size-6 rounded-md grid place-items-center text-primary hover:bg-primary/10"
                title="Abrir loja"
              >
                <ExternalLink className="size-4" />
              </a>
            )}
            {onEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Editar loja"
              >
                <MoreVertical className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
      {!dragging && !store.is_placeholder && features && features.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {features.includes("hold") && <FeatureBadge feature="hold" store={store} />}
          {/* Média de pedidos e tempo de payout sempre lado a lado — são as
              duas métricas mais lidas de relance no board. */}
          {(features.includes("avg_orders") || features.includes("payout_time")) && (
            <div className="grid grid-cols-2 gap-1.5">
              {features.includes("avg_orders") && <FeatureBadge feature="avg_orders" store={store} />}
              {features.includes("payout_time") && <FeatureBadge feature="payout_time" store={store} />}
            </div>
          )}
          {features.includes("note") && <FeatureBadge feature="note" store={store} />}
        </div>
      )}
    </div>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="w-8 shrink-0 rounded-2xl border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/40 grid place-items-center"
        title="Nova coluna"
      >
        <Plus className="size-4" />
      </button>
    );
  }

  const commit = () => {
    if (val.trim()) onAdd(val.trim());
    setVal("");
    setAdding(false);
  };

  return (
    <div className="w-[260px] shrink-0 self-start rounded-2xl border border-border bg-card p-2 flex items-center gap-1.5">
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setVal(""); setAdding(false); }
        }}
        placeholder="Nome da coluna"
        className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
      />
      <button onClick={commit} className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center shrink-0">
        <Check className="size-4" />
      </button>
      <button onClick={() => { setVal(""); setAdding(false); }} className="size-8 rounded-lg hover:bg-muted grid place-items-center shrink-0 text-muted-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
}

function fmtMoney(amount: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency ?? "USD", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

// Caixinha de métrica: número em destaque + legenda embaixo.
function MetricBox({ icon: Icon, value, label }: { icon: any; value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5 flex items-center gap-2 min-w-0">
      <Icon className="size-4 text-muted-foreground shrink-0 hidden @[230px]:block" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground leading-tight tabular-nums">{value}</p>
        <p className="text-[10px] text-muted-foreground leading-tight truncate">{label}</p>
      </div>
    </div>
  );
}

function FeatureBadge({ feature, store }: { feature: ColumnFeature; store: Store }) {
  if (feature === "hold") return <HoldBadge storeId={store.id} />;
  if (feature === "avg_orders") return <AvgOrdersBadge storeId={store.id} />;
  if (feature === "payout_time") return <PayoutTimeBadge storeId={store.id} />;
  if (feature === "note") return <NoteBadge store={store} />;
  return null;
}

function HoldBadge({ storeId }: { storeId: string }) {
  const fn = useServerFn(getStoreHoldBalance);
  const { data, isLoading } = useQuery({
    queryKey: ["store-hold-balance", storeId],
    queryFn: () => fn({ data: { shopify_store_id: storeId } }),
    staleTime: 5 * 60_000,
  });
  const warn = !!data && data.amount > 0;
  return (
    <div className={`rounded-lg px-2.5 py-2 flex items-center gap-2 text-xs font-medium ${warn ? "bg-orange-500/10 text-orange-700 dark:text-orange-300" : "bg-muted/60 text-muted-foreground"}`}>
      <Clock className="size-4 shrink-0" />
      {isLoading ? "..." : !data ? "-" : `${fmtMoney(data.amount, data.currency)} em hold`}
    </div>
  );
}

function AvgOrdersBadge({ storeId }: { storeId: string }) {
  const fn = useServerFn(getStoreAvgDailyOrders);
  const { data, isLoading } = useQuery({
    queryKey: ["store-avg-orders", storeId],
    queryFn: () => fn({ data: { shopify_store_id: storeId } }),
    staleTime: 5 * 60_000,
  });
  return <MetricBox icon={ShoppingCart} value={isLoading ? "..." : data ? Math.round(data.avgPerDay) : "-"} label="pedidos/dia" />;
}

function PayoutTimeBadge({ storeId }: { storeId: string }) {
  const fn = useServerFn(getStorePayoutTime);
  const { data, isLoading } = useQuery({
    queryKey: ["store-payout-time", storeId],
    queryFn: () => fn({ data: { shopify_store_id: storeId } }),
    staleTime: 5 * 60_000,
  });
  return <MetricBox icon={Clock} value={isLoading ? "..." : data?.avgDays != null ? `${Math.round(data.avgDays)}d` : "-"} label="até payout" />;
}

function NoteBadge({ store }: { store: Store }) {
  const qc = useQueryClient();
  const fn = useServerFn(setStoreBoardNote);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(store.board_note ?? "");
  useEffect(() => { setText(store.board_note ?? ""); }, [store.board_note]);

  const save = useMutation({
    mutationFn: (note: string) => fn({ data: { id: store.id, note: note || null } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shopify-stores"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const commit = () => {
    setEditing(false);
    const trimmed = text.trim();
    if (trimmed !== (store.board_note ?? "")) save.mutate(trimmed);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setText(store.board_note ?? ""); setEditing(false); }
        }}
        placeholder="Escrever nota..."
        className="w-full px-3 h-9 rounded-lg bg-background border border-primary/50 text-xs outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left rounded-lg bg-muted/60 px-3 py-2.5 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
    >
      <StickyNote className="size-4 shrink-0" />
      <span className="truncate">{store.board_note || "Adicionar nota..."}</span>
    </button>
  );
}

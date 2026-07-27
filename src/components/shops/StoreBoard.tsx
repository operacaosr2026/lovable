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
import { GripVertical, Plus, ShoppingBag, ExternalLink, Pencil, X, Trash2, Check, Clock, TrendingUp, Timer, StickyNote, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  listBoardColumns, createBoardColumn, renameBoardColumn, deleteBoardColumn,
  reorderBoardColumns, moveBoardStores, setBoardColumnFeatures, setStoreBoardNote,
  type BOARD_COLUMN_FEATURES,
} from "@/lib/store-board.functions";
import { listShopifyStores } from "@/lib/shop-orders.functions";
import { getStoreHoldBalance, getStoreAvgDailyOrders, getStorePayoutTime } from "@/lib/store-board-metrics.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Store = {
  id: string;
  name: string | null;
  shop_domain: string;
  board_column_id: string | null;
  board_position: number;
  board_note: string | null;
};
type ColumnFeature = (typeof BOARD_COLUMN_FEATURES)[number];
type Column = { id: string; name: string; position: number; features: ColumnFeature[] };

const FEATURE_LABELS: Record<ColumnFeature, string> = {
  hold: "Em Hold",
  avg_orders: "Média de pedidos diários",
  payout_time: "Payouts Time",
  note: "Nota",
};
const FEATURE_ORDER: ColumnFeature[] = ["hold", "avg_orders", "payout_time", "note"];

export function StoreBoard({ onEditStore }: { onEditStore: (store: any) => void }) {
  const qc = useQueryClient();
  const listColumnsFn = useServerFn(listBoardColumns);
  const listStoresFn = useServerFn(listShopifyStores);
  const createColFn = useServerFn(createBoardColumn);
  const renameColFn = useServerFn(renameBoardColumn);
  const deleteColFn = useServerFn(deleteBoardColumn);
  const reorderColsFn = useServerFn(reorderBoardColumns);
  const moveStoresFn = useServerFn(moveBoardStores);
  const setFeaturesFn = useServerFn(setBoardColumnFeatures);
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

  const setColumnFeaturesLocal = (id: string, features: ColumnFeature[]) => {
    const prevColumns = columns;
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, features } : c)));
    setFeatures.mutate({ id, features }, {
      onError: (e: any) => { toast.error(e.message); setColumns(prevColumns); },
    });
  };

  // Optimistic column edits: update local state immediately, let the request
  // reconcile in the background instead of waiting on invalidate+refetch.
  const addColumn = (name: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    setColumns((prev) => [...prev, { id: tempId, name, position: prev.length, features: [] }]);
    setBoard((prev) => ({ ...prev, [tempId]: [] }));
    createColumn.mutate(name, {
      onSuccess: (row: any) => {
        setColumns((prev) => prev.map((c) => (c.id === tempId ? { id: row.id, name: row.name, position: row.position, features: row.features } : c)));
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

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2 items-start">
        <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              stores={board[col.id] ?? []}
              onEditStore={onEditStore}
              onRename={(name) => renameColumnLocal(col.id, name)}
              onFeaturesChange={(features) => setColumnFeaturesLocal(col.id, features)}
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

        <AddColumn onAdd={addColumn} />
      </div>

      <DragOverlay>
        {activeCard && <StoreDragCard store={activeCard} dragging />}
        {activeColumn && (
          <div className="rounded-2xl border border-primary/40 bg-surface shadow-xl w-[300px] px-4 py-3 font-semibold text-sm">
            {activeColumn.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({ column, stores, onEditStore, onRename, onFeaturesChange, onDelete }: {
  column: Column;
  stores: Store[];
  onEditStore: (store: any) => void;
  onRename: (name: string) => void;
  onFeaturesChange: (features: ColumnFeature[]) => void;
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

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  useEffect(() => { setName(column.name); }, [column.name]);

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col rounded-2xl border border-border bg-surface w-[300px] shrink-0 max-h-[calc(100vh-220px)] overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
        <button
          {...attributes}
          {...listeners}
          disabled={isPending}
          className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-muted cursor-grab active:cursor-grabbing shrink-0 disabled:cursor-wait"
        >
          <GripVertical className="size-3.5" />
        </button>
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setName(column.name); setRenaming(false); }
            }}
            className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none border-b border-primary/50"
          />
        ) : (
          <button
            onClick={() => !isPending && setRenaming(true)}
            disabled={isPending}
            className={`flex-1 min-w-0 text-left text-sm font-semibold truncate hover:opacity-70 ${isPending ? "opacity-50" : ""}`}
          >
            {column.name}
          </button>
        )}
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{stores.length}</span>
        <button
          onClick={onDelete}
          disabled={isPending}
          className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0 disabled:opacity-30 disabled:pointer-events-none"
          title="Excluir coluna"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="px-3 py-1.5 border-b border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={isPending}
              className="w-full h-7 px-1.5 rounded-md bg-transparent border border-transparent hover:border-border flex items-center justify-between gap-1 text-[11px] text-muted-foreground outline-none cursor-pointer disabled:cursor-wait"
            >
              <span className="truncate text-left">
                {column.features.length === 0
                  ? "Sem função"
                  : column.features.map((f) => FEATURE_LABELS[f]).join(", ")}
              </span>
              <ChevronDown className="size-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        ref={setDropRef}
        className={`flex-1 overflow-y-auto p-2 space-y-2 min-h-[140px] transition-colors ${isOver ? "bg-primary/5" : ""}`}
      >
        <SortableContext items={stores.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {stores.map((s) => (
            <StoreDragCard key={s.id} store={s} features={column.features} onEdit={() => onEditStore(s)} />
          ))}
        </SortableContext>
        {stores.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Arraste uma loja para cá
          </div>
        )}
      </div>
    </div>
  );
}

function StoreDragCard({ store, features, onEdit, dragging }: {
  store: Store; features?: ColumnFeature[]; onEdit?: () => void; dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: store.id,
    data: { type: "card" },
    disabled: dragging,
  });
  const domain = store.shop_domain ?? "";
  const storeUrl = domain ? `https://${domain}` : null;

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
      className={`group relative rounded-xl bg-background border border-border hover:border-primary/40 p-3 flex items-start gap-2.5 cursor-grab active:cursor-grabbing transition-shadow ${dragging ? "shadow-xl border-primary/40" : ""}`}
    >
      <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
        <ShoppingBag className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{store.name || domain}</div>
        {domain && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{domain}</div>}
        {storeUrl && (
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="size-2.5" /> Abrir loja
          </a>
        )}
        {!dragging && features && features.length > 0 && (
          <div className="mt-2 space-y-1.5" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {features.map((f) => <FeatureBadge key={f} feature={f} store={store} />)}
          </div>
        )}
      </div>
      {onEdit && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 size-6 rounded-md grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
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
        className="w-[300px] shrink-0 h-[46px] rounded-2xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 flex items-center justify-center gap-1.5"
      >
        <Plus className="size-4" /> Nova coluna
      </button>
    );
  }

  const commit = () => {
    if (val.trim()) onAdd(val.trim());
    setVal("");
    setAdding(false);
  };

  return (
    <div className="w-[300px] shrink-0 rounded-2xl border border-border bg-surface p-2 flex items-center gap-1.5">
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

function BadgeShell({ icon: Icon, children, tone }: { icon: any; children: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md ${tone === "warn" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
      <Icon className="size-3 shrink-0" />
      {children}
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
  if (isLoading) return <BadgeShell icon={Clock}>...</BadgeShell>;
  if (!data) return <BadgeShell icon={Clock}>-</BadgeShell>;
  return <BadgeShell icon={Clock} tone={data.amount > 0 ? "warn" : undefined}>{fmtMoney(data.amount, data.currency)} em hold</BadgeShell>;
}

function AvgOrdersBadge({ storeId }: { storeId: string }) {
  const fn = useServerFn(getStoreAvgDailyOrders);
  const { data, isLoading } = useQuery({
    queryKey: ["store-avg-orders", storeId],
    queryFn: () => fn({ data: { shopify_store_id: storeId } }),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <BadgeShell icon={TrendingUp}>...</BadgeShell>;
  if (!data) return <BadgeShell icon={TrendingUp}>-</BadgeShell>;
  return <BadgeShell icon={TrendingUp}>{data.avgPerDay.toFixed(1)} pedidos/dia</BadgeShell>;
}

function PayoutTimeBadge({ storeId }: { storeId: string }) {
  const fn = useServerFn(getStorePayoutTime);
  const { data, isLoading } = useQuery({
    queryKey: ["store-payout-time", storeId],
    queryFn: () => fn({ data: { shopify_store_id: storeId } }),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <BadgeShell icon={Timer}>...</BadgeShell>;
  if (!data || data.avgDays == null) return <BadgeShell icon={Timer}>-</BadgeShell>;
  return <BadgeShell icon={Timer}>{data.avgDays.toFixed(1)}d até payout</BadgeShell>;
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
        className="w-full px-2 h-7 rounded-md bg-background border border-primary/50 text-[11px] outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left"
    >
      <BadgeShell icon={StickyNote}>
        <span className="truncate">{store.board_note || "Adicionar nota..."}</span>
      </BadgeShell>
    </button>
  );
}

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, MoreHorizontal, MoreVertical, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  listProductBoardColumns, createProductBoardColumn, renameProductBoardColumn, deleteProductBoardColumn,
  reorderProductBoardColumns, moveBoardProducts, setProductBoardColumnColor,
} from "@/lib/product-board.functions";
import { createProduct } from "@/lib/products.functions";
import { listProductionProgress } from "@/lib/store-production.functions";
import { BOARD_COLUMN_COLORS } from "@/lib/store-board.functions";
import { AddColumn, COLOR_LABELS, COLOR_TONES, ToneIcon, columnTone, type ColumnTone } from "@/components/shops/StoreBoard";
import { usd } from "@/components/products/product-status";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ColumnColor = (typeof BOARD_COLUMN_COLORS)[number];
type Column = { id: string; name: string; position: number; color: ColumnColor | null };
type Product = {
  id: string; name: string; niche: string | null; cost: number | null; main_image_url: string | null;
  board_column_id: string | null; board_position: number; created_at: string;
};

// Cada coluna é um status do produto. Mesma mecânica do StoreBoard (Banco de
// Lojas): estado local otimista, arrastar cards entre colunas e colunas entre
// si. visible: busca da página — esconde cards sem tirá-los do lugar;
// columnFilter: filtro de status, mostra só essa coluna.
export function ProductBoard({ products, visible, columnFilter = null, onOpen, onEdit, onDelete }: {
  products: Product[]; visible: (p: Product) => boolean; columnFilter?: string | null;
  onOpen: (p: Product) => void; onEdit: (p: Product) => void; onDelete: (p: Product) => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listColumnsFn = useServerFn(listProductBoardColumns);
  const createColFn = useServerFn(createProductBoardColumn);
  const renameColFn = useServerFn(renameProductBoardColumn);
  const deleteColFn = useServerFn(deleteProductBoardColumn);
  const reorderColsFn = useServerFn(reorderProductBoardColumns);
  const moveFn = useServerFn(moveBoardProducts);
  const setColorFn = useServerFn(setProductBoardColumnColor);
  const createProductFn = useServerFn(createProduct);

  const { data: columnsData } = useQuery({ queryKey: ["product-board-columns"], queryFn: () => listColumnsFn() });

  const [columns, setColumns] = useState<Column[]>([]);
  const [board, setBoard] = useState<Record<string, Product[]>>({});
  const dragActive = useRef(false);
  const dragSourceCol = useRef<string | null>(null);

  const refreshProducts = () => qc.invalidateQueries({ queryKey: ["products"] });

  useEffect(() => {
    if (dragActive.current) return;
    setColumns((columnsData ?? []) as Column[]);
  }, [columnsData]);

  useEffect(() => {
    if (dragActive.current) return;
    const cols = (columnsData ?? []) as Column[];
    if (cols.length === 0) { setBoard({}); return; }
    const grouped: Record<string, Product[]> = {};
    for (const c of cols) grouped[c.id] = [];
    const orphans: Product[] = [];
    for (const p of products) {
      if (p.board_column_id && grouped[p.board_column_id]) grouped[p.board_column_id].push(p);
      else orphans.push(p);
    }
    for (const id of Object.keys(grouped)) {
      grouped[id].sort((a, b) => a.board_position - b.board_position || b.created_at.localeCompare(a.created_at));
    }
    if (orphans.length > 0) grouped[cols[0].id] = [...orphans, ...grouped[cols[0].id]];
    setBoard(grouped);
  }, [columnsData, products]);

  const move = useMutation({
    mutationFn: (updates: { id: string; board_column_id: string; board_position: number }[]) => moveFn({ data: { updates } }),
    onError: (e: any) => toast.error(e.message),
  });

  // Produto sem coluna (criado antes da esteira ou com a coluna excluída)
  // fica na primeira coluna — grava pra não depender disso toda vez.
  useEffect(() => {
    const cols = (columnsData ?? []) as Column[];
    if (cols.length === 0) return;
    const ids = new Set(cols.map((c) => c.id));
    const orphans = products.filter((p) => !p.board_column_id || !ids.has(p.board_column_id));
    if (orphans.length === 0) return;
    const rest = products.filter((p) => p.board_column_id === cols[0].id)
      .sort((a, b) => a.board_position - b.board_position);
    moveFn({ data: { updates: [...orphans, ...rest].map((p, i) => ({ id: p.id, board_column_id: cols[0].id, board_position: i })) } })
      .then(refreshProducts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsData, products]);

  const addProduct = useMutation({
    mutationFn: (input: { name: string; board_column_id: string }) => createProductFn({ data: { ...input, cost: 0, sale_price: 0, keywords: [] } }),
    onSuccess: () => {
      refreshProducts();
      qc.invalidateQueries({ queryKey: ["production-progress", "product"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addColumn = (name: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    setColumns((prev) => [...prev, { id: tempId, name, position: prev.length, color: null }]);
    setBoard((prev) => ({ ...prev, [tempId]: [] }));
    createColFn({ data: { name } }).then(
      (row: any) => {
        setColumns((prev) => prev.map((c) => (c.id === tempId ? { id: row.id, name: row.name, position: row.position, color: row.color ?? null } : c)));
        setBoard((prev) => {
          const { [tempId]: items, ...rest } = prev;
          const settled = items ?? [];
          if (settled.length > 0) move.mutate(settled.map((p, i) => ({ id: p.id, board_column_id: row.id, board_position: i })));
          return { ...rest, [row.id]: settled };
        });
        qc.invalidateQueries({ queryKey: ["product-board-columns"] });
      },
      (e: any) => {
        toast.error(e.message);
        setColumns((prev) => prev.filter((c) => c.id !== tempId));
        setBoard((prev) => { const { [tempId]: _drop, ...rest } = prev; return rest; });
      },
    );
  };

  const patchColumn = (id: string, patch: Partial<Column>, request: Promise<unknown>) => {
    const prevColumns = columns;
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    request.then(
      () => qc.invalidateQueries({ queryKey: ["product-board-columns"] }),
      (e: any) => { toast.error(e.message); setColumns(prevColumns); },
    );
  };

  const deleteColumn = async (col: Column) => {
    if ((board[col.id] ?? []).length > 0) {
      toast.error("Mova ou remova os produtos deste status antes de excluí-lo.");
      return;
    }
    if (!(await confirm(`Excluir o status "${col.name}"?`))) return;
    const prevColumns = columns;
    setColumns((prev) => prev.filter((c) => c.id !== col.id));
    deleteColFn({ data: { id: col.id } }).then(
      () => qc.invalidateQueries({ queryKey: ["product-board-columns"] }),
      (e: any) => { toast.error(e.message); setColumns(prevColumns); },
    );
  };

  const [activeCard, setActiveCard] = useState<Product | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const findColumnOf = (id: string): string | null => {
    for (const [colId, items] of Object.entries(board)) if (items.some((p) => p.id === id)) return colId;
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
    if (e.active.data.current?.type === "column") {
      setActiveColumn(columns.find((c) => c.id === e.active.id) ?? null);
      return;
    }
    const colId = findColumnOf(String(e.active.id));
    dragSourceCol.current = colId;
    setActiveCard(colId ? board[colId].find((p) => p.id === e.active.id) ?? null : null);
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
      const idx = sourceItems.findIndex((p) => p.id === activeId);
      if (idx === -1) return prev;
      const moved = sourceItems[idx];
      const destItems = [...(prev[destCol] ?? [])];
      let insertAt = destItems.length;
      if (over.data.current?.type === "card") {
        const overIdx = destItems.findIndex((p) => p.id === String(over.id));
        if (overIdx !== -1) insertAt = overIdx;
      }
      destItems.splice(insertAt, 0, moved);
      return { ...prev, [sourceCol]: sourceItems.filter((_, i) => i !== idx), [destCol]: destItems };
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
      reorderColsFn({ data: { updates: reordered.map((c, i) => ({ id: c.id, position: i })) } })
        .catch((err: any) => toast.error(err.message));
      return;
    }

    const activeId = String(active.id);
    const finalCol = findColumnOf(activeId);
    if (!finalCol) return;
    let finalItems = board[finalCol] ?? [];
    if (over.data.current?.type === "card" && String(over.id) !== activeId) {
      const oldIndex = finalItems.findIndex((p) => p.id === activeId);
      const newIndex = finalItems.findIndex((p) => p.id === String(over.id));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        finalItems = arrayMove(finalItems, oldIndex, newIndex);
        setBoard((prev) => ({ ...prev, [finalCol]: finalItems }));
      }
    }
    if (!finalCol.startsWith("temp-")) {
      move.mutate(finalItems.map((p, i) => ({ id: p.id, board_column_id: finalCol, board_position: i })), { onSuccess: refreshProducts });
    }
    const startCol = dragSourceCol.current;
    if (startCol && startCol !== finalCol && !startCol.startsWith("temp-")) {
      const remaining = board[startCol] ?? [];
      if (remaining.length > 0) move.mutate(remaining.map((p, i) => ({ id: p.id, board_column_id: startCol, board_position: i })));
    }
    dragSourceCol.current = null;
  };

  const shownColumns = columnFilter ? columns.filter((c) => c.id === columnFilter) : columns;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="flex gap-2.5 overflow-x-auto pb-1 items-stretch flex-1 min-h-[480px] lg:min-h-0">
        <SortableContext items={shownColumns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {shownColumns.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              products={(board[col.id] ?? []).filter(visible)}
              onOpen={onOpen}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddProduct={(name) => addProduct.mutate({ name, board_column_id: col.id })}
              onRename={(name) => patchColumn(col.id, { name }, renameColFn({ data: { id: col.id, name } }))}
              onColorChange={(color) => patchColumn(col.id, { color }, setColorFn({ data: { id: col.id, color } }))}
              onDeleteColumn={() => deleteColumn(col)}
            />
          ))}
        </SortableContext>
        {!columnFilter && <AddColumn onAdd={addColumn} />}
      </div>

      <DragOverlay>
        {activeCard && (
          <ProductDragCard
            product={activeCard}
            tone={(() => { const c = columns.find((c) => c.id === dragSourceCol.current); return columnTone(c?.name ?? "", c?.color); })()}
            dragging
          />
        )}
        {activeColumn && (
          <div className="rounded-2xl border border-primary/40 bg-card shadow-xl w-[260px] px-4 py-3 font-bold text-sm">{activeColumn.name}</div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({ column, products, onOpen, onEdit, onDelete, onAddProduct, onRename, onColorChange, onDeleteColumn }: {
  column: Column; products: Product[];
  onOpen: (p: Product) => void; onEdit: (p: Product) => void; onDelete: (p: Product) => void;
  onAddProduct: (name: string) => void; onRename: (name: string) => void;
  onColorChange: (color: ColumnColor | null) => void; onDeleteColumn: () => void;
}) {
  const isPending = column.id.startsWith("temp-");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id, data: { type: "column" }, disabled: isPending,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `col-${column.id}`, data: { type: "column-drop", columnId: column.id } });
  const tone = columnTone(column.name, column.color);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  useEffect(() => { setName(column.name); }, [column.name]);
  const commitRename = () => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== column.name) onRename(trimmed);
    else setName(column.name);
  };

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const commitAdd = () => {
    const trimmed = newName.trim();
    if (trimmed) onAddProduct(trimmed);
    setNewName("");
    setAdding(false);
  };
  const addInput = (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitAdd();
          if (e.key === "Escape") { setNewName(""); setAdding(false); }
        }}
        onBlur={commitAdd}
        placeholder="Nome do produto"
        className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
      />
      <button onMouseDown={(e) => e.preventDefault()} onClick={commitAdd} className="size-9 rounded-lg bg-primary text-primary-foreground grid place-items-center shrink-0">
        <Check className="size-4" />
      </button>
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="group/col @container flex flex-col rounded-2xl border border-border bg-card flex-1 min-w-[220px] min-h-0 overflow-hidden"
    >
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
          <p className="text-[11px] text-muted-foreground truncate">Status</p>
        </div>
        <div className="flex items-center gap-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={isPending}
                className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-background/70 hover:text-foreground opacity-0 group-hover/col:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                title="Editar status"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil className="size-3.5" /> Renomear
              </DropdownMenuItem>
              <div className="px-2 pt-1.5 pb-2">
                <p className="text-xs text-muted-foreground mb-1.5">Cor</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onColorChange(null)}
                    title="Automática (pelo nome)"
                    className={`size-5 rounded-full border border-dashed border-muted-foreground/60 grid place-items-center ${!column.color ? "ring-2 ring-offset-1 ring-offset-popover ring-foreground/60" : ""}`}
                  >
                    {!column.color && <Check className="size-3 text-muted-foreground" />}
                  </button>
                  {BOARD_COLUMN_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => onColorChange(c)}
                      title={COLOR_LABELS[c]}
                      className={`size-5 rounded-full grid place-items-center ${COLOR_TONES[c].dot} ${column.color === c ? "ring-2 ring-offset-1 ring-offset-popover ring-foreground/60" : ""}`}
                    >
                      {column.color === c && <Check className="size-3 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDeleteColumn} className="text-destructive focus:text-destructive">
                <Trash2 className="size-3.5" /> Excluir status
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-background/80 border border-border/60 grid place-items-center text-xs font-semibold tabular-nums text-foreground">
            {products.length}
          </span>
        </div>
      </div>

      <div ref={setDropRef} className={`flex-1 min-h-[160px] overflow-y-auto p-2 space-y-2 transition-colors ${isOver ? "bg-primary/5" : tone.body}`}>
        <SortableContext items={products.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {products.map((p) => (
            <ProductDragCard key={p.id} product={p} tone={tone} onOpen={() => onOpen(p)} onEdit={() => onEdit(p)} onDelete={() => onDelete(p)} />
          ))}
        </SortableContext>

        {products.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-5 text-center">
            <Package className="size-8 text-muted-foreground/60 mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground/80">Nenhum produto neste status</p>
            <p className="text-xs text-muted-foreground mt-1">Arraste um produto para cá<br />ou adicione um novo.</p>
            <div className="mt-4">
              {adding ? addInput : (
                <button
                  onClick={() => setAdding(true)}
                  className="w-full h-10 rounded-lg border border-border bg-card text-sm font-medium text-primary hover:bg-primary/5 flex items-center justify-center gap-1.5"
                >
                  <Plus className="size-4" /> Adicionar produto
                </button>
              )}
            </div>
          </div>
        ) : adding ? addInput : (
          <button
            onClick={() => setAdding(true)}
            className="w-full h-9 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center gap-1.5 opacity-0 group-hover/col:opacity-100 transition-opacity"
          >
            <Plus className="size-3.5" /> Adicionar produto
          </button>
        )}
      </div>
    </div>
  );
}

function ProductDragCard({ product, tone, onOpen, onEdit, onDelete, dragging }: {
  product: Product; tone: ColumnTone; onOpen?: () => void; onEdit?: () => void; onDelete?: () => void; dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id, data: { type: "card" }, disabled: dragging,
  });
  const style = dragging ? undefined : { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div
      ref={dragging ? undefined : setNodeRef}
      style={style}
      {...(dragging ? {} : attributes)}
      {...(dragging ? {} : listeners)}
      onClick={dragging ? undefined : onOpen}
      className={`rounded-xl bg-card border border-border border-l-4 ${tone.stripe} p-2.5 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-shadow ${dragging ? "shadow-xl w-[280px]" : ""}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="size-10 rounded-lg bg-muted/40 overflow-hidden grid place-items-center shrink-0">
          {product.main_image_url
            ? <img src={product.main_image_url} alt={product.name} className="w-full h-full object-cover" draggable={false} />
            : <Package className="size-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">{product.name}</div>
          {product.niche && <div className="mt-0.5 text-[11px] text-muted-foreground truncate">{product.niche}</div>}
          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">Custo: {usd(product.cost ?? 0)}</div>
        </div>
        {!dragging && (onEdit || onDelete) && (
          <div className="shrink-0 -mr-1" onPointerDown={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Mais opções"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {onEdit && (
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil className="size-3.5" /> Editar
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
                    <Trash2 className="size-3.5" /> Excluir produto
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {!dragging && <ProductionProgress productId={product.id} />}
    </div>
  );
}

// Só aparece enquanto o produto tem etapa de produção aberta.
function ProductionProgress({ productId }: { productId: string }) {
  const fn = useServerFn(listProductionProgress);
  const { data } = useQuery({ queryKey: ["production-progress", "product"], queryFn: () => fn({ data: { kind: "product" } }), staleTime: 60_000 });
  const p = data?.[productId];
  if (!p) return null;
  return (
    <div className="mt-2.5" title={`Produção: ${p.done} de ${p.total} etapas`}>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
        <span>Produção</span>
        <span className="tabular-nums">{p.done}/{p.total}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} />
      </div>
    </div>
  );
}

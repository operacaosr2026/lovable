import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, pointerWithin, useSensor, useSensors, useDroppable,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type DropAnimation,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  listTrafficColumns, createTrafficColumn, renameTrafficColumn, setTrafficColumnColor, deleteTrafficColumn,
  reorderTrafficColumns, moveTrafficCards, type TrafficBoard as Board, type TrafficColumn,
} from "@/lib/traffic-board.functions";
import { BOARD_COLUMN_COLORS } from "@/lib/store-board.functions";
import { AddColumn, COLOR_LABELS, COLOR_TONES, ToneIcon, columnTone, type ColumnTone } from "@/components/shops/StoreBoard";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// Esteira de Tráfego (Criativos / Títulos e Descrições). Mesma mecânica das
// esteiras de Produtos e Lojas: estado local otimista, arrastar cards entre
// colunas e colunas entre si. Colunas valem pra todos os produtos.

export type BoardItem = { id: string; column_id: string | null; position: number; created_at: string };
export const trafficColumnsKey = (board: Board) => ["traffic-columns", board];

export function useTrafficColumns(board: Board) {
  const fn = useServerFn(listTrafficColumns);
  return useQuery({ queryKey: trafficColumnsKey(board), queryFn: () => fn({ data: { board } }) });
}

// Alvos de soltar fora das colunas (ex.: pastas em cima da esteira) usam
// useDroppable com data { type: "drop-target", ... } dentro de `header`.
const collision: CollisionDetection = (args) => {
  const targets = pointerWithin(args).filter((c) => c.data?.droppableContainer?.data.current?.type === "drop-target");
  return targets.length ? targets : closestCorners(args);
};
const dropAnimation: DropAnimation = { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

export function TrafficBoard<T extends BoardItem>({
  board, items, visible = () => true, renderCard, onAdd, addLabel, emptyText, onMoved, columnSubtitle, header, onDropToTarget, sort,
}: {
  board: Board; items: T[]; visible?: (item: T) => boolean;
  renderCard: (item: T, ctx: { tone: ColumnTone; dragging: boolean }) => ReactNode;
  onAdd?: (columnId: string) => void; addLabel: string; emptyText: string;
  onMoved: () => void; columnSubtitle?: (count: number) => string;
  header?: ReactNode; onDropToTarget?: (itemId: string, target: Record<string, unknown>) => void;
  // Ordem fixa dentro de cada coluna (ex.: AD01, AD02…). Com ela, arrastar só troca de coluna.
  sort?: (a: T, b: T) => number;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const createFn = useServerFn(createTrafficColumn);
  const renameFn = useServerFn(renameTrafficColumn);
  const colorFn = useServerFn(setTrafficColumnColor);
  const deleteFn = useServerFn(deleteTrafficColumn);
  const reorderFn = useServerFn(reorderTrafficColumns);
  const moveFn = useServerFn(moveTrafficCards);
  const { data: columnsData } = useTrafficColumns(board);
  const key = trafficColumnsKey(board);

  const [columns, setColumns] = useState<TrafficColumn[]>([]);
  const [lanes, setLanes] = useState<Record<string, T[]>>({});
  const dragActive = useRef(false);
  const dragSourceCol = useRef<string | null>(null);
  const lanesAtStart = useRef<Record<string, T[]> | null>(null);
  const [overlayWidth, setOverlayWidth] = useState<number | null>(null);

  useEffect(() => { if (!dragActive.current) setColumns(columnsData ?? []); }, [columnsData]);

  // Card sem coluna (ou de coluna apagada) aparece na primeira.
  useEffect(() => {
    if (dragActive.current) return;
    const cols = columnsData ?? [];
    if (!cols.length) { setLanes({}); return; }
    const grouped: Record<string, T[]> = Object.fromEntries(cols.map((c) => [c.id, [] as T[]]));
    for (const it of items) (grouped[it.column_id ?? ""] ?? grouped[cols[0].id]).push(it);
    for (const id of Object.keys(grouped)) grouped[id].sort(sort ?? ((a, b) => a.position - b.position || b.created_at.localeCompare(a.created_at)));
    setLanes(grouped);
  }, [columnsData, items]);

  const persist = (colId: string, list: T[]) => {
    if (colId.startsWith("temp-")) return Promise.resolve();
    return moveFn({ data: { board, updates: list.map((it, i) => ({ id: it.id, column_id: colId, position: i })) } })
      .then(onMoved, (e: any) => toast.error(e.message));
  };

  const addColumn = (name: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    setColumns((prev) => [...prev, { id: tempId, name, position: prev.length, color: null }]);
    setLanes((prev) => ({ ...prev, [tempId]: [] }));
    createFn({ data: { board, name } }).then(
      () => qc.invalidateQueries({ queryKey: key }),
      (e: any) => { toast.error(e.message); setColumns((prev) => prev.filter((c) => c.id !== tempId)); },
    );
  };

  const patchColumn = (id: string, patch: Partial<TrafficColumn>, request: Promise<unknown>) => {
    const prev = columns;
    setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    request.then(() => qc.invalidateQueries({ queryKey: key }), (e: any) => { toast.error(e.message); setColumns(prev); });
  };

  const deleteColumn = async (col: TrafficColumn) => {
    if ((lanes[col.id] ?? []).length > 0) { toast.error("Mova os itens desta coluna antes de excluí-la."); return; }
    if (!(await confirm(`Excluir a coluna "${col.name}"? Ela some da esteira de todos os produtos.`))) return;
    const prev = columns;
    setColumns((cs) => cs.filter((c) => c.id !== col.id));
    deleteFn({ data: { id: col.id } }).then(() => qc.invalidateQueries({ queryKey: key }), (e: any) => { toast.error(e.message); setColumns(prev); });
  };

  const [activeCard, setActiveCard] = useState<T | null>(null);
  const [activeColumn, setActiveColumn] = useState<TrafficColumn | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const findColumnOf = (id: string) => Object.entries(lanes).find(([, list]) => list.some((it) => it.id === id))?.[0] ?? null;
  const overColumnId = (over: NonNullable<DragEndEvent["over"]>) => {
    const t = over.data.current?.type;
    if (t === "column-drop") return over.data.current?.columnId as string;
    if (t === "card") return findColumnOf(String(over.id));
    if (t === "column") return String(over.id);
    return null; // drop-target (pasta etc.) não mexe nas colunas

  };

  const onDragStart = (e: DragStartEvent) => {
    dragActive.current = true;
    if (e.active.data.current?.type === "column") { setActiveColumn(columns.find((c) => c.id === e.active.id) ?? null); return; }
    const colId = findColumnOf(String(e.active.id));
    dragSourceCol.current = colId;
    lanesAtStart.current = lanes;
    setOverlayWidth(e.active.rect.current.initial?.width ?? null);
    setActiveCard(colId ? lanes[colId].find((it) => it.id === e.active.id) ?? null : null);
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over || active.data.current?.type === "column") return;
    const activeId = String(active.id);
    const src = findColumnOf(activeId);
    const dest = overColumnId(over);
    if (!src || !dest || src === dest) return;
    setLanes((prev) => {
      const from = prev[src] ?? [];
      const idx = from.findIndex((it) => it.id === activeId);
      if (idx === -1) return prev;
      const to = [...(prev[dest] ?? [])];
      const overIdx = over.data.current?.type === "card" ? to.findIndex((it) => it.id === String(over.id)) : -1;
      to.splice(overIdx === -1 ? to.length : overIdx, 0, from[idx]);
      if (sort) to.sort(sort);
      return { ...prev, [src]: from.filter((_, i) => i !== idx), [dest]: to };
    });
  };

  const resetDrag = () => {
    dragActive.current = false;
    setActiveCard(null);
    setActiveColumn(null);
  };

  const onDragCancel = () => {
    resetDrag();
    if (lanesAtStart.current) setLanes(lanesAtStart.current);
    lanesAtStart.current = null;
    dragSourceCol.current = null;
  };

  const onDragEnd = (e: DragEndEvent) => {
    resetDrag();
    const { active, over } = e;
    if (!over) { onDragCancel(); return; }

    // Soltou numa pasta (ou outro alvo de fora): o card volta pro lugar e quem chamou decide.
    if (over.data.current?.type === "drop-target") {
      if (lanesAtStart.current) setLanes(lanesAtStart.current);
      lanesAtStart.current = null;
      dragSourceCol.current = null;
      onDropToTarget?.(String(active.id), over.data.current as Record<string, unknown>);
      return;
    }
    lanesAtStart.current = null;

    if (active.data.current?.type === "column") {
      const oldIndex = columns.findIndex((c) => c.id === active.id);
      const newIndex = columns.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(columns, oldIndex, newIndex);
      setColumns(reordered);
      reorderFn({ data: { updates: reordered.map((c, i) => ({ id: c.id, position: i })) } })
        .then(() => qc.invalidateQueries({ queryKey: key }), (err: any) => toast.error(err.message));
      return;
    }

    const activeId = String(active.id);
    const finalCol = findColumnOf(activeId);
    if (!finalCol) return;
    let list = lanes[finalCol] ?? [];
    if (!sort && over.data.current?.type === "card" && String(over.id) !== activeId) {
      const a = list.findIndex((it) => it.id === activeId);
      const b = list.findIndex((it) => it.id === String(over.id));
      if (a !== -1 && b !== -1 && a !== b) {
        list = arrayMove(list, a, b);
        setLanes((prev) => ({ ...prev, [finalCol]: list }));
      }
    }
    persist(finalCol, list);
    const startCol = dragSourceCol.current;
    if (startCol && startCol !== finalCol && (lanes[startCol] ?? []).length) persist(startCol, lanes[startCol]);
    dragSourceCol.current = null;
  };

  if (!columnsData) return <div className="h-64 rounded-2xl border border-border bg-card animate-pulse" />;

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      {header}
      <div className="flex gap-2.5 overflow-x-auto pb-2 items-stretch min-h-[460px]">
        <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {columns.map((col) => (
            <Lane
              key={col.id}
              column={col}
              items={(lanes[col.id] ?? []).filter(visible)}
              renderCard={renderCard}
              onAdd={onAdd ? () => onAdd(col.id) : undefined}
              addLabel={addLabel}
              emptyText={emptyText}
              subtitle={columnSubtitle}
              fixedOrder={!!sort}
              onRename={(name) => patchColumn(col.id, { name }, renameFn({ data: { id: col.id, name } }))}
              onColorChange={(color) => patchColumn(col.id, { color }, colorFn({ data: { id: col.id, color } }))}
              onDelete={() => deleteColumn(col)}
            />
          ))}
        </SortableContext>
        <AddColumn onAdd={addColumn} />
      </div>
      {/* Fora da janela do produto: dentro dela (que é centralizada com transform)
          a cópia do card ficava deslocada do cursor. */}
      {typeof document !== "undefined" && createPortal(
        <DragOverlay dropAnimation={dropAnimation} zIndex={1000}>
          {activeCard && (() => {
            const c = columns.find((x) => x.id === dragSourceCol.current);
            return (
              <div style={{ width: overlayWidth ?? 260 }} className="cursor-grabbing rotate-[1.5deg] scale-[1.02] transition-transform">
                {renderCard(activeCard, { tone: columnTone(c?.name ?? "", c?.color), dragging: true })}
              </div>
            );
          })()}
          {activeColumn && <div className="rounded-2xl border border-primary/40 bg-card shadow-xl w-[260px] px-4 py-3 font-bold text-sm cursor-grabbing">{activeColumn.name}</div>}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

function Lane<T extends BoardItem>({ column, items, renderCard, onAdd, addLabel, emptyText, subtitle, fixedOrder, onRename, onColorChange, onDelete }: {
  column: TrafficColumn; items: T[]; renderCard: (item: T, ctx: { tone: ColumnTone; dragging: boolean }) => ReactNode;
  onAdd?: () => void; addLabel: string; emptyText: string; subtitle?: (count: number) => string; fixedOrder?: boolean;
  onRename: (name: string) => void; onColorChange: (color: TrafficColumn["color"]) => void; onDelete: () => void;
}) {
  const pending = column.id.startsWith("temp-");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, data: { type: "column" }, disabled: pending });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `col-${column.id}`, data: { type: "column-drop", columnId: column.id } });
  const tone = columnTone(column.name, column.color);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  useEffect(() => setName(column.name), [column.name]);
  const commit = () => {
    setRenaming(false);
    const t = name.trim();
    if (t && t !== column.name) onRename(t); else setName(column.name);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="group/col flex flex-col rounded-2xl border border-border bg-card flex-1 min-w-[250px] max-w-[340px] overflow-hidden"
    >
      <div {...attributes} {...listeners} className={`flex items-center gap-2 px-3 py-2.5 border-b border-border ${tone.head} ${pending ? "cursor-wait" : "cursor-grab active:cursor-grabbing"}`}>
        <div className="size-5 grid place-items-center shrink-0"><ToneIcon tone={tone} className="size-4" /></div>
        <div className="flex-1 min-w-0">
          {renaming ? (
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setName(column.name); setRenaming(false); } }}
              className="w-full bg-transparent text-sm font-bold outline-none border-b border-primary/50"
            />
          ) : (
            <p className={`text-sm font-bold truncate ${pending ? "opacity-50" : ""}`}>{column.name}</p>
          )}
          {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle(items.length)}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button disabled={pending} title="Editar coluna" className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-background/70 hover:text-foreground opacity-0 group-hover/col:opacity-100 data-[state=open]:opacity-100 transition-opacity">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil className="size-3.5" /> Renomear</DropdownMenuItem>
              <div className="px-2 pt-1.5 pb-2">
                <p className="text-xs text-muted-foreground mb-1.5">Cor</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => onColorChange(null)} title="Automática (pelo nome)"
                    className={`size-5 rounded-full border border-dashed border-muted-foreground/60 grid place-items-center ${!column.color ? "ring-2 ring-offset-1 ring-offset-popover ring-foreground/60" : ""}`}>
                    {!column.color && <Check className="size-3 text-muted-foreground" />}
                  </button>
                  {BOARD_COLUMN_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => onColorChange(c)} title={COLOR_LABELS[c]}
                      className={`size-5 rounded-full grid place-items-center ${COLOR_TONES[c].dot} ${column.color === c ? "ring-2 ring-offset-1 ring-offset-popover ring-foreground/60" : ""}`}>
                      {column.color === c && <Check className="size-3 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="size-3.5" /> Excluir coluna</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-background/80 border border-border/60 grid place-items-center text-xs font-semibold tabular-nums">{items.length}</span>
        </div>
      </div>

      <div ref={setDropRef} className={`flex-1 min-h-[160px] max-h-[68vh] overflow-y-auto p-2 space-y-2 transition-colors ${isOver ? "bg-primary/5" : tone.body}`}>
        {/* Ordem fixa: os cards não abrem espaço ao passar por cima (o lugar é pela ordem). */}
        <SortableContext items={items.map((it) => it.id)} strategy={fixedOrder ? () => null : verticalListSortingStrategy}>
          {items.map((it) => <SortableCard key={it.id} id={it.id}>{renderCard(it, { tone, dragging: false })}</SortableCard>)}
        </SortableContext>
        {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6 px-2">{emptyText}</p>}
        {onAdd && (
          <button onClick={onAdd} className={`w-full h-9 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/40 flex items-center justify-center gap-1.5 transition-opacity ${items.length ? "opacity-0 group-hover/col:opacity-100" : ""}`}>
            <Plus className="size-3.5" /> {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function SortableCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { type: "card" } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners}
      className={isDragging ? "rounded-xl outline-2 outline-dashed outline-primary/30 [&>*]:invisible bg-primary/5" : "cursor-grab active:cursor-grabbing touch-none"}>
      {children}
    </div>
  );
}

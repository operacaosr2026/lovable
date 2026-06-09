import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ReactFlow, ReactFlowProvider, Controls, MiniMap,
  Handle, Position, applyNodeChanges, applyEdgeChanges,
  BaseEdge, getBezierPath,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
  type EdgeProps,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Plus, Trash2, GitBranch, Palette, Type, Spline, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Network, MoveHorizontal, MoveVertical, Target, ChevronDown, ChevronRight } from "lucide-react";

const INLINE_TEXT_COLORS = ["#0f172a", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0284c7", "#7c3aed", "#db2777", "#ffffff"];
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
import { getWhiteboard, updateWhiteboard } from "@/lib/whiteboards.functions";
import {
  listBoardContent, createNode, updateNode, deleteNode,
  createEdge, deleteEdge,
} from "@/lib/whiteboard-nodes.functions";

export const Route = createFileRoute("/whiteboard/$boardId")({
  component: () => (
    <ReactFlowProvider>
      <BoardPage />
    </ReactFlowProvider>
  ),
});

// ---------------- Palettes ----------------
const CARD_BG_OPTIONS = [
  "#ffffff", "#fef3c7", "#fee2e2", "#dcfce7", "#dbeafe",
  "#ede9fe", "#fce7f3", "#cffafe", "#fef0c7", "#1f2937",
];
const CARD_FG_OPTIONS = [
  "#0f172a", "#475569", "#7c3aed", "#dc2626", "#059669",
  "#0284c7", "#d97706", "#ffffff",
];
const EDGE_DASH_OPTIONS: { id: "solid" | "dashed" | "dotted"; label: string; dash: string }[] = [
  { id: "solid", label: "Sólida", dash: "0" },
  { id: "dashed", label: "Tracejada", dash: "8 6" },
  { id: "dotted", label: "Pontilhada", dash: "2 6" },
];

type EdgeStyle = { thickness: number; dash: "solid" | "dashed" | "dotted" };
type LayoutType = "horizontal" | "vertical" | "radial";

const LAYOUT_OPTIONS: { id: LayoutType; label: string; Icon: any }[] = [
  { id: "horizontal", label: "Horizontal", Icon: MoveHorizontal },
  { id: "vertical", label: "Vertical", Icon: MoveVertical },
  { id: "radial", label: "Radial", Icon: Target },
];

function readEdgeStyle(viewport: any): EdgeStyle {
  return {
    thickness: typeof viewport?.edgeThickness === "number" ? viewport.edgeThickness : 2,
    dash: ["solid", "dashed", "dotted"].includes(viewport?.edgeDash) ? viewport.edgeDash : "solid",
  };
}

function readLayoutType(viewport: any): LayoutType {
  return ["horizontal", "vertical", "radial"].includes(viewport?.layoutType) ? viewport.layoutType : "horizontal";
}

function BoardPage() {
  const { boardId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getBoardFn = useServerFn(getWhiteboard);
  const updateBoardFn = useServerFn(updateWhiteboard);
  const listFn = useServerFn(listBoardContent);

  const { data: boardData } = useQuery({
    queryKey: ["whiteboard", boardId],
    queryFn: () => getBoardFn({ data: { id: boardId } }),
  });
  const { data: content, isLoading } = useQuery({
    queryKey: ["whiteboard-content", boardId],
    queryFn: () => listFn({ data: { boardId } }),
  });
  const board: any = (boardData as any)?.board;
  const nodesData: any[] = (content as any)?.nodes ?? [];
  const edgesData: any[] = (content as any)?.edges ?? [];

  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState("");
  useEffect(() => { if (board?.name) setRenaming(board.name); }, [board?.name]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["whiteboard-content", boardId] });
  const color = board?.color ?? "oklch(0.6 0.22 285)";
  const edgeStyle = useMemo(() => readEdgeStyle(board?.viewport), [board?.viewport]);
  const layoutType = useMemo(() => readLayoutType(board?.viewport), [board?.viewport]);

  const patchViewport = useCallback(async (patch: Record<string, any>) => {
    qc.setQueryData(["whiteboard", boardId], (old: any) => {
      if (!old?.board) return old;
      return { ...old, board: { ...old.board, viewport: { ...(old.board.viewport ?? {}), ...patch } } };
    });
    await updateBoardFn({
      data: { id: boardId, patch: { viewport: { ...(board?.viewport ?? {}), ...patch } } },
    });
  }, [qc, boardId, updateBoardFn, board?.viewport]);

  const setEdgeStyle = useCallback(async (next: Partial<EdgeStyle>) => {
    const merged = { ...edgeStyle, ...next };
    await patchViewport({ edgeThickness: merged.thickness, edgeDash: merged.dash });
  }, [edgeStyle, patchViewport]);

  const setLayoutType = useCallback(async (next: LayoutType) => {
    await patchViewport({ layoutType: next });
  }, [patchViewport]);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>;
  if (!board) return <div className="p-8 text-sm text-muted-foreground">Quadro não encontrado.</div>;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border bg-surface/40 backdrop-blur px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate({ to: "/whiteboard" })}
          className="size-9 grid place-items-center rounded-lg border border-border bg-surface hover:bg-surface-hover"
          title="Voltar"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div
          className="size-9 rounded-lg grid place-items-center shrink-0"
          style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}
        >
          <GitBranch className="size-4" />
        </div>
        <input
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => {
            if (renaming.trim() && renaming !== board.name) {
              updateBoardFn({ data: { id: boardId, patch: { name: renaming.trim() } } })
                .then(() => qc.invalidateQueries({ queryKey: ["whiteboards"] }));
            }
          }}
          className="px-3 h-9 rounded-lg bg-surface border border-border text-sm font-semibold outline-none focus:border-primary min-w-[200px] flex-1 max-w-md"
        />

        {/* Layout selector */}
        <LayoutSelector value={layoutType} onChange={setLayoutType} />

        {/* Edge style controls */}
        <EdgeStyleControls value={edgeStyle} onChange={setEdgeStyle} />
      </div>

      <div className="flex-1 min-h-0">
        <CanvasView
          boardId={boardId}
          color={color}
          edgeStyle={edgeStyle}
          layoutType={layoutType}
          nodesData={nodesData}
          edgesData={edgesData}
          selected={selected}
          onSelect={setSelected}
          refresh={refresh}
        />
      </div>
    </div>
  );
}

// ---------------- Top-bar edge controls ----------------

function EdgeStyleControls({ value, onChange }: { value: EdgeStyle; onChange: (p: Partial<EdgeStyle>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-9 px-3 rounded-lg border border-border bg-surface hover:bg-surface-hover text-xs font-medium flex items-center gap-1.5"
        title="Estilo das linhas"
      >
        <Spline className="size-3.5" /> Linhas
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-border bg-surface shadow-xl p-3 space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Tipo</div>
              <div className="grid grid-cols-3 gap-1.5">
                {EDGE_DASH_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => onChange({ dash: o.id })}
                    className={`h-9 rounded-md text-[11px] font-medium border flex items-center justify-center gap-1.5 transition ${value.dash === o.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted"}`}
                  >
                    <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray={o.dash} /></svg>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Espessura</div>
                <div className="text-[11px] font-medium tabular-nums">{value.thickness}px</div>
              </div>
              <input
                type="range" min={1} max={8} step={1} value={value.thickness}
                onChange={(e) => onChange({ thickness: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LayoutSelector({ value, onChange }: { value: LayoutType; onChange: (v: LayoutType) => void }) {
  return (
    <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      {LAYOUT_OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          title={label}
          className={`h-7 px-2.5 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition ${value === id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

// ---------------- Card ----------------

function MindCardNode({ id, data, selected }: any) {
  const accent = data.accent ?? "oklch(0.6 0.22 285)";
  const bg = data.bg ?? "#ffffff";
  const fg = data.fg ?? "#0f172a";
  const fontSize = typeof data.fontSize === "number" ? data.fontSize : 13.5;
  const bold = data.bold !== false;
  const italic = !!data.italic;
  const underline = !!data.underline;
  const align: "left" | "center" | "right" = data.align ?? "left";
  const [editing, setEditing] = useState(false);
  const [selRect, setSelRect] = useState<{ x: number; y: number } | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    const el = rootRef.current;
    const report = () => data.onMeasure?.(id, el.offsetHeight, el.offsetWidth);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, data.onMeasure]);

  useEffect(() => {
    if (editing && editorRef.current) {
      const el = editorRef.current;
      el.innerHTML = data.titleHtml || escapeHtml(data.title || "");
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (!editing) { setSelRect(null); return; }
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !editorRef.current) { setSelRect(null); return; }
      const node = sel.anchorNode;
      if (!node || !editorRef.current.contains(node)) { setSelRect(null); return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { setSelRect(null); return; }
      setSelRect({ x: r.left + r.width / 2, y: r.top });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editing]);

  useEffect(() => {
    if (data.autoEdit) {
      setEditing(true);
      data.onConsumeAutoEdit?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.autoEdit]);

  const commit = () => {
    setEditing(false);
    setSelRect(null);
    const html = editorRef.current?.innerHTML ?? "";
    const text = (editorRef.current?.innerText ?? "").trim();
    const cleanText = text || "Sem título";
    if (html !== (data.titleHtml ?? "") || cleanText !== (data.title ?? "")) {
      data.onRename?.(cleanText, html);
    }
  };

  const exec = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };

  const textStyle: React.CSSProperties = {
    color: fg,
    fontSize: `${fontSize}px`,
    fontWeight: bold ? 600 : 400,
    fontStyle: italic ? "italic" : "normal",
    textDecoration: underline ? "underline" : "none",
    textAlign: align,
  };

  const displayHtml = data.titleHtml || (data.title ? escapeHtml(data.title) : "");

  return (
    <div
      ref={rootRef}
      className={`group relative rounded-2xl min-w-[180px] max-w-[260px] transition-all duration-200 ease-out
        ${selected ? "ring-2 ring-offset-2 ring-offset-background" : "ring-0"}`}
      style={{
        background: bg,
        boxShadow: selected
          ? `0 20px 50px -18px ${accent}, 0 4px 12px rgba(15,23,42,.08)`
          : "0 1px 2px rgba(15,23,42,.04), 0 10px 28px -16px rgba(15,23,42,.12)",
        // @ts-ignore
        "--tw-ring-color": accent,
      }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      <div
        className="absolute left-0 top-3 bottom-3 w-1 rounded-full"
        style={{ background: `linear-gradient(180deg, ${accent}, color-mix(in oklab, ${accent} 55%, transparent))` }}
      />
      <Handle type="target" position={data.layoutType === "vertical" ? Position.Top : Position.Left} />
      <Handle type="source" position={data.layoutType === "vertical" ? Position.Bottom : Position.Right} id="src-main" />
      <div className="pl-4 pr-3 py-3">
        {editing ? (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); setSelRect(null); }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={textStyle}
            className="nodrag nopan leading-snug tracking-[-0.01em] whitespace-pre-wrap break-words outline-none"
          />
        ) : (
          <div
            className="leading-snug tracking-[-0.01em] whitespace-pre-wrap break-words"
            style={textStyle}
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            dangerouslySetInnerHTML={{ __html: displayHtml || `<span style="opacity:.5">Sem título</span>` }}
          />
        )}
      </div>
      <button
        tabIndex={selected ? 0 : -1}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); data.onAddChild?.(); }}
        title="Adicionar card"
        className={`nodrag nopan absolute size-7 rounded-full text-white grid place-items-center shadow-lg transition-all hover:scale-110 focus-visible:outline-none ${data.layoutType === "vertical" ? "-bottom-10 left-1/2 -translate-x-1/2" : "-right-10 top-1/2 -translate-y-1/2"} ${selected ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        style={{ background: accent, boxShadow: `0 6px 18px -4px ${accent}` }}
      >
        <Plus className="size-3.5" strokeWidth={3} />
      </button>

      {data.hasChildren && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); data.onToggleCollapse?.(); }}
          title={data.collapsed ? "Expandir ramo" : "Recolher ramo"}
          className={`nodrag nopan absolute size-5 rounded-full bg-white border grid place-items-center shadow-md hover:scale-110 transition-all ${data.layoutType === "vertical" ? "-bottom-3 left-1/2 -translate-x-1/2" : "-right-3 top-1/2 -translate-y-1/2"}`}
          style={{ borderColor: `color-mix(in oklab, ${accent} 55%, transparent)`, color: accent }}
        >
          {data.collapsed ? <ChevronRight className="size-3" strokeWidth={3} /> : <ChevronDown className="size-3" strokeWidth={3} />}
        </button>
      )}

      {editing && selRect && typeof document !== "undefined" && createPortal(
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{ position: "fixed", left: selRect.x, top: Math.max(8, selRect.y - 44), transform: "translateX(-50%)", zIndex: 1000 }}
          className="rounded-lg border border-border bg-popover shadow-xl px-1.5 py-1 flex items-center gap-1"
        >
          <button onClick={() => exec("bold")} className="size-7 rounded hover:bg-muted grid place-items-center" title="Negrito"><Bold className="size-3.5" /></button>
          <button onClick={() => exec("italic")} className="size-7 rounded hover:bg-muted grid place-items-center" title="Itálico"><Italic className="size-3.5" /></button>
          <button onClick={() => exec("underline")} className="size-7 rounded hover:bg-muted grid place-items-center" title="Sublinhado"><Underline className="size-3.5" /></button>
          <div className="w-px h-5 bg-border mx-0.5" />
          {INLINE_TEXT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => exec("foreColor", c)}
              className="size-5 rounded border border-border/60 hover:scale-110 transition"
              style={{ background: c }}
              title={`Cor ${c}`}
            />
          ))}
          <div className="w-px h-5 bg-border mx-0.5" />
          <button onClick={() => exec("removeFormat")} className="h-7 px-1.5 rounded hover:bg-muted text-[10px] font-medium" title="Limpar">Limpar</button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function MindEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps) {
  const [path] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.45,
  });
  const accent = (data as any)?.accent ?? "oklch(0.6 0.22 285)";
  const thickness = (data as any)?.thickness ?? 2;
  const dash = (data as any)?.dash ?? "solid";
  const dashArray = dash === "dashed" ? `${thickness * 4} ${thickness * 3}`
    : dash === "dotted" ? `${thickness} ${thickness * 3}` : undefined;
  const gradId = `wb-grad-${id}`;
  return (
    <>
      <defs>
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        style={{
          ...style,
          stroke: `url(#${gradId})`,
          strokeWidth: thickness,
          strokeDasharray: dashArray,
          strokeLinecap: dash === "dotted" ? "round" : "butt",
          fill: "none",
        }}
      />
    </>
  );
}

const nodeTypes = { mindStep: MindCardNode };
const edgeTypes = { mind: MindEdge };

function computeLayout(
  type: LayoutType,
  items: any[],
  parentMap: Record<string, string | null>,
  sizes: Record<string, { w: number; h: number }>,
): Record<string, { x: number; y: number }> {
  const NODE_W_DEFAULT = 240, NODE_H_DEFAULT = 64;
  const sizeOf = (id: string) => sizes[id] ?? { w: NODE_W_DEFAULT, h: NODE_H_DEFAULT };

  const byParent: Record<string, any[]> = {};
  for (const s of items) {
    const k = parentMap[s.id] ?? "__root";
    (byParent[k] ||= []).push(s);
  }
  for (const k of Object.keys(byParent)) {
    byParent[k].sort((a, b) => {
      const ax = a.created_at ?? a.id, bx = b.created_at ?? b.id;
      return ax < bx ? -1 : ax > bx ? 1 : 0;
    });
  }

  const pos: Record<string, { x: number; y: number }> = {};
  const roots = byParent["__root"] ?? [];

  if (type === "horizontal") {
    const X_GAP = 110, Y_GAP = 28;
    // subtree height = max(own height, sum(children subtree heights) + gaps)
    const subH: Record<string, number> = {};
    const measureH = (id: string): number => {
      if (subH[id] != null) return subH[id];
      const kids = byParent[id] ?? [];
      const own = sizeOf(id).h;
      if (!kids.length) return (subH[id] = own);
      const total = kids.reduce((a, k) => a + measureH(k.id), 0) + (kids.length - 1) * Y_GAP;
      return (subH[id] = Math.max(own, total));
    };
    const place = (id: string, depth: number, topY: number) => {
      const sh = measureH(id);
      const oh = sizeOf(id).h;
      pos[id] = { x: depth * (NODE_W_DEFAULT + X_GAP), y: topY + sh / 2 - oh / 2 };
      const kids = byParent[id] ?? [];
      const kidsTotal = kids.reduce((a, k) => a + measureH(k.id), 0) + Math.max(0, kids.length - 1) * Y_GAP;
      let c = topY + sh / 2 - kidsTotal / 2;
      for (const k of kids) {
        const kh = measureH(k.id);
        place(k.id, depth + 1, c);
        c += kh + Y_GAP;
      }
    };
    let cursor = 0;
    for (const r of roots) {
      place(r.id, 0, cursor);
      cursor += measureH(r.id) + Y_GAP;
    }
  } else if (type === "vertical") {
    const X_GAP = 32, Y_GAP = 90;
    const subW: Record<string, number> = {};
    const measureW = (id: string): number => {
      if (subW[id] != null) return subW[id];
      const kids = byParent[id] ?? [];
      const own = sizeOf(id).w;
      if (!kids.length) return (subW[id] = own);
      const total = kids.reduce((a, k) => a + measureW(k.id), 0) + (kids.length - 1) * X_GAP;
      return (subW[id] = Math.max(own, total));
    };
    // depth-based y: stack each level using max child height in that level — simpler: per-row max
    const place = (id: string, y: number, leftX: number) => {
      const sw = measureW(id);
      const ow = sizeOf(id).w;
      const oh = sizeOf(id).h;
      pos[id] = { x: leftX + sw / 2 - ow / 2, y };
      const kids = byParent[id] ?? [];
      const kidsTotal = kids.reduce((a, k) => a + measureW(k.id), 0) + Math.max(0, kids.length - 1) * X_GAP;
      let c = leftX + sw / 2 - kidsTotal / 2;
      const nextY = y + oh + Y_GAP;
      for (const k of kids) {
        const kw = measureW(k.id);
        place(k.id, nextY, c);
        c += kw + X_GAP;
      }
    };
    let cursor = 0;
    for (const r of roots) {
      place(r.id, 0, cursor);
      cursor += measureW(r.id) + X_GAP;
    }
  } else {
    // radial — keep slot-based approximation
    const slotsOf: Record<string, number> = {};
    const computeSlots = (id: string): number => {
      const kids = byParent[id] ?? [];
      if (!kids.length) return (slotsOf[id] = 1);
      return (slotsOf[id] = kids.reduce((a, k) => a + computeSlots(k.id), 0));
    };
    for (const r of roots) computeSlots(r.id);
    const RING = 280;
    const placeRadial = (id: string, depth: number, angleStart: number, angleEnd: number) => {
      const mid = (angleStart + angleEnd) / 2;
      const s = sizeOf(id);
      if (depth === 0) {
        pos[id] = { x: -s.w / 2, y: -s.h / 2 };
      } else {
        pos[id] = {
          x: Math.cos(mid) * depth * RING - s.w / 2,
          y: Math.sin(mid) * depth * RING - s.h / 2,
        };
      }
      const kids = byParent[id] ?? [];
      const total = slotsOf[id] ?? 1;
      let c = angleStart;
      for (const k of kids) {
        const ks = slotsOf[k.id] ?? 1;
        const span = (angleEnd - angleStart) * (ks / total);
        placeRadial(k.id, depth + 1, c, c + span);
        c += span;
      }
    };
    const totalRoots = roots.reduce((a, r) => a + (slotsOf[r.id] ?? 1), 0) || 1;
    let cursor = -Math.PI / 2;
    const TAU = Math.PI * 2;
    for (const r of roots) {
      const ks = slotsOf[r.id] ?? 1;
      const span = TAU * (ks / totalRoots);
      placeRadial(r.id, 0, cursor, cursor + span);
      cursor += span;
    }
  }
  return pos;
}

function CanvasView({ boardId, color, edgeStyle, layoutType, nodesData, edgesData, selected, onSelect, refresh }: any) {
  const rf = useReactFlow();
  const qc = useQueryClient();
  const createNodeFn = useServerFn(createNode);
  const updateNodeFn = useServerFn(updateNode);
  const deleteNodeFn = useServerFn(deleteNode);
  const createEdgeFn = useServerFn(createEdge);
  const deleteEdgeFn = useServerFn(deleteEdge);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const addingChildForRef = useRef<string | null>(null);
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  // Persist collapsed branches per board in localStorage
  const collapsedStorageKey = `wb-collapsed:${boardId}`;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(collapsedStorageKey) || "[]")); } catch { return new Set(); }
  });
  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(collapsedStorageKey, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }, [collapsedStorageKey]);
  const sizesRef = useRef<Record<string, { w: number; h: number }>>({});
  const [sizesVersion, setSizesVersion] = useState(0);
  const onMeasure = useCallback((id: string, h: number, w?: number) => {
    const cur = sizesRef.current[id];
    const nw = w ?? cur?.w ?? 240;
    if (cur && Math.abs(cur.h - h) < 0.5 && Math.abs(cur.w - nw) < 0.5) return;
    sizesRef.current = { ...sizesRef.current, [id]: { w: nw, h } };
    setSizesVersion((v) => v + 1);
  }, []);

  const mutateCache = useCallback((fn: (d: any) => any) => {
    qc.setQueryData(["whiteboard-content", boardId], (old: any) => {
      if (!old) return old;
      return fn({ ...old, nodes: [...(old.nodes ?? [])], edges: [...(old.edges ?? [])] });
    });
  }, [qc, boardId]);

  const optimisticAdd = useCallback((n: any) => mutateCache((d) => { d.nodes.push(n); return d; }), [mutateCache]);
  const optimisticAddEdge = useCallback((e: any) => mutateCache((d) => { d.edges.push(e); return d; }), [mutateCache]);
  const optimisticReplaceNodeId = useCallback((tempId: string, realId: string) => mutateCache((d) => {
    d.nodes = d.nodes.map((n: any) => n.id === tempId ? { ...n, id: realId } : n);
    d.edges = d.edges.map((e: any) => ({
      ...e,
      source_node_id: e.source_node_id === tempId ? realId : e.source_node_id,
      target_node_id: e.target_node_id === tempId ? realId : e.target_node_id,
    }));
    return d;
  }), [mutateCache]);
  const optimisticReplaceEdgeId = useCallback((tempId: string, realId: string) => mutateCache((d) => {
    d.edges = d.edges.map((e: any) => e.id === tempId ? { ...e, id: realId } : e);
    return d;
  }), [mutateCache]);
  const optimisticRemove = useCallback((id: string) => mutateCache((d) => {
    d.nodes = d.nodes.filter((n: any) => n.id !== id && n.parent_id !== id);
    d.edges = d.edges.filter((e: any) => e.source_node_id !== id && e.target_node_id !== id);
    return d;
  }), [mutateCache]);
  const optimisticUpdate = useCallback((id: string, patch: any) => mutateCache((d) => {
    d.nodes = d.nodes.map((n: any) => n.id === id ? { ...n, data: { ...n.data, ...(patch.data ?? {}) }, ...(patch.x !== undefined ? { x: patch.x } : {}), ...(patch.y !== undefined ? { y: patch.y } : {}) } : n);
    return d;
  }), [mutateCache]);

  const removeNode = useCallback(async (id: string) => {
    if (id.startsWith("temp-")) return;
    optimisticRemove(id);
    if (selected === id) onSelect(null);
    try { await deleteNodeFn({ data: { id } }); } catch {}
  }, [optimisticRemove, deleteNodeFn, selected, onSelect]);

  const renameNode = useCallback(async (id: string, title: string, titleHtml?: string) => {
    if (id.startsWith("temp-")) return;
    const node = nodesData.find((n: any) => n.id === id);
    const d = node?.data ?? {};
    const patch: any = { title };
    if (titleHtml !== undefined) patch.titleHtml = titleHtml;
    optimisticUpdate(id, { data: patch });
    try { await updateNodeFn({ data: { id, patch: { data: { ...d, ...patch } } } }); } catch {}
  }, [nodesData, optimisticUpdate, updateNodeFn]);

  const patchNodeData = useCallback(async (id: string, patch: any) => {
    const node = nodesData.find((n: any) => n.id === id);
    if (!node) return;
    const d = node.data ?? {};
    optimisticUpdate(id, { data: patch });
    if (id.startsWith("temp-")) return;
    try { await updateNodeFn({ data: { id, patch: { data: { ...d, ...patch } } } }); } catch {}
  }, [nodesData, optimisticUpdate, updateNodeFn]);

  const addChild = useCallback(async (parent: any) => {
    if (addingChildForRef.current) return;
    addingChildForRef.current = parent.id;
    const siblings = nodesData.filter((n: any) => n.parent_id === parent.id);
    const x = Number(parent.x) + 320;
    const y = Number(parent.y) + siblings.length * 110;
    const tempNodeId = `temp-${crypto.randomUUID()}`;
    const tempEdgeId = `temp-edge-${crypto.randomUUID()}`;
    // Add BOTH node and edge optimistically so the line shows up instantly
    optimisticAdd({
      id: tempNodeId, board_id: boardId, parent_id: parent.id, kind: "mindmap",
      x, y, data: { title: "Novo card" },
    });
    optimisticAddEdge({
      id: tempEdgeId, board_id: boardId, source_node_id: parent.id, target_node_id: tempNodeId, kind: "mindmap",
    });
    setAutoEditId(tempNodeId);
    onSelect(tempNodeId);
    try {
      const res: any = await createNodeFn({
        data: { board_id: boardId, kind: "mindmap", x, y, parent_id: parent.id,
          data: { title: "Novo card" } },
      });
      const realId = res.node.id;
      optimisticReplaceNodeId(tempNodeId, realId);
      setAutoEditId((cur) => (cur === tempNodeId ? realId : cur));
      onSelect(realId);
      try {
        const eRes: any = await createEdgeFn({ data: { board_id: boardId, source_node_id: parent.id, target_node_id: realId, kind: "mindmap" } });
        if (eRes?.edge?.id) optimisticReplaceEdgeId(tempEdgeId, eRes.edge.id);
      } catch {}
    } finally { addingChildForRef.current = null; }
  }, [nodesData, createNodeFn, createEdgeFn, boardId, optimisticAdd, optimisticAddEdge, optimisticReplaceNodeId, optimisticReplaceEdgeId, onSelect]);

  // Compute auto-layout positions from the chosen layoutType (re-runs when sizes change)
  const layoutPositions = useMemo(() => {
    const parentMap: Record<string, string | null> = {};
    for (const n of nodesData) parentMap[n.id] = n.parent_id ?? null;
    return computeLayout(layoutType, nodesData, parentMap, sizesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutType, nodesData, sizesVersion]);

  // Children map + hidden set (descendants of collapsed branches)
  const { hasChildrenMap, hiddenIds } = useMemo(() => {
    const childrenOf: Record<string, string[]> = {};
    for (const n of nodesData) {
      const pid = n.parent_id;
      if (pid) (childrenOf[pid] ||= []).push(n.id);
    }
    const hc: Record<string, boolean> = {};
    for (const id in childrenOf) hc[id] = childrenOf[id].length > 0;
    const hidden = new Set<string>();
    const walk = (id: string) => {
      for (const c of childrenOf[id] ?? []) { hidden.add(c); walk(c); }
    };
    for (const id of collapsedIds) if (hc[id]) walk(id);
    return { hasChildrenMap: hc, hiddenIds: hidden };
  }, [nodesData, collapsedIds]);

  const buildNode = useCallback((n: any): Node => {
    const d = n.data ?? {};
    const isManual = !!d.manual;
    const layoutP = layoutPositions[n.id];
    const p = isManual || !layoutP ? { x: Number(n.x), y: Number(n.y) } : layoutP;
    return {
      id: n.id,
      type: "mindStep",
      position: p,
      data: {
        title: d.title,
        titleHtml: d.titleHtml,
        bg: d.bg,
        fg: d.fg,
        fontSize: d.fontSize,
        bold: d.bold,
        italic: d.italic,
        underline: d.underline,
        align: d.align,
        accent: color,
        layoutType,
        hasChildren: !!hasChildrenMap[n.id],
        collapsed: collapsedIds.has(n.id),
        onToggleCollapse: () => toggleCollapse(n.id),
        autoEdit: autoEditId === n.id,
        onConsumeAutoEdit: () => setAutoEditId((cur) => (cur === n.id ? null : cur)),
        onRename: (next: string, html?: string) => renameNode(n.id, next, html),
        onAddChild: () => addChild(n),
        onMeasure,
      },
      selected: n.id === selected,
    };
  }, [selected, color, addChild, renameNode, autoEditId, layoutPositions, layoutType, onMeasure, hasChildrenMap, collapsedIds, toggleCollapse]);

  useEffect(() => {
    const visibleNodes = nodesData.filter((n: any) => !hiddenIds.has(n.id));
    setNodes(visibleNodes.map(buildNode));
    setFlowEdges(
      edgesData
        .filter((e: any) => !hiddenIds.has(e.source_node_id) && !hiddenIds.has(e.target_node_id))
        .map((e: any): Edge => ({
          id: e.id, source: e.source_node_id, target: e.target_node_id,
          type: "mind", data: { accent: color, thickness: edgeStyle.thickness, dash: edgeStyle.dash },
        }))
    );
  }, [nodesData, edgesData, buildNode, color, edgeStyle.thickness, edgeStyle.dash, hiddenIds]);


  // Persist auto-layout positions to the DB (debounced) whenever node set or layout changes
  const persistedSigRef = useRef<string>("");
  useEffect(() => {
    if (!nodesData.length) return;
    const sig = layoutType + ":" + nodesData.map((n: any) => n.id).sort().join(",");
    if (sig === persistedSigRef.current) return;
    persistedSigRef.current = sig;
    const t = setTimeout(() => {
      for (const n of nodesData) {
        if (String(n.id).startsWith("temp-")) continue;
        if (n.data?.manual) continue;
        const p = layoutPositions[n.id];
        if (!p) continue;
        if (Math.abs(Number(n.x) - p.x) < 0.5 && Math.abs(Number(n.y) - p.y) < 0.5) continue;
        updateNodeFn({ data: { id: n.id, patch: { x: p.x, y: p.y } } }).catch(() => {});
      }
    }, 250);
    return () => clearTimeout(t);
  }, [nodesData, layoutPositions, layoutType, updateNodeFn]);

  const onNodeDragStop = useCallback((_e: any, node: Node) => {
    const orig = nodesData.find((n: any) => n.id === node.id);
    if (!orig) return;
    const newData = { ...(orig.data ?? {}), manual: true };
    optimisticUpdate(node.id, { x: node.position.x, y: node.position.y, data: { manual: true } });
    if (String(node.id).startsWith("temp-")) return;
    updateNodeFn({ data: { id: node.id, patch: { x: node.position.x, y: node.position.y, data: newData } } }).catch(() => {});
  }, [nodesData, optimisticUpdate, updateNodeFn]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    for (const ch of changes) {
      if (ch.type === "remove") removeNode(ch.id);
    }
  }, [removeNode]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdges((eds) => applyEdgeChanges(changes, eds));
    for (const ch of changes) {
      if (ch.type === "remove" && !ch.id.startsWith("temp-edge-")) {
        deleteEdgeFn({ data: { id: ch.id } }).catch(() => {});
      }
    }
  }, [deleteEdgeFn]);

  const onConnect = useCallback(async (conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    const tempId = `temp-edge-${crypto.randomUUID()}`;
    optimisticAddEdge({ id: tempId, board_id: boardId, source_node_id: conn.source, target_node_id: conn.target, kind: "mindmap" });
    try {
      const res: any = await createEdgeFn({ data: { board_id: boardId, source_node_id: conn.source, target_node_id: conn.target, kind: "mindmap" } });
      if (res?.edge?.id) optimisticReplaceEdgeId(tempId, res.edge.id);
    } catch { refresh(); }
  }, [createEdgeFn, boardId, optimisticAddEdge, optimisticReplaceEdgeId, refresh]);

  const addCard = useCallback(async () => {
    const { x, y, zoom } = rf.getViewport();
    const center = {
      x: (-x + window.innerWidth / 2) / zoom - 100,
      y: (-y + window.innerHeight / 2) / zoom - 40,
    };
    const tempId = `temp-${crypto.randomUUID()}`;
    optimisticAdd({
      id: tempId, board_id: boardId, parent_id: null, kind: "mindmap",
      x: center.x, y: center.y,
      data: { title: "Novo card" },
    });
    setAutoEditId(tempId);
    onSelect(tempId);
    try {
      const res: any = await createNodeFn({
        data: { board_id: boardId, kind: "mindmap", x: center.x, y: center.y,
          data: { title: "Novo card" } },
      });
      const realId = res.node.id;
      optimisticReplaceNodeId(tempId, realId);
      setAutoEditId((cur) => (cur === tempId ? realId : cur));
      onSelect(realId);
    } catch { refresh(); }
  }, [rf, createNodeFn, boardId, optimisticAdd, optimisticReplaceNodeId, onSelect, refresh]);

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    await removeNode(selected);
  }, [selected, removeNode]);

  // Refit view when layout type changes
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ duration: 400, padding: 0.2 }), 80);
    return () => clearTimeout(t);
  }, [layoutType, rf]);

  // Tab on a selected card spawns a child (mindmeister-style)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (!selected || isEditing) return;
      if (e.key === "Tab") {
        e.preventDefault();
        const parent = nodesData.find((n: any) => n.id === selected);
        if (parent) addChild(parent);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, nodesData, addChild]);

  const selectedNode = nodesData.find((n: any) => n.id === selected) ?? null;

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        <button
          onClick={addCard}
          className="h-9 px-3.5 rounded-xl text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shadow-lg hover:shadow-xl"
          style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 75%, black))`, boxShadow: `0 8px 22px -8px ${color}` }}
        >
          <Plus className="size-3.5" strokeWidth={2.8} /> Novo card
        </button>
        {selected && (
          <button
            onClick={deleteSelected}
            className="h-9 px-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs hover:bg-destructive/15 flex items-center gap-1.5"
          >
            <Trash2 className="size-3.5" /> Excluir
          </button>
        )}
      </div>

      {/* Floating card style toolbar */}
      {selectedNode && (
        <CardStylePopover
          key={selectedNode.id}
          node={selectedNode}
          onChange={(patch) => patchNodeData(selectedNode.id, patch)}
        />
      )}

      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={true}
        defaultEdgeOptions={{ type: "mind", data: { accent: color, thickness: edgeStyle.thickness, dash: edgeStyle.dash } }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        panOnScroll
        selectionOnDrag
        zoomOnDoubleClick={false}
      >
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable maskColor="oklch(0.985 0.003 250 / 0.6)" nodeColor={() => color} nodeStrokeWidth={3} />
      </ReactFlow>
    </div>
  );
}

function CardStylePopover({ node, onChange }: { node: any; onChange: (p: any) => void }) {
  const d = node.data ?? {};
  const bg = d.bg ?? "#ffffff";
  const fg = d.fg ?? "#0f172a";
  const fontSize = typeof d.fontSize === "number" ? d.fontSize : 13.5;
  const bold = d.bold !== false;
  const italic = !!d.italic;
  const underline = !!d.underline;
  const align: "left" | "center" | "right" = d.align ?? "left";

  const toggleBtn = (active: boolean) =>
    `size-8 rounded-md border flex items-center justify-center transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted text-foreground"}`;

  return (
    <div className="absolute top-3 right-3 z-10 rounded-xl border border-border bg-surface/95 backdrop-blur shadow-xl p-3 w-64 space-y-3">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
          <Palette className="size-3" /> Cor do card
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {CARD_BG_OPTIONS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ bg: c })}
              className={`size-7 rounded-md border-2 transition ${bg === c ? "border-primary scale-110" : "border-border hover:scale-105"}`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
          <Type className="size-3" /> Cor do texto
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {CARD_FG_OPTIONS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ fg: c })}
              className={`size-6 rounded-md border-2 transition ${fg === c ? "border-primary scale-110" : "border-border hover:scale-105"}`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Tamanho</div>
          <div className="text-[11px] font-medium tabular-nums">{Math.round(fontSize)}px</div>
        </div>
        <input
          type="range" min={10} max={32} step={1} value={fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Estilo</div>
        <div className="flex gap-1.5">
          <button onClick={() => onChange({ bold: !bold })} className={toggleBtn(bold)} title="Negrito">
            <Bold className="size-3.5" />
          </button>
          <button onClick={() => onChange({ italic: !italic })} className={toggleBtn(italic)} title="Itálico">
            <Italic className="size-3.5" />
          </button>
          <button onClick={() => onChange({ underline: !underline })} className={toggleBtn(underline)} title="Sublinhado">
            <Underline className="size-3.5" />
          </button>
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Alinhamento</div>
        <div className="flex gap-1.5">
          <button onClick={() => onChange({ align: "left" })} className={toggleBtn(align === "left")} title="Esquerda">
            <AlignLeft className="size-3.5" />
          </button>
          <button onClick={() => onChange({ align: "center" })} className={toggleBtn(align === "center")} title="Centro">
            <AlignCenter className="size-3.5" />
          </button>
          <button onClick={() => onChange({ align: "right" })} className={toggleBtn(align === "right")} title="Direita">
            <AlignRight className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

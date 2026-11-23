import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, NodeToolbar, Panel, ViewportPortal,
  ConnectionMode, SelectionMode, Position, applyEdgeChanges, applyNodeChanges, getNodesBounds, reconnectEdge, useReactFlow,
  type Connection, type EdgeChange, type FinalConnectionState, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft, Check, Copy, CornerDownRight, Diamond, Download, Expand, FileImage, FileText, Frame, Grid3x3, HelpCircle,
  Keyboard, Link2, Loader2, Minimize, MoveHorizontal, MoveVertical, Palette, Plus, Redo2, RectangleHorizontal, Search,
  Smile, Spline, StickyNote, Trash2, Undo2, Wand2, X, ArrowLeftRight, Minus, Slash, CornerUpRight, Type, Circle,
} from "lucide-react";
import { toast } from "sonner";
import {
  EMOJIS, NODE_COLORS, SHAPES, childrenMap, decorateEdge, decorateNode, descendants, deserialize, fromLegacy, makeEdge,
  makeNode, newId, nodeSize, normalize, pickHandles, serialize,
  type Diagram, type Direction, type EdgeKind, type FlowEdge, type FlowEdgeData, type FlowNode, type FlowNodeData, type ShapeKind,
} from "./model";
import { FlowUIContext, nodeTypes, type EditMode, type FlowUI } from "./nodes";
import { EdgeUIContext, edgeTypes, type EdgeUI } from "./edges";
import { autoLayout, freeSpot, snapToGuides, type Guides } from "./layout";

type Snap = { nodes: FlowNode[]; edges: FlowEdge[] };
type SaveStatus = "saved" | "pending" | "saving" | "error";
type Menu = { x: number; y: number; kind: "pane" | "node" | "selection"; flow: { x: number; y: number }; nodeId?: string };

export type FlowEditorProps = {
  name: string;
  accent: string;
  direction: Direction;
  diagram: Diagram | null;
  legacySteps: any[];
  legacyEdges: any[];
  onSave: (d: Diagram) => Promise<unknown>;
  onRename: (name: string) => void;
  onDirectionChange: (d: Direction) => void;
  onBack: () => void;
};

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

const CLIP_KEY = "srx-flow-clipboard";
let memoryClipboard: Snap | null = null;

function readClipboard(): Snap | null {
  if (memoryClipboard) return memoryClipboard;
  try {
    const raw = localStorage.getItem(CLIP_KEY);
    return raw ? (JSON.parse(raw) as Snap) : null;
  } catch {
    return null;
  }
}
function writeClipboard(s: Snap) {
  memoryClipboard = s;
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(s)); } catch { /* sem storage */ }
}

const OPPOSITE: Record<string, string> = { t: "b", b: "t", l: "r", r: "l" };
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.closest("input, textarea, select, [contenteditable='true']") != null);

function initialState(p: FlowEditorProps): { nodes: FlowNode[]; edges: FlowEdge[]; saved: string } {
  if (p.diagram && Array.isArray(p.diagram.nodes)) {
    const d = deserialize(p.diagram);
    return { ...d, saved: JSON.stringify(serialize(d.nodes, d.edges)) };
  }
  if (p.legacySteps.length) return { ...fromLegacy(p.legacySteps, p.legacyEdges), saved: "" };
  return { nodes: [makeNode("terminal", { x: 0, y: 0 }, { text: "Início" })], edges: [], saved: "" };
}

function Editor(props: FlowEditorProps) {
  const { accent, direction, onSave } = props;
  const rf = useReactFlow<FlowNode, FlowEdge>();
  const init = useMemo(() => initialState(props), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [nodes, setNodes] = useState<FlowNode[]>(init.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(init.edges);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const directionRef = useRef(direction);
  directionRef.current = direction;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSeed, setEditSeed] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guides>({});
  const [gridOn, setGridOn] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [help, setHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [name, setName] = useState(props.name);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [, setHistTick] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const pasteCount = useRef(0);
  const resizing = useRef(false);
  const frameDrag = useRef<{ id: string; sx: number; sy: number; items: Map<string, { x: number; y: number }> } | null>(null);

  // ---------- Desfazer / refazer ----------
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const snapshot = useCallback(() => {
    past.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    if (past.current.length > 150) past.current.shift();
    future.current = [];
    setHistTick((t) => t + 1);
  }, []);
  const undo = useCallback(() => {
    const s = past.current.pop();
    if (!s) return;
    future.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes(s.nodes);
    setEdges(s.edges);
    setHistTick((t) => t + 1);
  }, []);
  const redo = useCallback(() => {
    const s = future.current.pop();
    if (!s) return;
    past.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes(s.nodes);
    setEdges(s.edges);
    setHistTick((t) => t + 1);
  }, []);

  // ---------- Salvar sozinho ----------
  const serialized = useMemo(() => JSON.stringify(serialize(nodes, edges)), [nodes, edges]);
  const serializedRef = useRef(serialized);
  serializedRef.current = serialized;
  const lastSaved = useRef(init.saved);
  const [status, setStatus] = useState<SaveStatus>(init.saved ? "saved" : "pending");
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const saveNow = useCallback(async () => {
    const payload = serializedRef.current;
    if (payload === lastSaved.current) { setStatus("saved"); return; }
    setStatus("saving");
    try {
      await onSaveRef.current(JSON.parse(payload));
      lastSaved.current = payload;
      setStatus(serializedRef.current === payload ? "saved" : "pending");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (serialized === lastSaved.current) return;
    setStatus("pending");
    const t = setTimeout(saveNow, 800);
    return () => clearTimeout(t);
  }, [serialized, saveNow]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (serializedRef.current !== lastSaved.current) { e.preventDefault(); void saveNow(); }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (serializedRef.current !== lastSaved.current) void onSaveRef.current(JSON.parse(serializedRef.current));
    };
  }, [saveNow]);

  // ---------- Galhos recolhidos ----------
  const collapsedKey = useMemo(() => nodes.filter((n) => n.data.collapsed).map((n) => n.id).join(","), [nodes]);
  const tree = useMemo(() => {
    const ch = childrenMap(edges);
    const hidden = new Set<string>();
    const hiddenCount = new Map<string, number>();
    for (const id of collapsedKey ? collapsedKey.split(",") : []) {
      const d = descendants(id, ch);
      d.delete(id);
      hiddenCount.set(id, d.size);
      d.forEach((x) => hidden.add(x));
    }
    const childCount = new Map<string, number>();
    ch.forEach((v, k) => childCount.set(k, v.length));
    return { hidden, hiddenCount, childCount };
  }, [edges, collapsedKey]);

  const displayNodes = useMemo(
    () => (tree.hidden.size ? nodes.map((n) => (tree.hidden.has(n.id) ? { ...n, hidden: true, selected: false } : n)) : nodes),
    [nodes, tree.hidden],
  );
  const displayEdges = useMemo(
    () => (tree.hidden.size ? edges.map((e) => (tree.hidden.has(e.source) || tree.hidden.has(e.target) ? { ...e, hidden: true } : e)) : edges),
    [edges, tree.hidden],
  );
  const visibleNodes = useCallback(() => nodesRef.current.filter((n) => !tree.hidden.has(n.id)), [tree.hidden]);

  // ---------- Ajudantes ----------
  const selectOnly = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setNodes((ns) => ns.map((n) => (!!n.selected === set.has(n.id) ? n : { ...n, selected: set.has(n.id) })));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
  }, []);

  const startEdit = useCallback((id: string, seed: string | null = null) => {
    setEditSeed(seed);
    setEditingId(id);
    selectOnly([id]);
  }, [selectOnly]);

  const addChild = useCallback((parentId: string) => {
    const ns = nodesRef.current;
    const p = ns.find((n) => n.id === parentId);
    if (!p || p.type === "frame") return;
    const dir = directionRef.current;
    const ps = nodeSize(p);
    const kids = (childrenMap(edgesRef.current).get(p.id) ?? [])
      .map((id) => ns.find((n) => n.id === id))
      .filter((n): n is FlowNode => !!n && !tree.hidden.has(n.id));
    const size = { w: 160, h: 44 };
    let start: { x: number; y: number };
    if (dir === "horizontal") {
      const y = kids.length ? Math.max(...kids.map((k) => k.position.y + nodeSize(k).h)) + 20 : p.position.y + ps.h / 2 - size.h / 2;
      start = { x: p.position.x + ps.w + 80, y };
    } else {
      const x = kids.length ? Math.max(...kids.map((k) => k.position.x + nodeSize(k).w)) + 20 : p.position.x + ps.w / 2 - size.w / 2;
      start = { x, y: p.position.y + ps.h + 80 };
    }
    const pos = freeSpot(start, size, ns.filter((n) => !tree.hidden.has(n.id)), dir);
    const color = p.type === "note" ? undefined : p.data.color;
    const n = makeNode("step", pos, { color });
    const [sh, th] = dir === "horizontal" ? ["r", "l"] : ["b", "t"];
    snapshot();
    setNodes((prev) => [
      ...prev.map((x) => {
        let y = x;
        if (x.selected) y = { ...y, selected: false };
        if (x.id === p.id && x.data.collapsed) y = { ...y, data: { ...y.data, collapsed: false } };
        return y;
      }),
      { ...n, selected: true },
    ]);
    setEdges((prev) => [...prev, makeEdge(p.id, n.id, sh, th)]);
    setEditSeed(null);
    setEditingId(n.id);
  }, [snapshot, tree.hidden]);

  const addSibling = useCallback((id: string) => {
    const ns = nodesRef.current;
    const me = ns.find((n) => n.id === id);
    if (!me || me.type === "frame") return;
    const inEdge = edgesRef.current.find((e) => e.target === id && e.source !== id);
    const dir = directionRef.current;
    const s = nodeSize(me);
    const start = dir === "horizontal"
      ? { x: me.position.x, y: me.position.y + s.h + 20 }
      : { x: me.position.x + s.w + 20, y: me.position.y };
    const pos = freeSpot(start, { w: 160, h: 44 }, ns.filter((n) => !tree.hidden.has(n.id)), dir);
    const type: ShapeKind = me.type === "note" ? "note" : "step";
    const n = makeNode(type, pos, { color: me.data.color });
    snapshot();
    setNodes((prev) => [...prev.map((x) => (x.selected ? { ...x, selected: false } : x)), { ...n, selected: true }]);
    if (inEdge) setEdges((prev) => [...prev, makeEdge(inEdge.source, n.id, inEdge.sourceHandle, inEdge.targetHandle)]);
    setEditSeed(null);
    setEditingId(n.id);
  }, [snapshot, tree.hidden]);

  const commitEdit = useCallback((id: string, text: string | null, then: EditMode = null) => {
    setEditingId(null);
    setEditSeed(null);
    const cur = nodesRef.current.find((n) => n.id === id);
    if (cur && text !== null && text !== cur.data.text) {
      snapshot();
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n)));
    }
    if (then === "child") setTimeout(() => addChild(id), 0);
    if (then === "sibling") setTimeout(() => addSibling(id), 0);
  }, [snapshot, addChild, addSibling]);

  const toggleCollapse = useCallback((id: string) => {
    snapshot();
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } } : n)));
  }, [snapshot]);

  const viewportCenter = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, [rf]);

  const addShape = useCallback((type: ShapeKind, at?: { x: number; y: number }) => {
    const c = at ?? viewportCenter();
    const proto = makeNode(type, { x: 0, y: 0 });
    const w = proto.width ?? 160;
    const h = proto.height ?? 44;
    const n = { ...proto, position: { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) }, selected: true };
    snapshot();
    setNodes((prev) => (type === "frame" ? [n, ...prev.map((x) => (x.selected ? { ...x, selected: false } : x))] : [...prev.map((x) => (x.selected ? { ...x, selected: false } : x)), n]));
    setEditSeed(null);
    setEditingId(n.id);
  }, [snapshot, viewportCenter]);

  const deleteSelected = useCallback(() => {
    const ids = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
    const eIds = new Set(edgesRef.current.filter((e) => e.selected).map((e) => e.id));
    if (!ids.size && !eIds.size) return;
    snapshot();
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) => es.filter((e) => !eIds.has(e.id) && !ids.has(e.source) && !ids.has(e.target)));
  }, [snapshot]);

  const copySelected = useCallback(() => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (!sel.length) return false;
    const ids = new Set(sel.map((n) => n.id));
    const es = edgesRef.current.filter((e) => ids.has(e.source) && ids.has(e.target));
    writeClipboard(JSON.parse(JSON.stringify({ nodes: sel, edges: es })));
    pasteCount.current = 0;
    return true;
  }, []);

  const pasteSnap = useCallback((clip: Snap, at: { x: number; y: number } | null) => {
    if (!clip.nodes.length) return;
    const minX = Math.min(...clip.nodes.map((n) => n.position.x));
    const minY = Math.min(...clip.nodes.map((n) => n.position.y));
    pasteCount.current += 1;
    const off = 32 * pasteCount.current;
    const base = at ?? { x: minX + off, y: minY + off };
    const map = new Map<string, string>();
    const ns: FlowNode[] = clip.nodes.map((n) => {
      const id = newId();
      map.set(n.id, id);
      return decorateNode({
        id,
        type: n.type,
        data: { ...n.data },
        position: { x: base.x + (n.position.x - minX), y: base.y + (n.position.y - minY) },
        ...(n.width ? { width: n.width } : {}),
        ...(n.height ? { height: n.height } : {}),
        selected: true,
      });
    });
    const es: FlowEdge[] = clip.edges
      .filter((e) => map.has(e.source) && map.has(e.target))
      .map((e) => decorateEdge({ ...e, id: newId(), source: map.get(e.source)!, target: map.get(e.target)!, selected: false }));
    snapshot();
    setNodes((prev) => [...prev.map((x) => (x.selected ? { ...x, selected: false } : x)), ...ns]);
    setEdges((prev) => [...prev.map((x) => (x.selected ? { ...x, selected: false } : x)), ...es]);
  }, [snapshot]);

  const paste = useCallback((at?: { x: number; y: number } | null) => {
    const clip = readClipboard();
    if (!clip) return;
    pasteSnap(clip, at ?? null);
  }, [pasteSnap]);

  const duplicate = useCallback(() => {
    const sel = nodesRef.current.filter((n) => n.selected);
    if (!sel.length) return;
    const ids = new Set(sel.map((n) => n.id));
    const snap = JSON.parse(JSON.stringify({ nodes: sel, edges: edgesRef.current.filter((e) => ids.has(e.source) && ids.has(e.target)) }));
    pasteCount.current = 0;
    pasteSnap(snap, null);
  }, [pasteSnap]);

  const updateNodes = useCallback((ids: string[], fn: (n: FlowNode) => FlowNode) => {
    const set = new Set(ids);
    snapshot();
    setNodes((ns) => ns.map((n) => (set.has(n.id) ? fn(n) : n)));
  }, [snapshot]);

  const setNodeData = useCallback((ids: string[], patch: Partial<FlowNodeData>) => {
    updateNodes(ids, (n) => ({ ...n, data: { ...n.data, ...patch } }));
  }, [updateNodes]);

  const setShape = useCallback((ids: string[], type: ShapeKind) => {
    updateNodes(ids, (n) => {
      if (n.type === "frame" || n.type === type) return n;
      const next: FlowNode = { ...n, type };
      if (type === "note") {
        next.width = n.width ?? 200;
        next.height = n.height ?? 120;
      } else {
        delete next.height;
        if (n.type === "note") delete next.width;
      }
      return next;
    });
  }, [updateNodes]);

  const updateEdges = useCallback((ids: string[], patch: Partial<FlowEdgeData>) => {
    const set = new Set(ids);
    snapshot();
    setEdges((es) => es.map((e) => (set.has(e.id) ? decorateEdge({ ...e, data: { ...(e.data ?? {}), ...patch } }) : e)));
  }, [snapshot]);

  const reverseEdges = useCallback((ids: string[]) => {
    const set = new Set(ids);
    snapshot();
    setEdges((es) => es.map((e) => (set.has(e.id) ? { ...e, source: e.target, target: e.source, sourceHandle: e.targetHandle, targetHandle: e.sourceHandle } : e)));
  }, [snapshot]);

  const startEdgeEdit = useCallback((id: string) => setEditingEdgeId(id), []);
  const commitEdgeLabel = useCallback((id: string, label: string | null) => {
    setEditingEdgeId(null);
    if (label === null) return;
    const cur = edgesRef.current.find((e) => e.id === id);
    if (!cur || (cur.data?.label ?? "") === label) return;
    updateEdges([id], { label: label.trim() || undefined });
  }, [updateEdges]);

  const organize = useCallback(() => {
    snapshot();
    const r = autoLayout(nodesRef.current, edgesRef.current, directionRef.current, tree.hidden);
    setNodes(r.nodes);
    setEdges(r.edges);
    setTimeout(() => rf.fitView({ duration: 500, padding: 0.2 }), 50);
  }, [snapshot, rf, tree.hidden]);

  const changeDirection = useCallback((d: Direction) => {
    if (d === directionRef.current) return;
    directionRef.current = d;
    props.onDirectionChange(d);
    setTimeout(organize, 0);
  }, [organize, props]);

  // ---------- Busca ----------
  const matches = useMemo(() => {
    const q = normalize(search.trim());
    if (!q) return [] as string[];
    return nodes
      .filter((n) => normalize(`${n.data.text} ${n.data.notes ?? ""}`).includes(q))
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.id);
  }, [nodes, search]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const activeMatch = matches.length ? matches[Math.min(matchIdx, matches.length - 1)] : null;

  const reveal = useCallback((id: string) => {
    const parents = new Map<string, string[]>();
    for (const e of edgesRef.current) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);
    const toOpen = new Set<string>();
    const stack = [...(parents.get(id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const p = stack.pop()!;
      if (seen.has(p)) continue;
      seen.add(p);
      if (nodesRef.current.find((n) => n.id === p)?.data.collapsed) toOpen.add(p);
      stack.push(...(parents.get(p) ?? []));
    }
    if (toOpen.size) setNodes((ns) => ns.map((n) => (toOpen.has(n.id) ? { ...n, data: { ...n.data, collapsed: false } } : n)));
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n) return;
    const s = nodeSize(n);
    selectOnly([id]);
    rf.setCenter(n.position.x + s.w / 2, n.position.y + s.h / 2, { zoom: Math.max(rf.getZoom(), 1), duration: 400 });
  }, [rf, selectOnly]);

  const goMatch = useCallback((delta: number) => {
    if (!matches.length) return;
    const next = (matchIdx + delta + matches.length) % matches.length;
    setMatchIdx(next);
    reveal(matches[next]);
  }, [matches, matchIdx, reveal]);

  // ---------- Navegar com setas ----------
  const navigate = useCallback((key: string) => {
    const vis = visibleNodes();
    const cur = vis.find((n) => n.selected);
    if (!cur) { if (vis[0]) selectOnly([vis[0].id]); return; }
    const cs = nodeSize(cur);
    const cx = cur.position.x + cs.w / 2;
    const cy = cur.position.y + cs.h / 2;
    const v = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key] as [number, number];
    let best: { id: string; score: number } | null = null;
    for (const n of vis) {
      if (n.id === cur.id || n.type === "frame") continue;
      const s = nodeSize(n);
      const dx = n.position.x + s.w / 2 - cx;
      const dy = n.position.y + s.h / 2 - cy;
      const along = dx * v[0] + dy * v[1];
      if (along <= 1) continue;
      const across = Math.abs(dx * v[1] - dy * v[0]);
      if (across > along * 2.5) continue;
      const score = along + across * 2;
      if (!best || score < best.score) best = { id: n.id, score };
    }
    if (best) {
      selectOnly([best.id]);
      const n = vis.find((x) => x.id === best!.id)!;
      const s = nodeSize(n);
      const r = wrapRef.current?.getBoundingClientRect();
      const sp = rf.flowToScreenPosition({ x: n.position.x + s.w / 2, y: n.position.y + s.h / 2 });
      if (r && (sp.x < r.left + 60 || sp.x > r.right - 60 || sp.y < r.top + 60 || sp.y > r.bottom - 60)) {
        rf.setCenter(n.position.x + s.w / 2, n.position.y + s.h / 2, { zoom: rf.getZoom(), duration: 250 });
      }
    }
  }, [rf, selectOnly, visibleNodes]);

  // ---------- Exportar ----------
  const exportAs = useCallback(async (kind: "png" | "pdf") => {
    const vis = visibleNodes();
    if (!vis.length) { toast.error("O mapa está vazio"); return; }
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = wrapRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!el) return;
    const b = getNodesBounds(vis);
    const pad = 48;
    const w = Math.ceil(b.width + pad * 2);
    const h = Math.ceil(b.height + pad * 2);
    const bg = getComputedStyle(wrapRef.current!).backgroundColor;
    const fileName = (name || "processo").replace(/[\\/:*?"<>|]+/g, "-");
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        backgroundColor: bg,
        width: w,
        height: h,
        pixelRatio: 2,
        style: { width: `${w}px`, height: `${h}px`, transform: `translate(${-b.x + pad}px, ${-b.y + pad}px) scale(1)` },
      });
      if (kind === "png") {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${fileName}.png`;
        a.click();
      } else {
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "px", format: [w, h], hotfixes: ["px_scaling"] });
        pdf.addImage(dataUrl, "PNG", 0, 0, w, h);
        pdf.save(`${fileName}.pdf`);
      }
    } catch {
      toast.error("Não consegui exportar");
    }
  }, [name, visibleNodes]);

  // ---------- Tela cheia ----------
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === wrapRef.current?.parentElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    const el = wrapRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  // ---------- Teclado ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || editingId || editingEdgeId) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      const selN = nodesRef.current.filter((n) => n.selected && !tree.hidden.has(n.id));
      const selE = edgesRef.current.filter((x) => x.selected);
      const one = selN.length === 1 ? selN[0] : null;

      if (mod && k.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && k.toLowerCase() === "s") { e.preventDefault(); void saveNow(); return; }
      if (mod && k.toLowerCase() === "f") { e.preventDefault(); setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0); return; }
      if (mod && k.toLowerCase() === "a") {
        e.preventDefault();
        setNodes((ns) => ns.map((n) => (tree.hidden.has(n.id) ? n : { ...n, selected: true })));
        return;
      }
      if (mod && k.toLowerCase() === "c") { if (copySelected()) e.preventDefault(); return; }
      if (mod && k.toLowerCase() === "x") { if (copySelected()) { e.preventDefault(); deleteSelected(); } return; }
      if (mod && k.toLowerCase() === "v") { e.preventDefault(); paste(pointer.current); return; }
      if (mod && k.toLowerCase() === "d") { e.preventDefault(); duplicate(); return; }
      if (mod) return;

      if (k === "Escape") { setMenu(null); selectOnly([]); return; }
      if (k === "Delete" || k === "Backspace") { e.preventDefault(); deleteSelected(); return; }
      if (k === "?" ) { setHelp(true); return; }
      if (k === "!" && e.shiftKey) { rf.fitView({ duration: 400, padding: 0.2 }); return; }
      if (k.startsWith("Arrow")) { e.preventDefault(); navigate(k); return; }
      if (!selE.length || selN.length) {
        if (k === "Tab" && one) { e.preventDefault(); addChild(one.id); return; }
        if (k === "Tab") { e.preventDefault(); return; }
        if (k === "Enter" && one) { e.preventDefault(); if (e.shiftKey) startEdit(one.id); else addSibling(one.id); return; }
        if (k === "F2" && one) { e.preventDefault(); startEdit(one.id); return; }
        if (k === "/" && one) { e.preventDefault(); toggleCollapse(one.id); return; }
        if (one && k.length === 1 && k !== " " && !e.altKey) { e.preventDefault(); startEdit(one.id, k); return; }
      } else if ((k === "Enter" || k === "F2") && selE.length === 1) {
        e.preventDefault();
        startEdgeEdit(selE[0].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, editingEdgeId, tree.hidden, undo, redo, saveNow, copySelected, deleteSelected, paste, duplicate, selectOnly, rf, navigate, addChild, addSibling, startEdit, toggleCollapse, startEdgeEdit]);

  // ---------- Eventos do React Flow ----------
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    if (changes.some((c) => c.type === "dimensions" && c.resizing) && !resizing.current) { resizing.current = true; snapshot(); }
    if (changes.some((c) => c.type === "dimensions" && c.resizing === false)) resizing.current = false;

    const c0 = changes[0];
    if (!gridOn && changes.length === 1 && c0.type === "position" && c0.dragging && c0.position) {
      const n = nodesRef.current.find((x) => x.id === c0.id);
      if (n && n.type !== "frame") {
        const others = nodesRef.current.filter((x) => !x.selected && !tree.hidden.has(x.id));
        const r = snapToGuides(n, c0.position, others, 6 / rf.getZoom());
        c0.position = r.pos;
        setGuides(r.guides);
      }
    }
    const resized = new Set(changes.filter((c) => c.type === "dimensions" && "setAttributes" in c && c.setAttributes).map((c) => (c as { id: string }).id));
    setNodes((ns) => {
      const out = applyNodeChanges(changes, ns);
      if (!resized.size) return out;
      return out.map((n) => (resized.has(n.id) && n.type !== "note" && n.type !== "frame" ? { ...n, height: undefined } : n));
    });
  }, [gridOn, rf, snapshot, tree.hidden]);

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    if (edgesRef.current.some((e) => e.source === c.source && e.target === c.target)) return;
    snapshot();
    setEdges((es) => [...es, makeEdge(c.source, c.target, c.sourceHandle, c.targetHandle)]);
  }, [snapshot]);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode) return;
    const pt = "changedTouches" in event ? event.changedTouches[0] : event;
    const pos = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
    const from = nodesRef.current.find((n) => n.id === state.fromNode!.id);
    if (!from || from.type === "frame") return;
    const sh = state.fromHandle?.id ?? pickHandles(from.position, pos)[0];
    const th = OPPOSITE[sh] ?? "l";
    const size = { w: 160, h: 44 };
    const at = th === "l" ? { x: pos.x, y: pos.y - size.h / 2 }
      : th === "r" ? { x: pos.x - size.w, y: pos.y - size.h / 2 }
      : th === "t" ? { x: pos.x - size.w / 2, y: pos.y }
      : { x: pos.x - size.w / 2, y: pos.y - size.h };
    const n = makeNode("step", at, { color: from.type === "note" ? undefined : from.data.color });
    snapshot();
    setNodes((prev) => [...prev.map((x) => (x.selected ? { ...x, selected: false } : x)), { ...n, selected: true }]);
    setEdges((prev) => [...prev, makeEdge(from.id, n.id, sh, th)]);
    setEditSeed(null);
    setEditingId(n.id);
  }, [rf, snapshot]);

  const onReconnect = useCallback((old: FlowEdge, c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    snapshot();
    setEdges((es) => reconnectEdge(old, c, es, { shouldReplaceId: false }).map((e) => (e.id === old.id ? decorateEdge(e) : e)));
  }, [snapshot]);

  const onNodeDragStart = useCallback((_e: unknown, node: FlowNode) => {
    snapshot();
    setDragging(true);
    setMenu(null);
    if (node.type !== "frame") return;
    const fs = nodeSize(node);
    const items = new Map<string, { x: number; y: number }>();
    for (const n of nodesRef.current) {
      if (n.id === node.id || n.selected) continue;
      const s = nodeSize(n);
      if (n.position.x >= node.position.x && n.position.y >= node.position.y
        && n.position.x + s.w <= node.position.x + fs.w && n.position.y + s.h <= node.position.y + fs.h) {
        items.set(n.id, { ...n.position });
      }
    }
    frameDrag.current = { id: node.id, sx: node.position.x, sy: node.position.y, items };
  }, [snapshot]);

  const onNodeDrag = useCallback((_e: unknown, node: FlowNode) => {
    const f = frameDrag.current;
    if (!f || f.id !== node.id || !f.items.size) return;
    const dx = node.position.x - f.sx;
    const dy = node.position.y - f.sy;
    setNodes((ns) => ns.map((n) => {
      const it = f.items.get(n.id);
      return it ? { ...n, position: { x: it.x + dx, y: it.y + dy } } : n;
    }));
  }, []);

  const onNodeDragStop = useCallback(() => {
    frameDrag.current = null;
    setDragging(false);
    setGuides({});
  }, []);

  const openMenu = (e: React.MouseEvent | MouseEvent, kind: Menu["kind"], nodeId?: string) => {
    e.preventDefault();
    const r = wrapRef.current!.getBoundingClientRect();
    const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setMenu({ x: Math.min(e.clientX - r.left, r.width - 220), y: Math.min(e.clientY - r.top, r.height - 300), kind, flow, nodeId });
  };

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData("application/srx-flow") as ShapeKind;
    if (!type) return;
    e.preventDefault();
    addShape(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  // ---------- Contextos ----------
  const flowUI: FlowUI = useMemo(() => ({
    accent, direction, editingId, editSeed, startEdit, commitEdit, toggleCollapse,
    childCount: tree.childCount, hiddenCount: tree.hiddenCount, matches: matchSet, activeMatch,
  }), [accent, direction, editingId, editSeed, startEdit, commitEdit, toggleCollapse, tree, matchSet, activeMatch]);
  const edgeUI: EdgeUI = useMemo(() => ({ editingEdgeId, commitEdgeLabel, startEdgeEdit }), [editingEdgeId, commitEdgeLabel, startEdgeEdit]);

  const selNodes = nodes.filter((n) => n.selected && !tree.hidden.has(n.id));
  const selEdges = edges.filter((e) => e.selected);
  const selIds = selNodes.map((n) => n.id);
  const onlyFrames = selNodes.length > 0 && selNodes.every((n) => n.type === "frame");

  return (
    <div className="flex flex-col h-full bg-background">
      <TopBar
        name={name}
        onName={setName}
        onRename={() => { const v = name.trim(); if (v && v !== props.name) props.onRename(v); }}
        onBack={() => { void saveNow(); props.onBack(); }}
        status={status}
        onRetry={saveNow}
        direction={direction}
        onDirection={changeDirection}
        onOrganize={organize}
        gridOn={gridOn}
        onGrid={() => setGridOn((g) => !g)}
        searchOpen={searchOpen}
        onSearchOpen={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }}
        onSearchClose={() => { setSearchOpen(false); setSearch(""); }}
        search={search}
        onSearch={(v) => { setSearch(v); setMatchIdx(0); }}
        searchRef={searchRef}
        matchCount={matches.length}
        matchIdx={matches.length ? Math.min(matchIdx, matches.length - 1) : -1}
        onMatch={goMatch}
        onExport={exportAs}
        fullscreen={fullscreen}
        onFullscreen={toggleFullscreen}
        onHelp={() => setHelp(true)}
      />

      <div
        ref={wrapRef}
        className="flex-1 min-h-0 relative bg-background"
        onMouseMove={(e) => { pointer.current = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); }}
        onMouseLeave={() => { pointer.current = null; }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={onDrop}
        onClick={() => menu && setMenu(null)}
      >
        <FlowUIContext.Provider value={flowUI}>
          <EdgeUIContext.Provider value={edgeUI}>
            <ReactFlow<FlowNode, FlowEdge>
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onReconnect={onReconnect}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onEdgeDoubleClick={(_e, edge) => startEdgeEdit(edge.id)}
              onPaneContextMenu={(e) => openMenu(e, "pane")}
              onNodeContextMenu={(e, n) => { if (!n.selected) selectOnly([n.id]); openMenu(e, "node", n.id); }}
              onSelectionContextMenu={(e) => openMenu(e, "selection")}
              onPaneClick={() => setMenu(null)}
              connectionMode={ConnectionMode.Loose}
              connectionRadius={36}
              deleteKeyCode={null}
              selectionKeyCode="Shift"
              multiSelectionKeyCode={["Shift", "Meta", "Control"]}
              selectionMode={SelectionMode.Partial}
              elevateNodesOnSelect={false}
              snapToGrid={gridOn}
              snapGrid={[20, 20]}
              minZoom={0.1}
              maxZoom={2.5}
              zoomOnDoubleClick={false}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: "flow" }}
            >
              <Background variant={gridOn ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={20} size={gridOn ? 1 : 1.2} color="var(--border)" />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                nodeColor={(n) => (n.type === "frame" ? "transparent" : (n.data as FlowNodeData).color ?? (n.type === "note" ? "#eab308" : accent))}
                nodeStrokeColor={(n) => (n.type === "frame" ? ((n.data as FlowNodeData).color ?? accent) : "transparent")}
                nodeStrokeWidth={4}
                maskColor="color-mix(in oklab, var(--background) 70%, transparent)"
                className="!bg-surface !border !border-border !rounded-lg"
              />

              <Panel position="top-left">
                <ShapePalette onAdd={addShape} canUndo={past.current.length > 0} canRedo={future.current.length > 0} onUndo={undo} onRedo={redo} />
              </Panel>

              {selEdges.length > 0 && selNodes.length === 0 && (
                <Panel position="top-center">
                  <EdgeBar
                    edges={selEdges}
                    onUpdate={(p) => updateEdges(selEdges.map((e) => e.id), p)}
                    onLabel={() => startEdgeEdit(selEdges[0].id)}
                    onReverse={() => reverseEdges(selEdges.map((e) => e.id))}
                    onDelete={deleteSelected}
                  />
                </Panel>
              )}

              <NodeToolbar nodeId={selIds} isVisible={selIds.length > 0 && !editingId && !dragging} position={Position.Top} offset={16}>
                <NodeBar
                  nodes={selNodes}
                  onlyFrames={onlyFrames}
                  onShape={(t) => setShape(selIds, t)}
                  onData={(p) => setNodeData(selIds, p)}
                  onChild={() => selNodes[0] && addChild(selNodes[0].id)}
                  onDuplicate={duplicate}
                  onDelete={deleteSelected}
                  onEdit={() => selNodes[0] && startEdit(selNodes[0].id)}
                />
              </NodeToolbar>

              {(guides.x != null || guides.y != null) && (
                <ViewportPortal>
                  {guides.x != null && <div className="absolute pointer-events-none" style={{ left: guides.x, top: -100000, width: 1, height: 200000, background: "#f43f5e" }} />}
                  {guides.y != null && <div className="absolute pointer-events-none" style={{ top: guides.y, left: -100000, height: 1, width: 200000, background: "#f43f5e" }} />}
                </ViewportPortal>
              )}
            </ReactFlow>
          </EdgeUIContext.Provider>
        </FlowUIContext.Provider>

        {menu && (
          <ContextMenu
            menu={menu}
            node={menu.nodeId ? nodes.find((n) => n.id === menu.nodeId) : undefined}
            hasChildren={!!menu.nodeId && (tree.childCount.get(menu.nodeId) ?? 0) > 0}
            canPaste={!!readClipboard()}
            onClose={() => setMenu(null)}
            actions={{
              add: (t) => addShape(t, menu.flow),
              paste: () => paste(menu.flow),
              selectAll: () => setNodes((ns) => ns.map((n) => (tree.hidden.has(n.id) ? n : { ...n, selected: true }))),
              organize,
              edit: () => menu.nodeId && startEdit(menu.nodeId),
              child: () => menu.nodeId && addChild(menu.nodeId),
              sibling: () => menu.nodeId && addSibling(menu.nodeId),
              collapse: () => menu.nodeId && toggleCollapse(menu.nodeId),
              copy: () => { copySelected(); },
              duplicate,
              remove: deleteSelected,
            }}
          />
        )}

        {nodes.length <= 1 && edges.length === 0 && (
          <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-surface/90 border border-border shadow-sm text-xs text-muted-foreground text-center">
            Clique na caixinha e aperte <Kbd>Tab</Kbd> pra criar o próximo passo · <Kbd>Enter</Kbd> cria um do lado · clique duas vezes pra escrever
          </div>
        )}
      </div>

      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </div>
  );
}

// ================= Barra de cima =================

function TopBar(p: {
  name: string; onName: (v: string) => void; onRename: () => void; onBack: () => void;
  status: SaveStatus; onRetry: () => void;
  direction: Direction; onDirection: (d: Direction) => void; onOrganize: () => void;
  gridOn: boolean; onGrid: () => void;
  searchOpen: boolean; onSearchOpen: () => void; onSearchClose: () => void; search: string; onSearch: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>; matchCount: number; matchIdx: number; onMatch: (d: number) => void;
  onExport: (k: "png" | "pdf") => void; fullscreen: boolean; onFullscreen: () => void; onHelp: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  return (
    <div className="border-b border-border bg-surface/60 backdrop-blur px-3 py-2 flex items-center gap-2 flex-wrap">
      <IconBtn title="Voltar" onClick={p.onBack}><ArrowLeft className="size-4" /></IconBtn>
      <input
        value={p.name}
        onChange={(e) => p.onName(e.target.value)}
        onBlur={p.onRename}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="px-3 h-9 rounded-lg bg-surface border border-border text-sm font-semibold outline-none focus:border-primary min-w-[160px] flex-1 max-w-sm"
      />
      <SaveBadge status={p.status} onRetry={p.onRetry} />

      <div className="flex-1" />

      {p.searchOpen ? (
        <div className="flex items-center gap-1 h-9 px-2 rounded-lg bg-surface border border-primary/50">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            ref={p.searchRef}
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); p.onMatch(e.shiftKey ? -1 : 1); }
              if (e.key === "Escape") p.onSearchClose();
            }}
            placeholder="Buscar no mapa…"
            className="bg-transparent text-sm outline-none w-40"
          />
          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
            {p.search ? (p.matchCount ? `${p.matchIdx + 1}/${p.matchCount}` : "0") : ""}
          </span>
          <button className="size-6 grid place-items-center rounded hover:bg-muted" onClick={p.onSearchClose} title="Fechar"><X className="size-3.5" /></button>
        </div>
      ) : (
        <IconBtn title="Buscar (Ctrl+F)" onClick={p.onSearchOpen}><Search className="size-4" /></IconBtn>
      )}

      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface border border-border">
        <SegBtn active={p.direction === "horizontal"} onClick={() => p.onDirection("horizontal")} title="Fluxo para a direita"><MoveHorizontal className="size-3.5" /></SegBtn>
        <SegBtn active={p.direction === "vertical"} onClick={() => p.onDirection("vertical")} title="Fluxo para baixo"><MoveVertical className="size-3.5" /></SegBtn>
      </div>
      <button onClick={p.onOrganize} className="h-9 px-3 rounded-lg bg-surface border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-surface-hover" title="Arrumar tudo automaticamente">
        <Wand2 className="size-3.5" /> Organizar
      </button>
      <IconBtn title={p.gridOn ? "Grade magnética ligada" : "Grade magnética"} onClick={p.onGrid} active={p.gridOn}><Grid3x3 className="size-4" /></IconBtn>

      <div className="relative">
        <IconBtn title="Exportar" onClick={() => setExportOpen((o) => !o)}><Download className="size-4" /></IconBtn>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
            <div className="absolute right-0 top-10 z-50 w-44 rounded-lg border border-border bg-popover shadow-lg p-1">
              <MenuItem icon={<FileImage className="size-3.5" />} onClick={() => { setExportOpen(false); p.onExport("png"); }}>Imagem (PNG)</MenuItem>
              <MenuItem icon={<FileText className="size-3.5" />} onClick={() => { setExportOpen(false); p.onExport("pdf"); }}>PDF</MenuItem>
            </div>
          </>
        )}
      </div>
      <IconBtn title={p.fullscreen ? "Sair da tela cheia" : "Tela cheia"} onClick={p.onFullscreen}>
        {p.fullscreen ? <Minimize className="size-4" /> : <Expand className="size-4" />}
      </IconBtn>
      <IconBtn title="Atalhos (?)" onClick={p.onHelp}><HelpCircle className="size-4" /></IconBtn>
    </div>
  );
}

function SaveBadge({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "error") {
    return (
      <button onClick={onRetry} className="text-xs text-destructive flex items-center gap-1 px-2 h-7 rounded-md hover:bg-destructive/10">
        <X className="size-3.5" /> Erro ao salvar — tentar de novo
      </button>
    );
  }
  return (
    <span className="text-xs text-muted-foreground flex items-center gap-1 px-1 whitespace-nowrap">
      {status === "saved" ? <><Check className="size-3.5 text-emerald-500" /> Salvo</> : <><Loader2 className="size-3.5 animate-spin" /> Salvando…</>}
    </span>
  );
}

// ================= Paleta da esquerda =================

const PALETTE: { type: ShapeKind; label: string; icon: ReactNode }[] = [
  { type: "step", label: "Etapa", icon: <RectangleHorizontal className="size-4" /> },
  { type: "decision", label: "Decisão", icon: <Diamond className="size-4" /> },
  { type: "terminal", label: "Início/Fim", icon: <Circle className="size-4" /> },
  { type: "note", label: "Nota", icon: <StickyNote className="size-4" /> },
  { type: "frame", label: "Moldura", icon: <Frame className="size-4" /> },
];

function ShapePalette({ onAdd, canUndo, canRedo, onUndo, onRedo }: {
  onAdd: (t: ShapeKind) => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 p-1 rounded-xl border border-border bg-surface shadow-sm">
      {PALETTE.map((s) => (
        <button
          key={s.type}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData("application/srx-flow", s.type); e.dataTransfer.effectAllowed = "copy"; }}
          onClick={() => onAdd(s.type)}
          title={`${s.label} — clique ou arraste pro quadro`}
          className="group/p relative size-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-grab active:cursor-grabbing"
        >
          {s.icon}
          <span className="pointer-events-none absolute left-11 whitespace-nowrap rounded-md bg-foreground text-background text-[11px] px-2 py-0.5 opacity-0 group-hover/p:opacity-100 transition-opacity">{s.label}</span>
        </button>
      ))}
      <div className="h-px bg-border my-0.5" />
      <button onClick={onUndo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" className="size-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"><Undo2 className="size-4" /></button>
      <button onClick={onRedo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" className="size-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"><Redo2 className="size-4" /></button>
    </div>
  );
}

// ================= Barra da caixinha selecionada =================

function NodeBar({ nodes, onlyFrames, onShape, onData, onChild, onDuplicate, onDelete, onEdit }: {
  nodes: FlowNode[]; onlyFrames: boolean; onShape: (t: ShapeKind) => void; onData: (p: Partial<FlowNodeData>) => void;
  onChild: () => void; onDuplicate: () => void; onDelete: () => void; onEdit: () => void;
}) {
  const [open, setOpen] = useState<"color" | "emoji" | "notes" | null>(null);
  const one = nodes.length === 1 ? nodes[0] : null;
  const shapeIcon: Record<string, ReactNode> = {
    step: <RectangleHorizontal className="size-3.5" />,
    decision: <Diamond className="size-3.5" />,
    terminal: <Circle className="size-3.5" />,
    note: <StickyNote className="size-3.5" />,
  };
  return (
    <div className="nodrag relative flex items-center gap-0.5 p-1 rounded-xl border border-border bg-popover shadow-lg" onMouseDown={(e) => e.stopPropagation()}>
      {!onlyFrames && SHAPES.map((s) => (
        <ToolBtn key={s.id} title={s.label} active={nodes.every((n) => n.type === s.id)} onClick={() => onShape(s.id)}>{shapeIcon[s.id]}</ToolBtn>
      ))}
      {!onlyFrames && <Sep />}
      <ToolBtn title="Cor" onClick={() => setOpen(open === "color" ? null : "color")} active={open === "color"}>
        <Palette className="size-3.5" />
      </ToolBtn>
      <ToolBtn title="Emoji" onClick={() => setOpen(open === "emoji" ? null : "emoji")} active={open === "emoji"}>
        {one?.data.emoji ? <span className="text-sm leading-none">{one.data.emoji}</span> : <Smile className="size-3.5" />}
      </ToolBtn>
      {one && (
        <ToolBtn title="Detalhes e link" onClick={() => setOpen(open === "notes" ? null : "notes")} active={open === "notes" || !!one.data.notes || !!one.data.link}>
          <Link2 className="size-3.5" />
        </ToolBtn>
      )}
      {one && <ToolBtn title="Editar texto (F2)" onClick={onEdit}><Type className="size-3.5" /></ToolBtn>}
      <Sep />
      {one && one.type !== "frame" && <ToolBtn title="Próximo passo (Tab)" onClick={onChild}><Plus className="size-3.5" /></ToolBtn>}
      <ToolBtn title="Duplicar (Ctrl+D)" onClick={onDuplicate}><Copy className="size-3.5" /></ToolBtn>
      <ToolBtn title="Excluir (Delete)" onClick={onDelete} danger><Trash2 className="size-3.5" /></ToolBtn>

      {open === "color" && (
        <Popover>
          <div className="grid grid-cols-5 gap-1.5">
            {NODE_COLORS.map((c) => (
              <button
                key={c.id}
                title={c.label}
                onClick={() => { onData({ color: c.value }); setOpen(null); }}
                className="size-6 rounded-full border-2 border-border grid place-items-center"
                style={{ background: c.value ?? "var(--surface)" }}
              >
                {!c.value && <Slash className="size-3 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {open === "emoji" && (
        <Popover>
          <div className="grid grid-cols-10 gap-0.5 w-[280px]">
            {EMOJIS.map((em) => (
              <button key={em} onClick={() => { onData({ emoji: em }); setOpen(null); }} className="size-7 rounded hover:bg-muted text-base">{em}</button>
            ))}
          </div>
          <button onClick={() => { onData({ emoji: undefined }); setOpen(null); }} className="mt-1.5 w-full text-[11px] text-muted-foreground hover:text-foreground h-6 rounded hover:bg-muted">Sem emoji</button>
        </Popover>
      )}
      {open === "notes" && one && <NotesPopover node={one} onSave={(p) => { onData(p); setOpen(null); }} />}
    </div>
  );
}

function NotesPopover({ node, onSave }: { node: FlowNode; onSave: (p: Partial<FlowNodeData>) => void }) {
  const [notes, setNotes] = useState(node.data.notes ?? "");
  const [link, setLink] = useState(node.data.link ?? "");
  const save = () => {
    let l = link.trim();
    if (l && !/^https?:\/\//i.test(l)) l = `https://${l}`;
    onSave({ notes: notes.trim() || undefined, link: l || undefined });
  };
  return (
    <Popover>
      <div className="w-72 space-y-2" onKeyDown={(e) => e.stopPropagation()}>
        <div className="text-[11px] font-medium text-muted-foreground">Detalhes (aparecem ao passar o mouse no 📝)</div>
        <textarea
          autoFocus
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Explique melhor esse passo…"
          className="w-full px-2.5 py-2 rounded-lg bg-surface border border-border text-xs outline-none focus:border-primary/50 resize-none"
        />
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Link (opcional)"
          className="w-full px-2.5 h-8 rounded-lg bg-surface border border-border text-xs outline-none focus:border-primary/50"
        />
        <div className="flex justify-end">
          <button onClick={save} className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium">Salvar</button>
        </div>
      </div>
    </Popover>
  );
}

// ================= Barra da seta selecionada =================

function EdgeBar({ edges, onUpdate, onLabel, onReverse, onDelete }: {
  edges: FlowEdge[]; onUpdate: (p: Partial<FlowEdgeData>) => void; onLabel: () => void; onReverse: () => void; onDelete: () => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const kind = (k: EdgeKind) => edges.every((e) => (e.data?.kind ?? "curve") === k);
  const dashed = edges.every((e) => e.data?.dashed);
  return (
    <div className="relative flex items-center gap-0.5 p-1 rounded-xl border border-border bg-popover shadow-lg">
      <ToolBtn title="Curva" active={kind("curve")} onClick={() => onUpdate({ kind: "curve" })}><Spline className="size-3.5" /></ToolBtn>
      <ToolBtn title="Reta" active={kind("straight")} onClick={() => onUpdate({ kind: "straight" })}><Minus className="size-3.5 -rotate-45" /></ToolBtn>
      <ToolBtn title="Em ângulo" active={kind("step")} onClick={() => onUpdate({ kind: "step" })}><CornerUpRight className="size-3.5" /></ToolBtn>
      <Sep />
      <ToolBtn title="Tracejada" active={dashed} onClick={() => onUpdate({ dashed: !dashed || undefined })}>
        <span className="text-[13px] font-bold tracking-[-1px] leading-none">- -</span>
      </ToolBtn>
      <ToolBtn title="Cor" active={colorOpen} onClick={() => setColorOpen((o) => !o)}><Palette className="size-3.5" /></ToolBtn>
      {edges.length === 1 && <ToolBtn title="Texto na seta (Enter)" onClick={onLabel}><Type className="size-3.5" /></ToolBtn>}
      <ToolBtn title="Inverter direção" onClick={onReverse}><ArrowLeftRight className="size-3.5" /></ToolBtn>
      <Sep />
      <ToolBtn title="Excluir (Delete)" onClick={onDelete} danger><Trash2 className="size-3.5" /></ToolBtn>
      {colorOpen && (
        <Popover>
          <div className="grid grid-cols-5 gap-1.5">
            {NODE_COLORS.map((c) => (
              <button key={c.id} title={c.label} onClick={() => { onUpdate({ color: c.value }); setColorOpen(false); }}
                className="size-6 rounded-full border-2 border-border grid place-items-center" style={{ background: c.value ?? "#94a3b8" }} />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

// ================= Menu do botão direito =================

function ContextMenu({ menu, node, hasChildren, canPaste, onClose, actions }: {
  menu: Menu; node?: FlowNode; hasChildren: boolean; canPaste: boolean; onClose: () => void;
  actions: Record<"paste" | "selectAll" | "organize" | "edit" | "child" | "sibling" | "collapse" | "copy" | "duplicate" | "remove", () => void> & { add: (t: ShapeKind) => void };
}) {
  const run = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <div
      className="absolute z-50 w-52 rounded-lg border border-border bg-popover shadow-xl p-1 text-sm"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.kind === "pane" && (
        <>
          <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Adicionar aqui</div>
          {PALETTE.map((s) => <MenuItem key={s.type} icon={s.icon} onClick={run(() => actions.add(s.type))}>{s.label}</MenuItem>)}
          <div className="h-px bg-border my-1" />
          {canPaste && <MenuItem icon={<CornerDownRight className="size-3.5" />} onClick={run(actions.paste)} hint="Ctrl+V">Colar</MenuItem>}
          <MenuItem icon={<Check className="size-3.5" />} onClick={run(actions.selectAll)} hint="Ctrl+A">Selecionar tudo</MenuItem>
          <MenuItem icon={<Wand2 className="size-3.5" />} onClick={run(actions.organize)}>Organizar</MenuItem>
        </>
      )}
      {menu.kind === "node" && node && (
        <>
          <MenuItem icon={<Type className="size-3.5" />} onClick={run(actions.edit)} hint="F2">Editar texto</MenuItem>
          {node.type !== "frame" && <MenuItem icon={<Plus className="size-3.5" />} onClick={run(actions.child)} hint="Tab">Próximo passo</MenuItem>}
          {node.type !== "frame" && <MenuItem icon={<CornerDownRight className="size-3.5" />} onClick={run(actions.sibling)} hint="Enter">Passo do lado</MenuItem>}
          {hasChildren && <MenuItem icon={<Minus className="size-3.5" />} onClick={run(actions.collapse)} hint="/">{node.data.collapsed ? "Mostrar galho" : "Esconder galho"}</MenuItem>}
          <div className="h-px bg-border my-1" />
          <MenuItem icon={<Copy className="size-3.5" />} onClick={run(actions.copy)} hint="Ctrl+C">Copiar</MenuItem>
          <MenuItem icon={<Copy className="size-3.5" />} onClick={run(actions.duplicate)} hint="Ctrl+D">Duplicar</MenuItem>
          <MenuItem icon={<Trash2 className="size-3.5" />} onClick={run(actions.remove)} hint="Del" danger>Excluir</MenuItem>
        </>
      )}
      {menu.kind === "selection" && (
        <>
          <MenuItem icon={<Copy className="size-3.5" />} onClick={run(actions.copy)} hint="Ctrl+C">Copiar</MenuItem>
          <MenuItem icon={<Copy className="size-3.5" />} onClick={run(actions.duplicate)} hint="Ctrl+D">Duplicar</MenuItem>
          <MenuItem icon={<Trash2 className="size-3.5" />} onClick={run(actions.remove)} hint="Del" danger>Excluir</MenuItem>
        </>
      )}
    </div>
  );
}

// ================= Ajuda =================

const SHORTCUTS: [string, string][] = [
  ["Tab", "Criar o próximo passo (filho)"],
  ["Enter", "Criar um passo do lado (irmão)"],
  ["Duplo clique / F2 / começar a digitar", "Escrever na caixinha"],
  ["Enter (escrevendo)", "Terminar de escrever · Shift+Enter quebra linha"],
  ["Tab (escrevendo)", "Terminar e já criar o próximo passo"],
  ["Esc", "Cancelar / tirar seleção"],
  ["Setas", "Andar entre as caixinhas"],
  ["/", "Esconder ou mostrar o galho"],
  ["Delete", "Excluir o que está selecionado"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Desfazer / refazer"],
  ["Ctrl+C / Ctrl+X / Ctrl+V", "Copiar / recortar / colar (cola onde está o mouse)"],
  ["Ctrl+D", "Duplicar"],
  ["Ctrl+A", "Selecionar tudo"],
  ["Ctrl+F", "Buscar no mapa"],
  ["Shift + arrastar", "Selecionar várias caixinhas com um retângulo"],
  ["Shift + clique", "Somar caixinhas à seleção"],
  ["Arrastar o fundo", "Mover o quadro · rodinha do mouse dá zoom"],
  ["Shift+1", "Enquadrar tudo na tela"],
  ["Puxar a bolinha da borda", "Ligar com outra caixinha · soltar no vazio cria uma nova"],
  ["Duplo clique na seta", "Escrever na seta (ex.: Sim / Não)"],
];

function HelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-popover border border-border shadow-xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="font-semibold flex items-center gap-2"><Keyboard className="size-4" /> Atalhos</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="p-3">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex items-start justify-between gap-4 px-2 py-1.5 text-sm rounded-md hover:bg-muted/50">
              <span className="text-muted-foreground">{d}</span>
              <span className="text-xs font-medium text-right shrink-0 max-w-[45%]">{k}</span>
            </div>
          ))}
          <p className="px-2 pt-2 text-[11px] text-muted-foreground">No Mac, use ⌘ no lugar de Ctrl.</p>
        </div>
      </div>
    </div>
  );
}

// ================= Peças pequenas =================

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="px-1.5 py-0.5 rounded border border-border bg-background text-[10px] font-semibold text-foreground">{children}</kbd>;
}

function IconBtn({ children, title, onClick, active }: { children: ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} title={title}
      className={`size-9 grid place-items-center rounded-lg border transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface hover:bg-surface-hover"}`}>
      {children}
    </button>
  );
}

function SegBtn({ children, active, onClick, title }: { children: ReactNode; active: boolean; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title}
      className={`h-7 px-2.5 rounded-md grid place-items-center ${active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}

function ToolBtn({ children, title, onClick, active, danger }: { children: ReactNode; title: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title}
      className={`size-7 grid place-items-center rounded-md transition-colors ${
        active ? "bg-primary/15 text-primary" : danger ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}>
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-border mx-0.5" />;
}

function Popover({ children }: { children: ReactNode }) {
  return <div className="absolute left-0 top-full mt-2 z-50 rounded-xl border border-border bg-popover shadow-xl p-2">{children}</div>;
}

function MenuItem({ children, icon, onClick, hint, danger }: { children: ReactNode; icon?: ReactNode; onClick: () => void; hint?: string; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 h-8 rounded-md text-left text-[13px] ${danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted"}`}>
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

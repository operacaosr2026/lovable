import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, ConnectionMode, MarkerType,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, useNodesInitialized,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./academia.css";
import {
  Circle, Square, Diamond, StickyNote, Trash2, Maximize2, Minimize2, GitBranchPlus, ListPlus,
  Undo2, Redo2, ChevronsDownUp, ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";

export type DiagramMode = "flow" | "mindmap";
export type DiagramContent = { nodes?: Node[]; edges?: Edge[] };
type Shape = "start" | "process" | "decision" | "note";
type Side = "left" | "right";
// Campos com "_" são calculados na hora (não vão pro banco).
type NodeData = {
  label: string; color?: string; shape?: Shape; root?: boolean;
  side?: Side; order?: number; collapsed?: boolean; _kids?: number; _desc?: number;
};
type Graph = { nodes: Node[]; edges: Edge[] };

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];
const GAP_X = 56;
const GAP_Y = 14;
const HISTORY = 100;

// Copiar/colar vale entre aulas do mesmo tipo.
let clipboard: { mode: DiagramMode; top: string | null; nodes: Node[]; edges: Edge[] } | null = null;

const DiagramCtx = createContext<{
  editable: boolean;
  setLabel: (id: string, label: string) => void;
  toggleCollapse: (id: string) => void;
  dropTarget: string | null;
  editId: string | null;
  clearEditId: () => void;
  refocus: () => void;
}>({
  editable: false, setLabel: () => {}, toggleCollapse: () => {}, dropTarget: null, editId: null, clearEditId: () => {}, refocus: () => {},
});

// Texto do nó: duplo clique edita (Enter salva, Shift+Enter quebra linha, Esc cancela).
function NodeLabel({ id, label, className }: { id: string; label: string; className?: string }) {
  const { editable, setLabel, editId, clearEditId, refocus } = useContext(DiagramCtx);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  useEffect(() => { if (!editing) setDraft(label); }, [label, editing]);
  useEffect(() => {
    if (editable && editId === id) { setEditing(true); clearEditId(); }
  }, [editable, editId, id, clearEditId]);

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => { setEditing(false); setLabel(id, draft.trim() || label); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); refocus(); }
          if (e.key === "Escape") { setDraft(label); setEditing(false); refocus(); }
        }}
        rows={Math.max(1, draft.split("\n").length)}
        className={`nodrag nowheel w-full resize-none bg-transparent outline-none text-center ${className ?? ""}`}
      />
    );
  }
  return (
    <div
      onDoubleClick={() => editable && setEditing(true)}
      className={`whitespace-pre-wrap break-words text-center ${className ?? ""}`}
    >
      {label || <span className="opacity-40">Duplo clique para escrever</span>}
    </div>
  );
}

function SideHandles() {
  return (
    <>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
    </>
  );
}

function FlowNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const color = data.color ?? COLORS[0];
  const ring = selected ? `0 0 0 2px ${color}` : undefined;

  if (data.shape === "decision") {
    return (
      <div className="relative w-[170px] h-[110px] grid place-items-center">
        <svg className="absolute inset-0 size-full overflow-visible" viewBox="0 0 170 110" preserveAspectRatio="none">
          <polygon
            points="85,2 168,55 85,108 2,55"
            fill={`color-mix(in oklab, ${color} 14%, var(--surface))`}
            stroke={color}
            strokeWidth={selected ? 3 : 1.5}
          />
        </svg>
        <NodeLabel id={id} label={data.label} className="relative px-9 text-xs font-medium leading-snug" />
        <SideHandles />
      </div>
    );
  }
  if (data.shape === "note") {
    return (
      <div className="w-[190px] rounded-md p-3 shadow-sm" style={{ background: "color-mix(in oklab, #facc15 30%, var(--surface))", boxShadow: ring }}>
        <NodeLabel id={id} label={data.label} className="text-xs text-left! leading-relaxed" />
        <SideHandles />
      </div>
    );
  }
  const pill = data.shape === "start";
  return (
    <div
      className={`min-w-[140px] max-w-[240px] px-4 py-3 border-2 bg-surface ${pill ? "rounded-full" : "rounded-xl"}`}
      style={{ borderColor: color, background: pill ? color : undefined, color: pill ? "#fff" : undefined, boxShadow: ring }}
    >
      <NodeLabel id={id} label={data.label} className="text-sm font-medium leading-snug" />
      <SideHandles />
    </div>
  );
}

function MindNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const { toggleCollapse, dropTarget } = useContext(DiagramCtx);
  const color = data.color ?? COLORS[0];
  const isDrop = dropTarget === id;
  const handles = (
    <>
      <Handle id="l" type="source" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
    </>
  );
  const ring = isDrop
    ? `0 0 0 3px var(--background), 0 0 0 5px ${color}`
    : selected ? `0 0 0 3px color-mix(in oklab, ${color} 38%, transparent)` : undefined;

  if (data.root) {
    return (
      <div className="min-w-[160px] max-w-[260px] px-5 py-3.5 rounded-2xl text-white shadow-lg" style={{ background: color, boxShadow: ring }}>
        <NodeLabel id={id} label={data.label} className="text-base font-semibold" />
        {handles}
      </div>
    );
  }
  const kids = data._kids ?? 0;
  const left = data.side === "left";
  return (
    <div
      className={`group relative min-w-[110px] max-w-[220px] px-3.5 py-2 rounded-xl border-2 transition-shadow ${isDrop ? "bg-primary/10" : "bg-surface"}`}
      style={{ borderColor: color, boxShadow: ring }}
    >
      <NodeLabel id={id} label={data.label} className="text-sm leading-snug" />
      {handles}
      {kids > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); toggleCollapse(id); }}
          title={data.collapsed ? `Expandir (${data._desc} ${data._desc === 1 ? "tópico" : "tópicos"})` : "Recolher este ramo"}
          className={`nodrag nopan absolute top-1/2 -translate-y-1/2 ${left ? "-left-3.5" : "-right-3.5"} z-10 min-w-6 h-6 px-1.5 rounded-full border-2 text-[11px] font-bold leading-none grid place-items-center shadow-sm hover:scale-110 transition-transform`}
          style={data.collapsed ? { borderColor: color, background: color, color: "#fff" } : { borderColor: color, background: "var(--surface)", color }}
        >
          {data.collapsed ? `+${data._desc}` : "−"}
        </button>
      )}
    </div>
  );
}

const nodeTypes = { flow: FlowNode, mind: MindNode };

const uid = () => crypto.randomUUID().slice(0, 8);
const dataOf = (n: Node | undefined) => (n?.data ?? {}) as NodeData;

function flowEdge(e: Edge | Connection & { id?: string; label?: unknown }): Edge {
  return {
    ...e,
    id: (e as Edge).id ?? `e-${uid()}`,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: { strokeWidth: 1.75 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 6,
    labelStyle: { fontSize: 11, fontWeight: 500 },
  } as Edge;
}

function mindEdge(source: string, target: string): Edge {
  return { id: `e-${uid()}`, source, target, type: "default" };
}

// ── Mapa mental: árvore, lados, recolhidos e layout automático ──

function mindTree(nodes: Node[], edges: Edge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes.find((n) => dataOf(n).root);
  const parentOf = new Map<string, string>();
  const kids = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || parentOf.has(e.target) || e.target === root?.id) continue;
    parentOf.set(e.target, e.source);
    kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => (dataOf(byId.get(a)).order ?? Infinity) - (dataOf(byId.get(b)).order ?? Infinity));
  }
  const subtree = (id: string) => {
    const out = new Set([id]);
    const stack = [id];
    while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) { out.add(k); stack.push(k); }
    return out;
  };
  return { byId, root, parentOf, kids, subtree };
}

// Ramos do tema central se dividem em direita/esquerda; filhos herdam o lado.
// Posição é sempre calculada (o mapa se organiza sozinho, como no MindMeister).
function normalizeMind({ nodes, edges }: Graph): Graph {
  const { byId, root, parentOf, kids } = mindTree(nodes, edges);
  if (!root) return { nodes, edges };

  const size = (id: string) => {
    const n = byId.get(id)!;
    return { w: n.measured?.width ?? n.width ?? 150, h: n.measured?.height ?? n.height ?? 42 };
  };
  const side = new Map<string, Side>();
  const hidden = new Set<string>();
  const desc = new Map<string, number>();
  const order = new Map<string, number>();
  const collapsed = (id: string) => !!dataOf(byId.get(id)).collapsed && (kids.get(id)?.length ?? 0) > 0;

  const walk = (id: string, s: Side | null, hideKids: boolean): number => {
    let count = 0;
    (kids.get(id) ?? []).forEach((k, i) => {
      order.set(k, i);
      const ks: Side = s ?? (dataOf(byId.get(k)).side === "left" ? "left" : "right");
      side.set(k, ks);
      if (hideKids) hidden.add(k);
      count += 1 + walk(k, ks, hideKids || collapsed(k));
    });
    desc.set(id, count);
    return count;
  };
  walk(root.id, null, false);

  const visibleKids = (id: string) => (collapsed(id) ? [] : kids.get(id) ?? []);
  const subH = new Map<string, number>();
  const calcH = (id: string): number => {
    const ks = visibleKids(id);
    const total = ks.reduce((a, k) => a + calcH(k), 0) + GAP_Y * Math.max(0, ks.length - 1);
    const v = Math.max(size(id).h, total);
    subH.set(id, v);
    return v;
  };
  const pos = new Map<string, { x: number; y: number }>();
  const stack = (ids: string[], anchorX: number, centerY: number, s: Side) => {
    const total = ids.reduce((a, k) => a + calcH(k), 0) + GAP_Y * Math.max(0, ids.length - 1);
    let y = centerY - total / 2;
    for (const k of ids) {
      place(k, anchorX, y + subH.get(k)! / 2, s);
      y += subH.get(k)! + GAP_Y;
    }
  };
  const place = (id: string, anchorX: number, centerY: number, s: Side) => {
    const { w, h } = size(id);
    pos.set(id, { x: s === "right" ? anchorX : anchorX - w, y: centerY - h / 2 });
    stack(visibleKids(id), s === "right" ? anchorX + w + GAP_X : anchorX - w - GAP_X, centerY, s);
  };
  const r = size(root.id);
  pos.set(root.id, { x: -r.w / 2, y: -r.h / 2 });
  const rootKids = kids.get(root.id) ?? [];
  stack(rootKids.filter((k) => side.get(k) === "right"), r.w / 2 + GAP_X + 14, 0, "right");
  stack(rootKids.filter((k) => side.get(k) === "left"), -r.w / 2 - GAP_X - 14, 0, "left");

  return {
    nodes: nodes.map((n) => {
      const isRoot = n.id === root.id;
      return {
        ...n,
        position: pos.get(n.id) ?? n.position,
        hidden: hidden.has(n.id),
        deletable: !isRoot,
        draggable: !isRoot,
        data: {
          ...n.data,
          side: isRoot ? undefined : side.get(n.id),
          order: order.get(n.id),
          _kids: kids.get(n.id)?.length ?? 0,
          _desc: desc.get(n.id) ?? 0,
        },
      };
    }),
    edges: edges.map((e) => {
      if (parentOf.get(e.target) !== e.source) return e;
      const left = side.get(e.target) === "left";
      return {
        ...e,
        type: "default",
        sourceHandle: left ? "l" : "r",
        targetHandle: left ? "r" : "l",
        hidden: hidden.has(e.target),
        style: { stroke: dataOf(byId.get(e.target)).color ?? COLORS[0], strokeWidth: 2.5 },
      };
    }),
  };
}

function balancedSide(nodes: Node[], edges: Edge[], rootId: string, except?: string): Side {
  const ids = new Set(edges.filter((e) => e.source === rootId && e.target !== except).map((e) => e.target));
  let left = 0, right = 0;
  for (const n of nodes) if (ids.has(n.id)) { if (dataOf(n).side === "left") left++; else right++; }
  return left < right ? "left" : "right";
}

function clean(nodes: Node[], edges: Edge[]): DiagramContent {
  return {
    nodes: nodes.map(({ id, type, position, data, width, height }) => {
      const d = Object.fromEntries(Object.entries(data).filter(([k, v]) => !k.startsWith("_") && v !== undefined));
      return { id, type, position, data: d, ...(width ? { width } : {}), ...(height ? { height } : {}) };
    }),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, label, type, style, markerEnd }) =>
      ({ id, source, target, sourceHandle, targetHandle, label, type, style, markerEnd })) as Edge[],
  };
}

function initial(mode: DiagramMode, content: DiagramContent): Graph {
  const nodes = content.nodes ?? [];
  if (mode === "flow") return { nodes, edges: content.edges ?? [] };
  if (nodes.length) return normalizeMind({ nodes, edges: content.edges ?? [] });
  return normalizeMind({
    nodes: [{ id: "root", type: "mind", position: { x: 0, y: 0 }, data: { label: "Tema central", root: true, color: COLORS[0] } }],
    edges: [],
  });
}

function Canvas({ mode, content, editable, onChange }: {
  mode: DiagramMode; content: DiagramContent; editable: boolean; onChange: (c: DiagramContent) => void;
}) {
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [{ nodes, edges }, setGraphRaw] = useState(() => initial(mode, content));
  const [full, setFull] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const graphRef = useRef<Graph>({ nodes, edges });
  graphRef.current = { nodes, edges };
  const past = useRef<Graph[]>([]);
  const future = useRef<Graph[]>([]);
  const mind = mode === "mindmap";

  const shape = useCallback((g: Graph) => (mind ? normalizeMind(g) : g), [mind]);
  const setGraph = useCallback((g: Graph) => { graphRef.current = g; setGraphRaw(g); }, []);

  // Mudança de verdade: entra no histórico (desfazer) e é salva.
  const commit = useCallback((next: Graph) => {
    const g = shape(next);
    past.current = [...past.current.slice(-(HISTORY - 1)), graphRef.current];
    future.current = [];
    setGraph(g);
    onChangeRef.current(clean(g.nodes, g.edges));
  }, [shape, setGraph]);

  const restore = useCallback((from: React.MutableRefObject<Graph[]>, to: React.MutableRefObject<Graph[]>) => {
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push(graphRef.current);
    const g = shape(prev);
    setGraph(g);
    onChangeRef.current(clean(g.nodes, g.edges));
  }, [shape, setGraph]);
  const undo = useCallback(() => restore(past, future), [restore]);
  const redo = useCallback(() => restore(future, past), [restore]);

  const nodesReady = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => {
    if (nodesReady && !fitted.current) {
      fitted.current = true;
      requestAnimationFrame(() => rf.fitView({ padding: 0.2, maxZoom: 1.2 }));
    }
  }, [nodesReady, rf]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const g = graphRef.current;
    const tree = mind ? mindTree(g.nodes, g.edges) : null;
    changes = changes.filter((c) => !(c.type === "remove" && c.id === tree?.root?.id));
    let removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    // Mapa mental: apagar um ramo apaga tudo que sai dele.
    if (tree && removed.length) {
      const all = new Set(removed.flatMap((id) => [...tree.subtree(id)]));
      removed = [...all];
      changes = [...changes.filter((c) => c.type !== "remove"), ...removed.map((id) => ({ type: "remove" as const, id }))];
    }
    const next = {
      nodes: applyNodeChanges(changes, g.nodes),
      edges: removed.length ? g.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)) : g.edges,
    };
    if (removed.length) return commit(next);
    if (mind) {
      // Tamanho medido muda o layout; arrastar só mexe até soltar (onNodeDragStop).
      if (changes.some((c) => c.type === "dimensions")) return setGraph(normalizeMind(next));
      return setGraph(next);
    }
    if (changes.some((c) => c.type === "position" && !c.dragging)) commit(next); else setGraph(next);
  }, [commit, mind, setGraph]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const g = graphRef.current;
    const next = { nodes: g.nodes, edges: applyEdgeChanges(changes, g.edges) };
    if (changes.some((c) => c.type === "remove")) commit(next); else setGraph(next);
  }, [commit, setGraph]);

  const onConnect = useCallback((c: Connection) => {
    const g = graphRef.current;
    commit({ nodes: g.nodes, edges: addEdge(flowEdge(c), g.edges) });
  }, [commit]);

  const setLabel = useCallback((id: string, label: string) => {
    const g = graphRef.current;
    if (dataOf(g.nodes.find((n) => n.id === id)).label === label) return;
    commit({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)) });
  }, [commit]);

  // Quem só assiste também recolhe/expande, mas sem salvar.
  const toggleCollapse = useCallback((id: string) => {
    const g = graphRef.current;
    const next = { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, collapsed: !dataOf(n).collapsed } } : n)) };
    if (editable) commit(next); else setGraph(normalizeMind(next));
  }, [commit, editable, setGraph]);

  const setAllCollapsed = (value: boolean) => {
    const g = graphRef.current;
    const next = { ...g, nodes: g.nodes.map((n) => (dataOf(n).root || !dataOf(n)._kids ? n : { ...n, data: { ...n.data, collapsed: value } })) };
    if (editable) commit(next); else setGraph(normalizeMind(next));
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300, maxZoom: 1.2 }), 60);
  };

  const refocus = useCallback(() => wrapRef.current?.focus({ preventScroll: true }), []);
  const clearEditId = useCallback(() => setEditId(null), []);

  const selectedNode = nodes.find((n) => n.selected);
  const selectedEdge = edges.find((e) => e.selected);
  const anyCollapsed = mind && nodes.some((n) => dataOf(n).collapsed && dataOf(n)._kids);

  const center = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    return { x: p.x - 80 + (Math.random() * 40 - 20), y: p.y - 25 + (Math.random() * 40 - 20) };
  };

  const addFlowNode = (shape: Shape) => {
    const g = graphRef.current;
    const label = { start: "Início", process: "Etapa", decision: "Decisão?", note: "Observação" }[shape];
    const node: Node = { id: uid(), type: "flow", position: center(), data: { label, shape, color: shape === "start" ? COLORS[2] : COLORS[0] }, selected: true };
    commit({ nodes: [...g.nodes.map((n) => ({ ...n, selected: false })), node], edges: g.edges });
  };

  // Novo ramo: entra no fim dos filhos (ou logo depois de `after`) e já abre pra escrever.
  const addMindChild = (parentId: string, after?: string) => {
    const g = graphRef.current;
    const { byId, root, kids } = mindTree(g.nodes, g.edges);
    const parent = byId.get(parentId);
    if (!parent || !root) return;
    const pData = dataOf(parent);
    const siblings = kids.get(parentId) ?? [];
    const afterNode = after ? byId.get(after) : undefined;
    const color = pData.root ? (afterNode ? dataOf(afterNode).color : COLORS[(siblings.length + 1) % COLORS.length]) : pData.color;
    const node: Node = {
      id: uid(), type: "mind", position: parent.position, selected: true,
      data: {
        label: "Novo ramo",
        color: color ?? COLORS[0],
        order: afterNode ? (dataOf(afterNode).order ?? 0) + 0.5 : siblings.length,
        side: pData.root ? (afterNode ? dataOf(afterNode).side : balancedSide(g.nodes, g.edges, root.id)) : undefined,
      },
    };
    commit({
      nodes: [...g.nodes.map((n) => ({ ...n, selected: false, ...(n.id === parentId && pData.collapsed ? { data: { ...n.data, collapsed: false } } : {}) })), node],
      edges: [...g.edges, mindEdge(parentId, node.id)],
    });
    setEditId(node.id);
  };

  const addMindSibling = (id: string) => {
    const parentEdge = graphRef.current.edges.find((e) => e.target === id);
    if (parentEdge) addMindChild(parentEdge.source, id);
  };

  // ── Arrastar: soltar em cima de outro tópico muda o pai; fora, reordena / troca de lado ──

  const findDropTarget = useCallback((node: Node) => {
    const g = graphRef.current;
    const banned = mindTree(g.nodes, g.edges).subtree(node.id);
    return rf.getIntersectingNodes(node).find((n) => !banned.has(n.id) && !n.hidden)?.id ?? null;
  }, [rf]);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    if (mind) setDropTarget(findDropTarget(node));
  }, [mind, findDropTarget]);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    if (!mind) return;
    setDropTarget(null);
    const g = graphRef.current;
    const { byId, root, parentOf, kids, subtree } = mindTree(g.nodes, g.edges);
    if (!root) return;
    const target = findDropTarget(node);
    const parentId = parentOf.get(node.id);

    if (target && target !== parentId) {
      const t = byId.get(target)!;
      const tData = dataOf(t);
      const sub = subtree(node.id);
      commit({
        nodes: g.nodes.map((n) => {
          if (n.id === target && tData.collapsed) return { ...n, data: { ...n.data, collapsed: false } };
          if (!sub.has(n.id)) return n;
          const d: NodeData = { ...dataOf(n) };
          if (n.id === node.id) {
            d.order = kids.get(target)?.length ?? 0;
            if (tData.root) d.side = balancedSide(g.nodes, g.edges, root.id, node.id);
          }
          if (!tData.root) d.color = tData.color;
          return { ...n, data: d };
        }),
        edges: [...g.edges.filter((e) => e.target !== node.id), mindEdge(target, node.id)],
      });
      return;
    }

    if (!parentId) { setGraph(normalizeMind(g)); return; }
    const r = byId.get(root.id)!;
    const rootCenter = r.position.x + (r.measured?.width ?? 160) / 2;
    const nodeCenter = node.position.x + (node.measured?.width ?? 150) / 2;
    const newSide: Side | undefined = parentId === root.id ? (nodeCenter < rootCenter ? "left" : "right") : undefined;
    const sibs = (kids.get(parentId) ?? []).map((id) => ({ id, y: id === node.id ? node.position.y : byId.get(id)!.position.y }));
    const newOrder = new Map([...sibs].sort((a, b) => a.y - b.y).map((s, i) => [s.id, i]));
    const changed = (newSide && newSide !== dataOf(node).side) || sibs.some((s) => newOrder.get(s.id) !== dataOf(byId.get(s.id)).order);
    if (!changed) { setGraph(normalizeMind(g)); return; }
    commit({
      ...g,
      nodes: g.nodes.map((n) => {
        if (!newOrder.has(n.id)) return n;
        const d: NodeData = { ...dataOf(n), order: newOrder.get(n.id) };
        if (n.id === node.id && newSide) d.side = newSide;
        return { ...n, data: d };
      }),
    });
  }, [mind, findDropTarget, commit, setGraph]);

  // ── Copiar / recortar / colar ──

  const copy = () => {
    const g = graphRef.current;
    if (mind) {
      if (!selectedNode || dataOf(selectedNode).root) return false;
      const sub = mindTree(g.nodes, g.edges).subtree(selectedNode.id);
      clipboard = {
        mode, top: selectedNode.id,
        nodes: g.nodes.filter((n) => sub.has(n.id)),
        edges: g.edges.filter((e) => sub.has(e.source) && sub.has(e.target)),
      };
    } else {
      const sel = g.nodes.filter((n) => n.selected);
      if (!sel.length) return false;
      const ids = new Set(sel.map((n) => n.id));
      clipboard = { mode, top: null, nodes: sel, edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
    }
    return true;
  };

  const paste = () => {
    if (!clipboard || clipboard.mode !== mode) return;
    const g = graphRef.current;
    const ids = new Map(clipboard.nodes.map((n) => [n.id, uid()]));
    const edgesCopy = clipboard.edges.map((e) => ({ ...e, id: `e-${uid()}`, source: ids.get(e.source)!, target: ids.get(e.target)!, selected: false }));
    const base = g.nodes.map((n) => ({ ...n, selected: false }));
    if (mind) {
      const { byId, root, kids } = mindTree(g.nodes, g.edges);
      if (!root) return;
      const parent = selectedNode && !selectedNode.hidden ? selectedNode : byId.get(root.id)!;
      const pData = dataOf(parent);
      const top = clipboard.top!;
      const copies = clipboard.nodes.map((n) => {
        const d: NodeData = { ...dataOf(n) };
        if (n.id === top) {
          d.order = kids.get(parent.id)?.length ?? 0;
          d.side = pData.root ? balancedSide(g.nodes, g.edges, root.id) : undefined;
        }
        if (!pData.root) d.color = pData.color;
        return { ...n, id: ids.get(n.id)!, data: d, selected: n.id === top, measured: undefined };
      });
      commit({
        nodes: [...base.map((n) => (n.id === parent.id && pData.collapsed ? { ...n, data: { ...n.data, collapsed: false } } : n)), ...copies],
        edges: [...g.edges, ...edgesCopy, mindEdge(parent.id, ids.get(top)!)],
      });
    } else {
      const copies = clipboard.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, position: { x: n.position.x + 40, y: n.position.y + 40 }, selected: true }));
      // Colar de novo cai mais 40px pra baixo, não em cima da cópia anterior.
      clipboard = { ...clipboard, nodes: clipboard.nodes.map((n) => ({ ...n, position: { x: n.position.x + 40, y: n.position.y + 40 } })) };
      commit({ nodes: [...base, ...copies], edges: [...g.edges, ...edgesCopy] });
    }
  };

  const setColor = (color: string) => {
    const g = graphRef.current;
    if (!selectedNode) return;
    // No mapa mental a cor desce pro ramo inteiro.
    const ids = mind ? mindTree(g.nodes, g.edges).subtree(selectedNode.id) : new Set([selectedNode.id]);
    commit({ ...g, nodes: g.nodes.map((n) => (ids.has(n.id) ? { ...n, data: { ...n.data, color } } : n)) });
  };

  const setEdgeLabel = (label: string) => {
    const g = graphRef.current;
    if (!selectedEdge) return;
    commit({ ...g, edges: g.edges.map((e) => (e.id === selectedEdge.id ? { ...e, label: label || undefined } : e)) });
  };

  const removeSelected = () => {
    const g = graphRef.current;
    if (selectedNode && !dataOf(selectedNode).root) onNodesChange([{ type: "remove", id: selectedNode.id }]);
    else if (selectedEdge) commit({ ...g, edges: g.edges.filter((e) => e.id !== selectedEdge.id) });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editable) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === "y") { e.preventDefault(); redo(); return; }
    if (mod && key === "c") { if (copy()) toast.success(mind ? "Ramo copiado" : "Copiado"); return; }
    if (mod && key === "x") { if (copy()) removeSelected(); return; }
    if (mod && key === "v") { e.preventDefault(); paste(); return; }
    if (!mind || !selectedNode) return;
    if (e.key === "Tab") { e.preventDefault(); addMindChild(selectedNode.id); }
    if (e.key === "Enter" && !dataOf(selectedNode).root) { e.preventDefault(); addMindSibling(selectedNode.id); }
    if (e.key === "F2" || e.key === " ") { e.preventDefault(); setEditId(selectedNode.id); }
  };

  const btn = "h-8 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-muted text-foreground/80 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent";
  const sep = "w-px h-5 bg-border mx-1";

  return (
    <DiagramCtx.Provider value={{ editable, setLabel, toggleCollapse, dropTarget, editId, clearEditId, refocus }}>
      <div
        ref={wrapRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          const tag = (e.target as HTMLElement).tagName;
          if (tag !== "TEXTAREA" && tag !== "INPUT" && !wrapRef.current?.contains(document.activeElement)) refocus();
        }}
        className={`academia-flow ${editable ? "" : "readonly"} ${mind ? "mind" : ""} relative outline-none border border-border bg-background overflow-hidden ${full ? "fixed inset-0 z-50 rounded-none" : "h-[70vh] min-h-[420px] rounded-2xl"}`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={editable}
          nodesConnectable={editable && !mind}
          elementsSelectable={editable}
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
          {nodes.length > 8 && <MiniMap pannable zoomable position="bottom-left" className="hidden sm:block" />}
        </ReactFlow>

        <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center gap-1 pointer-events-none">
          {editable ? (
            <div className="flex flex-wrap items-center gap-0.5 rounded-xl border border-border bg-surface/95 backdrop-blur p-1 shadow-sm pointer-events-auto">
              <button className={btn} disabled={!past.current.length} onClick={undo} title="Desfazer (Ctrl+Z)"><Undo2 className="size-3.5" /></button>
              <button className={btn} disabled={!future.current.length} onClick={redo} title="Refazer (Ctrl+Shift+Z)"><Redo2 className="size-3.5" /></button>
              <span className={sep} />
              {mind ? (
                <>
                  <button className={btn} disabled={!selectedNode} onClick={() => selectedNode && addMindChild(selectedNode.id)} title="Adicionar ramo (Tab)"><GitBranchPlus className="size-3.5" /> Ramo</button>
                  <button className={btn} disabled={!selectedNode || dataOf(selectedNode).root} onClick={() => selectedNode && addMindSibling(selectedNode.id)} title="Adicionar irmão (Enter)"><ListPlus className="size-3.5" /> Irmão</button>
                  <button className={btn} onClick={() => setAllCollapsed(!anyCollapsed)} title={anyCollapsed ? "Expandir tudo" : "Recolher tudo"}>
                    {anyCollapsed ? <ChevronsUpDown className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}
                    {anyCollapsed ? "Expandir tudo" : "Recolher tudo"}
                  </button>
                </>
              ) : (
                <>
                  <button className={btn} onClick={() => addFlowNode("start")} title="Início / Fim"><Circle className="size-3.5" /> Início/Fim</button>
                  <button className={btn} onClick={() => addFlowNode("process")} title="Etapa"><Square className="size-3.5" /> Etapa</button>
                  <button className={btn} onClick={() => addFlowNode("decision")} title="Decisão"><Diamond className="size-3.5" /> Decisão</button>
                  <button className={btn} onClick={() => addFlowNode("note")} title="Nota"><StickyNote className="size-3.5" /> Nota</button>
                </>
              )}
              {selectedNode && (
                <div className="flex items-center gap-1 pl-1.5 ml-1 border-l border-border">
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => setColor(c)} className="size-5 rounded-full border-2 border-surface hover:scale-110 transition" style={{ background: c }} title="Cor" />
                  ))}
                </div>
              )}
              {selectedEdge && !mind && (
                <input
                  key={selectedEdge.id}
                  defaultValue={typeof selectedEdge.label === "string" ? selectedEdge.label : ""}
                  onBlur={(e) => setEdgeLabel(e.target.value.trim())}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}
                  placeholder="Texto da seta (ex.: Sim)"
                  className="h-8 w-44 px-2.5 ml-1 rounded-lg bg-background border border-border text-xs outline-none focus:border-primary"
                />
              )}
              {(selectedEdge || (selectedNode && !dataOf(selectedNode).root)) && (
                <button className={`${btn} text-destructive! hover:bg-destructive/10`} onClick={removeSelected} title="Excluir (Delete)"><Trash2 className="size-3.5" /></button>
              )}
            </div>
          ) : mind && nodes.some((n) => dataOf(n)._kids && !dataOf(n).root) && (
            <button
              onClick={() => setAllCollapsed(!anyCollapsed)}
              className="h-9 px-3 rounded-xl border border-border bg-surface/95 backdrop-blur text-xs font-medium flex items-center gap-1.5 shadow-sm hover:bg-muted pointer-events-auto"
            >
              {anyCollapsed ? <ChevronsUpDown className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}
              {anyCollapsed ? "Expandir tudo" : "Recolher tudo"}
            </button>
          )}
          <button
            onClick={() => { setFull((f) => !f); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); }}
            className="ml-auto size-9 rounded-xl border border-border bg-surface/95 backdrop-blur grid place-items-center shadow-sm hover:bg-muted pointer-events-auto"
            title={full ? "Sair da tela cheia" : "Tela cheia"}
          >
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </div>

        {editable && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground bg-surface/90 border border-border rounded-lg px-2.5 py-1 hidden md:block pointer-events-none whitespace-nowrap">
            {mind
              ? "Tab ramo · Enter irmão · duplo clique edita · arraste para outro tópico · Ctrl+Z desfaz · Ctrl+C/V copia"
              : "Duplo clique edita · arraste das bolinhas para ligar · Delete apaga · Ctrl+Z desfaz · Ctrl+C/V copia"}
          </div>
        )}
        {!editable && nodes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground pointer-events-none">Diagrama ainda vazio</div>
        )}
      </div>
    </DiagramCtx.Provider>
  );
}

export function LessonDiagram(props: {
  mode: DiagramMode; content: DiagramContent; editable: boolean; onChange: (c: DiagramContent) => void;
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

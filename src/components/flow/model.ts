import { MarkerType, type Edge, type Node } from "@xyflow/react";

export type ShapeKind = "step" | "decision" | "terminal" | "note" | "frame";
export type EdgeKind = "curve" | "straight" | "step";
export type Direction = "horizontal" | "vertical";

export type FlowNodeData = {
  text: string;
  color?: string;
  emoji?: string;
  notes?: string;
  link?: string;
  collapsed?: boolean;
};
export type FlowNode = Node<FlowNodeData, ShapeKind>;

export type FlowEdgeData = {
  label?: string;
  kind?: EdgeKind;
  dashed?: boolean;
  color?: string;
};
export type FlowEdge = Edge<FlowEdgeData>;

type StoredNode = {
  id: string;
  type: ShapeKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
} & FlowNodeData;

type StoredEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
} & FlowEdgeData;

export type Diagram = { version: 1; nodes: StoredNode[]; edges: StoredEdge[] };

export const SHAPES: { id: Exclude<ShapeKind, "frame">; label: string }[] = [
  { id: "step", label: "Etapa" },
  { id: "decision", label: "Decisão" },
  { id: "terminal", label: "Início/Fim" },
  { id: "note", label: "Nota" },
];

export const NODE_COLORS: { id: string; label: string; value?: string }[] = [
  { id: "default", label: "Padrão" },
  { id: "blue", label: "Azul", value: "#3b82f6" },
  { id: "teal", label: "Verde-água", value: "#14b8a6" },
  { id: "green", label: "Verde", value: "#22c55e" },
  { id: "yellow", label: "Amarelo", value: "#eab308" },
  { id: "orange", label: "Laranja", value: "#f97316" },
  { id: "red", label: "Vermelho", value: "#ef4444" },
  { id: "pink", label: "Rosa", value: "#ec4899" },
  { id: "purple", label: "Roxo", value: "#8b5cf6" },
  { id: "gray", label: "Cinza", value: "#64748b" },
];

export const EMOJIS = [
  "✅", "❌", "⚠️", "❓", "💡", "📌", "⭐", "🔥", "🎯", "🚀",
  "💰", "💳", "🧾", "📦", "🚚", "🛒", "📞", "💬", "📧", "👤",
  "👥", "⏰", "📅", "🔁", "🛠️", "📊", "🔒", "📝", "🔍", "🏁",
];

export const DEFAULT_EDGE_COLOR = "#94a3b8";

export const DEFAULT_TEXT: Record<ShapeKind, string> = {
  step: "",
  decision: "",
  terminal: "",
  note: "",
  frame: "Moldura",
};

export const newId = () => crypto.randomUUID();

export function decorateNode(n: FlowNode): FlowNode {
  if (n.type === "frame") {
    return { ...n, zIndex: -1, dragHandle: ".flow-frame-handle", style: { ...(n.style ?? {}), pointerEvents: "none" } };
  }
  return n;
}

export function decorateEdge(e: FlowEdge): FlowEdge {
  const color = e.data?.color ?? DEFAULT_EDGE_COLOR;
  return {
    ...e,
    type: "flow",
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
  };
}

export function makeNode(type: ShapeKind, position: { x: number; y: number }, data: Partial<FlowNodeData> = {}): FlowNode {
  const base: FlowNode = {
    id: newId(),
    type,
    position,
    data: { text: DEFAULT_TEXT[type], ...data },
  };
  if (type === "frame") return decorateNode({ ...base, width: 420, height: 280 });
  if (type === "note") return { ...base, width: 200, height: 120 };
  return base;
}

export function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  data: FlowEdgeData = {},
): FlowEdge {
  return decorateEdge({ id: newId(), source, target, sourceHandle, targetHandle, data: { kind: "curve", ...data } });
}

const clean = <T extends Record<string, unknown>>(o: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) out[k] = v;
  return out as T;
};

export function serialize(nodes: FlowNode[], edges: FlowEdge[]): Diagram {
  const keepSize = (t: ShapeKind) => t === "note" || t === "frame";
  return {
    version: 1,
    nodes: nodes.map((n) =>
      clean({
        id: n.id,
        type: n.type as ShapeKind,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        w: n.width != null ? Math.round(n.width) : undefined,
        h: keepSize(n.type as ShapeKind) && n.height != null ? Math.round(n.height) : undefined,
        ...n.data,
        text: n.data.text ?? "",
      }) as StoredNode,
    ),
    edges: edges.map((e) =>
      clean({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        ...(e.data ?? {}),
      }) as StoredEdge,
    ),
  };
}

export function deserialize(d: Diagram): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = (d.nodes ?? []).map((s) => {
    const { id, type, x, y, w, h, ...data } = s;
    const n: FlowNode = {
      id,
      type,
      position: { x: Number(x) || 0, y: Number(y) || 0 },
      data: { ...data, text: data.text ?? "" },
      ...(w ? { width: w } : {}),
      ...(h ? { height: h } : {}),
    };
    return decorateNode(n);
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (d.edges ?? [])
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map(({ id, source, target, sourceHandle, targetHandle, ...data }) =>
      decorateEdge({ id, source, target, sourceHandle, targetHandle, data }),
    );
  return { nodes, edges };
}

export function pickHandles(a: { x: number; y: number }, b: { x: number; y: number }): [string, string] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["r", "l"] : ["l", "r"];
  return dy >= 0 ? ["b", "t"] : ["t", "b"];
}

// Processos criados na versão antiga (etapas + ligações em tabelas separadas).
export function fromLegacy(steps: any[], legacyEdges: any[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = steps.map((s) => {
    const checklist = Array.isArray(s.checklist) ? s.checklist.map((c: any) => `• ${c.text ?? c.title ?? ""}`).filter((t: string) => t.length > 2) : [];
    const notes = [s.description, s.notes, checklist.join("\n")].filter(Boolean).join("\n\n");
    const link = Array.isArray(s.links) && s.links[0]?.url ? String(s.links[0].url) : undefined;
    return {
      id: s.id,
      type: "step",
      position: { x: Number(s.x) || 0, y: Number(s.y) || 0 },
      data: { text: s.title ?? "", notes: notes || undefined, link },
    };
  });
  const pos = new Map(nodes.map((n) => [n.id, n.position]));
  const seen = new Set<string>();
  const edges: FlowEdge[] = [];
  const push = (source: string, target: string) => {
    const key = `${source}>${target}`;
    if (seen.has(key) || !pos.has(source) || !pos.has(target)) return;
    seen.add(key);
    const [sh, th] = pickHandles(pos.get(source)!, pos.get(target)!);
    edges.push(makeEdge(source, target, sh, th));
  };
  for (const s of steps) if (s.parent_id) push(s.parent_id, s.id);
  for (const e of legacyEdges) push(e.source_id, e.target_id);
  return { nodes, edges };
}

export function nodeSize(n: FlowNode): { w: number; h: number } {
  return {
    w: n.measured?.width ?? n.width ?? 160,
    h: n.measured?.height ?? n.height ?? 44,
  };
}

export function childrenMap(edges: FlowEdge[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    const arr = m.get(e.source) ?? [];
    arr.push(e.target);
    m.set(e.source, arr);
  }
  return m;
}

export function descendants(id: string, children: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (c === id || out.has(c)) continue;
    out.add(c);
    stack.push(...(children.get(c) ?? []));
  }
  return out;
}

export const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

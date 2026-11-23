import dagre from "@dagrejs/dagre";
import { nodeSize, type Direction, type FlowEdge, type FlowNode } from "./model";

// Arruma as caixinhas ligadas (etapas, decisões, início/fim). Notas e molduras ficam onde estão.
export function autoLayout(nodes: FlowNode[], edges: FlowEdge[], direction: Direction, skip: Set<string>) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction === "horizontal" ? "LR" : "TB", nodesep: 36, ranksep: 80, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const movable = nodes.filter((n) => n.type !== "note" && n.type !== "frame" && !skip.has(n.id));
  const ids = new Set(movable.map((n) => n.id));
  if (!movable.length) return { nodes, edges };
  for (const n of movable) {
    const { w, h } = nodeSize(n);
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const anchor = movable[0];
  const a = g.node(anchor.id);
  const { w: aw, h: ah } = nodeSize(anchor);
  const dx = anchor.position.x - (a.x - aw / 2);
  const dy = anchor.position.y - (a.y - ah / 2);

  const [sh, th] = direction === "horizontal" ? ["r", "l"] : ["b", "t"];
  return {
    nodes: nodes.map((n) => {
      if (!ids.has(n.id)) return n;
      const p = g.node(n.id);
      const { w, h } = nodeSize(n);
      return { ...n, position: { x: Math.round(p.x - w / 2 + dx), y: Math.round(p.y - h / 2 + dy) } };
    }),
    edges: edges.map((e) => (ids.has(e.source) && ids.has(e.target) ? { ...e, sourceHandle: sh, targetHandle: th } : e)),
  };
}

export type Guides = { x?: number; y?: number };

// Linhas-guia: encosta a caixinha arrastada na borda/centro de outra quando chega perto.
export function snapToGuides(
  moving: FlowNode,
  pos: { x: number; y: number },
  others: FlowNode[],
  threshold: number,
): { pos: { x: number; y: number }; guides: Guides } {
  const { w, h } = nodeSize(moving);
  const xs = [pos.x, pos.x + w / 2, pos.x + w];
  const ys = [pos.y, pos.y + h / 2, pos.y + h];
  let bestX: { d: number; shift: number; line: number } | null = null;
  let bestY: { d: number; shift: number; line: number } | null = null;
  for (const o of others) {
    if (o.id === moving.id || o.hidden || o.type === "frame") continue;
    const s = nodeSize(o);
    const oxs = [o.position.x, o.position.x + s.w / 2, o.position.x + s.w];
    const oys = [o.position.y, o.position.y + s.h / 2, o.position.y + s.h];
    for (const a of xs) for (const b of oxs) {
      const d = Math.abs(a - b);
      if (d < threshold && (!bestX || d < bestX.d)) bestX = { d, shift: b - a, line: b };
    }
    for (const a of ys) for (const b of oys) {
      const d = Math.abs(a - b);
      if (d < threshold && (!bestY || d < bestY.d)) bestY = { d, shift: b - a, line: b };
    }
  }
  return {
    pos: { x: pos.x + (bestX?.shift ?? 0), y: pos.y + (bestY?.shift ?? 0) },
    guides: { x: bestX?.line, y: bestY?.line },
  };
}

export function overlaps(a: { x: number; y: number; w: number; h: number }, nodes: FlowNode[], gap = 16) {
  return nodes.some((n) => {
    if (n.hidden || n.type === "frame") return false;
    const s = nodeSize(n);
    return a.x < n.position.x + s.w + gap && a.x + a.w + gap > n.position.x && a.y < n.position.y + s.h + gap && a.y + a.h + gap > n.position.y;
  });
}

export function freeSpot(start: { x: number; y: number }, size: { w: number; h: number }, nodes: FlowNode[], direction: Direction) {
  const p = { ...start };
  for (let i = 0; i < 60 && overlaps({ ...p, ...size }, nodes); i++) {
    if (direction === "horizontal") p.y += size.h / 2 + 12;
    else p.x += size.w / 2 + 12;
  }
  return p;
}

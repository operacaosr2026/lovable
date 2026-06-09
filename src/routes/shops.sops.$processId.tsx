import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ReactFlow, ReactFlowProvider, Controls, MiniMap,
  Handle, Position, applyNodeChanges, applyEdgeChanges, addEdge as rfAddEdge,
  BaseEdge, getBezierPath,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
  type EdgeProps,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft, Plus, Check, Trash2, Network, ListChecks, X, Link as LinkIcon,
  MessageSquare, User, ExternalLink, GripVertical, GitBranch, ChevronRight, ChevronDown,
  Sparkles, MoveHorizontal, MoveVertical, Target,
} from "lucide-react";

type LayoutType = "horizontal" | "vertical" | "radial";
const LAYOUT_OPTIONS: { id: LayoutType; label: string; Icon: any }[] = [
  { id: "horizontal", label: "Horizontal", Icon: MoveHorizontal },
  { id: "vertical", label: "Vertical", Icon: MoveVertical },
  { id: "radial", label: "Radial", Icon: Target },
];
function readLayoutType(v: any): LayoutType {
  return ["horizontal", "vertical", "radial"].includes(v) ? v : "horizontal";
}

function LayoutSelector({ value, onChange }: { value: LayoutType; onChange: (v: LayoutType) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
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
import {
  getSopProcess, createSopStep, updateSopStep, deleteSopStep,
  createSopEdge, deleteSopEdge, updateSopProcess,
  listSopComments, addSopComment, deleteSopComment,
} from "@/lib/sops.functions";

export const Route = createFileRoute("/shops/sops/$processId")({
  component: () => (
    <ReactFlowProvider>
      <SopDetail />
    </ReactFlowProvider>
  ),
});

type Mode = "canvas" | "list";

function SopDetail() {
  const { processId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getFn = useServerFn(getSopProcess);
  const updProcFn = useServerFn(updateSopProcess);
  const createStepFn = useServerFn(createSopStep);
  const updStepFn = useServerFn(updateSopStep);
  const delStepFn = useServerFn(deleteSopStep);
  const createEdgeFn = useServerFn(createSopEdge);
  const delEdgeFn = useServerFn(deleteSopEdge);

  const { data, isLoading } = useQuery({
    queryKey: ["sop-process", processId],
    queryFn: () => getFn({ data: { id: processId } }),
  });
  const proc = (data as any)?.process;
  const stepsData: any[] = (data as any)?.steps ?? [];
  const edgesData: any[] = (data as any)?.edges ?? [];

  const [mode, setMode] = useState<Mode>("canvas");
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState("");

  useEffect(() => { if (proc?.name) setRenaming(proc.name); }, [proc?.name]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["sop-process", processId] });

  const total = stepsData.length;
  const done = stepsData.filter((s) => s.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>;
  }
  if (!proc) {
      return (
      <div className="p-8">
        <Link to="/shops/sops" className="text-sm text-primary">← Voltar</Link>
        <div className="mt-3 text-sm text-muted-foreground">Processo não encontrado.</div>
      </div>
    );
  }

  const selectedStep = stepsData.find((s) => s.id === selected) ?? null;
  const layoutType = readLayoutType(proc.layout_type);
  const setLayoutType = (v: LayoutType) => {
    qc.setQueryData(["sop-process", processId], (old: any) =>
      old ? { ...old, process: { ...old.process, layout_type: v } } : old,
    );
    updProcFn({ data: { id: processId, patch: { layout_type: v } } }).then(refresh);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border bg-surface/40 backdrop-blur px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate({ to: "/shops/sops" })}
          className="size-9 grid place-items-center rounded-lg border border-border bg-surface hover:bg-surface-hover"
          title="Voltar"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div
          className="size-9 rounded-lg grid place-items-center shrink-0"
          style={{ background: `color-mix(in oklab, ${proc.color} 18%, transparent)`, color: proc.color }}
        >
          <Network className="size-4" />
        </div>
        <input
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => {
            if (renaming.trim() && renaming !== proc.name) {
              updProcFn({ data: { id: processId, patch: { name: renaming.trim() } } }).then(refresh);
            }
          }}
          className="px-3 h-9 rounded-lg bg-surface border border-border text-sm font-semibold outline-none focus:border-primary min-w-[200px] flex-1 max-w-md"
        />

        {/* Progress */}
        <div className="hidden md:flex items-center gap-3 px-3 h-9 rounded-lg bg-surface border border-border min-w-[200px]">
          <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{done}/{total}</div>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[80px]">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: proc.color }} />
          </div>
          <div className="text-xs font-semibold tabular-nums">{pct}%</div>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-surface border border-border">
          <button
            onClick={() => setMode("canvas")}
            className={`h-7 px-3 rounded-md text-xs flex items-center gap-1.5 ${mode === "canvas" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Network className="size-3.5" /> Canvas
          </button>
          <button
            onClick={() => setMode("list")}
            className={`h-7 px-3 rounded-md text-xs flex items-center gap-1.5 ${mode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <ListChecks className="size-3.5" /> Execução
          </button>
        </div>

        {mode === "canvas" && <LayoutSelector value={layoutType} onChange={setLayoutType} />}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0">
          {mode === "canvas" ? (
            <CanvasView
              processId={processId}
              color={proc.color}
              steps={stepsData}
              edges={edgesData}
              layoutType={layoutType}
              selected={selected}
              onSelect={setSelected}
              createStepFn={createStepFn}
              updStepFn={updStepFn}
              delStepFn={delStepFn}
              createEdgeFn={createEdgeFn}
              delEdgeFn={delEdgeFn}
              refresh={refresh}
            />
          ) : (
            <ListView
              steps={stepsData}
              color={proc.color}
              onSelect={setSelected}
              updStepFn={updStepFn}
              refresh={refresh}
            />
          )}
        </div>

        {selectedStep && (
          <StepPanel
            key={selectedStep.id}
            step={selectedStep}
            onClose={() => setSelected(null)}
            updStepFn={updStepFn}
            delStepFn={delStepFn}
            refresh={refresh}
          />
        )}
      </div>
    </div>
  );
}

// ---------------- Canvas ----------------

function StepNode({ data, selected }: any) {
  const pct = data.checklistTotal > 0 ? Math.round((data.checklistDone / data.checklistTotal) * 100) : null;
  const accent = data.accent ?? "oklch(0.6 0.22 285)";
  const done = data.status === "done";
  return (
    <div
      className={`group relative rounded-2xl bg-white min-w-[210px] max-w-[270px] transition-all duration-200 ease-out
        ${selected ? "ring-2 ring-offset-2 ring-offset-background" : "ring-0"}
        ${done ? "opacity-75" : ""}`}
      style={{
        boxShadow: selected
          ? `0 20px 50px -18px ${accent}, 0 4px 12px rgba(15,23,42,.08)`
          : "0 1px 2px rgba(15,23,42,.04), 0 10px 28px -16px rgba(15,23,42,.12)",
        borderColor: accent,
        // @ts-ignore
        "--tw-ring-color": accent,
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-1 rounded-full"
        style={{ background: `linear-gradient(180deg, ${accent}, color-mix(in oklab, ${accent} 55%, transparent))` }}
      />
      <Handle type="target" position={data.layoutType === "vertical" ? Position.Top : Position.Left} />
      <div className="pl-4 pr-3 py-3 flex items-start gap-2.5">
        <button
          onClick={(e) => { e.stopPropagation(); data.onToggleStatus?.(); }}
          className="mt-0.5 size-[18px] rounded-full grid place-items-center shrink-0 border-2 transition-all"
          style={{
            borderColor: done ? accent : "color-mix(in oklab, var(--muted-foreground) 35%, transparent)",
            background: done ? accent : "transparent",
            color: done ? "white" : undefined,
          }}
        >
          {done && <Check className="size-3" strokeWidth={3.5} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className={`text-[13.5px] font-semibold leading-snug tracking-[-0.01em] text-zinc-900 ${done ? "line-through text-zinc-400" : ""}`}>
            {data.title || "Sem título"}
          </div>
          {data.description && (
            <div className="text-[11.5px] text-zinc-500 mt-1 line-clamp-2 leading-relaxed">{data.description}</div>
          )}
          {(pct !== null || data.linksCount > 0 || data.assignee) && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2 text-[10.5px] text-zinc-500">
              {pct !== null && (
                <span className="inline-flex items-center gap-1 font-medium">
                  <ListChecks className="size-3" /> {data.checklistDone}/{data.checklistTotal}
                </span>
              )}
              {data.linksCount > 0 && (
                <span className="inline-flex items-center gap-1"><LinkIcon className="size-3" /> {data.linksCount}</span>
              )}
              {data.assignee && (
                <span className="inline-flex items-center gap-1 truncate"><User className="size-3" /> {data.assignee}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={data.layoutType === "vertical" ? Position.Bottom : Position.Right} />
      {/* Add child */}
      <button
        tabIndex={selected ? 0 : -1}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); data.onAddChild?.(); }}
        title="Adicionar subetapa"
        className={`nodrag nopan absolute -right-10 top-1/2 -translate-y-1/2 size-7 rounded-full text-white grid place-items-center shadow-lg transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${selected ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        style={{ background: accent, boxShadow: `0 6px 18px -4px ${accent}` }}
      >
        <Plus className="size-3.5" strokeWidth={3} />
      </button>
    </div>
  );
}

// Smooth bezier edge with gradient stroke
function MindEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps) {
  const [path] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.45,
  });
  const accent = (data as any)?.accent ?? "oklch(0.6 0.22 285)";
  const gradId = `sop-grad-${id}`;
  return (
    <>
      <defs>
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <BaseEdge id={id} path={path} style={{ ...style, stroke: `url(#${gradId})`, fill: "none" }} />
    </>
  );
}

const nodeTypes = { sopStep: StepNode };
const edgeTypes = { mind: MindEdge };

// Multi-mode auto-layout (horizontal / vertical / radial), ported from whiteboard
function computeLayout(type: LayoutType, items: any[]): Record<string, { x: number; y: number }> {
  const NODE_W = 250, NODE_H = 110;
  const byParent: Record<string, any[]> = {};
  for (const s of items) {
    const k = s.parent_id ?? "__root";
    (byParent[k] ||= []).push(s);
  }
  for (const k of Object.keys(byParent)) {
    byParent[k].sort((a, b) => {
      const ap = a.position ?? 0, bp = b.position ?? 0;
      if (ap !== bp) return ap - bp;
      const ax = a.created_at ?? a.id, bx = b.created_at ?? b.id;
      return ax < bx ? -1 : ax > bx ? 1 : 0;
    });
  }
  const pos: Record<string, { x: number; y: number }> = {};
  const roots = byParent["__root"] ?? [];

  if (type === "horizontal") {
    const X_GAP = 110, Y_GAP = 28;
    const subH: Record<string, number> = {};
    const measureH = (id: string): number => {
      if (subH[id] != null) return subH[id];
      const kids = byParent[id] ?? [];
      if (!kids.length) return (subH[id] = NODE_H);
      const total = kids.reduce((a, k) => a + measureH(k.id), 0) + (kids.length - 1) * Y_GAP;
      return (subH[id] = Math.max(NODE_H, total));
    };
    const place = (id: string, depth: number, topY: number) => {
      const sh = measureH(id);
      pos[id] = { x: depth * (NODE_W + X_GAP), y: topY + sh / 2 - NODE_H / 2 };
      const kids = byParent[id] ?? [];
      const kidsTotal = kids.reduce((a, k) => a + measureH(k.id), 0) + Math.max(0, kids.length - 1) * Y_GAP;
      let c = topY + sh / 2 - kidsTotal / 2;
      for (const k of kids) { const kh = measureH(k.id); place(k.id, depth + 1, c); c += kh + Y_GAP; }
    };
    let cursor = 0;
    for (const r of roots) { place(r.id, 0, cursor); cursor += measureH(r.id) + Y_GAP; }
  } else if (type === "vertical") {
    const X_GAP = 32, Y_GAP = 90;
    const subW: Record<string, number> = {};
    const measureW = (id: string): number => {
      if (subW[id] != null) return subW[id];
      const kids = byParent[id] ?? [];
      if (!kids.length) return (subW[id] = NODE_W);
      const total = kids.reduce((a, k) => a + measureW(k.id), 0) + (kids.length - 1) * X_GAP;
      return (subW[id] = Math.max(NODE_W, total));
    };
    const place = (id: string, y: number, leftX: number) => {
      const sw = measureW(id);
      pos[id] = { x: leftX + sw / 2 - NODE_W / 2, y };
      const kids = byParent[id] ?? [];
      const kidsTotal = kids.reduce((a, k) => a + measureW(k.id), 0) + Math.max(0, kids.length - 1) * X_GAP;
      let c = leftX + sw / 2 - kidsTotal / 2;
      const nextY = y + NODE_H + Y_GAP;
      for (const k of kids) { const kw = measureW(k.id); place(k.id, nextY, c); c += kw + X_GAP; }
    };
    let cursor = 0;
    for (const r of roots) { place(r.id, 0, cursor); cursor += measureW(r.id) + X_GAP; }
  } else {
    const slotsOf: Record<string, number> = {};
    const computeSlots = (id: string): number => {
      const kids = byParent[id] ?? [];
      if (!kids.length) return (slotsOf[id] = 1);
      return (slotsOf[id] = kids.reduce((a, k) => a + computeSlots(k.id), 0));
    };
    for (const r of roots) computeSlots(r.id);
    const RING = 300;
    const placeRadial = (id: string, depth: number, aStart: number, aEnd: number) => {
      const mid = (aStart + aEnd) / 2;
      if (depth === 0) {
        pos[id] = { x: -NODE_W / 2, y: -NODE_H / 2 };
      } else {
        pos[id] = { x: Math.cos(mid) * depth * RING - NODE_W / 2, y: Math.sin(mid) * depth * RING - NODE_H / 2 };
      }
      const kids = byParent[id] ?? [];
      const total = slotsOf[id] ?? 1;
      let c = aStart;
      for (const k of kids) {
        const ks = slotsOf[k.id] ?? 1;
        const span = (aEnd - aStart) * (ks / total);
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

function CanvasView({
  processId, color, steps, edges, layoutType, selected, onSelect,
  createStepFn, updStepFn, delStepFn, createEdgeFn, delEdgeFn, refresh,
}: any) {
  const rf = useReactFlow();
  const qc = useQueryClient();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const addingChildForRef = useRef<string | null>(null);

  // Optimistic cache helpers — update UI instantly, server reconciles on refresh
  const mutateCache = useCallback((fn: (d: any) => any) => {
    qc.setQueryData(["sop-process", processId], (old: any) => {
      if (!old) return old;
      return fn({ ...old, steps: [...(old.steps ?? [])], edges: [...(old.edges ?? [])] });
    });
  }, [qc, processId]);

  const optimisticAddStep = useCallback((step: any) => {
    mutateCache((d) => { d.steps.push(step); return d; });
  }, [mutateCache]);

  const optimisticRemoveStep = useCallback((id: string) => {
    mutateCache((d) => {
      d.steps = d.steps.filter((s: any) => s.id !== id && s.parent_id !== id);
      d.edges = d.edges.filter((e: any) => e.source_id !== id && e.target_id !== id);
      return d;
    });
  }, [mutateCache]);

  const optimisticUpdateStep = useCallback((id: string, patch: any) => {
    mutateCache((d) => {
      d.steps = d.steps.map((s: any) => s.id === id ? { ...s, ...patch } : s);
      return d;
    });
  }, [mutateCache]);

  const optimisticAddEdge = useCallback((edge: any) => {
    mutateCache((d) => { d.edges.push(edge); return d; });
  }, [mutateCache]);

  const childrenCountByParent = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of steps) if (s.parent_id) m[s.parent_id] = (m[s.parent_id] ?? 0) + 1;
    return m;
  }, [steps]);

  const removeStep = useCallback(async (id: string) => {
    if (id.startsWith("temp-")) return;
    optimisticRemoveStep(id);
    if (selected === id) onSelect(null);
    try {
      await delStepFn({ data: { id } });
    } finally {
      refresh();
    }
  }, [optimisticRemoveStep, delStepFn, refresh, selected, onSelect]);

  const addChild = useCallback(async (parent: any) => {
    if (addingChildForRef.current) return;
    addingChildForRef.current = parent.id;
    const siblings = steps.filter((s: any) => s.parent_id === parent.id);
    const x = Number(parent.x) + 360;
    const y = Number(parent.y) + siblings.length * 140;
    const tempId = `temp-${crypto.randomUUID()}`;
    optimisticAddStep({
      id: tempId, process_id: processId, parent_id: parent.id,
      title: "Nova subetapa", description: null, status: "todo",
      x, y, position: siblings.length, checklist: [], links: [],
      assignee: null, notes: null, created_at: new Date().toISOString(),
    });
    try {
      const res: any = await createStepFn({
        data: { process_id: processId, x, y, parent_id: parent.id, title: "Nova subetapa" },
      });
      try {
        await createEdgeFn({ data: { process_id: processId, source_id: parent.id, target_id: res.step.id } });
      } catch {}
      refresh();
    } finally {
      addingChildForRef.current = null;
    }
  }, [steps, createStepFn, createEdgeFn, processId, refresh, optimisticAddStep]);

  const layoutPositions = useMemo(() => computeLayout(layoutType, steps), [layoutType, steps]);

  const buildNode = useCallback((s: any): Node => {
    const checklist = Array.isArray(s.checklist) ? s.checklist : [];
    const links = Array.isArray(s.links) ? s.links : [];
    const auto = layoutPositions[s.id];
    const position = (!s.manual && auto) ? auto : { x: Number(s.x), y: Number(s.y) };
    return {
      id: s.id,
      type: "sopStep",
      position,
      data: {
        title: s.title,
        description: s.description,
        status: s.status,
        assignee: s.assignee,
        accent: color,
        layoutType,
        checklistDone: checklist.filter((c: any) => c.done).length,
        checklistTotal: checklist.length,
        linksCount: links.length,
        childrenCount: childrenCountByParent[s.id] ?? 0,
        onToggleStatus: async () => {
          const next = s.status === "done" ? "todo" : "done";
          optimisticUpdateStep(s.id, { status: next });
          await updStepFn({ data: { id: s.id, patch: { status: next } } });
          refresh();
        },
        onAddChild: () => addChild(s),
      },
      selected: s.id === selected,
    };
  }, [selected, updStepFn, refresh, childrenCountByParent, addChild, color, optimisticUpdateStep, layoutPositions, layoutType]);

  useEffect(() => {
    setNodes(steps.map(buildNode));
    setFlowEdges(
      edges.map((e: any): Edge => ({
        id: e.id,
        source: e.source_id,
        target: e.target_id,
        type: "mind",
        data: { accent: color },
      }))
    );
  }, [steps, edges, buildNode, color]);

  // Persist computed auto-layout to DB (debounced) whenever the set of steps or layout type changes.
  const persistedSigRef = useRef<string>("");
  useEffect(() => {
    if (!steps.length) return;
    const sig = layoutType + ":" + steps.map((s: any) => s.id).sort().join(",");
    if (sig === persistedSigRef.current) return;
    persistedSigRef.current = sig;
    const t = setTimeout(() => {
      for (const s of steps) {
        if (String(s.id).startsWith("temp-")) continue;
        if (s.manual) continue;
        const p = layoutPositions[s.id];
        if (!p) continue;
        if (Math.abs(Number(s.x) - p.x) < 0.5 && Math.abs(Number(s.y) - p.y) < 0.5) continue;
        updStepFn({ data: { id: s.id, patch: { x: p.x, y: p.y } } }).catch(() => {});
      }
    }, 250);
    return () => clearTimeout(t);
  }, [steps, layoutPositions, layoutType, updStepFn]);

  const onNodeDragStop = useCallback((_e: any, node: Node) => {
    if (String(node.id).startsWith("temp-")) return;
    optimisticUpdateStep(node.id, { x: node.position.x, y: node.position.y, manual: true });
    updStepFn({ data: { id: node.id, patch: { x: node.position.x, y: node.position.y, manual: true } } }).catch(() => {});
  }, [optimisticUpdateStep, updStepFn]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    for (const ch of changes) {
      if (ch.type === "remove") removeStep(ch.id);
    }
  }, [removeStep]);


  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdges((eds) => applyEdgeChanges(changes, eds));
    for (const ch of changes) {
      if (ch.type === "remove" && !ch.id.startsWith("temp-edge-")) {
        delEdgeFn({ data: { id: ch.id } }).catch(() => {});
      }
    }
  }, [delEdgeFn]);

  const onConnect = useCallback(async (conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    const tempId = `temp-edge-${crypto.randomUUID()}`;
    optimisticAddEdge({ id: tempId, process_id: processId, source_id: conn.source, target_id: conn.target });
    try {
      await createEdgeFn({ data: { process_id: processId, source_id: conn.source, target_id: conn.target } });
      refresh();
    } catch (e) { console.error(e); refresh(); }
  }, [createEdgeFn, processId, refresh, optimisticAddEdge]);

  const addStep = useCallback(async () => {
    const { x, y, zoom } = rf.getViewport();
    const center = {
      x: (-x + window.innerWidth / 2) / zoom - 100,
      y: (-y + window.innerHeight / 2) / zoom - 40,
    };
    const tempId = `temp-${crypto.randomUUID()}`;
    optimisticAddStep({
      id: tempId, process_id: processId, parent_id: null,
      title: "Nova etapa", description: null, status: "todo",
      x: center.x, y: center.y, position: steps.length,
      checklist: [], links: [], assignee: null, notes: null,
      created_at: new Date().toISOString(),
    });
    try {
      await createStepFn({ data: { process_id: processId, x: center.x, y: center.y } });
    } finally {
      refresh();
    }
  }, [rf, createStepFn, processId, refresh, optimisticAddStep, steps.length]);

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    await removeStep(selected);
  }, [selected, removeStep]);

  const resetLayout = useCallback(async () => {
    // Clear manual flag so all steps snap back to the active auto layout
    const pos = computeLayout(layoutType, steps);
    setNodes((nds) => nds.map((n) => pos[n.id] ? { ...n, position: pos[n.id] } : n));
    await Promise.all(
      steps.filter((s: any) => !String(s.id).startsWith("temp-")).map((s: any) =>
        updStepFn({ data: { id: s.id, patch: { manual: false, ...(pos[s.id] ?? {}) } } }).catch(() => {})
      )
    );
    setTimeout(() => rf.fitView({ duration: 600, padding: 0.18 }), 60);
    refresh();
  }, [steps, layoutType, updStepFn, rf, refresh]);

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        <button
          onClick={addStep}
          className="h-9 px-3.5 rounded-xl text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shadow-lg hover:shadow-xl"
          style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 75%, black))`, boxShadow: `0 8px 22px -8px ${color}` }}
        >
          <Plus className="size-3.5" strokeWidth={2.8} /> Nova etapa
        </button>
        <button
          onClick={resetLayout}
          className="h-9 px-3.5 rounded-xl bg-white/90 backdrop-blur border border-border text-xs font-medium flex items-center gap-1.5 shadow-sm hover:bg-white"
          title="Reaplicar alinhamento automático em todos os cards"
        >
          <Sparkles className="size-3.5" /> Reorganizar tudo
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
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: "mind", data: { accent: color } }}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
        className="sop-flow"
      >
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable maskColor="oklch(0.985 0.003 250 / 0.6)" nodeColor={() => color} nodeStrokeWidth={3} />
      </ReactFlow>
    </div>
  );
}

// ---------------- List/Execution View ----------------

function ListView({ steps, color, onSelect, updStepFn, refresh }: any) {
  // Build tree by parent_id
  const { roots, childrenOf } = useMemo(() => {
    const sorted = [...steps].sort((a: any, b: any) => a.position - b.position || a.created_at.localeCompare(b.created_at));
    const childrenOf: Record<string, any[]> = {};
    const roots: any[] = [];
    for (const s of sorted) {
      if (s.parent_id) (childrenOf[s.parent_id] ||= []).push(s);
      else roots.push(s);
    }
    return { roots, childrenOf };
  }, [steps]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = async (s: any) => {
    await updStepFn({ data: { id: s.id, patch: { status: s.status === "done" ? "todo" : "done" } } });
    refresh();
  };

  if (steps.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        Nenhuma etapa ainda. Vá para o Canvas para criar a primeira.
      </div>
    );
  }

  const renderRow = (s: any, depth: number, index: number) => {
    const checklist = Array.isArray(s.checklist) ? s.checklist : [];
    const links = Array.isArray(s.links) ? s.links : [];
    const cDone = checklist.filter((c: any) => c.done).length;
    const kids = childrenOf[s.id] ?? [];
    const isCollapsed = !!collapsed[s.id];
    return (
      <div key={s.id} style={{ marginLeft: depth * 24 }}>
        <div
          className={`rounded-xl border bg-surface p-4 flex items-start gap-3 transition-colors hover:border-primary/40 ${s.status === "done" ? "opacity-60" : "border-border"}`}
        >
          {kids.length > 0 ? (
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !isCollapsed }))}
              className="mt-0.5 size-5 grid place-items-center text-muted-foreground hover:text-foreground shrink-0"
              title={isCollapsed ? "Expandir" : "Recolher"}
            >
              {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          ) : (
            <div className="size-5 shrink-0" />
          )}
          <button
            onClick={() => toggle(s)}
            className={`mt-0.5 size-5 rounded-md grid place-items-center shrink-0 border-2 transition-colors ${
              s.status === "done" ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40 hover:border-primary"
            }`}
          >
            {s.status === "done" && <Check className="size-3.5" strokeWidth={3} />}
          </button>
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect(s.id)}>
            <div className="flex items-center gap-2">
              {depth === 0 && (
                <span className="text-[10px] tabular-nums font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              )}
              <div className={`text-sm font-medium ${s.status === "done" ? "line-through text-muted-foreground" : ""}`}>{s.title || "Sem título"}</div>
              {kids.length > 0 && (
                <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                  <GitBranch className="size-3" /> {kids.length}
                </span>
              )}
            </div>
            {s.description && <div className="text-xs text-muted-foreground mt-1">{s.description}</div>}
            <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted-foreground">
              {checklist.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <ListChecks className="size-3" /> {cDone}/{checklist.length}
                </span>
              )}
              {links.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <LinkIcon className="size-3" /> {links.length} link{links.length > 1 ? "s" : ""}
                </span>
              )}
              {s.assignee && (
                <span className="inline-flex items-center gap-1">
                  <User className="size-3" /> {s.assignee}
                </span>
              )}
            </div>
          </div>
          <GripVertical className="size-4 text-muted-foreground/30 mt-1" />
        </div>
        {!isCollapsed && kids.length > 0 && (
          <div className="mt-2 space-y-2 border-l-2 ml-2.5 pl-3" style={{ borderColor: `color-mix(in oklab, ${color} 40%, transparent)` }}>
            {kids.map((k: any, ki: number) => renderRow(k, depth + 1, ki))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-2">
      {roots.map((s, i) => renderRow(s, 0, i))}
    </div>
  );
}

// ---------------- Step Side Panel ----------------

function StepPanel({ step, onClose, updStepFn, delStepFn, refresh }: any) {
  const [title, setTitle] = useState(step.title || "");
  const [description, setDescription] = useState(step.description || "");
  const [notes, setNotes] = useState(step.notes || "");
  const [assignee, setAssignee] = useState(step.assignee || "");
  const [checklist, setChecklist] = useState<any[]>(Array.isArray(step.checklist) ? step.checklist : []);
  const [links, setLinks] = useState<any[]>(Array.isArray(step.links) ? step.links : []);
  const saveTimer = useRef<any>(null);

  // Debounced save
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updStepFn({
        data: {
          id: step.id,
          patch: { title, description: description || null, notes: notes || null, assignee: assignee || null, checklist, links },
        },
      }).then(refresh);
    }, 500);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, notes, assignee, checklist, links]);

  // Comments
  const listCommentsFn = useServerFn(listSopComments);
  const addCommentFn = useServerFn(addSopComment);
  const delCommentFn = useServerFn(deleteSopComment);
  const qc = useQueryClient();
  const { data: commentsData } = useQuery({
    queryKey: ["sop-comments", step.id],
    queryFn: () => listCommentsFn({ data: { step_id: step.id } }),
  });
  const comments = ((commentsData as any)?.comments ?? []) as any[];
  const [newComment, setNewComment] = useState("");
  const addComment = async () => {
    if (!newComment.trim()) return;
    await addCommentFn({ data: { step_id: step.id, content: newComment.trim() } });
    setNewComment("");
    qc.invalidateQueries({ queryKey: ["sop-comments", step.id] });
  };

  return (
    <aside className="w-[380px] shrink-0 border-l border-border bg-surface/30 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Etapa</div>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              onClose();
              await delStepFn({ data: { id: step.id } });
              refresh();
            }}
            className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Excluir"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button onClick={onClose} className="size-7 grid place-items-center rounded-md hover:bg-muted text-muted-foreground" title="Fechar">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título da etapa"
          className="w-full px-3 h-10 rounded-lg bg-background border border-border text-sm font-semibold outline-none focus:border-primary/50"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição / instruções..."
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50 resize-none"
        />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Responsável</div>
          <input
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="Nome do responsável"
            className="w-full px-3 h-9 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
          />
        </div>

        {/* Checklist */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Checklist</div>
            <button
              onClick={() => setChecklist([...checklist, { text: "", done: false }])}
              className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline"
            >
              <Plus className="size-3" /> item
            </button>
          </div>
          <div className="space-y-1">
            {checklist.length === 0 && <div className="text-xs text-muted-foreground italic">Sem itens.</div>}
            {checklist.map((c, i) => (
              <div key={i} className="flex items-start gap-2 group">
                <input
                  type="checkbox"
                  checked={!!c.done}
                  onChange={(e) => {
                    const copy = [...checklist]; copy[i] = { ...c, done: e.target.checked }; setChecklist(copy);
                  }}
                  className="mt-1.5 size-4 accent-primary shrink-0"
                />
                <textarea
                  value={c.text}
                  onChange={(e) => {
                    const copy = [...checklist]; copy[i] = { ...c, text: e.target.value }; setChecklist(copy);
                    // auto-grow
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = el.scrollHeight + "px";
                  }}
                  ref={(el) => {
                    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
                  }}
                  rows={1}
                  placeholder="Item..."
                  className={`flex-1 bg-transparent border-none outline-none text-sm resize-none leading-snug py-1 break-words whitespace-pre-wrap ${c.done ? "line-through text-muted-foreground" : ""}`}
                />
                <button
                  onClick={() => setChecklist(checklist.filter((_, idx) => idx !== i))}
                  className="mt-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Links */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Links / Recursos</div>
            <button
              onClick={() => setLinks([...links, { title: "", url: "" }])}
              className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline"
            >
              <Plus className="size-3" /> link
            </button>
          </div>
          <div className="space-y-1.5">
            {links.length === 0 && <div className="text-xs text-muted-foreground italic">Sem links.</div>}
            {links.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5 group">
                <input
                  value={l.title}
                  onChange={(e) => { const c = [...links]; c[i] = { ...l, title: e.target.value }; setLinks(c); }}
                  placeholder="Título"
                  className="w-1/3 px-2 h-8 rounded-md bg-background border border-border text-xs outline-none focus:border-primary/50"
                />
                <input
                  value={l.url}
                  onChange={(e) => { const c = [...links]; c[i] = { ...l, url: e.target.value }; setLinks(c); }}
                  placeholder="https://..."
                  className="flex-1 px-2 h-8 rounded-md bg-background border border-border text-xs outline-none focus:border-primary/50"
                />
                {l.url && (
                  <a href={l.url} target="_blank" rel="noreferrer" className="size-7 grid place-items-center text-muted-foreground hover:text-foreground">
                    <ExternalLink className="size-3" />
                  </a>
                )}
                <button
                  onClick={() => setLinks(links.filter((_, idx) => idx !== i))}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Observações</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações internas..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50 resize-none"
          />
        </div>

        {/* Comments */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 flex items-center gap-1.5">
            <MessageSquare className="size-3" /> Comentários ({comments.length})
          </div>
          <div className="space-y-2 mb-2">
            {comments.map((c) => (
              <div key={c.id} className="group rounded-lg bg-background border border-border p-2.5 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleString("pt-BR")}</span>
                  <button
                    onClick={async () => {
                      await delCommentFn({ data: { id: c.id } });
                      qc.invalidateQueries({ queryKey: ["sop-comments", step.id] });
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <div className="whitespace-pre-wrap">{c.content}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addComment(); }}
              placeholder="Adicionar comentário..."
              className="flex-1 px-3 h-9 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
            />
            <button
              onClick={addComment}
              disabled={!newComment.trim()}
              className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

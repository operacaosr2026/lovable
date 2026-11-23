import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import {
  BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps,
} from "@xyflow/react";
import { DEFAULT_EDGE_COLOR, type FlowEdge } from "./model";

export type EdgeUI = {
  editingEdgeId: string | null;
  commitEdgeLabel: (id: string, label: string | null) => void;
  startEdgeEdit: (id: string) => void;
};
export const EdgeUIContext = createContext<EdgeUI | null>(null);

export const FlowEdgeView = memo(function FlowEdgeView(props: EdgeProps<FlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props;
  const ui = useContext(EdgeUIContext)!;
  const kind = data?.kind ?? "curve";
  const args = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [path, labelX, labelY] =
    kind === "straight" ? getStraightPath(args)
    : kind === "step" ? getSmoothStepPath({ ...args, borderRadius: 10 })
    : getBezierPath(args);
  const color = data?.color ?? DEFAULT_EDGE_COLOR;
  const editing = ui.editingEdgeId === id;
  const label = data?.label ?? "";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={22}
        style={{
          stroke: color,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: data?.dashed ? "6 5" : undefined,
          filter: selected ? `drop-shadow(0 0 3px ${color})` : undefined,
        }}
      />
      {(label || editing) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute pointer-events-auto"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onDoubleClick={(e) => { e.stopPropagation(); ui.startEdgeEdit(id); }}
          >
            {editing ? (
              <LabelInput initial={label} onDone={(v) => ui.commitEdgeLabel(id, v)} />
            ) : (
              <div
                className="px-2 py-0.5 rounded-md text-[11px] font-semibold border bg-surface shadow-sm whitespace-nowrap cursor-pointer"
                style={{ borderColor: color, color: "var(--foreground)" }}
              >
                {label}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

function LabelInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); }); }, []);
  const finish = (val: string | null) => { if (done.current) return; done.current = true; onDone(val); };
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(v);
        if (e.key === "Escape") finish(null);
      }}
      placeholder="Sim, Não…"
      className="h-6 w-28 px-2 rounded-md text-[11px] font-semibold border border-primary bg-surface outline-none text-center"
    />
  );
}

export const edgeTypes = { flow: FlowEdgeView };

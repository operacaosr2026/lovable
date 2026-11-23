import { createContext, memo, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, NodeResizeControl, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { ExternalLink, StickyNote } from "lucide-react";
import type { Direction, FlowNode } from "./model";

export type EditMode = "child" | "sibling" | null;

export type FlowUI = {
  accent: string;
  direction: Direction;
  editingId: string | null;
  editSeed: string | null;
  startEdit: (id: string, seed?: string | null) => void;
  commitEdit: (id: string, text: string | null, then?: EditMode) => void;
  toggleCollapse: (id: string) => void;
  childCount: Map<string, number>;
  hiddenCount: Map<string, number>;
  matches: Set<string>;
  activeMatch: string | null;
};

export const FlowUIContext = createContext<FlowUI | null>(null);
const useFlowUI = () => useContext(FlowUIContext)!;

const tint = (c: string, pct: number) => `color-mix(in oklab, ${c} ${pct}%, var(--surface))`;

const handleCls =
  "!size-3 !rounded-full !border-2 !border-background !bg-[var(--flow-accent)] opacity-0 group-hover:opacity-100 transition-opacity";

function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" className={handleCls} />
      <Handle type="source" position={Position.Right} id="r" className={handleCls} />
      <Handle type="source" position={Position.Bottom} id="b" className={handleCls} />
      <Handle type="source" position={Position.Left} id="l" className={handleCls} />
    </>
  );
}

function EditableText({ id, text, className, placeholder }: { id: string; text: string; className?: string; placeholder: string }) {
  const ui = useFlowUI();
  const editing = ui.editingId === id;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(text);
  const done = useRef(false);

  useEffect(() => {
    if (!editing) return;
    done.current = false;
    const seed = ui.editSeed;
    setValue(seed ?? text);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (seed == null) el.select();
      else el.setSelectionRange(el.value.length, el.value.length);
      autosize(el);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const finish = (v: string | null, then: EditMode = null) => {
    if (done.current) return;
    done.current = true;
    ui.commitEdit(id, v, then);
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={value}
        rows={1}
        onChange={(e) => { setValue(e.target.value); autosize(e.target); }}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); finish(null); }
          else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(value); }
          else if (e.key === "Tab") { e.preventDefault(); finish(value, "child"); }
        }}
        className={`nodrag nopan nowheel w-full resize-none bg-transparent outline-none text-center overflow-hidden ${className ?? ""}`}
        placeholder={placeholder}
      />
    );
  }
  return (
    <div className={`whitespace-pre-wrap break-words ${className ?? ""} ${text ? "" : "text-muted-foreground/60 italic"}`}>
      {text || placeholder}
    </div>
  );
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

function Extras({ data }: { data: FlowNode["data"] }) {
  if (!data.notes && !data.link) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 mt-1 text-muted-foreground">
      {data.notes && (
        <span title={data.notes}>
          <StickyNote className="size-3" />
        </span>
      )}
      {data.link && (
        <a
          href={data.link}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="nodrag hover:text-foreground"
          title={data.link}
        >
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

function CollapseButton({ id }: { id: string }) {
  const ui = useFlowUI();
  const count = ui.childCount.get(id) ?? 0;
  if (!count) return null;
  const hidden = ui.hiddenCount.get(id) ?? 0;
  const collapsed = hidden > 0;
  const side: CSSProperties =
    ui.direction === "horizontal"
      ? { right: -10, top: "50%", transform: "translate(100%, -50%)" }
      : { bottom: -10, left: "50%", transform: "translate(-50%, 100%)" };
  return (
    <button
      onClick={(e) => { e.stopPropagation(); ui.toggleCollapse(id); }}
      onDoubleClick={(e) => e.stopPropagation()}
      style={side}
      title={collapsed ? "Mostrar galho" : "Esconder galho"}
      className={`nodrag absolute z-10 h-5 min-w-5 px-1 rounded-full border text-[10px] font-semibold leading-none grid place-items-center bg-surface shadow-sm transition-opacity ${
        collapsed ? "opacity-100 border-[var(--flow-accent)] text-[var(--flow-accent)]" : "opacity-0 group-hover:opacity-100 border-border text-muted-foreground"
      }`}
    >
      {collapsed ? `+${hidden}` : "−"}
    </button>
  );
}

function Shell({
  id, data, selected, children, className, style, fixedWidth,
}: {
  id: string;
  data: FlowNode["data"];
  selected: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  fixedWidth: boolean;
}) {
  const ui = useFlowUI();
  const color = data.color ?? ui.accent;
  const match = ui.matches.has(id);
  const active = ui.activeMatch === id;
  return (
    <div
      className={`group relative ${fixedWidth ? "w-full h-full" : ""}`}
      style={{ ["--flow-accent" as string]: color }}
      onDoubleClick={(e) => { e.stopPropagation(); ui.startEdit(id); }}
    >
      <div
        className={`relative ${className ?? ""} ${match ? "ring-2 ring-offset-2 ring-offset-background" : ""} ${active ? "ring-[3px]" : ""}`}
        style={{ ...(match ? { ["--tw-ring-color" as string]: "#f59e0b" } : {}), ...style }}
      >
        {children}
      </div>
      <Handles />
      <CollapseButton id={id} />
      {selected && (
        <>
          <NodeResizeControl position="left" resizeDirection="horizontal" minWidth={90} className="!bg-transparent !border-0 !w-2" />
          <NodeResizeControl position="right" resizeDirection="horizontal" minWidth={90} className="!bg-transparent !border-0 !w-2" />
        </>
      )}
    </div>
  );
}

function Label({ id, data }: { id: string; data: FlowNode["data"] }) {
  return (
    <>
      <div className="flex items-start justify-center gap-1.5">
        {data.emoji && <span className="text-[15px] leading-5 shrink-0">{data.emoji}</span>}
        <EditableText id={id} text={data.text} className="text-[13px] leading-5 font-medium min-w-[40px]" placeholder="Escreva…" />
      </div>
      <Extras data={data} />
    </>
  );
}

export const StepNode = memo(function StepNode({ id, data, selected, width }: NodeProps<FlowNode>) {
  const ui = useFlowUI();
  const color = data.color ?? ui.accent;
  const fixed = width != null;
  return (
    <Shell id={id} data={data} selected={!!selected} fixedWidth={fixed}
      className={`rounded-xl border-2 px-3.5 py-2.5 text-center shadow-sm ${fixed ? "w-full" : "min-w-[120px] max-w-[260px]"}`}
      style={{ borderColor: selected ? color : tint(color, 55), background: tint(color, 10) }}
    >
      <Label id={id} data={data} />
    </Shell>
  );
});

export const TerminalNode = memo(function TerminalNode({ id, data, selected, width }: NodeProps<FlowNode>) {
  const ui = useFlowUI();
  const color = data.color ?? ui.accent;
  const fixed = width != null;
  return (
    <Shell id={id} data={data} selected={!!selected} fixedWidth={fixed}
      className={`rounded-full border-2 px-6 py-2.5 text-center shadow-sm ${fixed ? "w-full" : "min-w-[120px] max-w-[260px]"}`}
      style={{ borderColor: color, background: tint(color, selected ? 30 : 22) }}
    >
      <Label id={id} data={data} />
    </Shell>
  );
});

export const DecisionNode = memo(function DecisionNode({ id, data, selected, width }: NodeProps<FlowNode>) {
  const ui = useFlowUI();
  const color = data.color ?? ui.accent;
  const fixed = width != null;
  return (
    <Shell id={id} data={data} selected={!!selected} fixedWidth={fixed}
      className={`grid place-items-center text-center px-10 py-7 min-h-[96px] ${fixed ? "w-full" : "min-w-[160px] max-w-[280px]"}`}
    >
      <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon
          points="50,1 99,50 50,99 1,50"
          fill={tint(color, 12)}
          stroke={selected ? color : tint(color, 60)}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>
      <div className="relative">
        <Label id={id} data={data} />
      </div>
    </Shell>
  );
});

export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ui = useFlowUI();
  const color = data.color ?? "#eab308";
  return (
    <div className="group relative w-full h-full" style={{ ["--flow-accent" as string]: color }}
      onDoubleClick={(e) => { e.stopPropagation(); ui.startEdit(id); }}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} color={color} />
      <div
        className={`w-full h-full rounded-md px-3 py-2.5 shadow-md overflow-auto nowheel ${ui.matches.has(id) ? "ring-2 ring-amber-500" : ""}`}
        style={{ background: tint(color, 28), borderLeft: `4px solid ${color}` }}
      >
        <div className="flex items-start gap-1.5">
          {data.emoji && <span className="text-[15px] leading-5 shrink-0">{data.emoji}</span>}
          <EditableText id={id} text={data.text} className="text-[13px] leading-5 !text-left flex-1" placeholder="Nota…" />
        </div>
        <Extras data={data} />
      </div>
      <Handles />
    </div>
  );
});

export const FrameNode = memo(function FrameNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ui = useFlowUI();
  const color = data.color ?? ui.accent;
  return (
    <div className="relative w-full h-full" style={{ ["--flow-accent" as string]: color }}>
      <NodeResizer isVisible={!!selected} minWidth={160} minHeight={100} color={color} handleStyle={{ pointerEvents: "auto" }} lineStyle={{ pointerEvents: "auto" }} />
      <div
        className="absolute inset-0 rounded-2xl border-2 border-dashed"
        style={{ borderColor: selected ? color : tint(color, 50), background: tint(color, 5) }}
      />
      <div
        className="flow-frame-handle absolute -top-3 left-4 max-w-[80%] px-2.5 py-0.5 rounded-md text-xs font-semibold cursor-grab active:cursor-grabbing shadow-sm"
        style={{ pointerEvents: "auto", background: color, color: "white" }}
        onDoubleClick={(e) => { e.stopPropagation(); ui.startEdit(id); }}
      >
        <div className="flex items-center gap-1">
          {data.emoji && <span>{data.emoji}</span>}
          <EditableText id={id} text={data.text} className="!text-left text-xs font-semibold min-w-[60px]" placeholder="Moldura" />
        </div>
      </div>
    </div>
  );
});

export const nodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  terminal: TerminalNode,
  note: NoteNode,
  frame: FrameNode,
};

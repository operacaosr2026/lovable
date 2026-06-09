import { memo, useState, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CheckSquare, Square, Link as LinkIcon, ImageIcon, Plus, ListTodo, StickyNote, Type as TypeIcon, FileText } from "lucide-react";

const handleClass = "!size-2 !bg-primary !border-2 !border-background opacity-0 hover:opacity-100 transition-opacity";
const ringClass = "ring-2 ring-primary ring-offset-2 ring-offset-background";

function NodeShell({ children, selected, color, className = "" }: { children: React.ReactNode; selected: boolean; color?: string; className?: string }) {
  return (
    <div
      className={`relative group rounded-xl shadow-md border border-border/60 ${selected ? ringClass : ""} ${className}`}
      style={color ? { background: color } : undefined}
    >
      <Handle type="target" position={Position.Top} className={handleClass} />
      <Handle type="target" position={Position.Left} className={handleClass} />
      <Handle type="source" position={Position.Right} className={handleClass} />
      <Handle type="source" position={Position.Bottom} className={handleClass} />
      {children}
    </div>
  );
}

export const NoteNode = memo(({ data, selected, id }: NodeProps) => {
  const d: any = data;
  const color = d.color ?? "#fde68a";
  return (
    <NodeShell selected={selected} color={color} className="text-zinc-900 min-w-[160px] min-h-[120px] max-w-[280px]">
      <EditableText
        value={d.text ?? ""}
        placeholder="Nota..."
        onChange={(text) => d.onChange?.(id, { ...d, text })}
        className="w-full h-full p-3 text-sm outline-none bg-transparent resize-none"
        rows={5}
      />
    </NodeShell>
  );
});
NoteNode.displayName = "NoteNode";

export const TextNode = memo(({ data, selected, id }: NodeProps) => {
  const d: any = data;
  return (
    <NodeShell selected={selected} className="bg-transparent !border-transparent !shadow-none min-w-[120px]">
      <EditableText
        value={d.text ?? ""}
        placeholder="Texto..."
        onChange={(text) => d.onChange?.(id, { ...d, text })}
        className="w-full p-2 text-base font-medium outline-none bg-transparent resize-none text-foreground"
        rows={2}
      />
    </NodeShell>
  );
});
TextNode.displayName = "TextNode";

export const CardNode = memo(({ data, selected, id }: NodeProps) => {
  const d: any = data;
  const accent = d.color ?? "oklch(0.6 0.22 285)";
  return (
    <NodeShell selected={selected} className="bg-surface min-w-[220px] max-w-[320px]">
      <div className="h-1.5 rounded-t-xl" style={{ background: accent }} />
      <div className="p-3 space-y-1.5">
        <EditableText
          value={d.title ?? ""}
          placeholder="Título do card"
          onChange={(title) => d.onChange?.(id, { ...d, title })}
          className="w-full text-sm font-semibold outline-none bg-transparent text-foreground"
          rows={1}
        />
        <EditableText
          value={d.description ?? ""}
          placeholder="Descrição..."
          onChange={(description) => d.onChange?.(id, { ...d, description })}
          className="w-full text-xs outline-none bg-transparent resize-none text-muted-foreground"
          rows={3}
        />
      </div>
    </NodeShell>
  );
});
CardNode.displayName = "CardNode";

export const ChecklistNode = memo(({ data, selected, id }: NodeProps) => {
  const d: any = data;
  const items: { text: string; done: boolean }[] = d.items ?? [];
  const update = (next: typeof items) => d.onChange?.(id, { ...d, items: next });
  return (
    <NodeShell selected={selected} className="bg-surface min-w-[220px] max-w-[320px] p-3">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-foreground">
        <ListTodo className="size-3.5 text-primary" /> Checklist
      </div>
      <div className="space-y-1">
        {items.map((it, idx) => (
          <div key={idx} className="flex items-start gap-2">
            <button onClick={() => update(items.map((x, i) => i === idx ? { ...x, done: !x.done } : x))}>
              {it.done ? <CheckSquare className="size-4 text-primary mt-0.5" /> : <Square className="size-4 text-muted-foreground mt-0.5" />}
            </button>
            <EditableText
              value={it.text}
              placeholder="Item"
              onChange={(text) => update(items.map((x, i) => i === idx ? { ...x, text } : x))}
              className={`flex-1 text-xs bg-transparent outline-none ${it.done ? "line-through text-muted-foreground" : "text-foreground"}`}
              rows={1}
            />
          </div>
        ))}
        <button
          onClick={() => update([...items, { text: "", done: false }])}
          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mt-1"
        >
          <Plus className="size-3" /> Adicionar
        </button>
      </div>
    </NodeShell>
  );
});
ChecklistNode.displayName = "ChecklistNode";

export const LinkNode = memo(({ data, selected, id }: NodeProps) => {
  const d: any = data;
  const url = d.url ?? "";
  let host = "";
  try { host = url ? new URL(url).hostname : ""; } catch {}
  return (
    <NodeShell selected={selected} className="bg-surface min-w-[220px] max-w-[280px] p-3">
      <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground">
        {host ? (
          <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" className="size-4 rounded" />
        ) : <LinkIcon className="size-4 text-primary" />}
        <span className="truncate">{host || "Link"}</span>
      </div>
      <EditableText
        value={d.title ?? ""}
        placeholder="Título"
        onChange={(title) => d.onChange?.(id, { ...d, title })}
        className="w-full text-sm font-medium outline-none bg-transparent text-foreground mb-1"
        rows={1}
      />
      <input
        value={url}
        onChange={(e) => d.onChange?.(id, { ...d, url: e.target.value })}
        placeholder="https://..."
        className="w-full text-xs outline-none bg-transparent text-primary truncate"
      />
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-primary underline mt-1 inline-block">
          Abrir →
        </a>
      )}
    </NodeShell>
  );
});
LinkNode.displayName = "LinkNode";

export const ImageNode = memo(({ data, selected, id }: NodeProps) => {
  const d: any = data;
  const url = d.url ?? "";
  return (
    <NodeShell selected={selected} className="bg-surface min-w-[200px] max-w-[400px] overflow-hidden">
      {url ? (
        <img src={url} alt="" className="w-full h-auto block rounded-xl" />
      ) : (
        <div className="p-6 text-center">
          <ImageIcon className="size-8 mx-auto mb-2 text-muted-foreground" />
          <input
            value={url}
            onChange={(e) => d.onChange?.(id, { ...d, url: e.target.value })}
            placeholder="URL da imagem"
            className="w-full text-xs outline-none bg-surface-hover px-2 py-1 rounded text-foreground"
          />
        </div>
      )}
    </NodeShell>
  );
});
ImageNode.displayName = "ImageNode";

export const MindmapNode = memo(({ data, selected, id }: NodeProps) => {
  const d: any = data;
  const isRoot = d.isRoot;
  const color = d.color ?? "oklch(0.6 0.22 285)";
  return (
    <div className={`relative group ${selected ? ringClass : ""} rounded-full`}>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <Handle type="source" position={Position.Right} className={handleClass} />
      <div
        className={`px-4 py-2 rounded-full font-medium text-sm shadow-lg whitespace-nowrap ${isRoot ? "text-white" : "text-zinc-900"}`}
        style={{ background: isRoot ? color : "#e0e7ff" }}
      >
        <EditableText
          value={d.text ?? ""}
          placeholder={isRoot ? "Tópico central" : "Tópico"}
          onChange={(text) => d.onChange?.(id, { ...d, text })}
          className="bg-transparent outline-none text-center min-w-[80px]"
          rows={1}
        />
      </div>
      <button
        onClick={() => d.onAddChild?.(id)}
        className="absolute -right-3 top-1/2 -translate-y-1/2 size-6 rounded-full bg-primary text-primary-foreground grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
        title="Adicionar ramo"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
});
MindmapNode.displayName = "MindmapNode";

export const TaskRefNode = memo(({ data, selected }: NodeProps) => {
  const d: any = data;
  const task = d.task;
  return (
    <NodeShell selected={selected} className="bg-surface min-w-[220px] max-w-[280px] p-3">
      <div className="flex items-center gap-1.5 mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <FileText className="size-3" /> Tarefa
      </div>
      {task ? (
        <>
          <div className={`text-sm font-medium ${task.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
            {task.title}
          </div>
          {task.due_at && (
            <div className="text-xs text-muted-foreground mt-1">
              {new Date(task.due_at).toLocaleDateString("pt-BR")}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-1">Status: {task.status}</div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground italic">Tarefa removida</div>
      )}
    </NodeShell>
  );
});
TaskRefNode.displayName = "TaskRefNode";

// Editable text: shows a div by default (so the node is fully draggable);
// double-click switches to a textarea for editing. This makes drag instant.
function EditableText({
  value, onChange, className, placeholder, rows = 1,
}: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; rows?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={local}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onChange(local);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setLocal(value); setEditing(false); }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={`nodrag nowheel ${className}`}
      />
    );
  }

  return (
    <div
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={`${className} whitespace-pre-wrap cursor-text ${!value ? "text-muted-foreground/60" : ""}`}
      style={{ minHeight: `${rows * 1.4}em` }}
    >
      {value || placeholder}
    </div>
  );
}

export const PALETTE_ITEMS = [
  { kind: "note", label: "Nota", icon: StickyNote },
  { kind: "text", label: "Texto", icon: TypeIcon },
  { kind: "card", label: "Card", icon: FileText },
  { kind: "checklist", label: "Checklist", icon: ListTodo },
  { kind: "link", label: "Link", icon: LinkIcon },
  { kind: "image", label: "Imagem", icon: ImageIcon },
  { kind: "mindmap", label: "Mapa mental", icon: Plus },
] as const;

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Plus, Trash2, X, Upload, Film, ImageIcon, Copy } from "lucide-react";
import { listCreatives, createCreative, updateCreative, deleteCreative, duplicateCreative, CREATIVE_STATUSES } from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";

const COLUMNS: { id: typeof CREATIVE_STATUSES[number]; label: string; tint: string; accent: string }[] = [
  { id: "lancar",     label: "Para Lançar", tint: "oklch(0.97 0.012 250)", accent: "oklch(0.55 0.2 250)" },
  { id: "validacao",  label: "Em Validação", tint: "oklch(0.97 0.03 75)",  accent: "oklch(0.6 0.16 65)" },
  { id: "aprovado",   label: "Aprovados",   tint: "oklch(0.96 0.04 155)", accent: "oklch(0.5 0.13 155)" },
  { id: "rejeitado",  label: "Rejeitados",  tint: "oklch(0.96 0.04 25)",  accent: "oklch(0.55 0.18 25)" },
];

export function ProductCreatives({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listCreatives);
  const createFn = useServerFn(createCreative);
  const updateFn = useServerFn(updateCreative);
  const deleteFn = useServerFn(deleteCreative);
  const duplicateFn = useServerFn(duplicateCreative);

  const [editing, setEditing] = useState<any | null>(null);
  const [adding, setAdding] = useState<typeof CREATIVE_STATUSES[number] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data } = useQuery({ queryKey: ["creatives", productId], queryFn: () => list({ data: { product_id: productId } }) });
  const items = (data?.creatives ?? []) as any[];

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const c of COLUMNS) g[c.id] = [];
    for (const it of items) g[it.status]?.push(it);
    return g;
  }, [items]);

  const queryKey = ["creatives", productId];
  const refresh = () => qc.invalidateQueries({ queryKey });
  const create = useMutation({ mutationFn: (input: any) => createFn({ data: { product_id: productId, ...input } }), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });
  const duplicate = useMutation({ mutationFn: (id: string) => duplicateFn({ data: { id } }), onSuccess: refresh });

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const c = items.find((x) => x.id === active.id);
    const newStatus = String(over.id) as typeof CREATIVE_STATUSES[number];
    if (!c || c.status === newStatus) return;
    const newPosition = ((grouped[newStatus]?.[0]?.position ?? 0) - 1);
    update.mutate({ id: c.id, patch: { status: newStatus, position: newPosition } });
  };

  const active = items.find((x) => x.id === activeId);

  return (
    <div>
      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <Column key={col.id} col={col} items={grouped[col.id] ?? []} onAdd={() => setAdding(col.id)} onCardClick={(c: any) => setEditing(c)} onDuplicate={(id: string) => duplicate.mutate(id)} onDelete={(id: string) => { if (confirm("Excluir criativo?")) remove.mutate(id); }} />
          ))}
        </div>
        <DragOverlay>{active && <CreativeCard c={active} onClick={() => {}} onDuplicate={() => {}} onDelete={() => {}} />}</DragOverlay>
      </DndContext>

      {(editing || adding) && (
        <CreativeEditor
          creative={editing}
          status={adding ?? editing?.status}
          productId={productId}
          onClose={() => { setEditing(null); setAdding(null); }}
          onCreate={async (data: any) => { await create.mutateAsync(data); setAdding(null); }}
          onSave={async (id: string, patch: any) => { await update.mutateAsync({ id, patch }); setEditing(null); }}
          onDelete={editing ? async () => { await remove.mutateAsync(editing.id); setEditing(null); } : undefined}
        />
      )}
    </div>
  );
}

function Column({ col, items, onAdd, onCardClick, onDuplicate, onDelete }: any) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface min-h-0 w-[280px] shrink-0">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border" style={{ background: col.tint }}>
        <span className="size-2 rounded-full" style={{ background: col.accent }} />
        <div className="text-sm font-semibold flex-1">{col.label}</div>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
        <button onClick={onAdd} className="size-6 rounded-md hover:bg-surface grid place-items-center text-muted-foreground"><Plus className="size-3.5" /></button>
      </div>
      <div ref={setNodeRef} className={`p-2 space-y-2 min-h-[160px] transition-colors ${isOver ? "bg-primary/5" : ""}`}>
        {items.map((c: any) => <CreativeCard key={c.id} c={c} onClick={() => onCardClick(c)} onDuplicate={() => onDuplicate(c.id)} onDelete={() => onDelete(c.id)} />)}
        {items.length === 0 && (
          <button onClick={onAdd} className="w-full text-xs text-muted-foreground py-3 hover:text-foreground rounded-lg border border-dashed border-border">+ Criativo</button>
        )}
      </div>
    </div>
  );
}

function CreativeCard({ c, onClick, onDuplicate, onDelete }: any) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id });
  const titles: string[] = Array.isArray(c.titles) ? c.titles : [];
  const descriptions: string[] = Array.isArray(c.descriptions) ? c.descriptions : [];
  const cardName = c.name || titles[0] || c.title || "Sem nome";
  const previewDesc = descriptions[0] || c.description || "";
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      onClick={(e) => { if (!isDragging) { e.stopPropagation(); onClick(); } }}
      className={`group rounded-xl bg-background border border-border hover:border-primary/40 cursor-grab active:cursor-grabbing transition-all overflow-hidden ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="aspect-video bg-muted/40 grid place-items-center overflow-hidden">
        {c.media_url ? (
          c.media_kind === "video" ? (
            <video src={c.media_url} className="w-full h-full object-cover" muted />
          ) : (
            <img src={c.media_url} alt={cardName} className="w-full h-full object-cover" />
          )
        ) : (
          <Film className="size-8 text-muted-foreground" />
        )}
      </div>
      <div className="p-2.5">
        <div className="flex items-start gap-2">
          <div className="text-sm flex-1 leading-snug font-medium truncate">{cardName}</div>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100">
            <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplicar" className="text-muted-foreground hover:text-foreground"><Copy className="size-3.5" /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Excluir" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
          </div>
        </div>
        {previewDesc && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-1">{previewDesc}</div>}
        {(titles.length + descriptions.length) > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1">{titles.length} título(s) · {descriptions.length} descrição(ões)</div>
        )}
      </div>
    </div>
  );
}

function CreativeEditor({ creative, status, productId, onClose, onCreate, onSave, onDelete }: any) {
  const initialTitles: string[] = (() => {
    if (Array.isArray(creative?.titles) && creative.titles.length > 0) return creative.titles;
    if (creative?.title) return [creative.title];
    return [];
  })();
  const initialDescriptions: string[] = (() => {
    if (Array.isArray(creative?.descriptions) && creative.descriptions.length > 0) return creative.descriptions;
    if (creative?.description) return [creative.description];
    return [];
  })();
  const [name, setName] = useState<string>(creative?.name ?? "");
  const [titles, setTitles] = useState<string[]>(initialTitles);
  const [descriptions, setDescriptions] = useState<string[]>(initialDescriptions);
  const [mediaUrl, setMediaUrl] = useState(creative?.media_url ?? "");
  const [mediaPath, setMediaPath] = useState(creative?.media_path ?? "");
  const [mediaKind, setMediaKind] = useState<"video" | "image" | null>(creative?.media_kind ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${u.user.id}/products/${productId}/creatives/${Date.now()}_${safe}`;
      const { error } = await supabase.storage.from("project-attachments").upload(path, file);
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      setMediaUrl(signed?.signedUrl ?? "");
      setMediaPath(path);
      setMediaKind(file.type.startsWith("video/") ? "video" : "image");
    } catch (err: any) { alert("Erro: " + err.message); } finally { setUploading(false); }
  };

  const submit = async () => {
    const cleanTitles = titles.map((t) => (t ?? "").trim()).filter(Boolean);
    const cleanDescs = descriptions.map((d) => (d ?? "").trim()).filter(Boolean);
    const cardName = name.trim() || cleanTitles[0] || "Sem nome";
    const payload = {
      name: cardName,
      title: cleanTitles[0] ?? "",
      description: cleanDescs[0] ?? null,
      titles: cleanTitles,
      descriptions: cleanDescs,
      media_url: mediaUrl || null,
      media_path: mediaPath || null,
      media_kind: mediaKind,
    };
    if (creative) {
      await onSave(creative.id, payload);
    } else {
      await onCreate({ ...payload, status: status ?? "lancar" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-popover z-10">
          <div className="text-base font-semibold">{creative ? "Editar criativo" : "Novo criativo"}</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="aspect-video rounded-xl bg-muted grid place-items-center overflow-hidden border border-border">
            {mediaUrl ? (
              mediaKind === "video" ? <video src={mediaUrl} className="w-full h-full object-cover" controls /> : <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="text-center"><ImageIcon className="size-10 text-muted-foreground mx-auto mb-1" /><div className="text-xs text-muted-foreground">Sem mídia</div></div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="video/*,image/*" onChange={onPick} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full h-9 rounded-lg border border-border bg-surface text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Upload className="size-3.5" /> {uploading ? "Enviando..." : "Vídeo ou imagem"}
          </button>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Nome do card</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Criativo VSL principal" className="w-full px-3 h-9 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50" />
          </div>

          <ListField
            label="Títulos"
            placeholder="Novo título"
            values={titles}
            setValues={setTitles}
          />

          <ListField
            label="Descrições"
            placeholder="Nova descrição"
            values={descriptions}
            setValues={setDescriptions}
            multiline
          />
        </div>
        <div className="flex justify-between items-center px-5 py-3 border-t border-border sticky bottom-0 bg-popover">
          {onDelete ? <button onClick={onDelete} className="text-sm text-destructive hover:underline">Excluir</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
            <button onClick={submit} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListField({ label, placeholder, values, setValues, multiline }: { label: string; placeholder: string; values: string[]; setValues: (v: string[]) => void; multiline?: boolean }) {
  const update = (i: number, v: string) => setValues(values.map((x, idx) => (idx === i ? v : x)));
  const remove = (i: number) => setValues(values.filter((_, idx) => idx !== i));
  const add = () => setValues([...values, ""]);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
        <span className="text-[10px] text-muted-foreground tabular-nums">{values.length}</span>
      </div>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex gap-1.5 items-start">
            {multiline ? (
              <textarea value={v} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} rows={2} className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none resize-none" />
            ) : (
              <input value={v} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} className="flex-1 px-3 h-9 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50" />
            )}
            <button onClick={() => remove(i)} className="mt-1 text-muted-foreground hover:text-destructive shrink-0"><X className="size-3.5" /></button>
          </div>
        ))}
        <button onClick={add} className="w-full text-xs text-muted-foreground py-2 hover:text-foreground rounded-lg border border-dashed border-border inline-flex items-center justify-center gap-1">
          <Plus className="size-3.5" /> Adicionar {label.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    </div>
  );
}

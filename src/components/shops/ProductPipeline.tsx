import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Plus, Trash2, X, Search, Tag as TagIcon, Upload, Image as ImageIcon, Link2, Calendar as CalIcon } from "lucide-react";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import {
  listShopProducts, createShopProduct, updateShopProduct, deleteShopProduct, reorderShopProducts,
  PRODUCT_STATUSES,
} from "@/lib/shop-products.functions";
import { listProducts } from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";

const COLUMNS: { id: typeof PRODUCT_STATUSES[number]; label: string; tint: string; accent: string }[] = [
  { id: "producao",   label: "Teste",      tint: "oklch(0.97 0.03 75)",   accent: "oklch(0.6 0.16 65)" },
  { id: "validacao",  label: "Validação",  tint: "oklch(0.97 0.025 130)", accent: "oklch(0.5 0.15 130)" },
  { id: "escala",     label: "Escala",     tint: "oklch(0.96 0.04 155)",  accent: "oklch(0.5 0.13 155)" },
  { id: "pausado",    label: "Pausado",    tint: "oklch(0.95 0.005 250)", accent: "oklch(0.45 0.015 260)" },
  { id: "vencedor",   label: "Vencedor",   tint: "oklch(0.95 0.05 75)",   accent: "oklch(0.55 0.2 65)" },
];

type Product = {
  id: string; name: string; image_url: string | null; description: string | null;
  links: { label: string; url: string }[]; notes: string | null; tags: string[];
  status: typeof PRODUCT_STATUSES[number]; product_date: string | null; position: number;
};

export function ProductPipeline({ shopIds }: { shopIds: string[] }) {
  const qc = useQueryClient();
  const list = useServerFn(listShopProducts);
  const createFn = useServerFn(createShopProduct);
  const updateFn = useServerFn(updateShopProduct);
  const deleteFn = useServerFn(deleteShopProduct);
  const reorderFn = useServerFn(reorderShopProducts);
  const isConsolidated = shopIds.length > 1;
  const cacheKey = shopIds.slice().sort().join(",");

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerStatus, setPickerStatus] = useState<typeof PRODUCT_STATUSES[number] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const listProductsFn = useServerFn(listProducts);
  const productsCatalog = useQuery({ queryKey: ["products-catalog"], queryFn: () => listProductsFn() });

  const { data } = useQuery({ queryKey: ["shop-products", cacheKey], queryFn: () => list({ data: { shop_ids: shopIds } }) });
  const products = (data?.products ?? []) as unknown as Product[];

  const grouped = useMemo(() => {
    const g: Record<string, Product[]> = {};
    for (const c of COLUMNS) g[c.id] = [];
    for (const p of products) {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.tags?.some((t) => t.toLowerCase().includes(search.toLowerCase()))) continue;
      g[p.status]?.push(p);
    }
    return g;
  }, [products, search]);

  const queryKey = ["shop-products", cacheKey];
  const refresh = () => qc.invalidateQueries({ queryKey });
  const create = useMutation({ mutationFn: (input: any) => createFn({ data: { shop_id: shopIds[0], ...input } }), onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }),
    onMutate: async ({ id, patch }: any) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      qc.setQueryData<any>(queryKey, (old: any) => old?.products ? { ...old, products: old.products.map((p: any) => p.id === id ? { ...p, ...patch } : p) } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev); },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      qc.setQueryData<any>(queryKey, (old: any) => old?.products ? { ...old, products: old.products.filter((p: any) => p.id !== id) } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev); },
    onSettled: refresh,
  });
  const reorder = useMutation({
    mutationFn: (updates: any[]) => reorderFn({ data: { updates } }),
    onMutate: async (updates: any[]) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      qc.setQueryData<any>(queryKey, (old: any) => {
        if (!old?.products) return old;
        const map = new Map(updates.map((u) => [u.id, u]));
        return { ...old, products: old.products.map((p: any) => map.has(p.id) ? { ...p, ...map.get(p.id) } : p) };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev); },
    onSettled: refresh,
  });

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const p = products.find((x) => x.id === active.id);
    const newStatus = String(over.id) as Product["status"];
    if (!p || p.status === newStatus) return;
    const newPosition = ((grouped[newStatus]?.[0]?.position ?? 0) - 1);
    reorder.mutate([{ id: p.id, status: newStatus, position: newPosition }]);
  };

  const activeProduct = products.find((p) => p.id === activeId) ?? null;

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface border border-border flex-1 max-w-sm">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto ou tag..."
            className="bg-transparent text-sm outline-none flex-1"
          />
        </div>
        <span className="text-xs text-muted-foreground">{products.length} produto(s)</span>
        <div className="flex-1" />
        {!isConsolidated && (
          <button onClick={() => setPickerStatus(COLUMNS[0].id)} className="flex items-center gap-1.5 text-xs px-3 h-8 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 transition-colors">
            <Plus className="size-3.5" /> Adicionar produto
          </button>
        )}
      </div>

      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              col={col}
              items={grouped[col.id] ?? []}
              onCardClick={(p: Product) => setEditing(p)}
              onDelete={(id: string) => remove.mutate(id)}
            />
          ))}
        </div>
        <DragOverlay>{activeProduct && <ProductCard p={activeProduct} onClick={() => {}} onDelete={() => {}} />}</DragOverlay>
      </DndContext>

      {editing && (
        <ProductEditor
          product={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch: any) => { await update.mutateAsync({ id: editing.id, patch }); setEditing(null); }}
          onDelete={async () => { await remove.mutateAsync(editing.id); setEditing(null); }}
        />
      )}

      {pickerStatus && (
        <ProductPicker
          catalog={productsCatalog.data?.products ?? []}
          existingProductIds={new Set(products.map((p) => (p as any).product_id).filter(Boolean))}
          onClose={() => setPickerStatus(null)}
          onPick={(item: any) => {
            create.mutate({
              name: item.name,
              status: pickerStatus,
              product_id: item.id,
              image_url: item.main_image_url ?? null,
            });
            setPickerStatus(null);
          }}
          onCreateBlank={(name: string) => {
            create.mutate({ name, status: pickerStatus });
            setPickerStatus(null);
          }}
        />
      )}
    </>
  );
}

function Column({ col, items, onCardClick, onDelete }: any) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface min-h-0 w-[260px] shrink-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border" style={{ background: col.tint }}>
        <span className="size-2 rounded-full" style={{ background: col.accent }} />
        <div className="text-sm font-semibold flex-1">{col.label}</div>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </div>
      <div ref={setNodeRef} className={`p-2 space-y-2 min-h-[120px] transition-colors ${isOver ? "bg-primary/5" : ""}`}>
        {items.map((p: Product) => <ProductCard key={p.id} p={p} onClick={() => onCardClick(p)} onDelete={() => onDelete(p.id)} />)}
      </div>
    </div>
  );
}

function ProductPicker({ catalog, existingProductIds, onClose, onPick, onCreateBlank }: any) {
  const [q, setQ] = useState("");
  useEscapeToClose(onClose);
  const filtered = catalog.filter((p: any) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.niche ?? "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-base font-semibold">Selecionar produto</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface border border-border">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && q.trim() && filtered.length === 0) onCreateBlank(q.trim()); }}
              placeholder="Buscar produto cadastrado..."
              className="bg-transparent text-sm outline-none flex-1"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8 px-4">
              <div className="text-sm text-muted-foreground mb-3">Nenhum produto encontrado.</div>
              {q.trim() && (
                <button onClick={() => onCreateBlank(q.trim())} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
                  Criar “{q.trim()}” avulso
                </button>
              )}
            </div>
          ) : filtered.map((p: any) => {
            const already = existingProductIds.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted text-left"
              >
                {p.main_image_url ? (
                  <img src={p.main_image_url} alt="" className="size-10 rounded-md object-cover border border-border shrink-0" />
                ) : (
                  <div className="size-10 rounded-md bg-muted grid place-items-center shrink-0"><ImageIcon className="size-4 text-muted-foreground" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  {p.niche && <div className="text-[11px] text-muted-foreground truncate">{p.niche}</div>}
                </div>
                {already && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">já na esteira</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProductCard({ p, onClick, onDelete }: { p: Product; onClick: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: p.id });
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      onClick={(e) => { if (!isDragging) { e.stopPropagation(); onClick(); } }}
      className={`group rounded-xl bg-background border border-border hover:border-primary/40 cursor-grab active:cursor-grabbing transition-all overflow-hidden ${isDragging ? "opacity-40" : ""}`}
    >
      {p.image_url && (
        <img src={p.image_url} alt={p.name} className="w-full h-24 object-cover" />
      )}
      <div className="p-2.5">
        <div className="flex items-start gap-2">
          <div className="text-sm flex-1 leading-snug font-medium">{p.name}</div>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0">
            <Trash2 className="size-3.5" />
          </button>
        </div>
        {(p.tags?.length > 0 || p.product_date) && (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {p.product_date && (
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                <CalIcon className="size-2.5" /> {new Date(p.product_date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
              </span>
            )}
            {p.tags?.slice(0, 3).map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductEditor({ product, onClose, onSave, onDelete }: any) {
  const [name, setName] = useState(product.name);
  const [imageUrl, setImageUrl] = useState(product.image_url ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [notes, setNotes] = useState(product.notes ?? "");
  const [tags, setTags] = useState<string[]>(product.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [status, setStatus] = useState(product.status);
  const [productDate, setProductDate] = useState(product.product_date ?? "");
  const [links, setLinks] = useState<{ label: string; url: string }[]>(product.links ?? []);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEscapeToClose(onClose);

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${u.user.id}/products/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from("project-attachments").upload(path, file);
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      setImageUrl(signed?.signedUrl ?? "");
    } catch (err: any) { alert("Erro: " + err.message); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const addTag = () => {
    const v = tagInput.trim().toLowerCase();
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setTagInput("");
  };

  const save = () => onSave({
    name: name.trim() || product.name,
    image_url: imageUrl || null,
    description: description.trim() || null,
    notes: notes.trim() || null,
    tags,
    status,
    product_date: productDate || null,
    links: links.filter((l) => l.url.trim()),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-popover z-10">
          <div className="text-base font-semibold">Produto</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-3">
            <div className="shrink-0">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="size-24 rounded-xl object-cover border border-border" />
              ) : (
                <div className="size-24 rounded-xl bg-muted grid place-items-center"><ImageIcon className="size-7 text-muted-foreground" /></div>
              )}
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="mt-2 w-full text-[11px] h-7 rounded-md border border-border bg-surface inline-flex items-center justify-center gap-1 disabled:opacity-50">
                <Upload className="size-3" /> {uploading ? "..." : "Imagem"}
              </button>
            </div>
            <div className="flex-1 space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full text-base font-medium bg-transparent outline-none border-b border-border pb-2 focus:border-primary" />
              <div className="grid grid-cols-2 gap-2">
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none">
                  {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <input type="date" value={productDate} onChange={(e) => setProductDate(e.target.value)} className="h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none" />
              </div>
            </div>
          </div>

          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição..." rows={2} className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none resize-none" />

          <div>
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1.5 items-center">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-muted">
                  <TagIcon className="size-3" /> {t}
                  <button onClick={() => setTags(tags.filter((x) => x !== t))}><X className="size-3" /></button>
                </span>
              ))}
              <input
                value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                placeholder="+ tag"
                className="text-xs px-2 h-7 rounded-md bg-surface border border-border outline-none w-24"
              />
            </div>
          </div>

          <div>
            <Label>Links</Label>
            <div className="space-y-1.5">
              {links.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <input value={l.label} onChange={(e) => { const c = [...links]; c[i] = { ...l, label: e.target.value }; setLinks(c); }} placeholder="Rótulo" className="w-32 px-2 h-8 rounded-md bg-surface border border-border text-sm outline-none" />
                  <input value={l.url} onChange={(e) => { const c = [...links]; c[i] = { ...l, url: e.target.value }; setLinks(c); }} placeholder="https://..." className="flex-1 px-2 h-8 rounded-md bg-surface border border-border text-sm outline-none" />
                  <button onClick={() => setLinks(links.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                </div>
              ))}
              <button onClick={() => setLinks([...links, { label: "", url: "" }])} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <Link2 className="size-3" /> Adicionar link
              </button>
            </div>
          </div>

          <div>
            <Label>Observações</Label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas livres..." rows={3} className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none resize-none" />
          </div>
        </div>

        <div className="flex justify-between items-center px-5 py-3 border-t border-border sticky bottom-0 bg-popover">
          <button onClick={onDelete} className="text-sm text-destructive hover:underline">Excluir</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
            <button onClick={save} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: any) {
  return <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">{children}</div>;
}

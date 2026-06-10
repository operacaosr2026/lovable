import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { Plus, Search, Package, X, Upload } from "lucide-react";
import {
  listProducts, createProduct, updateProduct, deleteProduct, PRODUCT_STATUSES,
} from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";

export const Route = createFileRoute("/shops/products/")({
  component: ProductsIndex,
});

const STATUS_META: Record<string, { label: string; tint: string; accent: string }> = {
  ativo:     { label: "Ativo",     tint: "oklch(0.96 0.04 155)",  accent: "oklch(0.5 0.13 155)" },
  teste:     { label: "Teste",     tint: "oklch(0.97 0.025 250)", accent: "oklch(0.55 0.18 250)" },
  escala:    { label: "Escala",    tint: "oklch(0.95 0.05 75)",   accent: "oklch(0.55 0.2 65)" },
  pausado:   { label: "Pausado",   tint: "oklch(0.97 0.03 75)",   accent: "oklch(0.55 0.16 65)" },
  arquivado: { label: "Arquivado", tint: "oklch(0.95 0.005 250)", accent: "oklch(0.45 0.015 260)" },
};

function ProductsIndex() {
  const qc = useQueryClient();
  const list = useServerFn(listProducts);
  const createFn = useServerFn(createProduct);
  const updateFn = useServerFn(updateProduct);
  const deleteFn = useServerFn(deleteProduct);
  const confirm = useConfirm();

  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState<string>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data } = useQuery({ queryKey: ["products"], queryFn: () => list() });
  const products = (data?.products ?? []) as any[];

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (fStatus !== "all" && p.status !== fStatus) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!p.name.toLowerCase().includes(s) && !(p.niche ?? "").toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [products, search, fStatus]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["products"] });
  const create = useMutation({ mutationFn: (input: any) => createFn({ data: input }), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });

  return (
    <PageShell>
      <PageHeader
        title="Produtos"
        subtitle={`${filtered.length} ${filtered.length === 1 ? "produto" : "produtos"}`}
        actions={
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Novo produto
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface border border-border flex-1 min-w-[220px]">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto ou nicho..."
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer"
        >
          <option value="all">Status</option>
          {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Package className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum produto cadastrado ainda.</p>
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Criar primeiro produto
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              p={p}
              onEdit={() => { setEditing(p); setEditorOpen(true); }}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <ProductEditor
          product={editing}
          onClose={() => setEditorOpen(false)}
          onSave={async (patch) => {
            if (editing) await update.mutateAsync({ id: editing.id, patch });
            else await create.mutateAsync(patch);
            setEditorOpen(false);
          }}
          onDelete={editing ? async () => {
            if (await confirm(`Excluir "${editing.name}"?`)) {
              await remove.mutateAsync(editing.id);
              setEditorOpen(false);
            }
          } : undefined}
        />
      )}
    </PageShell>
  );
}

function ProductCard({ p, onEdit }: { p: any; onEdit: () => void }) {
  const st = STATUS_META[p.status] ?? STATUS_META.ativo;
  return (
    <div className="group relative rounded-2xl border border-border bg-surface hover:border-primary/40 transition-colors overflow-hidden">
      <Link to="/shops/products/$productId" params={{ productId: p.id }} className="block">
        <div className="aspect-[4/3] bg-muted/40 overflow-hidden">
          {p.main_image_url ? (
            <img src={p.main_image_url} alt={p.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full grid place-items-center text-muted-foreground">
              <Package className="size-10" />
            </div>
          )}
        </div>
        <div className="p-4">
          <div className="flex items-start gap-2 mb-2">
            <div className="text-sm font-semibold leading-tight flex-1 line-clamp-2">{p.name}</div>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0" style={{ background: st.tint, color: st.accent }}>
              {st.label}
            </span>
          </div>
          {p.niche && <div className="text-[11px] text-muted-foreground">{p.niche}</div>}
        </div>
      </Link>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.preventDefault(); onEdit(); }}
          className="text-[11px] px-2 h-6 rounded-md bg-background/90 backdrop-blur border border-border text-muted-foreground hover:text-foreground"
        >
          editar
        </button>
      </div>
    </div>
  );
}

function ProductEditor({ product, onClose, onSave, onDelete }: {
  product: any;
  onClose: () => void;
  onSave: (patch: any) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [niche, setNiche] = useState(product?.niche ?? "");
  const [status, setStatus] = useState<string>(product?.status ?? "ativo");
  const [imageUrl, setImageUrl] = useState<string>(product?.main_image_url ?? "");
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
      const path = `${u.user.id}/product-covers/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from("project-attachments").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      setImageUrl(signed?.signedUrl ?? "");
    } catch (err: any) {
      alert("Erro ao enviar: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = () => {
    if (!name.trim() && !product) return;
    onSave({
      name: name.trim() || (product?.name ?? "Novo produto"),
      niche: niche.trim() || null,
      status,
      main_image_url: imageUrl || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-base font-semibold">{product ? "Editar produto" : "Novo produto"}</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            {imageUrl ? (
              <img src={imageUrl} alt="capa" className="size-16 rounded-xl object-cover border border-border" />
            ) : (
              <div className="size-16 rounded-xl bg-muted grid place-items-center">
                <Package className="size-7 text-muted-foreground" />
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="h-9 px-3 rounded-lg border border-border bg-surface text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Upload className="size-3.5" /> {uploading ? "Enviando..." : "Imagem"}
            </button>
          </div>

          <input
            autoFocus={!product}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do produto"
            className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="Nicho"
              className="px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="px-2 h-10 rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer"
            >
              {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center px-5 py-3 border-t border-border">
          {onDelete ? (
            <button onClick={onDelete} className="text-sm text-destructive hover:underline">Excluir</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
            <button onClick={save} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

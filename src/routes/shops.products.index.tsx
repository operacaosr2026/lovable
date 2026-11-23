import { Fragment, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import {
  Plus, Search, Package, X, Upload, LayoutGrid, List, FlaskConical, Pickaxe, Wrench, TrendingUp, ChevronRight, LayoutList, type LucideIcon,
} from "lucide-react";
import {
  listProducts, createProduct, updateProduct, deleteProduct,
} from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { StatusBadge, useProductStatuses, usd, type ProductStatus } from "@/components/products/product-status";
import { PLACEMENTS_KEY, ProductBoard, usePipelinePlacements } from "@/components/products/ProductBoard";
import { ProductDetailsDialog } from "@/components/products/ProductDetails";
import { ProductLearnings } from "@/components/products/ProductLearnings";
import { PIPELINES, PIPELINE_LABEL, type Pipeline } from "@/lib/product-pipelines";

type Tab = Pipeline | "todos";
type AllView = "galeria" | "lista" | "aprendizados";
type ProductsSearch = { tab?: Tab; view?: AllView };

const PIPELINE_ICON: Record<Pipeline, LucideIcon> = { mineracao: Pickaxe, producao: Wrench, validacao: FlaskConical, escala: TrendingUp };
const ALL_VIEWS: { id: AllView; label: string; icon: LucideIcon }[] = [
  { id: "galeria", label: "Galeria", icon: LayoutGrid },
  { id: "lista", label: "Lista", icon: List },
  { id: "aprendizados", label: "Aprendizados", icon: FlaskConical },
];

export const Route = createFileRoute("/shops/products/")({
  validateSearch: (search: Record<string, unknown>): ProductsSearch => {
    const view = ALL_VIEWS.some((v) => v.id === search.view) ? (search.view as AllView) : undefined;
    // Links antigos: ?view=esteira era o quadro de status (hoje Validação).
    if (search.view === "esteira") return { tab: "validacao" };
    if ((PIPELINES as readonly string[]).includes(search.tab as string) || search.tab === "todos") {
      return { tab: search.tab as Tab, ...(search.tab === "todos" && view ? { view } : {}) };
    }
    return view ? { tab: "todos", view } : {};
  },
  component: ProductsIndex,
});

function ProductsIndex() {
  const search_ = Route.useSearch();
  const tab: Tab = search_.tab ?? "mineracao";
  const view: AllView = search_.view ?? "galeria";
  const isPipeline = tab !== "todos";
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listProducts);
  const createFn = useServerFn(createProduct);
  const updateFn = useServerFn(updateProduct);
  const deleteFn = useServerFn(deleteProduct);
  const confirm = useConfirm();
  const { statuses, byId } = useProductStatuses();
  const { data: placements } = usePipelinePlacements();

  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState<string>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [newColumnId, setNewColumnId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["products"], queryFn: () => list() });
  const products = (data?.products ?? []) as any[];

  const counts = useMemo(() => {
    const ids = new Set(products.map((p) => p.id));
    const c: Record<Pipeline, number> = { mineracao: 0, producao: 0, validacao: 0, escala: 0 };
    for (const pl of placements ?? []) if (ids.has(pl.product_id)) c[pl.pipeline]++;
    return c;
  }, [products, placements]);

  const matches = (p: any) => {
    if (fStatus !== "all" && !isPipeline && p.board_column_id !== fStatus) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!p.name.toLowerCase().includes(s) && !(p.niche ?? "").toLowerCase().includes(s)) return false;
    }
    return true;
  };
  const filtered = useMemo(() => products.filter(matches), [products, search, fStatus, tab]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: PLACEMENTS_KEY });
  };
  // Card novo aparece na hora (cópia temporária no cache) e o servidor confirma depois.
  const create = useMutation({
    mutationFn: (input: any) => createFn({ data: input }),
    onMutate: async (input: any) => {
      await Promise.all([qc.cancelQueries({ queryKey: ["products"] }), qc.cancelQueries({ queryKey: PLACEMENTS_KEY })]);
      const pl: Pipeline = input.pipeline ?? "validacao";
      const cols = qc.getQueryData<any[]>(pl === "validacao" ? ["product-board-columns"] : ["product-board-columns", pl]) ?? [];
      const columnId: string | undefined = input.board_column_id ?? input.pipeline_column_id ?? cols[0]?.id;
      const id = `temp-${crypto.randomUUID()}`;
      qc.setQueryData(["products"], (old: any) => old && ({
        ...old,
        products: [{
          id, name: input.name, main_image_url: input.main_image_url ?? null, cost: 0, sale_price: 0, niche: null,
          board_column_id: pl === "validacao" ? columnId ?? null : null, board_position: 1e6, created_at: new Date().toISOString(),
        }, ...old.products],
      }));
      if (columnId) qc.setQueryData(PLACEMENTS_KEY, (old: any[] | undefined) => [...(old ?? []), { product_id: id, pipeline: pl, column_id: columnId, position: 1e6 }]);
    },
    onError: (e: any) => toast.error(e.message),
    onSettled: refresh,
  });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });

  const openNew = (columnId: string | null = null) => { setEditing(null); setNewColumnId(columnId); setEditorOpen(true); };
  const goTab = (t: Tab) => { setFStatus("all"); navigate({ search: t === "todos" ? { tab: t, view } : { tab: t } }); };

  return (
    <PageShell fit={isPipeline} wide={isPipeline}>
      <PageHeader
        title="Esteira de produtos"
        subtitle={`${products.length} ${products.length === 1 ? "produto" : "produtos"}`}
        actions={
          <button onClick={() => openNew()} className="hidden sm:flex h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium items-center gap-1.5">
            <Plus className="size-4" /> Novo produto
          </button>
        }
      />

      {/* Abas principais: as esteiras em sequência + Todos à parte. */}
      <div className="flex items-stretch gap-1.5 sm:gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1 shrink-0">
        {PIPELINES.map((pl, i) => {
          const Icon = PIPELINE_ICON[pl];
          const active = tab === pl;
          return (
            <Fragment key={pl}>
              {i > 0 && <ChevronRight className="size-4 self-center shrink-0 text-muted-foreground/60" />}
              <button
                onClick={() => goTab(pl)}
                className={`group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 min-w-[150px] sm:min-w-[180px] text-left transition-colors shrink-0 ${
                  active ? "border-primary bg-primary/10" : "border-border bg-surface hover:border-primary/40"
                }`}
              >
                <span className={`size-9 rounded-lg grid place-items-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground"}`}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className={`block text-[10px] font-semibold uppercase tracking-wider ${active ? "text-primary" : "text-muted-foreground"}`}>Etapa {i + 1}</span>
                  <span className="block text-sm font-semibold leading-tight">{PIPELINE_LABEL[pl]}</span>
                  <span className="block text-[11px] text-muted-foreground tabular-nums">
                    {counts[pl]} {counts[pl] === 1 ? "produto" : "produtos"}
                  </span>
                </span>
              </button>
            </Fragment>
          );
        })}
        <div className="w-px bg-border mx-1 sm:mx-2 shrink-0" />
        <button
          onClick={() => goTab("todos")}
          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 min-w-[130px] text-left transition-colors shrink-0 ${
            tab === "todos" ? "border-primary bg-primary/10" : "border-border bg-surface hover:border-primary/40"
          }`}
        >
          <span className={`size-9 rounded-lg grid place-items-center shrink-0 ${tab === "todos" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            <LayoutList className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold leading-tight">Todos</span>
            <span className="block text-[11px] text-muted-foreground tabular-nums">{products.length} {products.length === 1 ? "produto" : "produtos"}</span>
          </span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface border border-border flex-1 min-w-0 sm:min-w-[220px]">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto ou nicho..."
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
          />
        </div>
        <button onClick={() => openNew()} className="sm:hidden h-9 px-3 shrink-0 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5">
          <Plus className="size-4" /> Novo produto
        </button>
        {!isPipeline && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              className="h-9 px-2 min-w-0 shrink rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer"
            >
              <option value="all">Status</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 ml-auto sm:ml-0 shrink-0">
              {ALL_VIEWS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => navigate({ search: { tab: "todos", view: id } })}
                  className={`h-8 px-2.5 sm:px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="size-3.5" /> <span className={view === id ? "" : "hidden sm:inline"}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {isPipeline ? (
        <ProductBoard
          key={tab}
          pipeline={tab}
          products={products}
          visible={matches}
          onOpen={(p) => { if (!p.id.startsWith("temp-")) setViewingId(p.id); }}
          onEdit={(p) => { setEditing(p); setEditorOpen(true); }}
          onDelete={async (p) => { if (await confirm(`Excluir "${p.name}"? Ele sai de todas as esteiras.`)) remove.mutate(p.id); }}
          onCreate={(columnId) => openNew(columnId)}
        />
      ) : view === "aprendizados" ? (
        <ProductLearnings search={search} onOpen={setViewingId} />
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Package className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum produto cadastrado ainda.</p>
          <button onClick={() => openNew()} className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5">
            <Plus className="size-4" /> Criar primeiro produto
          </button>
        </div>
      ) : view === "galeria" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              p={p}
              status={byId.get(p.board_column_id)}
              onOpen={() => setViewingId(p.id)}
              onEdit={() => { setEditing(p); setEditorOpen(true); }}
            />
          ))}
        </div>
      ) : (
        <ProductListView products={filtered} statusById={byId} onOpen={(p) => setViewingId(p.id)} />
      )}

      {viewingId && <ProductDetailsDialog productId={viewingId} onClose={() => setViewingId(null)} />}

      {editorOpen && (
        <ProductEditor
          product={editing}
          statuses={statuses}
          pipeline={tab === "todos" ? "validacao" : tab}
          columnId={newColumnId}
          onClose={() => setEditorOpen(false)}
          onSave={async (patch) => {
            if (editing) await update.mutateAsync({ id: editing.id, patch });
            else create.mutate(patch);
            setEditorOpen(false);
          }}
          onDelete={editing ? async () => {
            if (await confirm(`Excluir "${editing.name}"? Ele sai de todas as esteiras.`)) {
              await remove.mutateAsync(editing.id);
              setEditorOpen(false);
            }
          } : undefined}
        />
      )}
    </PageShell>
  );
}

function ProductCard({ p, status, onOpen, onEdit }: { p: any; status: ProductStatus | undefined; onOpen: () => void; onEdit: () => void }) {
  return (
    <div className="group relative rounded-2xl border border-border bg-surface hover:border-primary/40 transition-colors overflow-hidden">
      <button type="button" onClick={onOpen} className="block w-full text-left">
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
            <StatusBadge status={status} className="shrink-0 max-w-[45%]" />
          </div>
          <div className="text-[11px] text-muted-foreground">Custo: {usd(p.cost ?? 0)}</div>
        </div>
      </button>
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

function ProductListView({ products, statusById, onOpen }: {
  products: any[]; statusById: Map<string, ProductStatus>; onOpen: (p: any) => void;
}) {
  return (
    // Colunas em px fixo não cabem em mobile; rola horizontal em vez de cortar.
    <div className="rounded-2xl border border-border bg-surface overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[56px_1fr_140px_110px_110px_110px] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <div />
          <div>Produto</div>
          <div>Nicho</div>
          <div>Status</div>
          <div className="text-right">Custo</div>
          <div className="text-right">Preço de venda</div>
        </div>
        {products.map((p, i) => {
          return (
            <button
              type="button"
              key={p.id}
              onClick={() => onOpen(p)}
              className={`w-full text-left grid grid-cols-[56px_1fr_140px_110px_110px_110px] gap-3 px-4 py-2.5 items-center hover:bg-muted/30 transition-colors ${i > 0 ? "border-t border-border/60" : ""}`}
            >
              <div className="size-9 rounded-lg bg-muted/40 overflow-hidden shrink-0 grid place-items-center">
                {p.main_image_url ? (
                  <img src={p.main_image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <Package className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="text-sm font-medium truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground truncate">{p.niche || "—"}</div>
              <div className="min-w-0"><StatusBadge status={statusById.get(p.board_column_id)} /></div>
              <div className="text-right text-sm tabular-nums">{usd(p.cost ?? 0)}</div>
              <div className="text-right text-sm tabular-nums text-muted-foreground">{usd(p.sale_price ?? 0)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Produto novo nasce na esteira da aba aberta; o status (Validação) só
// aparece quando ele nasce na Validação ou já tem status.
function ProductEditor({ product, statuses, pipeline, columnId, onClose, onSave, onDelete }: {
  product: any;
  statuses: ProductStatus[];
  pipeline: Pipeline;
  columnId: string | null;
  onClose: () => void;
  onSave: (patch: any) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [statusId, setStatusId] = useState<string>(product ? product.board_column_id ?? "" : (pipeline === "validacao" ? columnId : null) ?? statuses[0]?.id ?? "");
  const showStatus = product ? true : pipeline === "validacao";
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
      console.error("Erro ao enviar imagem do produto", err);
      alert(`Erro ao enviar: ${err.message}${err.status ? ` (status ${err.status}${err.statusCode ? `, ${err.statusCode}` : ""})` : ""}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = () => {
    if (!name.trim() && !product) return;
    onSave({
      name: name.trim() || (product?.name ?? "Novo produto"),
      ...(showStatus && statusId && statusId !== product?.board_column_id ? { board_column_id: statusId } : {}),
      main_image_url: imageUrl || null,
      ...(product ? {} : { pipeline, ...(pipeline !== "validacao" && columnId ? { pipeline_column_id: columnId } : {}) }),
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
          {!showStatus && (
            <p className="text-xs text-muted-foreground">Entra em {PIPELINE_LABEL[pipeline]}.</p>
          )}
          {showStatus && <select
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
            className="w-full px-2 h-10 rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer"
          >
            {!statusId && <option value="">Sem status (fora da Validação)</option>}
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>}
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

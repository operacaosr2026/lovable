import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { Plus, ShoppingBag, ExternalLink, Pencil, X, List, Layers } from "lucide-react";
import { listShopifyStores, renameShopifyStore } from "@/lib/shop-orders.functions";
import { ConnectStoreDialog } from "@/components/shops/ShopIntegrations";
import { StoreBoard } from "@/components/shops/StoreBoard";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";

type ViewMode = "esteira" | "lista";

export const Route = createFileRoute("/shops/banco-de-lojas/")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view === "lista" ? "lista" : "esteira") as ViewMode,
  }),
  component: BancoDeLojasIndex,
});

function BancoDeLojasIndex() {
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listShopifyStores);
  const [openConnect, setOpenConnect] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ["shopify-stores"],
    queryFn: () => listFn(),
  });

  return (
    <PageShell>
      <PageHeader title="Banco de Lojas" subtitle="Repositório de lojas para referência e análise." />

      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Carregando..." : `${stores.length} ${stores.length === 1 ? "loja conectada" : "lojas conectadas"}`}
          </p>
          <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
            <button
              onClick={() => navigate({ search: { view: "esteira" } })}
              className={`h-7 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${view === "esteira" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Layers className="size-3.5" /> Esteira
            </button>
            <button
              onClick={() => navigate({ search: { view: "lista" } })}
              className={`h-7 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${view === "lista" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="size-3.5" /> Lista
            </button>
          </div>
        </div>
        <button
          onClick={() => setOpenConnect(true)}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> Nova loja
        </button>
      </div>

      {!isLoading && stores.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <ShoppingBag className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma loja Shopify conectada ainda.</p>
          <button
            onClick={() => setOpenConnect(true)}
            className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Conectar primeira loja
          </button>
        </div>
      ) : view === "esteira" ? (
        <StoreBoard onEditStore={(store) => setEditing(store)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {stores.map((store: any) => (
            <StoreCard
              key={store.id}
              store={store}
              onEdit={() => setEditing(store)}
            />
          ))}
        </div>
      )}

      {editing && (
        <RenameStoreDialog
          store={editing}
          onClose={() => setEditing(null)}
          onRenamed={() => {
            qc.invalidateQueries({ queryKey: ["shopify-stores"] });
            setEditing(null);
          }}
        />
      )}

      {openConnect && (
        <ConnectStoreDialog
          open={openConnect}
          onClose={() => setOpenConnect(false)}
          onConnected={() => {
            qc.invalidateQueries({ queryKey: ["shopify-stores"] });
            setOpenConnect(false);
          }}
        />
      )}
    </PageShell>
  );
}

function StoreCard({ store, onEdit }: { store: any; onEdit: () => void }) {
  const domain = store.shop_domain ?? "";
  const storeUrl = domain ? `https://${domain}` : null;

  return (
    <div className="group relative rounded-2xl border border-border bg-surface p-5 flex items-start gap-3">
      <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
        <ShoppingBag className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{store.name || domain}</div>
        {domain && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{domain}</div>
        )}
        {storeUrl && (
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3" /> Abrir loja
          </a>
        )}
      </div>
      <button
        onClick={onEdit}
        className="absolute top-3 right-3 size-7 rounded-md grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted text-muted-foreground hover:text-foreground"
        title="Editar nome"
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

function RenameStoreDialog({ store, onClose, onRenamed }: { store: any; onClose: () => void; onRenamed: () => void }) {
  const [name, setName] = useState(store?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const renameFn = useServerFn(renameShopifyStore);
  useEscapeToClose(onClose);

  const rename = useMutation({
    mutationFn: () => renameFn({ data: { id: store.id, name: name.trim() } }),
    onSuccess: onRenamed,
    onError: (e: any) => setError(e?.message ?? "Erro ao salvar"),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-popover border border-border shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-base font-semibold">Editar loja</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome da loja"
              className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50"
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Domínio e credenciais estão vinculados à autorização Shopify e não podem ser alterados aqui. Para trocá-los, reconecte a loja.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
          <button
            onClick={() => rename.mutate()}
            disabled={rename.isPending || !name.trim()}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

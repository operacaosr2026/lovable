import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/PageHeader";
import {
  Plus, ShoppingBag, ExternalLink, Pencil, Trash2, X, List, Layers, Search, Filter, ChevronDown, Store,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { listShopifyStores, renameShopifyStore, deleteShopifyStore } from "@/lib/shop-orders.functions";
import { listBoardColumns } from "@/lib/store-board.functions";
import { ConnectStoreDialog } from "@/components/shops/ShopIntegrations";
import { StoreBoard, columnTone, ToneIcon } from "@/components/shops/StoreBoard";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
  const confirm = useConfirm();
  const listFn = useServerFn(listShopifyStores);
  const deleteFn = useServerFn(deleteShopifyStore);
  const listColumnsFn = useServerFn(listBoardColumns);
  const [openConnect, setOpenConnect] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [connecting, setConnecting] = useState<any>(null);
  const [search, setSearch] = useState("");
  // Filtro por etapa (coluna da esteira); null = todas.
  const [columnFilter, setColumnFilter] = useState<string | null>(null);

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ["shopify-stores"],
    queryFn: () => listFn(),
  });

  const { data: columns = [] } = useQuery({
    queryKey: ["board-columns"],
    queryFn: () => listColumnsFn(),
  });
  const columnNameById = new Map((columns as any[]).map((c) => [c.id, c.name as string]));
  // Mesma ordem da Esteira: agrupado por coluna (na ordem das colunas) e,
  // dentro da coluna, pela posição do card — lojas órfãs (sem coluna válida)
  // caem na primeira coluna, igual ao StoreBoard.
  const columnIndexById = new Map((columns as any[]).map((c, i) => [c.id, i]));
  const q = search.trim().toLowerCase();
  const firstColumnId = (columns as any[])[0]?.id;
  const columnOf = (s: any) => (columnIndexById.has(s.board_column_id) ? s.board_column_id : firstColumnId);
  const sortedStores = [...stores].filter((s: any) =>
    (!q || `${s.name ?? ""} ${s.shop_domain ?? ""}`.toLowerCase().includes(q)) &&
    (!columnFilter || columnOf(s) === columnFilter),
  ).sort((a: any, b: any) => {
    const ca = columnIndexById.get(a.board_column_id) ?? 0;
    const cb = columnIndexById.get(b.board_column_id) ?? 0;
    if (ca !== cb) return ca - cb;
    return Number(a.board_position ?? 0) - Number(b.board_position ?? 0);
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shopify-stores"] }),
  });

  const handleDelete = (store: any) => {
    confirm(`Excluir "${store.name || store.shop_domain}"? Isso remove a loja do banco de lojas.`).then((ok) => {
      if (ok) remove.mutate(store.id);
    });
  };

  const connectedCount = stores.filter((s: any) => !s.is_placeholder).length;
  // KPIs: total + cada etapa menos a primeira (aquecimento), com % do total.
  const kpiColumns = (columns as any[]).slice(1);
  const countIn = (colId: string) => stores.filter((s: any) => columnOf(s) === colId).length;
  const filterLabel = columnFilter ? columnNameById.get(columnFilter) ?? "Todas as lojas" : "Todas as lojas";

  return (
    <PageShell fit wide>
      {/* ── Cabeçalho ── */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-4 min-w-0">
          <div className="size-14 rounded-2xl bg-gradient-to-br from-primary/80 to-primary text-primary-foreground grid place-items-center shrink-0 shadow-sm">
            <Store className="size-7" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Banco de Lojas</h1>
            <p className="text-sm text-muted-foreground">Gerencie suas lojas Shopify e acompanhe o status de cada uma.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar lojas..."
              className="h-11 w-60 pl-9 pr-3 rounded-xl border border-border bg-card text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex items-center rounded-xl border border-border bg-card p-1 h-11">
            <button
              onClick={() => navigate({ search: { view: "esteira" } })}
              className={`h-full px-4 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${view === "esteira" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Layers className="size-4" /> Esteira
            </button>
            <button
              onClick={() => navigate({ search: { view: "lista" } })}
              className={`h-full px-4 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${view === "lista" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="size-4" /> Lista
            </button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-11 w-52 px-3.5 rounded-xl border border-border bg-card text-sm flex items-center gap-2 hover:border-primary/40">
                <Filter className="size-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left truncate">{filterLabel}</span>
                <ChevronDown className="size-4 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuRadioGroup value={columnFilter ?? "all"} onValueChange={(v) => setColumnFilter(v === "all" ? null : v)}>
                <DropdownMenuRadioItem value="all">Todas as lojas</DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {(columns as any[]).map((c) => (
                  <DropdownMenuRadioItem key={c.id} value={c.id}>{c.name}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={() => setOpenConnect(true)}
            className="h-11 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2 shadow-sm hover:bg-primary/90"
          >
            <Plus className="size-4" /> Nova loja
          </button>
        </div>
      </div>

      {/* ── Resumo por etapa ── */}
      {!isLoading && stores.length > 0 && (
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${Math.min(kpiColumns.length + 1, 6)}, minmax(0, 1fr))` }}>
          <div className="rounded-2xl border border-border bg-card px-4 py-3.5 flex items-center gap-3 min-w-0">
            <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0"><Store className="size-5" /></div>
            <div className="min-w-0">
              <p className="text-xl font-bold leading-tight tabular-nums">{connectedCount}</p>
              <p className="text-sm text-muted-foreground truncate">Lojas conectadas</p>
            </div>
          </div>
          {kpiColumns.map((c) => {
            const tone = columnTone(c.name);
            const n = countIn(c.id);
            const pct = stores.length > 0 ? Math.round((n / stores.length) * 100) : 0;
            const pill = n === 0
              ? { cls: "bg-muted text-muted-foreground", Icon: Minus }
              : tone.trend === "up"
                ? { cls: "bg-emerald-500/10 text-emerald-600", Icon: ArrowUpRight }
                : { cls: "bg-rose-500/10 text-rose-600", Icon: ArrowDownRight };
            return (
              <button
                key={c.id}
                onClick={() => setColumnFilter(columnFilter === c.id ? null : c.id)}
                className={`rounded-2xl border bg-card px-4 py-3.5 flex items-center gap-3 min-w-0 text-left transition-colors ${columnFilter === c.id ? "border-primary/50 ring-1 ring-primary/30" : "border-border hover:border-primary/30"}`}
                title="Filtrar por esta etapa"
              >
                <div className={`size-11 rounded-full grid place-items-center shrink-0 ${tone.chip}`}><ToneIcon tone={tone} className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-bold leading-tight tabular-nums">{n}</p>
                  <p className="text-sm text-muted-foreground truncate">{c.name}</p>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${pill.cls}`}>
                  <pill.Icon className="size-3.5" /> {pct}%
                </span>
              </button>
            );
          })}
        </div>
      )}

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
        <StoreBoard onEditStore={(store) => setEditing(store)} search={search} columnFilter={columnFilter} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 content-start">
          {sortedStores.map((store: any) => (
            <StoreCard
              key={store.id}
              store={store}
              columnName={columnNameById.get(store.board_column_id) ?? null}
              onEdit={() => setEditing(store)}
              onDelete={() => handleDelete(store)}
            />
          ))}
          {sortedStores.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma loja encontrada.</p>}
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
          onDelete={() => {
            setEditing(null);
            handleDelete(editing);
          }}
          onConnect={() => {
            setConnecting(editing);
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

      {connecting && (
        <ConnectStoreDialog
          open={!!connecting}
          onClose={() => setConnecting(null)}
          initialName={connecting.name ?? ""}
          replacePlaceholderId={connecting.id}
          onConnected={() => {
            qc.invalidateQueries({ queryKey: ["shopify-stores"] });
            setConnecting(null);
          }}
        />
      )}
    </PageShell>
  );
}

function StoreCard({ store, columnName, onEdit, onDelete }: { store: any; columnName: string | null; onEdit: () => void; onDelete: () => void }) {
  const domain = store.shop_domain ?? "";
  const storeUrl = domain ? `https://${domain}` : null;

  return (
    <div className="group relative rounded-2xl border border-border bg-surface p-5 flex items-start gap-3">
      <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
        <ShoppingBag className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold truncate">{store.name || domain}</div>
          {columnName && (
            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
              {columnName}
            </span>
          )}
        </div>
        {store.is_placeholder ? (
          <span className="mt-1 inline-block text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
            Aguardando Shopify
          </span>
        ) : domain && (
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
      <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground hover:text-foreground"
          title="Editar nome"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="size-7 rounded-md grid place-items-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          title="Excluir loja"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function RenameStoreDialog({ store, onClose, onRenamed, onDelete, onConnect }: { store: any; onClose: () => void; onRenamed: () => void; onDelete: () => void; onConnect: () => void }) {
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
          <div className="text-base font-semibold">{store.is_placeholder ? "Loja para produzir" : "Editar loja"}</div>
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
          {store.is_placeholder ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Essa loja ainda não existe na Shopify. Quando criá-la lá, conecte aqui os dados (domínio, Client ID e Client Secret) para ela virar uma loja de verdade nesta mesma coluna.
              </p>
              <button
                onClick={onConnect}
                className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
              >
                Conectar na Shopify
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Domínio e credenciais estão vinculados à autorização Shopify e não podem ser alterados aqui. Para trocá-los, reconecte a loja.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onDelete}
            className="h-9 px-3 rounded-lg text-sm text-destructive hover:bg-destructive/10 flex items-center gap-1.5"
          >
            <Trash2 className="size-3.5" /> Excluir loja
          </button>
          <div className="flex gap-2">
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
    </div>
  );
}

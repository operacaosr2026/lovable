import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Link2, Loader2, Search, Sparkles, Store } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getProductSync, listStoreShopifyProducts, setProductShopifyLink, type LooseLineItem, type StoreShopifyProduct } from "@/lib/product-links.functions";

// Botão "Sincronizar Card" + status (lojas com produto ligado / lojas ativas).
export function ProductSyncCard({ productId, productName }: { productId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const getSync = useServerFn(getProductSync);
  const { data } = useQuery({ queryKey: ["product-sync", productId], queryFn: () => getSync({ data: { product_id: productId } }) });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
      >
        <Link2 className="size-4" /> Sincronizar Card
      </button>
      {data && <SyncStatus linked={data.linked} total={data.total} />}
      {open && <SyncDialog productId={productId} productName={productName} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SyncStatus({ linked, total }: { linked: number; total: number }) {
  if (!total) return <span className="text-xs text-muted-foreground">Nenhuma loja ativa conectada</span>;
  const pct = Math.round((linked / total) * 100);
  const tone = linked === total ? "bg-success" : linked === 0 ? "bg-destructive" : "bg-warning";
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums font-medium">{linked} de {total} lojas</span>
      <span className="text-muted-foreground tabular-nums">({pct}%)</span>
    </div>
  );
}

function SyncDialog({ productId, productName, onClose }: { productId: string; productName: string; onClose: () => void }) {
  const getSync = useServerFn(getProductSync);
  const { data, isLoading } = useQuery({ queryKey: ["product-sync", productId], queryFn: () => getSync({ data: { product_id: productId } }) });
  const [openStore, setOpenStore] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogTitle>Sincronizar card · {productName}</DialogTitle>
        <p className="text-sm text-muted-foreground -mt-1">
          Em cada loja, marque os produtos da Shopify (e os itens sem produto) que são este card. Os pedidos deles entram no custo, nas vendas e nos dashboards deste produto.
        </p>
        {isLoading || !data ? (
          <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : data.stores.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Nenhuma loja ativa conectada à Shopify.</div>
        ) : (
          <div className="space-y-2">
            {data.stores.map((s) => (
              <StoreRow
                key={s.id}
                productId={productId}
                store={s}
                open={openStore === s.id}
                onToggle={() => setOpenStore(openStore === s.id ? null : s.id)}
              />
            ))}
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">Concluir</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SyncStore = { id: string; name: string; active: boolean; links: { shopify_product_id: string | null; title: string | null }[] };

function StoreRow({ productId, store, open, onToggle }: { productId: string; store: SyncStore; open: boolean; onToggle: () => void }) {
  const n = store.links.length;
  return (
    <div className="rounded-xl border border-border">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-2 px-3 h-11 text-left">
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        <Store className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate">{store.name}</span>
        {!store.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">fora das Ativas</span>}
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-md ${n ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
          {n ? `${n} produto${n === 1 ? "" : "s"}` : "Sem produto"}
        </span>
      </button>
      {!open && n > 0 && (
        <div className="px-10 pb-2 -mt-1 text-xs text-muted-foreground truncate">
          {store.links.map((l) => l.title || `#${l.shopify_product_id ?? "?"}`).join(" · ")}
        </div>
      )}
      {open && <StoreProducts productId={productId} storeId={store.id} />}
    </div>
  );
}

function StoreProducts({ productId, storeId }: { productId: string; storeId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listFn = useServerFn(listStoreShopifyProducts);
  const setFn = useServerFn(setProductShopifyLink);
  const [search, setSearch] = useState("");
  const key = ["store-shopify-products", productId, storeId];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { product_id: productId, shopify_store_id: storeId } }),
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: (r: SyncRow & { linked: boolean }) => setFn({ data: {
      product_id: productId, shopify_store_id: storeId, ...r.target, title: r.title, linked: r.linked,
    } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["product-sync"] });
      qc.invalidateQueries({ queryKey: ["store-shopify-products"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onCheck = async (r: SyncRow) => {
    const mine = r.linked_to?.product_id === productId;
    if (!mine && r.linked_to) {
      const ok = await confirm({
        title: "Trocar de card?",
        description: `"${r.title}" está ligado ao card "${r.linked_to.name}". Os pedidos dele passam a contar neste card.`,
        confirmText: "Trocar",
      });
      if (!ok) return;
    }
    toggle.mutate({ ...r, linked: !mine });
  };

  const { products, loose } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (r: SyncRow) => !q || r.title.toLowerCase().includes(q);
    return {
      products: (data?.products ?? []).map(productRow).filter(match),
      loose: (data?.loose ?? []).map(looseRow).filter(match),
    };
  }, [data, search]);

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  if (error) return <div className="px-3 pb-3 text-sm text-destructive">{(error as Error).message}</div>;

  const row = (r: SyncRow) => {
    const mine = r.linked_to?.product_id === productId;
    const busy = toggle.isPending && toggle.variables?.key === r.key;
    return (
      <label key={r.key} className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-muted ${mine ? "bg-primary/5" : ""}`}>
        {busy
          ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
          : <input type="checkbox" checked={mine} onChange={() => onCheck(r)} disabled={toggle.isPending} className="size-4 accent-primary" />}
        {r.image !== undefined && (r.image
          ? <img src={r.image} alt="" className="size-8 rounded-md object-cover border border-border" />
          : <div className="size-8 rounded-md bg-muted" />)}
        <span className="text-sm flex-1 min-w-0 truncate">{r.title}</span>
        {r.badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap">{r.badge}</span>}
        {r.suggested && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-info/10 text-info"><Sparkles className="size-3" /> Sugerido</span>}
        {r.linked_to && !mine && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning truncate max-w-40">No card: {r.linked_to.name}</span>}
      </label>
    );
  };

  return (
    <div className="px-3 pb-3 space-y-2">
      <div className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-background border border-border">
        <Search className="size-3.5 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto da loja" className="flex-1 bg-transparent text-sm outline-none" />
      </div>
      <div className="max-h-72 overflow-y-auto space-y-0.5">
        {products.length === 0 && <div className="text-xs text-muted-foreground py-3 text-center">Nenhum produto.</div>}
        {products.map(row)}
      </div>
      {loose.length > 0 && (
        <div className="pt-1">
          <div className="text-xs font-medium">Itens sem produto na Shopify</div>
          <div className="text-xs text-muted-foreground mb-1">Produto apagado da loja, item avulso ou de app — liga pelo título exato do item no pedido.</div>
          <div className="max-h-56 overflow-y-auto space-y-0.5">{loose.map(row)}</div>
        </div>
      )}
    </div>
  );
}

type SyncRow = {
  key: string; title: string; image?: string | null; badge: string | null;
  linked_to: StoreShopifyProduct["linked_to"]; suggested: boolean;
  target: { shopify_product_id: string } | { line_item_title: string };
};

const productRow = (p: StoreShopifyProduct): SyncRow => ({
  key: `p:${p.id}`, title: p.title, image: p.image, linked_to: p.linked_to, suggested: p.suggested,
  badge: p.status === "active" ? null : p.status === "draft" ? "Rascunho" : "Arquivado",
  target: { shopify_product_id: p.id },
});

const looseRow = (l: LooseLineItem): SyncRow => ({
  key: `t:${l.line_item_title}`, title: l.title, linked_to: l.linked_to, suggested: l.suggested,
  badge: `${l.orders} pedido${l.orders === 1 ? "" : "s"}`,
  target: { line_item_title: l.line_item_title },
});

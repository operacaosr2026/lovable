import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { Plus, ShoppingBag, ExternalLink, Store, Users } from "lucide-react";
import { listShopifyStores } from "@/lib/shop-orders.functions";
import { ConnectStoreDialog } from "@/components/shops/ShopIntegrations";
import { GruposPanel } from "@/components/shops/GruposPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Tab = "lojas" | "grupos";

export const Route = createFileRoute("/shops/banco-de-lojas/")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab === "grupos" ? "grupos" : "lojas") as Tab,
  }),
  component: BancoDeLojasIndex,
});

function BancoDeLojasIndex() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listShopifyStores);
  const [openConnect, setOpenConnect] = useState(false);

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ["shopify-stores"],
    queryFn: () => listFn(),
  });

  return (
    <PageShell>
      <PageHeader title="Banco de Lojas" subtitle="Repositório de lojas e grupos para referência e análise." />

      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as Tab } })}>
        <TabsList>
          <TabsTrigger value="lojas" className="flex items-center gap-1.5">
            <Store className="size-3.5" /> Lojas
          </TabsTrigger>
          <TabsTrigger value="grupos" className="flex items-center gap-1.5">
            <Users className="size-3.5" /> Grupos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lojas" className="pt-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm text-muted-foreground">
              {isLoading ? "Carregando..." : `${stores.length} ${stores.length === 1 ? "loja conectada" : "lojas conectadas"}`}
            </p>
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
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {stores.map((store: any) => (
                <StoreCard key={store.id} store={store} />
              ))}
            </div>
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
        </TabsContent>

        <TabsContent value="grupos" className="pt-4">
          <GruposPanel />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function StoreCard({ store }: { store: any }) {
  const domain = store.shop_domain ?? "";
  const storeUrl = domain ? `https://${domain}` : null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 flex items-start gap-3">
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
    </div>
  );
}

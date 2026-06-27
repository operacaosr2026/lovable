import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  syncShopifyOrders, syncShopifyPayouts, recomputeRange, getOrderSettings,
} from "@/lib/shop-orders.functions";
import { getMetaAdsIntegration, getMetaToken } from "@/lib/meta-ads.functions";
import { updateLgCardMetaShop } from "@/lib/lg-cards.functions";
import { MetaAdsIntegrationDialog } from "@/components/shops/MetaAdsIntegration";
import { Track123IntegrationDialog } from "@/components/shops/Track123Integration";
import { getTrack123Integration } from "@/lib/track123.functions";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Sparkles, Megaphone, Webhook,
  CheckCircle2, AlertCircle, Settings2, ChevronDown, Store,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ShopStub = { id: string; name: string };

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}
const PROCESSING_DELAY_DAYS = 7;

// ─── Sync all shops section ───────────────────────────────────────────────────

function SyncAllSection({ shops }: { shops: ShopStub[] }) {
  const qc          = useQueryClient();
  const syncFn      = useServerFn(syncShopifyOrders);
  const syncPayFn   = useServerFn(syncShopifyPayouts);
  const recompFn    = useServerFn(recomputeRange);
  const getSettFn   = useServerFn(getOrderSettings);

  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const syncAll = async () => {
    if (shops.length === 0) return;
    setSyncing(true);
    let totalOrders = 0;
    let totalPayouts = 0;
    try {
      for (const shop of shops) {
        setProgress(`Sincronizando ${shop.name}...`);
        const today    = isoDate(new Date());
        const settings = await getSettFn({ data: { shop_id: shop.id } }).catch(() => null);
        const cutoff   = (settings as any)?.cashflow_start_date as string | null | undefined;
        const since    = cutoff && cutoff > addDays(today, -30) ? cutoff : addDays(today, -30);
        const r        = await syncFn({ data: { shop_id: shop.id, since_date: since } }).catch(() => ({ synced: 0 }));
        const futureTo = addDays(today, PROCESSING_DELAY_DAYS + 1);
        await recompFn({ data: { shop_id: shop.id, from_processing: addDays(since, PROCESSING_DELAY_DAYS), to_processing: futureTo } }).catch(() => null);
        const payouts  = await syncPayFn({ data: { shop_id: shop.id, since_days: 365 } }).catch(() => ({ synced: 0 }));
        totalOrders  += (r as any).synced ?? 0;
        totalPayouts += (payouts as any).synced ?? 0;
      }
      qc.invalidateQueries({ queryKey: ["lg-orders"] });
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
      toast.success(`Sincronização concluída · ${totalOrders} pedidos · ${totalPayouts} depósitos`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao sincronizar");
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-surface to-surface/40 p-6 flex items-start gap-5 flex-wrap">
      <div className="size-12 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
        <Sparkles className="size-6" />
      </div>
      <div className="flex-1 min-w-[260px]">
        <div className="text-base font-semibold">Sincronizar dados da Shopify</div>
        <p className="text-sm text-muted-foreground mt-1">
          Atualiza pedidos, payouts e métricas de todas as {shops.length === 1 ? "loja" : `${shops.length} lojas`} conectadas.
          Não altera configurações manuais.
        </p>
        {syncing && progress && (
          <p className="text-xs text-primary mt-2 flex items-center gap-1.5">
            <RefreshCw className="size-3 animate-spin" /> {progress}
          </p>
        )}
      </div>
      <div className="w-full md:w-auto">
        <Button onClick={syncAll} disabled={syncing || shops.length === 0}>
          {syncing
            ? <RefreshCw className="size-4 animate-spin" />
            : <RefreshCw className="size-4" />}
          {syncing ? "Sincronizando..." : "Sincronizar todas"}
        </Button>
      </div>
    </div>
  );
}

// ─── Track 123 per shop ───────────────────────────────────────────────────────

function Track123Section({ shop }: { shop: ShopStub }) {
  const getTrackFn = useServerFn(getTrack123Integration);
  const [open, setOpen] = useState(false);

  const track = useQuery({
    queryKey: ["track123-integration", shop.id],
    queryFn:  () => getTrackFn({ data: { shop_id: shop.id } }),
  });

  const configured = Boolean(track.data?.configured);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="size-11 rounded-xl bg-muted/50 grid place-items-center shrink-0">
          <Webhook className="size-5 text-foreground" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">Track123</span>
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border",
              configured
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30"
                : "bg-muted text-muted-foreground border-border"
            )}>
              {configured ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
              {configured ? "Conectado" : "Não conectado"}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
              {shop.name}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Rastreamento de encomendas e notificações automáticas</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Settings2 className="size-4" /> {configured ? "Configurar" : "Conectar"}
        </Button>
      </div>

      {open && (
        <Track123IntegrationDialog shopId={shop.id} open={open} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

// ─── Meta Ads (card level) ────────────────────────────────────────────────────

function MetaAdsSection({
  cardId, card, shops,
}: { cardId: string; card: any; shops: ShopStub[] }) {
  const qc             = useQueryClient();
  const updateMetaFn   = useServerFn(updateLgCardMetaShop);
  const getMetaAdsFn   = useServerFn(getMetaAdsIntegration);
  const getMetaTokenFn = useServerFn(getMetaToken);

  const [openDialog,  setOpenDialog]  = useState(false);
  const [openPicker,  setOpenPicker]  = useState(false);
  const [saving,      setSaving]      = useState(false);

  const metaShopId = card?.meta_shop_id as string | null;
  const metaShop   = shops.find((s) => s.id === metaShopId);

  const metaAds = useQuery({
    queryKey: ["meta-ads-integration", metaShopId],
    queryFn:  () => getMetaAdsFn({ data: { shop_id: metaShopId! } }),
    enabled:  Boolean(metaShopId),
  });
  const metaToken = useQuery({
    queryKey: ["meta-token", metaShopId],
    queryFn:  () => getMetaTokenFn({ data: { shop_id: metaShopId! } }),
    enabled:  Boolean(metaShopId),
  });

  const connected   = Boolean(metaToken.data?.connected || metaAds.data?.configured);
  const statusLabel = connected
    ? (metaToken.data?.fb_user_name || (metaAds.data as any)?.account_name || "Conectado")
    : "Não conectado";

  const selectShop = async (shopId: string) => {
    setSaving(true);
    try {
      await updateMetaFn({ data: { id: cardId, meta_shop_id: shopId } });
      qc.invalidateQueries({ queryKey: ["lg-card", cardId] });
      setOpenPicker(false);
      toast.success("Loja de anúncios atualizada");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 space-y-4">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="size-11 rounded-xl bg-muted/50 grid place-items-center shrink-0">
          <Megaphone className="size-5 text-foreground" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">Meta Ads</span>
            {metaShopId ? (
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border",
                connected
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30"
                  : "bg-muted text-muted-foreground border-border"
              )}>
                {connected ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
                {statusLabel}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border bg-amber-500/10 text-amber-600 border-amber-500/30">
                <AlertCircle className="size-3" /> Loja não selecionada
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">card</span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gasto de campanhas sincronizado automaticamente.
            {metaShop && <span className="text-primary"> Via: {metaShop.name}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {shops.length > 1 && (
            <Button size="sm" variant="outline" onClick={() => setOpenPicker((o) => !o)}>
              <Store className="size-4" />
              {metaShop ? "Trocar loja" : "Selecionar loja"}
              <ChevronDown className="size-3" />
            </Button>
          )}
          {metaShopId && (
            <Button size="sm" variant="outline" onClick={() => setOpenDialog(true)}>
              <Settings2 className="size-4" /> {connected ? "Configurar" : "Conectar"}
            </Button>
          )}
        </div>
      </div>

      {/* Shop picker inline */}
      {openPicker && (
        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30">
            Qual loja gerencia os anúncios para este card?
          </div>
          {shops.map((shop) => (
            <button
              key={shop.id}
              onClick={() => selectShop(shop.id)}
              disabled={saving}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-muted/50 transition-colors",
                shop.id === metaShopId && "bg-primary/5 text-primary font-medium"
              )}
            >
              <Store className="size-3.5 text-muted-foreground shrink-0" />
              {shop.name}
              {shop.id === metaShopId && <CheckCircle2 className="size-3.5 ml-auto text-primary" />}
            </button>
          ))}
        </div>
      )}

      {/* If only 1 shop and no meta_shop_id, auto-select it */}
      {shops.length === 1 && !metaShopId && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => selectShop(shops[0].id)}
          disabled={saving}
        >
          <Store className="size-4" /> Usar {shops[0].name} para anúncios
        </Button>
      )}

      {openDialog && metaShopId && (
        <MetaAdsIntegrationDialog
          shopId={metaShopId}
          open={openDialog}
          onClose={() => setOpenDialog(false)}
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LgIntegrations({
  cardId,
  card,
  shops,
}: {
  cardId: string;
  card:   any;
  shops:  ShopStub[];
}) {
  return (
    <div className="space-y-6">
      {/* 1. Sync all */}
      <SyncAllSection shops={shops} />

      {/* 2. Meta Ads (card level) */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Anúncios</p>
        <MetaAdsSection cardId={cardId} card={card} shops={shops} />
      </div>

      {/* 3. Track 123 (per shop) */}
      {shops.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Track 123</p>
          <div className="space-y-3">
            {shops.map((shop) => (
              <Track123Section key={shop.id} shop={shop} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

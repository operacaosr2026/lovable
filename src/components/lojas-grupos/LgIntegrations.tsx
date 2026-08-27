import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  syncShopifyOrders, syncShopifyPayouts, recomputeRange, getOrderSettings, upsertOrderSettings,
} from "@/lib/shop-orders.functions";
import { getConnectedMetaAdAccounts, getMetaToken } from "@/lib/meta-ads.functions";
import { MetaAdsIntegrationDialog } from "@/components/shops/MetaAdsIntegration";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Sparkles, Megaphone, CalendarClock,
  CheckCircle2, AlertCircle, Settings2, Info, ChevronDown, ChevronUp, Check,
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

// ─── Sync cutoff date per shop ─────────────────────────────────────────────────

function SyncCutoffRow({ shop }: { shop: ShopStub }) {
  const qc = useQueryClient();
  const getSettFn = useServerFn(getOrderSettings);
  const upsertFn = useServerFn(upsertOrderSettings);

  const settings = useQuery({
    queryKey: ["order-settings", shop.id],
    queryFn: () => getSettFn({ data: { shop_id: shop.id } }),
  });

  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (settings.data as any)?.cashflow_start_date ?? "";

  const saveMut = useMutation({
    mutationFn: (date: string | null) => upsertFn({ data: { shop_id: shop.id, patch: { cashflow_start_date: date } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order-settings", shop.id] });
      toast.success("Data de início atualizada");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="size-7 rounded-lg bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">
        {shop.name?.[0]?.toUpperCase()}
      </div>
      <span className="text-sm text-foreground flex-1 truncate">{shop.name}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          type="date"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 rounded-lg border border-border bg-card text-foreground text-xs px-2 focus:outline-none focus:border-primary"
        />
        {value && (
          <button
            onClick={() => { setDraft(""); saveMut.mutate(null); }}
            className="text-xs text-muted-foreground hover:text-destructive px-1"
            title="Remover data de corte"
          >
            limpar
          </button>
        )}
        <button
          onClick={() => saveMut.mutate(value || null)}
          disabled={saveMut.isPending}
          className="size-7 rounded-lg bg-primary grid place-items-center text-primary-foreground disabled:opacity-50"
        >
          {saveMut.isPending
            ? <div className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <Check className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

function SyncCutoffSection({ shops }: { shops: ShopStub[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <CalendarClock className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground flex-1">Início da sincronização por loja</span>
        <span className="text-xs text-muted-foreground mr-2">Ignora pedidos anteriores à data</span>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border">
          {shops.map((shop) => <SyncCutoffRow key={shop.id} shop={shop} />)}
          <div className="px-5 py-2">
            <p className="text-[11px] text-muted-foreground">
              A partir da data definida, apenas pedidos e depósitos com essa data ou posterior são sincronizados. Deixe em branco para sincronizar normalmente (últimos 30 dias a cada sincronização).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Meta Ads (card level — uses matriz_shop_id automatically) ────────────────

function MetaAdsSection({
  cardId, card, shops,
}: { cardId: string; card: any; shops: ShopStub[] }) {
  const getAccountsFn  = useServerFn(getConnectedMetaAdAccounts);
  const getMetaTokenFn = useServerFn(getMetaToken);
  const [openDialog, setOpenDialog] = useState(false);

  const matrizShopId = card?.matriz_shop_id as string | null;
  const matrizShop   = shops.find((s) => s.id === matrizShopId);

  const accountsQuery = useQuery({
    queryKey: ["meta-ad-accounts", matrizShopId],
    queryFn:  () => getAccountsFn({ data: { shop_id: matrizShopId! } }),
    enabled:  Boolean(matrizShopId),
  });
  const metaToken = useQuery({
    queryKey: ["meta-token", matrizShopId],
    queryFn:  () => getMetaTokenFn({ data: { shop_id: matrizShopId! } }),
    enabled:  Boolean(matrizShopId),
  });

  const accounts    = accountsQuery.data?.accounts ?? [];
  const connected   = Boolean(metaToken.data?.connected) && accounts.length > 0;
  const statusLabel = connected
    ? (accounts.length === 1 ? (accounts[0].account_name ?? "Conectado") : `${accounts.length} contas conectadas`)
    : "Não conectado";

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="size-11 rounded-xl bg-muted/50 grid place-items-center shrink-0">
          <Megaphone className="size-5 text-foreground" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">Meta Ads</span>
            {matrizShopId ? (
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
                <AlertCircle className="size-3" /> Sem loja matriz
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">card</span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gasto de campanhas sincronizado automaticamente.
            {matrizShop && <span className="text-primary"> Via: {matrizShop.name}</span>}
          </p>
        </div>
        {matrizShopId && (
          <Button size="sm" variant="outline" onClick={() => setOpenDialog(true)}>
            <Settings2 className="size-4" /> {connected ? "Configurar" : "Conectar"}
          </Button>
        )}
      </div>

      {!matrizShopId && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <Info className="size-4 shrink-0 mt-0.5" />
          Configure a <strong>Loja Matriz</strong> no editor do card para conectar o Meta Ads.
          A loja matriz é a que gerencia os anúncios e recebe o tráfego.
        </div>
      )}

      {openDialog && matrizShopId && (
        <MetaAdsIntegrationDialog
          shopId={matrizShopId}
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

      {/* 1b. Sync cutoff date per shop */}
      {shops.length > 0 && <SyncCutoffSection shops={shops} />}

      {/* 2. Meta Ads (card level) */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Anúncios</p>
        <MetaAdsSection cardId={cardId} card={card} shops={shops} />
      </div>

    </div>
  );
}

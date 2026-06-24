import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getOrderSettings, syncShopifyOrders, syncShopifyPayouts, recomputeRange,
  startShopifyOAuth, listShopifyStores,
} from "@/lib/shop-orders.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, RefreshCw, Sparkles, Webhook, CheckCircle2, AlertCircle, Settings2, Plug,
} from "lucide-react";
import { toast } from "sonner";
import { Track123IntegrationDialog } from "./Track123Integration";
import { getTrack123Integration } from "@/lib/track123.functions";

const PROCESSING_DELAY_DAYS = 7;
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}

export function ShopIntegrations({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const getSettingsFn = useServerFn(getOrderSettings);
  const syncFn = useServerFn(syncShopifyOrders);
  const syncPayoutsFn = useServerFn(syncShopifyPayouts);
  const recomputeRangeFn = useServerFn(recomputeRange);

  const settings = useQuery({
    queryKey: ["order-settings", shopId],
    queryFn: () => getSettingsFn({ data: { shop_id: shopId } }),
  });

  const [openTrack123, setOpenTrack123] = useState(false);

  const isConnected = Boolean(settings.data?.shopify_store_id);

  const getTrack123Fn = useServerFn(getTrack123Integration);
  const track123 = useQuery({
    queryKey: ["track123-integration", shopId],
    queryFn: () => getTrack123Fn({ data: { shop_id: shopId } }),
  });
  const track123Connected = Boolean(track123.data?.configured);

  const syncAll = useMutation({
    mutationFn: async () => {
      const today = isoDate(new Date());
      const cutoff = settings.data?.cashflow_start_date as string | null | undefined;
      const sinceDate = cutoff && cutoff > addDays(today, -30) ? cutoff : addDays(today, -30);
      const r = await syncFn({ data: { shop_id: shopId, since_date: sinceDate } });
      const futureTo = addDays(today, PROCESSING_DELAY_DAYS + 1);
      await recomputeRangeFn({ data: { shop_id: shopId, from_processing: addDays(sinceDate, PROCESSING_DELAY_DAYS), to_processing: futureTo } });
      const payouts = await syncPayoutsFn({ data: { shop_id: shopId, since_days: 365 } });
      return { ...r, payouts: payouts.synced };
    },
    onSuccess: (r) => {
      toast.success(`Loja sincronizada · ${r.synced} pedidos · ${r.payouts} depósitos`);
      qc.invalidateQueries({ queryKey: ["orders", shopId] });
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
      qc.invalidateQueries({ queryKey: ["shop-profit-goal-stats", shopId] });
      qc.invalidateQueries({ queryKey: ["order-settings", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* Hero — sync action */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-surface to-surface/40 p-6 flex items-start gap-5 flex-wrap">
        <div className="size-12 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
          <Sparkles className="size-6" />
        </div>
        <div className="flex-1 min-w-[260px]">
          <div className="text-base font-semibold">Sincronizar dados da loja</div>
          <p className="text-sm text-muted-foreground mt-1">
            Atualiza pedidos e métricas vindos do Shopify. Não altera metas nem configurações manuais.
          </p>
        </div>
        <Button onClick={() => syncAll.mutate()} disabled={syncAll.isPending || !isConnected} size="lg" className="gap-2">
          {syncAll.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sincronizar dados da loja
        </Button>
      </div>

      {/* Track123 */}
      <IntegrationCard
        icon={Webhook}
        title="Track123"
        subtitle="Rastreamento logístico automatizado por webhook"
        status={track123Connected ? "connected" : "disconnected"}
        statusLabel={track123Connected ? "Conectado" : "Não conectado"}
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpenTrack123(true)}>
            <Settings2 className="size-4" /> {track123Connected ? "Configurar" : "Conectar"}
          </Button>
        </div>
      </IntegrationCard>

      {openTrack123 && (
        <Track123IntegrationDialog
          shopId={shopId}
          open={openTrack123}
          onClose={() => setOpenTrack123(false)}
        />
      )}
    </div>
  );
}

export function ConnectStoreDialog({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected?: (s: any) => void }) {
  const startOAuth = useServerFn(startShopifyOAuth);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const m = useMutation({
    mutationFn: () => startOAuth({ data: {
      name: name.trim(),
      shop_domain: domain.trim(),
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
    } }),
    onSuccess: (r: any) => { if (r?.url) window.location.href = r.url; },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Conectar loja Shopify</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Como obter as credenciais:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Na sua loja Shopify, vá em <strong>Settings → Apps and sales channels → Develop apps</strong>.</li>
              <li>Crie um app, abra a aba <strong>Configuration</strong> e cole esta URL em <strong>Allowed redirection URL(s)</strong>:</li>
            </ol>
            <code className="block bg-background rounded px-2 py-1 text-[11px] break-all">
              https://lojas-one.vercel.app/api/public/shopify/callback
            </code>
            <p>Em <strong>Admin API access scopes</strong>, marque:</p>
            <code className="block bg-background rounded px-2 py-1 text-[11px] break-all">read_orders,read_products,read_shopify_payments_payouts</code>
            <p>Salve, vá em <strong>API credentials</strong> e copie <strong>Client ID</strong> e <strong>Client secret</strong>.</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Minha loja" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Domínio</label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="minha-loja.myshopify.com" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Client ID</label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ex: 1a2b3c4d..." />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Client Secret</label>
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="shpss_..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => m.mutate()}
            disabled={m.isPending || !name.trim() || !domain.trim() || !clientId.trim() || !clientSecret.trim()}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />} Autorizar na Shopify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationCard({ icon: Icon, title, subtitle, status, statusLabel, children }: any) {
  const connected = status === "connected";
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="size-11 rounded-xl bg-muted/50 text-foreground grid place-items-center shrink-0">
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold">{title}</div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${connected ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}>
              {connected ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
              {statusLabel}
            </span>
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>
        </div>
        <div className="w-full md:w-auto">{children}</div>
      </div>
    </div>
  );
}

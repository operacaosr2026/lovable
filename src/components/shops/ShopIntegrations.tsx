import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getOrderSettings, upsertOrderSettings, listShopifyStores, startShopifyOAuth,
  syncShopifyOrders, syncShopifyPayouts, recomputeRange,
} from "@/lib/shop-orders.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Loader2, RefreshCw, Plug, ShoppingBag, CheckCircle2, AlertCircle,
  Webhook, Sparkles, Settings2, Mail, Megaphone,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Track123IntegrationDialog } from "./Track123Integration";
import { getTrack123Integration } from "@/lib/track123.functions";
import { listInboxes, upsertInbox, testInboxConnection, deleteInbox } from "@/lib/support.functions";
import { MetaAdsIntegrationDialog } from "./MetaAdsIntegration";
import { getMetaAdsIntegration, syncMetaAdsSpend, syncMetaAdsActivities } from "@/lib/meta-ads.functions";

const PROCESSING_DELAY_DAYS = 7;
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}

export function ShopIntegrations({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const getSettingsFn = useServerFn(getOrderSettings);
  const listStoresFn = useServerFn(listShopifyStores);
  const syncFn = useServerFn(syncShopifyOrders);
  const syncPayoutsFn = useServerFn(syncShopifyPayouts);
  const recomputeRangeFn = useServerFn(recomputeRange);

  const settings = useQuery({ queryKey: ["order-settings", shopId], queryFn: () => getSettingsFn({ data: { shop_id: shopId } }) });
  const stores = useQuery({ queryKey: ["shopify-stores"], queryFn: () => listStoresFn() });

  const [openSettings, setOpenSettings] = useState(false);
  const [openConnect, setOpenConnect] = useState(false);
  const [openTrack123, setOpenTrack123] = useState(false);

  const linkedStore = (stores.data ?? []).find((s: any) => s.id === settings.data?.shopify_store_id);
  const isConnected = Boolean(linkedStore);

  const getTrack123Fn = useServerFn(getTrack123Integration);
  const track123 = useQuery({
    queryKey: ["track123-integration", shopId],
    queryFn: () => getTrack123Fn({ data: { shop_id: shopId } }),
  });
  const track123Connected = Boolean(track123.data?.configured);

  const getMetaAdsFn = useServerFn(getMetaAdsIntegration);
  const syncMetaAdsFn = useServerFn(syncMetaAdsSpend);
  const syncMetaAdsActivitiesFn = useServerFn(syncMetaAdsActivities);
  const metaAds = useQuery({
    queryKey: ["meta-ads-integration", shopId],
    queryFn: () => getMetaAdsFn({ data: { shop_id: shopId } }),
  });
  const metaAdsConnected = Boolean(metaAds.data?.configured);

  const syncAll = useMutation({
    mutationFn: async () => {
      const r = await syncFn({ data: { shop_id: shopId, since_days: 30 } });
      const today = isoDate(new Date());
      const from = addDays(today, -30);
      const futureTo = addDays(today, PROCESSING_DELAY_DAYS + 1);
      await recomputeRangeFn({ data: { shop_id: shopId, from_processing: addDays(from, PROCESSING_DELAY_DAYS), to_processing: futureTo } });
      const payouts = await syncPayoutsFn({ data: { shop_id: shopId, since_days: 365 } });
      if (metaAdsConnected) {
        await syncMetaAdsFn({ data: { shop_id: shopId } });
        await syncMetaAdsActivitiesFn({ data: { shop_id: shopId } });
      }
      return { ...r, payouts: payouts.synced };
    },
    onSuccess: (r) => {
      toast.success(`Loja sincronizada · ${r.synced} pedidos · ${r.payouts} depósitos`);
      qc.invalidateQueries({ queryKey: ["orders", shopId] });
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
      qc.invalidateQueries({ queryKey: ["shop-profit-goal-stats", shopId] });
      qc.invalidateQueries({ queryKey: ["order-settings", shopId] });
      qc.invalidateQueries({ queryKey: ["meta-ads-integration", shopId] });
      qc.invalidateQueries({ queryKey: ["meta-ads-metrics", shopId] });
      qc.invalidateQueries({ queryKey: ["shop-wiki", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [openMetaAds, setOpenMetaAds] = useState(false);

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
            Atualiza pedidos, produtos e métricas vindos das integrações conectadas (Shopify, etc).
            Não altera metas nem configurações manuais.
          </p>
        </div>
        <Button onClick={() => syncAll.mutate()} disabled={syncAll.isPending || !isConnected} size="lg" className="gap-2">
          {syncAll.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sincronizar dados da loja
        </Button>
      </div>

      {/* Shopify */}
      <IntegrationCard
        icon={ShoppingBag}
        title="Shopify"
        subtitle="Pedidos, produtos e receita da sua loja"
        status={isConnected ? "connected" : "disconnected"}
        statusLabel={isConnected ? (linkedStore?.name || linkedStore?.shop_domain) : "Não conectado"}
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpenConnect(true)}>
            <Plug className="size-4" /> {isConnected ? "Conectar outra loja" : "Conectar loja"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpenSettings(true)}>
            <Settings2 className="size-4" /> Configurações
          </Button>
        </div>
      </IntegrationCard>

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

      {/* Zoho Mail (Atendimento) */}
      <ZohoMailIntegrationCard shopId={shopId} />

      {/* Meta Ads */}
      <IntegrationCard
        icon={Megaphone}
        title="Meta Ads"
        subtitle="Gasto de campanhas sincronizado automaticamente no Caixa"
        status={metaAdsConnected ? "connected" : "disconnected"}
        statusLabel={metaAdsConnected ? (metaAds.data?.account_name || "Conectado") : "Não conectado"}
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpenMetaAds(true)}>
            <Settings2 className="size-4" /> {metaAdsConnected ? "Configurar" : "Conectar"}
          </Button>
        </div>
      </IntegrationCard>

      {openMetaAds && (
        <MetaAdsIntegrationDialog
          shopId={shopId}
          open={openMetaAds}
          onClose={() => setOpenMetaAds(false)}
        />
      )}

      {openSettings && settings.data && (
        <SettingsDialog
          shopId={shopId}
          open={openSettings}
          onClose={() => setOpenSettings(false)}
          settings={settings.data}
          stores={stores.data ?? []}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["order-settings", shopId] }); }}
        />
      )}
      {openConnect && (
        <ConnectStoreDialog
          open={openConnect}
          onClose={() => setOpenConnect(false)}
          onConnected={() => { qc.invalidateQueries({ queryKey: ["shopify-stores"] }); }}
        />
      )}
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

// ===== Zoho Mail (Atendimento) =====

function ZohoMailIntegrationCard({ shopId }: { shopId: string }) {
  const _listInboxes = useServerFn(listInboxes);
  const inboxesQ = useQuery({ queryKey: ["support", "inboxes"], queryFn: () => _listInboxes() });
  const [open, setOpen] = useState(false);

  const inbox = (inboxesQ.data?.inboxes ?? []).find(
    (i: any) => i.shop_id === shopId && (i.imap_host ?? "").toLowerCase().includes("zoho")
  );
  const connected = inbox?.connection_status === "connected";

  return (
    <>
      <IntegrationCard
        icon={Mail}
        title="Zoho Mail (Atendimento)"
        subtitle="Receba e responda emails de suporte direto pela aba Atendimento"
        status={connected ? "connected" : "disconnected"}
        statusLabel={inbox ? (connected ? inbox.email_address : (inbox.connection_status === "error" ? "Erro de conexão" : "Desconectado")) : "Não conectado"}
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Settings2 className="size-4" /> {inbox ? "Configurar" : "Conectar"}
          </Button>
        </div>
      </IntegrationCard>
      {open && <ZohoMailDialog shopId={shopId} inbox={inbox} onClose={() => setOpen(false)} />}
    </>
  );
}

function ZohoMailDialog({ shopId, inbox, onClose }: { shopId: string; inbox: any; onClose: () => void }) {
  const qc = useQueryClient();
  const _upsert = useServerFn(upsertInbox);
  const _test = useServerFn(testInboxConnection);
  const _delete = useServerFn(deleteInbox);

  const [email, setEmail] = useState(inbox?.email_address ?? "");
  const [displayName, setDisplayName] = useState(inbox?.display_name ?? "");
  const [password, setPassword] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const confirm = useConfirm();

  const save = useMutation({
    mutationFn: () => _upsert({ data: {
      id: inbox?.id,
      shop_id: shopId,
      email_address: email.trim(),
      display_name: displayName.trim() || null,
      imap_host: "imap.zoho.com",
      imap_port: 993,
      imap_user: email.trim(),
      imap_password: password || null,
      imap_ssl: true,
      smtp_host: "smtp.zoho.com",
      smtp_port: 465,
      smtp_user: email.trim(),
      smtp_password: password || null,
      smtp_ssl: true,
    } }),
    onSuccess: () => {
      toast.success("Caixa Zoho salva");
      qc.invalidateQueries({ queryKey: ["support"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => _delete({ data: { id: inbox.id } }),
    onSuccess: () => {
      toast.success("Integração removida");
      qc.invalidateQueries({ queryKey: ["support"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleTest = async () => {
    if (!inbox?.id) return;
    setTesting(true); setTestMsg(null);
    const r = await _test({ data: { id: inbox.id } });
    setTestMsg(r.message);
    qc.invalidateQueries({ queryKey: ["support"] });
    setTesting(false);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Zoho Mail · Atendimento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground">Como conectar:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Use o email de suporte cadastrado no Zoho Mail desta loja.</li>
              <li>Em Zoho Mail, vá em Configurações → Segurança → Senhas de aplicativo e gere uma senha.</li>
              <li>Cole essa senha de aplicativo abaixo (não use a senha normal da conta).</li>
            </ol>
            <p>Após conectar, os emails recebidos aparecem na aba <strong>Atendimento</strong> e podem ser respondidos por lá.</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Email de suporte</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="suporte@sualoja.com" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome de exibição</label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Suporte Loja" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{inbox ? "Nova senha de aplicativo (deixe vazio para manter)" : "Senha de aplicativo"}</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {inbox && (
            <div className="text-xs text-muted-foreground">
              Status: {inbox.connection_status === "connected" ? "Conectado" : inbox.connection_status === "error" ? "Erro de conexão" : "Desconectado"}
              {inbox.last_error && ` · ${inbox.last_error}`}
            </div>
          )}
          {testMsg && <div className="text-xs px-3 py-2 rounded-md bg-emerald-500/10 text-emerald-700">{testMsg}</div>}
        </div>
        <DialogFooter className="sm:justify-between">
          <div>
            {inbox && (
              <Button variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => { confirm("Remover esta integração?").then((ok) => { if (ok) remove.mutate(); }); }}>
                Remover
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {inbox && (
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Testar conexão
              </Button>
            )}
            <Button onClick={() => save.mutate()} disabled={save.isPending || !email.trim() || (!inbox && !password.trim())}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ===== Dialogs (moved from ShopOrders) =====

function SettingsDialog({ shopId, open, onClose, settings, stores, onSaved }: any) {
  const upsertFn = useServerFn(upsertOrderSettings);
  const recomputeRangeFn = useServerFn(recomputeRange);
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(Boolean(settings.automation_enabled));
  const [storeId, setStoreId] = useState<string | null>(settings.shopify_store_id ?? null);
  const [defaultCost, setDefaultCost] = useState(String(settings.default_unit_cost ?? 0));
  const [cashflowStart, setCashflowStart] = useState<string>(settings.cashflow_start_date ?? "");
  const [openConnect, setOpenConnect] = useState(false);

  const setPreset = (daysAgo: number | null) => {
    if (daysAgo === null) { setCashflowStart(""); return; }
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    setCashflowStart(isoDate(d));
  };

  const save = useMutation({
    mutationFn: async () => {
      await upsertFn({ data: { shop_id: shopId, patch: {
        automation_enabled: enabled,
        shopify_store_id: storeId,
        default_unit_cost: Number(defaultCost) || 0,
        cashflow_start_date: cashflowStart || null,
      } } });
      const today = isoDate(new Date());
      const from = addDays(today, -90);
      const futureTo = addDays(today, PROCESSING_DELAY_DAYS + 1);
      await recomputeRangeFn({ data: { shop_id: shopId, from_processing: addDays(from, PROCESSING_DELAY_DAYS), to_processing: futureTo } });
    },
    onSuccess: () => {
      toast.success("Salvo · caixa atualizado");
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
      onSaved(); onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Configurações da integração Shopify</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Loja Shopify vinculada</label>
            <div className="flex gap-2">
              <select className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={storeId ?? ""} onChange={(e) => setStoreId(e.target.value || null)}>
                <option value="">— Nenhuma —</option>
                {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name || s.shop_domain}</option>)}
              </select>
              <Button type="button" size="sm" variant="outline" onClick={() => setOpenConnect(true)}>
                <Plug className="size-4" /> Conectar
              </Button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Processamento dos pedidos</label>
            <div className="rounded-lg border border-border p-3 text-sm">
              Mesmo dia da semana seguinte <span className="text-muted-foreground">(D+7)</span>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Custo unitário padrão (fallback)</label>
            <Input type="number" step="0.01" value={defaultCost} onChange={(e) => setDefaultCost(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Conectar pedidos ao caixa a partir de</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPreset(null)}>Não conectar</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPreset(0)}>Hoje</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPreset(5)}>5 dias atrás</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPreset(14)}>14 dias atrás</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPreset(30)}>30 dias atrás</Button>
            </div>
            <Input type="date" value={cashflowStart} onChange={(e) => setCashflowStart(e.target.value)} />
            <div className="text-xs text-muted-foreground mt-1.5">
              {cashflowStart
                ? `Apenas pedidos a partir de ${cashflowStart} entram no caixa.`
                : "Nenhum pedido será conectado ao caixa."}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <div className="text-sm font-medium">Automação diária</div>
              <div className="text-xs text-muted-foreground">Cria saída automaticamente a cada dia</div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
      {openConnect && (
        <ConnectStoreDialog
          open={openConnect}
          onClose={() => setOpenConnect(false)}
          onConnected={(s) => {
            setStoreId(s.id);
            qc.invalidateQueries({ queryKey: ["shopify-stores"] });
          }}
        />
      )}
    </Dialog>
  );
}

function ConnectStoreDialog({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected?: (s: any) => void }) {
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
            <p className="text-foreground">
              Se a loja já estava conectada antes, refaça essa autorização para liberar a permissão de
              payouts (depósitos do Shopify Payments) — sem ela, os depósitos não são sincronizados.
            </p>
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

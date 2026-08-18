import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createMetaOAuthUrl, getMetaToken, getConnectedMetaAdAccounts,
  connectMetaAdAccount, disconnectMetaAdAccount, disconnectMeta,
  getMetaCampaigns, saveMetaCampaigns, syncMetaAdsSpend, syncMetaAdsActivities,
} from "@/lib/meta-ads.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Megaphone, RefreshCw, Copy, Check, LogOut, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function MetaAdsIntegrationDialog({
  shopId, open, onClose,
}: { shopId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const createUrlFn      = useServerFn(createMetaOAuthUrl);
  const getTokenFn       = useServerFn(getMetaToken);
  const getAccountsFn    = useServerFn(getConnectedMetaAdAccounts);
  const connectAccountFn = useServerFn(connectMetaAdAccount);
  const disconnectAcctFn = useServerFn(disconnectMetaAdAccount);
  const disconnectFn     = useServerFn(disconnectMeta);
  const syncSpendFn      = useServerFn(syncMetaAdsSpend);
  const syncActivitiesFn = useServerFn(syncMetaAdsActivities);
  const getCampaignsFn   = useServerFn(getMetaCampaigns);
  const saveCampaignsFn  = useServerFn(saveMetaCampaigns);

  const [authUrl, setAuthUrl]             = useState<string | null>(null);
  const [copied, setCopied]               = useState(false);
  const [showPicker, setShowPicker]       = useState(false);
  const [campaignsAccountId, setCampaignsAccountId] = useState<string | null>(null);
  const [selectedCampaigns, setSelectedCampaigns]   = useState<Set<string>>(new Set());

  const token = useQuery({
    queryKey: ["meta-token", shopId],
    queryFn:  () => getTokenFn({ data: { shop_id: shopId } }),
  });
  const d = token.data;
  const connected = Boolean(d?.connected);

  const accountsQuery = useQuery({
    queryKey: ["meta-ad-accounts", shopId],
    queryFn:  () => getAccountsFn({ data: { shop_id: shopId } }),
    enabled:  connected,
  });
  const connectedAccounts = accountsQuery.data?.accounts ?? [];
  const connectedIds = new Set(connectedAccounts.map((a) => a.ad_account_id));
  const availableAccounts = ((d?.ad_accounts ?? []) as any[]).filter((acc) => {
    const normalizedId = acc.id?.startsWith("act_") ? acc.id : `act_${acc.account_id}`;
    return !connectedIds.has(normalizedId) && !connectedIds.has(acc.id);
  });

  const generateUrl = useMutation({
    mutationFn: () => createUrlFn({ data: { shop_id: shopId } }),
    onSuccess: (res) => setAuthUrl(res.url),
    onError: (e: any) => toast.error(e.message),
  });

  const copyUrl = () => {
    if (!authUrl) return;
    navigator.clipboard.writeText(authUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["meta-token", shopId] });
    qc.invalidateQueries({ queryKey: ["meta-ad-accounts", shopId] });
  };

  const campaigns = useQuery({
    queryKey: ["meta-campaigns", shopId, campaignsAccountId],
    queryFn: () => getCampaignsFn({ data: { shop_id: shopId, ad_account_id: campaignsAccountId! } }),
    enabled: Boolean(campaignsAccountId),
  });

  const connectAccount = useMutation({
    mutationFn: (adAccountId: string) => connectAccountFn({ data: { shop_id: shopId, ad_account_id: adAccountId } }),
    onSuccess: (_res, adAccountId) => {
      toast.success("Conta de anúncios conectada");
      qc.invalidateQueries({ queryKey: ["meta-ad-accounts", shopId] });
      setShowPicker(false);
      setCampaignsAccountId(adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`);
      setSelectedCampaigns(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const disconnectAccount = useMutation({
    mutationFn: (adAccountId: string) => disconnectAcctFn({ data: { shop_id: shopId, ad_account_id: adAccountId } }),
    onSuccess: () => {
      toast.success("Conta desconectada");
      qc.invalidateQueries({ queryKey: ["meta-ad-accounts", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveCampaigns = useMutation({
    mutationFn: () => saveCampaignsFn({
      data: { shop_id: shopId, ad_account_id: campaignsAccountId!, campaign_ids: Array.from(selectedCampaigns) },
    }),
    onSuccess: () => {
      toast.success(selectedCampaigns.size > 0 ? `${selectedCampaigns.size} campanhas selecionadas` : "Sincronizando conta inteira");
      setCampaignsAccountId(null);
      qc.invalidateQueries({ queryKey: ["meta-ad-accounts", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleCampaign = (id: string) => {
    setSelectedCampaigns(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sync = useMutation({
    mutationFn: async () => {
      const [spend, activities] = await Promise.all([
        syncSpendFn({ data: { shop_id: shopId } }),
        syncActivitiesFn({ data: { shop_id: shopId } }),
      ]);
      return { spend, activities };
    },
    onSuccess: ({ spend, activities }) => {
      toast.success(`${spend.synced} dias sincronizados · ${activities.synced} alterações no Diário`);
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
      qc.invalidateQueries({ queryKey: ["meta-ad-accounts", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectFn({ data: { shop_id: shopId } }),
    onSuccess: () => {
      toast.success("Conta desconectada");
      setAuthUrl(null);
      qc.invalidateQueries({ queryKey: ["meta-token", shopId] });
      qc.invalidateQueries({ queryKey: ["meta-ad-accounts", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openCampaignsFor = (adAccountId: string, existingIds: string[]) => {
    setCampaignsAccountId(adAccountId);
    setSelectedCampaigns(new Set(existingIds));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-blue-500/10 text-blue-600 grid place-items-center">
              <Megaphone className="size-5" />
            </div>
            <div className="flex-1">
              <DialogTitle>Meta Ads</DialogTitle>
              <p className="text-xs text-muted-foreground">Gastos de campanhas sincronizados no Caixa</p>
            </div>
            <Badge variant="outline" className={cn(
              "text-[11px]",
              connected ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground"
            )}>
              {connected ? <CheckCircle2 className="size-3 mr-1" /> : <AlertCircle className="size-3 mr-1" />}
              {connected ? (d?.fb_user_name || "Conectado") : "Desconectado"}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">

          {/* ── Não conectado ── */}
          {!connected && (
            <div className="space-y-4">
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2"><span className="size-5 rounded-full bg-primary/10 text-primary text-xs grid place-items-center shrink-0 font-semibold">1</span>Clique em <strong className="text-foreground">Gerar link</strong> abaixo</li>
                <li className="flex gap-2"><span className="size-5 rounded-full bg-primary/10 text-primary text-xs grid place-items-center shrink-0 font-semibold">2</span>Copie o link e abra no navegador onde seu Facebook está logado</li>
                <li className="flex gap-2"><span className="size-5 rounded-full bg-primary/10 text-primary text-xs grid place-items-center shrink-0 font-semibold">3</span>Autorize o acesso e volte aqui para clicar em <strong className="text-foreground">Atualizar</strong></li>
              </ol>

              {!authUrl && (
                <Button className="w-full" onClick={() => generateUrl.mutate()} disabled={generateUrl.isPending}>
                  {generateUrl.isPending && <Loader2 className="size-4 animate-spin" />}
                  Gerar link de autenticação
                </Button>
              )}

              {authUrl && (
                <div className="space-y-2">
                  <div className="relative rounded-xl border border-border bg-muted overflow-hidden">
                    <p className="text-xs font-mono text-muted-foreground px-3 py-2.5 pr-10 break-all leading-relaxed">
                      {authUrl}
                    </p>
                    <button
                      onClick={copyUrl}
                      title="Copiar link"
                      className="absolute top-2 right-2 size-7 rounded-lg bg-primary text-primary-foreground grid place-items-center hover:opacity-90 transition-opacity"
                    >
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>

                  <Button variant="outline" className="w-full gap-2" onClick={refresh}>
                    <RefreshCw className="size-4" />
                    Já autentiquei — Atualizar
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Seleção de campanhas ── */}
          {connected && campaignsAccountId && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Selecione as campanhas desta conta</p>
                <p className="text-xs text-muted-foreground mt-0.5">Deixe tudo desmarcado para sincronizar a conta inteira.</p>
              </div>
              {campaigns.isLoading && <div className="flex justify-center py-4"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {(campaigns.data?.campaigns ?? []).map((c) => {
                  const checked = selectedCampaigns.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCampaign(c.id)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all",
                        checked ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"
                      )}
                    >
                      <div className={cn("size-4 rounded border-2 grid place-items-center shrink-0 transition-colors",
                        checked ? "bg-primary border-primary" : "border-muted-foreground/40"
                      )}>
                        {checked && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.status}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => saveCampaigns.mutate()} disabled={saveCampaigns.isPending}>
                  {saveCampaigns.isPending && <Loader2 className="size-4 animate-spin" />}
                  {selectedCampaigns.size > 0 ? `Salvar ${selectedCampaigns.size} campanhas` : "Usar conta inteira"}
                </Button>
                <Button variant="outline" onClick={() => setCampaignsAccountId(null)}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* ── Seletor de contas para adicionar ── */}
          {connected && showPicker && !campaignsAccountId && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Selecione uma conta de anúncios para conectar:</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availableAccounts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Todas as contas do perfil já estão conectadas.</p>
                )}
                {availableAccounts.map((acc: any) => (
                  <button
                    key={acc.id}
                    onClick={() => connectAccount.mutate(acc.id)}
                    disabled={connectAccount.isPending}
                    className="w-full flex items-center justify-between rounded-xl border border-border hover:border-primary/40 px-4 py-3 text-left transition-all"
                  >
                    <div>
                      <p className="text-sm font-medium">{acc.name}</p>
                      <p className="text-xs text-muted-foreground">{acc.account_id} · {acc.currency}</p>
                    </div>
                    {connectAccount.isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  </button>
                ))}
              </div>
              <Button variant="outline" className="w-full" onClick={() => setShowPicker(false)}>Cancelar</Button>
            </div>
          )}

          {/* ── Contas conectadas ── */}
          {connected && !showPicker && !campaignsAccountId && (
            <div className="space-y-3">
              {connectedAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma conta de anúncios conectada ainda.</p>
              )}

              {connectedAccounts.map((acc) => {
                const ids = (acc.selected_campaign_ids ?? []) as string[];
                return (
                  <div key={acc.ad_account_id} className="rounded-xl border border-border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{acc.account_name ?? acc.ad_account_id}</p>
                        <p className="text-xs text-muted-foreground">
                          {ids.length > 0 ? `${ids.length} campanhas selecionadas` : "Conta inteira"}
                        </p>
                        {acc.last_sync_status === "error" && (
                          <p className="text-xs text-destructive mt-1">{acc.last_sync_error}</p>
                        )}
                      </div>
                      <button
                        onClick={() => disconnectAccount.mutate(acc.ad_account_id)}
                        disabled={disconnectAccount.isPending}
                        title="Desconectar esta conta"
                        className="size-6 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => openCampaignsFor(acc.ad_account_id, ids)}
                    >
                      Campanhas
                    </Button>
                  </div>
                );
              })}

              <Button variant="outline" className="w-full gap-2" onClick={() => setShowPicker(true)}>
                <Plus className="size-4" /> Adicionar conta
              </Button>

              {connectedAccounts.length > 0 && (
                <div className="flex gap-2 flex-wrap pt-1">
                  <Button className="flex-1" onClick={() => sync.mutate()} disabled={sync.isPending}>
                    {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    Sincronizar gastos
                  </Button>
                  <Button variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                    {disconnect.isPending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                  </Button>
                </div>
              )}
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

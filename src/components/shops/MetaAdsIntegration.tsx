import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createMetaOAuthUrl, getMetaToken, selectMetaAdAccount, disconnectMeta,
  getMetaCampaigns, saveMetaCampaigns, syncMetaAdsSpend, syncMetaAdsActivities,
} from "@/lib/meta-ads.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Megaphone, RefreshCw, Copy, Check, LogOut } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function MetaAdsIntegrationDialog({
  shopId, open, onClose,
}: { shopId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const createUrlFn      = useServerFn(createMetaOAuthUrl);
  const getTokenFn       = useServerFn(getMetaToken);
  const selectAccountFn  = useServerFn(selectMetaAdAccount);
  const disconnectFn     = useServerFn(disconnectMeta);
  const syncSpendFn      = useServerFn(syncMetaAdsSpend);
  const syncActivitiesFn = useServerFn(syncMetaAdsActivities);

  const [authUrl, setAuthUrl]         = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const [showCampaigns, setShowCampaigns] = useState(false);
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<string>>(new Set());

  const token = useQuery({
    queryKey: ["meta-token", shopId],
    queryFn:  () => getTokenFn({ data: { shop_id: shopId } }),
  });
  const d = token.data;
  const connected = Boolean(d?.connected);
  const hasAccount = Boolean(d?.selected_ad_account_id);

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
    qc.invalidateQueries({ queryKey: ["meta-ads-integration", shopId] });
  };

  const getCampaignsFn = useServerFn(getMetaCampaigns);
  const saveCampaignsFn = useServerFn(saveMetaCampaigns);

  const campaigns = useQuery({
    queryKey: ["meta-campaigns", shopId],
    queryFn: () => getCampaignsFn({ data: { shop_id: shopId } }),
    enabled: connected && hasAccount,
  });

  const selectAccount = useMutation({
    mutationFn: (id: string) => selectAccountFn({ data: { shop_id: shopId, ad_account_id: id } }),
    onSuccess: () => {
      toast.success("Conta de anúncios selecionada");
      qc.invalidateQueries({ queryKey: ["meta-token", shopId] });
      qc.invalidateQueries({ queryKey: ["meta-ads-integration", shopId] });
      setShowCampaigns(true);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveCampaigns = useMutation({
    mutationFn: () => saveCampaignsFn({ data: { shop_id: shopId, campaign_ids: Array.from(selectedCampaigns) } }),
    onSuccess: () => {
      toast.success(selectedCampaigns.size > 0 ? `${selectedCampaigns.size} campanhas selecionadas` : "Sincronizando conta inteira");
      setShowCampaigns(false);
      qc.invalidateQueries({ queryKey: ["meta-token", shopId] });
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
    },
    onError: (e: any) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectFn({ data: { shop_id: shopId } }),
    onSuccess: () => {
      toast.success("Conta desconectada");
      setAuthUrl(null);
      qc.invalidateQueries({ queryKey: ["meta-token", shopId] });
      qc.invalidateQueries({ queryKey: ["meta-ads-integration", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

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

          {/* ── Conectado, sem conta selecionada ── */}
          {connected && !hasAccount && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Selecione qual conta de anúncios rastrear nesta loja:</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {((d?.ad_accounts ?? []) as any[]).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhuma conta de anúncios encontrada neste perfil.</p>
                )}
                {((d?.ad_accounts ?? []) as any[]).map((acc: any) => (
                  <button
                    key={acc.id}
                    onClick={() => selectAccount.mutate(acc.id)}
                    disabled={selectAccount.isPending}
                    className="w-full flex items-center justify-between rounded-xl border border-border hover:border-primary/40 px-4 py-3 text-left transition-all"
                  >
                    <div>
                      <p className="text-sm font-medium">{acc.name}</p>
                      <p className="text-xs text-muted-foreground">{acc.account_id} · {acc.currency}</p>
                    </div>
                    {selectAccount.isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Seleção de campanhas ── */}
          {connected && hasAccount && showCampaigns && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Selecione as campanhas desta loja</p>
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
                <Button variant="outline" onClick={() => setShowCampaigns(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* ── Conectado com conta selecionada ── */}
          {connected && hasAccount && !showCampaigns && (
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-4 space-y-1">
                <p className="text-xs text-muted-foreground">Conta ativa</p>
                <p className="font-medium text-sm">
                  {((d?.ad_accounts ?? []) as any[]).find((a: any) =>
                    a.id === d?.selected_ad_account_id ||
                    `act_${a.account_id}` === d?.selected_ad_account_id
                  )?.name ?? d?.selected_ad_account_id}
                </p>
                <p className="text-xs text-muted-foreground">Perfil: {d?.fb_user_name}</p>
              </div>

              {/* Campanhas selecionadas */}
              {(() => {
                const ids: string[] = d?.selected_campaign_ids ?? [];
                const allCampaigns = campaigns.data?.campaigns ?? [];
                if (ids.length === 0) {
                  return (
                    <p className="text-xs text-muted-foreground px-1">
                      Campanhas: <span className="text-foreground font-medium">conta inteira</span>
                    </p>
                  );
                }
                const names = ids
                  .map(id => allCampaigns.find(c => c.id === id)?.name ?? id)
                  .filter(Boolean);
                return (
                  <div className="space-y-1 px-1">
                    <p className="text-xs text-muted-foreground">Campanhas ({ids.length}):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {names.map((name, i) => (
                        <span key={i} className="inline-flex items-center rounded-lg bg-primary/8 text-primary text-[11px] font-medium px-2 py-0.5 border border-primary/15">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="flex gap-2 flex-wrap">
                <Button className="flex-1" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Sincronizar gastos
                </Button>
                <Button variant="outline" onClick={() => { setShowCampaigns(true); setSelectedCampaigns(new Set()); }}>
                  Campanhas
                </Button>
                <Button variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                  {disconnect.isPending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                </Button>
              </div>
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

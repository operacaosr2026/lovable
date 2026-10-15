import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getCardMetaSetup, connectCardMetaAccount, disconnectCardMetaAccount,
  getCardMetaCampaigns, saveCardMetaCampaigns, syncCardMetaSpend,
} from "@/lib/lg-card-meta.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Megaphone, RefreshCw, Plus, X, Check, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const cardMetaSetupKey = (cardId: string) => ["card-meta-setup", cardId];

// Contas e campanhas do card: o gasto do card é o dessas campanhas, contado
// uma vez, independente de quais lojas estão no card.
export function CardMetaAdsDialog({
  cardId, open, onClose,
}: { cardId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const getSetupFn      = useServerFn(getCardMetaSetup);
  const connectFn       = useServerFn(connectCardMetaAccount);
  const disconnectFn    = useServerFn(disconnectCardMetaAccount);
  const getCampaignsFn  = useServerFn(getCardMetaCampaigns);
  const saveCampaignsFn = useServerFn(saveCardMetaCampaigns);
  const syncFn          = useServerFn(syncCardMetaSpend);

  const [showPicker, setShowPicker] = useState(false);
  const [campaignsAccountId, setCampaignsAccountId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const setup = useQuery({ queryKey: cardMetaSetupKey(cardId), queryFn: () => getSetupFn({ data: { card_id: cardId } }) });
  const accounts = setup.data?.accounts ?? [];
  const connectedIds = new Set(accounts.map((a) => a.ad_account_id));
  const available = (setup.data?.available ?? []).filter((a) => !connectedIds.has(a.id));
  const invalidate = () => qc.invalidateQueries({ queryKey: cardMetaSetupKey(cardId) });

  const campaigns = useQuery({
    queryKey: ["card-meta-campaigns", cardId, campaignsAccountId],
    queryFn: () => getCampaignsFn({ data: { card_id: cardId, ad_account_id: campaignsAccountId! } }),
    enabled: Boolean(campaignsAccountId),
  });
  const visibleCampaigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = campaigns.data?.campaigns ?? [];
    return (q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list)
      .slice().sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)));
  }, [campaigns.data, search, selected]);

  const openCampaigns = (adAccountId: string, ids: string[]) => {
    setCampaignsAccountId(adAccountId);
    setSelected(new Set(ids));
    setSearch("");
  };

  const connect = useMutation({
    mutationFn: (acc: { id: string; name: string | null; currency: string | null }) =>
      connectFn({ data: { card_id: cardId, ad_account_id: acc.id, account_name: acc.name, currency: acc.currency } }),
    onSuccess: (_r, acc) => {
      invalidate();
      setShowPicker(false);
      openCampaigns(acc.id, []);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: (adAccountId: string) => disconnectFn({ data: { card_id: cardId, ad_account_id: adAccountId } }),
    onSuccess: () => { toast.success("Conta removida do card"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const saveCampaigns = useMutation({
    mutationFn: () => saveCampaignsFn({ data: { card_id: cardId, ad_account_id: campaignsAccountId!, campaign_ids: [...selected] } }),
    onSuccess: () => {
      toast.success(selected.size > 0 ? `${selected.size} campanhas no card` : "Card usa a conta inteira");
      setCampaignsAccountId(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { card_id: cardId, since_days: 90 } }),
    onSuccess: (r) => {
      toast.success(`${r.synced} dias sincronizados`);
      invalidate();
      qc.invalidateQueries({ queryKey: ["lg-dashboard"] });
      qc.invalidateQueries({ queryKey: ["lg-card-metrics", cardId] });
    },
    onError: (e: any) => { toast.error(e.message); invalidate(); },
  });

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
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
              <DialogTitle>Meta Ads do card</DialogTitle>
              <p className="text-xs text-muted-foreground">O gasto do card é o das campanhas marcadas aqui</p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {setup.isLoading && <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}

          {setup.data && !setup.data.hasMetaConnection && (
            <p className="text-sm text-muted-foreground">
              Nenhuma conexão com o Facebook ainda. Conecte o Meta Ads em qualquer loja (Integrações da loja) e volte aqui.
            </p>
          )}

          {campaignsAccountId && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Campanhas deste card</p>
                <p className="text-xs text-muted-foreground mt-0.5">Deixe tudo desmarcado para usar a conta inteira.</p>
              </div>
              <div className="relative">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar campanha" className="pl-9" />
              </div>
              {campaigns.isLoading && <div className="flex justify-center py-4"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
              {campaigns.error && <p className="text-xs text-destructive">{(campaigns.error as any).message}</p>}
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {visibleCampaigns.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
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
                        <p className="text-xs text-muted-foreground">{c.effective_status ?? c.status}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => saveCampaigns.mutate()} disabled={saveCampaigns.isPending}>
                  {saveCampaigns.isPending && <Loader2 className="size-4 animate-spin" />}
                  {selected.size > 0 ? `Salvar ${selected.size} campanhas` : "Usar conta inteira"}
                </Button>
                <Button variant="outline" onClick={() => setCampaignsAccountId(null)}>Cancelar</Button>
              </div>
            </div>
          )}

          {!campaignsAccountId && showPicker && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Selecione uma conta de anúncios:</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {available.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Todas as contas já estão no card.</p>
                )}
                {available.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => connect.mutate(acc)}
                    disabled={connect.isPending}
                    className="w-full flex items-center justify-between rounded-xl border border-border hover:border-primary/40 px-4 py-3 text-left transition-all"
                  >
                    <div>
                      <p className="text-sm font-medium">{acc.name ?? acc.id}</p>
                      <p className="text-xs text-muted-foreground">{acc.id}{acc.currency ? ` · ${acc.currency}` : ""}</p>
                    </div>
                    {connect.isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  </button>
                ))}
              </div>
              <Button variant="outline" className="w-full" onClick={() => setShowPicker(false)}>Cancelar</Button>
            </div>
          )}

          {!campaignsAccountId && !showPicker && setup.data?.hasMetaConnection && (
            <div className="space-y-3">
              {accounts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma conta de anúncios no card ainda.</p>
              )}
              {accounts.map((acc) => {
                const ids = acc.selected_campaign_ids ?? [];
                return (
                  <div key={acc.ad_account_id} className="rounded-xl border border-border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{acc.account_name ?? acc.ad_account_id}</p>
                        <p className="text-xs text-muted-foreground">
                          {ids.length > 0 ? `${ids.length} campanhas` : "Conta inteira"}
                        </p>
                        {acc.last_sync_status === "error" && <p className="text-xs text-destructive mt-1">{acc.last_sync_error}</p>}
                      </div>
                      <button
                        onClick={() => disconnect.mutate(acc.ad_account_id)}
                        disabled={disconnect.isPending}
                        title="Remover esta conta do card"
                        className="size-6 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openCampaigns(acc.ad_account_id, ids)}>Campanhas</Button>
                  </div>
                );
              })}

              <Button variant="outline" className="w-full gap-2" onClick={() => setShowPicker(true)}>
                <Plus className="size-4" /> Adicionar conta
              </Button>

              {accounts.length > 0 && (
                <Button className="w-full" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Sincronizar gastos (90 dias)
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

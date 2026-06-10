import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMetaAdsIntegration, upsertMetaAdsIntegration, testMetaAdsConnection,
  syncMetaAdsSpend, syncMetaAdsActivities, getMetaAdsMetrics,
} from "@/lib/meta-ads.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, CheckCircle2, AlertCircle, Megaphone, RefreshCw, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function fmtMoney(n: number, currency?: string | null) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: currency || "BRL" });
}

export function MetaAdsIntegrationDialog({
  shopId, open, onClose,
}: { shopId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getMetaAdsIntegration);
  const upsertFn = useServerFn(upsertMetaAdsIntegration);
  const testFn = useServerFn(testMetaAdsConnection);
  const syncFn = useServerFn(syncMetaAdsSpend);
  const syncActivitiesFn = useServerFn(syncMetaAdsActivities);
  const metricsFn = useServerFn(getMetaAdsMetrics);

  const integ = useQuery({
    queryKey: ["meta-ads-integration", shopId],
    queryFn: () => getFn({ data: { shop_id: shopId } }),
  });
  const metrics = useQuery({
    queryKey: ["meta-ads-metrics", shopId],
    queryFn: () => metricsFn({ data: { shop_id: shopId } }),
  });

  const [accessToken, setAccessToken] = useState("");
  const [adAccountId, setAdAccountId] = useState("");

  const save = useMutation({
    mutationFn: () => upsertFn({ data: {
      shop_id: shopId,
      ...(accessToken ? { access_token: accessToken } : {}),
      ...(adAccountId ? { ad_account_id: adAccountId } : {}),
    } }),
    onSuccess: () => {
      toast.success("Integração salva");
      setAccessToken(""); setAdAccountId("");
      qc.invalidateQueries({ queryKey: ["meta-ads-integration", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => testFn({ data: { shop_id: shopId } }),
    onSuccess: (r: any) => { toast.success(`Conexão OK · ${r.name ?? ""}`); qc.invalidateQueries({ queryKey: ["meta-ads-integration", shopId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: async () => {
      const spend = await syncFn({ data: { shop_id: shopId } });
      const activities = await syncActivitiesFn({ data: { shop_id: shopId } });
      return { ...spend, activitiesSynced: activities.synced };
    },
    onSuccess: (r) => {
      toast.success(`${r.synced} dias de gasto · ${fmtMoney(r.totalSpend)} · ${r.activitiesSynced} alterações no Diário`);
      qc.invalidateQueries({ queryKey: ["meta-ads-integration", shopId] });
      qc.invalidateQueries({ queryKey: ["meta-ads-metrics", shopId] });
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
      qc.invalidateQueries({ queryKey: ["shop-wiki", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const d = integ.data;
  const isConnected = Boolean(d?.configured);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-blue-500/10 text-blue-600 grid place-items-center">
              <Megaphone className="size-5" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg">Meta Ads</DialogTitle>
              <div className="text-xs text-muted-foreground">Gasto de campanhas sincronizado automaticamente no Caixa</div>
            </div>
            <Badge variant="outline" className={cn(
              "text-[11px]",
              isConnected ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground"
            )}>
              {isConnected ? <CheckCircle2 className="size-3 mr-1" /> : <AlertCircle className="size-3 mr-1" />}
              {isConnected ? (d?.account_name || "Conectado") : "Desconectado"}
            </Badge>
          </div>
        </DialogHeader>

        <Tabs defaultValue="connection" className="mt-2">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="connection">Conexão</TabsTrigger>
            <TabsTrigger value="howto">Como conectar</TabsTrigger>
            <TabsTrigger value="metrics">Métricas</TabsTrigger>
          </TabsList>

          {/* ===== CONEXÃO ===== */}
          <TabsContent value="connection" className="space-y-4 pt-4">
            <Field label="Token de acesso" hint="Token de sistema com permissão ads_read sobre a conta de anúncios">
              <Input
                type="password"
                placeholder={d?.token_masked ?? "Cole o token de acesso"}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </Field>
            <Field label="ID da conta de anúncios" hint="Ex: act_1234567890 (o prefixo act_ é adicionado automaticamente)">
              <Input
                placeholder={d?.ad_account_id ?? "act_1234567890"}
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground mb-0.5">Status</div>
                <div className="font-medium">
                  {d?.last_sync_status === "ok" ? "✓ OK"
                    : d?.last_sync_status === "error" ? "✗ Erro"
                    : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground mb-0.5">Última sincronização</div>
                <div className="font-medium">
                  {d?.last_sync_at ? new Date(d.last_sync_at).toLocaleString("pt-BR") : "Nunca"}
                </div>
              </div>
            </div>

            {d?.last_sync_error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600">
                {d.last_sync_error}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending || (!accessToken && !adAccountId)}>
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                Salvar credenciais
              </Button>
              <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !isConnected}>
                {test.isPending && <Loader2 className="size-4 animate-spin" />}
                Testar conexão
              </Button>
              <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending || !isConnected}>
                {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Sincronizar gastos e alterações
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              As alterações da conta de anúncios (orçamento, status, criação de campanhas/anúncios etc.) são
              registradas automaticamente em uma página <strong>"Alterações Meta Ads"</strong> no Diário desta loja.
            </p>
          </TabsContent>

          {/* ===== COMO CONECTAR ===== */}
          <TabsContent value="howto" className="space-y-3 pt-4 text-sm">
            <Step n={1} title="Crie um System User">
              No <strong>Business Settings</strong> (business.facebook.com) → <strong>Usuários → Usuários do sistema</strong>, crie um usuário do sistema com acesso de administrador.
            </Step>
            <Step n={2} title="Gere um token de acesso">
              No usuário do sistema, clique em <strong>Gerar novo token</strong>, selecione o app e marque a permissão <strong>ads_read</strong> (e <strong>ads_management</strong> se quiser ler também rascunhos/pausados). Copie o token gerado — ele não é exibido novamente.
            </Step>
            <Step n={3} title="Dê acesso à conta de anúncios">
              Ainda em Business Settings → <strong>Contas → Contas de anúncios</strong>, adicione o usuário do sistema com permissão de visualização à conta de anúncios desta loja.
            </Step>
            <Step n={4} title="ID da conta de anúncios">
              Em <strong>Contas de anúncios</strong>, copie o ID (números) da conta — cole no campo acima, com ou sem o prefixo <code>act_</code>.
            </Step>
            <Step n={5} title="Testar e sincronizar">
              Cole o token e o ID da conta na aba <strong>Conexão</strong>, salve, clique em <strong>Testar conexão</strong> e depois em <strong>Sincronizar gastos</strong>. O gasto diário aparece no Caixa como saída na categoria "Facebook Ads".
            </Step>
          </TabsContent>

          {/* ===== MÉTRICAS ===== */}
          <TabsContent value="metrics" className="pt-4">
            <div className="grid grid-cols-2 gap-3">
              <Metric icon={TrendingDown} label="Gasto últimos 7 dias" value={fmtMoney(metrics.data?.spend7 ?? 0, d?.currency)} />
              <Metric icon={TrendingDown} label="Gasto últimos 30 dias" value={fmtMoney(metrics.data?.spend30 ?? 0, d?.currency)} />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: any) {
  return (
    <div>
      <label className="text-sm font-medium block">{label}</label>
      {hint && <div className="text-xs text-muted-foreground mt-0.5 mb-1.5">{hint}</div>}
      {children}
    </div>
  );
}

function Step({ n, title, children }: any) {
  return (
    <div className="rounded-lg border border-border p-3 flex gap-3">
      <div className="size-7 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-semibold shrink-0">{n}</div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground text-xs mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: any) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getTrack123Integration, upsertTrack123Integration, testTrack123Connection,
  syncTrack123Tracking, listTrack123EventRules, upsertTrack123EventRule,
  deleteTrack123EventRule, getTrack123Metrics,
} from "@/lib/track123.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2, Copy, ExternalLink, CheckCircle2, AlertCircle, Plus, Trash2,
  Truck, Package, AlertTriangle, Clock, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "shipped", label: "Marcar como Enviado", tone: "sky" },
  { value: "delivered", label: "Marcar como Entregue", tone: "emerald" },
  { value: "problem", label: "Marcar com Problema", tone: "rose" },
  { value: "ignore", label: "Ignorar", tone: "muted" },
] as const;

export function Track123IntegrationDialog({
  shopId, open, onClose,
}: { shopId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getTrack123Integration);
  const upsertFn = useServerFn(upsertTrack123Integration);
  const testFn = useServerFn(testTrack123Connection);
  const syncFn = useServerFn(syncTrack123Tracking);
  const metricsFn = useServerFn(getTrack123Metrics);

  const integ = useQuery({
    queryKey: ["track123-integration", shopId],
    queryFn: () => getFn({ data: { shop_id: shopId } }),
  });
  const metrics = useQuery({
    queryKey: ["track123-metrics", shopId],
    queryFn: () => metricsFn({ data: { shop_id: shopId } }),
  });

  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");

  const save = useMutation({
    mutationFn: () => upsertFn({ data: {
      shop_id: shopId,
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(token ? { token } : {}),
    } }),
    onSuccess: () => {
      toast.success("Integração salva");
      setApiKey(""); setToken("");
      qc.invalidateQueries({ queryKey: ["track123-integration", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => testFn({ data: { shop_id: shopId } }),
    onSuccess: () => { toast.success("Conexão OK"); qc.invalidateQueries({ queryKey: ["track123-integration", shopId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { shop_id: shopId } }),
    onSuccess: (r) => { toast.success(`${r.updated} rastreios atualizados`); qc.invalidateQueries({ queryKey: ["track123-integration", shopId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const copy = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copiado"); };

  const d = integ.data;
  const isConnected = Boolean(d?.configured);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-violet-500/10 text-violet-600 grid place-items-center">
              <Truck className="size-5" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg">Track123</DialogTitle>
              <div className="text-xs text-muted-foreground">Rastreamento logístico automatizado por webhook</div>
            </div>
            <Badge variant="outline" className={cn(
              "text-[11px]",
              isConnected ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground"
            )}>
              {isConnected ? <CheckCircle2 className="size-3 mr-1" /> : <AlertCircle className="size-3 mr-1" />}
              {isConnected ? "Conectado" : "Desconectado"}
            </Badge>
          </div>
        </DialogHeader>

        <Tabs defaultValue="connection" className="mt-2">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="connection">Conexão</TabsTrigger>
            <TabsTrigger value="howto">Como conectar</TabsTrigger>
            <TabsTrigger value="events">Mapeamento</TabsTrigger>
            <TabsTrigger value="metrics">Métricas</TabsTrigger>
          </TabsList>

          {/* ===== CONEXÃO ===== */}
          <TabsContent value="connection" className="space-y-4 pt-4">
            <Field label="API Key" hint="Painel Track123 → API → API Secret">
              <Input
                placeholder={d?.api_key_masked ?? "Cole sua API Key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Field>
            <Field label="Token (opcional)" hint="Algumas integrações usam token adicional">
              <Input
                type="password"
                placeholder={d?.token_masked ?? "Cole o token (opcional)"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>

            <Field label="Webhook URL" hint="Cadastre essa URL no painel do Track123 → Webhooks">
              <div className="flex gap-2">
                <Input readOnly value={d?.webhook_url ?? ""} className="font-mono text-xs" />
                <Button size="icon" variant="outline" onClick={() => d?.webhook_url && copy(d.webhook_url)} disabled={!d?.webhook_url}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground mb-0.5">Status</div>
                <div className="font-medium">
                  {d?.last_sync_status === "ok" ? "✓ OK"
                    : d?.last_sync_status === "webhook" ? "Recebendo webhooks"
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
              <Button onClick={() => save.mutate()} disabled={save.isPending || (!apiKey && !token)}>
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                Salvar credenciais
              </Button>
              <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !isConnected}>
                {test.isPending && <Loader2 className="size-4 animate-spin" />}
                Testar conexão
              </Button>
              <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending || !isConnected}>
                {sync.isPending && <Loader2 className="size-4 animate-spin" />}
                Sincronizar tracking
              </Button>
            </div>
          </TabsContent>

          {/* ===== COMO CONECTAR ===== */}
          <TabsContent value="howto" className="space-y-3 pt-4 text-sm">
            <Step n={1} title="API Key">
              Entre no painel Track123, vá em <strong>Settings → API</strong> e copie sua <strong>API Secret</strong>.
              Cole no campo <em>API Key</em> da aba Conexão e salve as credenciais.
            </Step>
            <Step n={2} title="Cadastrar Webhook URL">
              <div className="mt-1">
                No painel Track123 → <strong>Settings → Webhooks → Add webhook</strong>, cole exatamente esta URL e selecione todos os eventos de tracking:
              </div>
              <div className="mt-2 flex gap-2">
                <Input readOnly value={d?.webhook_url ?? "Salve as credenciais primeiro para gerar a URL"} className="font-mono text-[11px]" />
                <Button size="icon" variant="outline" onClick={() => d?.webhook_url && copy(d.webhook_url)} disabled={!d?.webhook_url}>
                  <Copy className="size-4" />
                </Button>
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                O último segmento da URL é o seu secret — não compartilhe esse link publicamente.
              </div>
            </Step>
            <Step n={3} title="Testar">
              Volte aqui e clique em <strong>Testar conexão</strong>. Se OK, os eventos passarão a chegar automaticamente.
            </Step>
            <Step n={4} title="Mapeamento de eventos">
              Na aba <strong>Mapeamento</strong>, escolha quais eventos do Track123 disparam mudanças de status (Enviado, Entregue, Problema).
              Comece com os defaults e ajuste depois com base nos eventos reais que você receber.
            </Step>
          </TabsContent>

          {/* ===== MAPEAMENTO ===== */}
          <TabsContent value="events" className="pt-4">
            <EventRules shopId={shopId} />
          </TabsContent>

          {/* ===== MÉTRICAS ===== */}
          <TabsContent value="metrics" className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric icon={Clock} label="Tempo médio até envio" value={metrics.data?.avg_time_to_ship != null ? `${metrics.data.avg_time_to_ship} dias` : "—"} />
              <Metric icon={Zap} label="Enviados hoje" value={String(metrics.data?.shipped_today ?? 0)} />
              <Metric icon={Truck} label="Em trânsito" value={String(metrics.data?.in_transit ?? 0)} />
              <Metric icon={Package} label="Entregues" value={String(metrics.data?.delivered ?? 0)} />
              <Metric icon={AlertCircle} label="Sem tracking" value={String(metrics.data?.without_tracking ?? 0)} tone="amber" />
              <Metric icon={Clock} label="Sem atualização" value={String(metrics.data?.stale_tracking ?? 0)} tone="amber" />
              <Metric icon={AlertTriangle} label="Com problema" value={String(metrics.data?.problem ?? 0)} tone="rose" />
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

function Metric({ icon: Icon, label, value, tone }: any) {
  const tones: any = {
    amber: "text-amber-600",
    rose: "text-rose-600",
  };
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={cn("size-3.5", tone && tones[tone])} /> {label}
      </div>
      <div className={cn("text-xl font-semibold mt-1 tabular-nums", tone && tones[tone])}>{value}</div>
    </div>
  );
}

function EventRules({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listTrack123EventRules);
  const upsertFn = useServerFn(upsertTrack123EventRule);
  const delFn = useServerFn(deleteTrack123EventRule);

  const rules = useQuery({
    queryKey: ["track123-rules", shopId],
    queryFn: () => listFn({ data: { shop_id: shopId } }),
  });

  const upsert = useMutation({
    mutationFn: (v: any) => upsertFn({ data: { shop_id: shopId, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["track123-rules", shopId] }),
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["track123-rules", shopId] }),
  });

  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newTarget, setNewTarget] = useState<"shipped" | "delivered" | "problem" | "ignore">("shipped");

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Defina quais eventos do Track123 acionam mudanças automáticas de status. Eventos não mapeados (ou marcados como "Ignorar") apenas atualizam a timeline.
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {(rules.data ?? []).map((r: any) => (
          <div key={r.id} className="grid grid-cols-[auto_1fr_220px_auto] gap-3 px-3 py-2 items-center border-b border-border/50 last:border-b-0">
            <Switch checked={r.enabled} onCheckedChange={(v) => upsert.mutate({ id: r.id, event_key: r.event_key, event_label: r.event_label, target_status: r.target_status, enabled: v })} />
            <div>
              <div className="text-sm font-medium">{r.event_label}</div>
              <div className="text-[11px] text-muted-foreground font-mono">{r.event_key}</div>
            </div>
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              value={r.target_status}
              onChange={(e) => upsert.mutate({ id: r.id, event_key: r.event_key, event_label: r.event_label, target_status: e.target.value, enabled: r.enabled })}
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}>
              <Trash2 className="size-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-border p-3">
        <div className="text-xs font-medium mb-2">Adicionar evento manualmente</div>
        <div className="grid grid-cols-[1fr_1fr_180px_auto] gap-2">
          <Input placeholder="event_key (snake_case)" value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"))} />
          <Input placeholder="Texto do evento (ex: Accepted by carrier)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <select className="h-10 rounded-md border border-input bg-transparent px-2 text-sm" value={newTarget} onChange={(e) => setNewTarget(e.target.value as any)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Button
            size="sm"
            disabled={!newKey || !newLabel}
            onClick={() => {
              upsert.mutate({ event_key: newKey, event_label: newLabel, target_status: newTarget, enabled: true });
              setNewKey(""); setNewLabel("");
            }}
          >
            <Plus className="size-4" /> Adicionar
          </Button>
        </div>
      </div>
    </div>
  );
}

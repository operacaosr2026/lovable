import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listLogisticsOrders, updateOrderLogistics } from "@/lib/lg-logistics.functions";
import { syncTrack123ForShops, getTrack123Integrations } from "@/lib/track123.functions";
import { DateRangePicker } from "@/components/lojas-grupos/LgDashboard";
import { RefreshCw, Package, Truck, CheckCircle2, AlertTriangle, ExternalLink, Clock, Hourglass, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addD(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
// order_number já vem com "#" do Shopify (ex: "#WV1145") — não duplica o prefixo.
function orderLabel(o: any) {
  const n = o.order_number ?? o.id.slice(0, 8);
  return String(n).startsWith("#") ? n : `#${n}`;
}
function orderNum(o: any): number {
  const m = String(o.order_number ?? "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
// Agrupa os status brutos do Shopify/Track123 nos 4 buckets exibidos nos cards de KPI.
function inBucket(o: any, key: string): boolean {
  const s = o.delivery_status;
  if (key === "pending")   return s === "pending_shipment" || !s;
  if (key === "shipped")   return s === "shipped" || s === "in_transit";
  if (key === "delivered") return s === "delivered";
  if (key === "problem")   return s === "problem" || s === "returned";
  if (key === "waiting_customer") return s === "waiting_customer";
  return true;
}
function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
// Tempo relativo pro "sincronizado há Xh" ao lado do botão Atualizar.
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  return (nowMs - new Date(iso).getTime()) / 86_400_000;
}
// Dias desde a postagem: se já entregue, é o tempo final (postagem → entrega).
// Se ainda não, é o tempo corrido até agora (ainda contando).
function deliveryTimeLabel(o: any, nowMs: number): string {
  if (!o.shipped_at) return "—";
  const end = o.delivered_at ? new Date(o.delivered_at).getTime() : nowMs;
  const d = daysSince(o.shipped_at, end);
  return d != null ? `${Math.floor(d)}d` : "—";
}
// Dias úteis (seg-sex) entre a data do pedido e agora — não conta a data do
// pedido em si, só os dias que já se passaram desde então.
function businessDaysSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const cur = new Date(iso + "T00:00:00Z");
  const now = new Date(nowMs);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let count = 0;
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
// Motivo extra (além do que o badge de status já mostra) pra sinalizar um pedido
// parado: enviado há +7 dias sem atualização, ou pedido feito há +28 dias e ainda
// sem entrega. Não cobre "pendente de envio"/"problema", que o badge já deixa claro,
// nem "esperando cliente" — a ação nesse caso já não é da loja.
function attentionReason(o: any, nowMs: number): string | null {
  const status = o.delivery_status ?? "pending_shipment";
  if (status === "waiting_customer") return null;
  if (status === "shipped" || status === "in_transit") {
    // last_event_at (Track123) reflete o último evento real de rastreio; sem
    // integração ativa, cai pra shipped_at (data da postagem) como referência.
    const d = daysSince(o.last_event_at ?? o.shipped_at, nowMs);
    if (d != null && d >= 7) return `${Math.floor(d)}d sem atualização`;
  }
  if (status !== "delivered" && status !== "returned") {
    const d = daysSince(o.order_date, nowMs);
    if (d != null && d >= 25) return `${Math.floor(d)}d sem entrega`;
  }
  return null;
}
// Precisa de atenção: pendente de envio há mais de 3 dias úteis, marcado como
// problema, parado sem atualização de rastreio há +7 dias, ou feito há +25
// dias e ainda não entregue. "Esperando cliente" fica de fora — a bola já não
// está com a loja. Pendente de envio recente (até 3 dias úteis) é normal, não
// precisa aparecer aqui ainda.
function needsAttention(o: any, nowMs: number): boolean {
  const status = o.delivery_status ?? "pending_shipment";
  if (status === "pending_shipment") return businessDaysSince(o.order_date, nowMs) > 3;
  return status === "problem" || attentionReason(o, nowMs) != null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Package }> = {
  pending_shipment: { label: "Pendente envio",   color: "amber",   icon: Package },
  shipped:          { label: "Enviado",           color: "blue",    icon: Truck },
  in_transit:       { label: "Em trânsito",       color: "blue",    icon: Truck },
  delivered:        { label: "Entregue",           color: "emerald", icon: CheckCircle2 },
  returned:         { label: "Devolvido",          color: "rose",    icon: AlertTriangle },
  problem:          { label: "Problema",           color: "rose",    icon: AlertTriangle },
  waiting_customer: { label: "Esperando cliente",  color: "violet",  icon: Hourglass },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "gray" };
  return (
    <span className={cn(
      "text-[10px] px-1.5 py-0.5 rounded-md border font-medium inline-flex items-center gap-1",
      cfg.color === "amber"   && "bg-amber-500/10 text-amber-600 border-amber-500/20",
      cfg.color === "blue"    && "bg-blue-500/10 text-blue-600 border-blue-500/20",
      cfg.color === "emerald" && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      cfg.color === "rose"    && "bg-rose-500/10 text-rose-600 border-rose-500/20",
      cfg.color === "violet"  && "bg-violet-500/10 text-violet-600 border-violet-500/20",
      cfg.color === "gray"    && "bg-muted text-muted-foreground border-border",
    )}>
      {cfg.label}
    </span>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditLogisticsModal({
  order, onClose, onSave,
}: {
  order: any;
  onClose: () => void;
  onSave: (patch: any) => Promise<any>;
}) {
  const [carrier, setCarrier]           = useState(order.carrier ?? "");
  const [trackingCode, setTrackingCode] = useState(order.tracking_code ?? "");
  const [trackingUrl, setTrackingUrl]   = useState(order.tracking_url ?? "");
  const [status, setStatus]             = useState(order.delivery_status ?? "pending_shipment");
  const [note, setNote]                 = useState(order.logistics_note ?? "");
  const [saving, setSaving]             = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        carrier: carrier || null, tracking_code: trackingCode || null, tracking_url: trackingUrl || null,
        delivery_status: status, logistics_note: note || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Logística — {orderLabel(order)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Status de entrega</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-card text-foreground text-sm px-3 focus:outline-none focus:border-primary"
            >
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Transportadora</label>
            <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Ex: Correios, DHL, FedEx..." />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Código de rastreio</label>
            <Input value={trackingCode} onChange={(e) => setTrackingCode(e.target.value)} placeholder="Ex: BR123456789BR" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">URL de rastreio</label>
            <Input value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Obs</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação sobre o envio..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <RefreshCw className="size-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LgLogistica({
  shopIds,
  shops,
}: {
  shopIds: string[];
  shops: { id: string; name: string }[];
}) {
  const cacheKey = shopIds.slice().sort().join(",");
  const qc = useQueryClient();

  const [period, setPeriod]           = useState("30d");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>("atencao");
  const [shopFilter, setShopFilter]   = useState<string>("todas");
  const [search, setSearch]           = useState("");
  const [editingOrder, setEditingOrder] = useState<any | null>(null);

  const nowMs = Date.now();
  const { from, to } = (() => {
    const today = isoDate(new Date());
    if (period === "hoje")   return { from: today, to: today };
    if (period === "ontem")  { const y = addD(today, -1); return { from: y, to: y }; }
    if (period === "7d")     return { from: addD(today, -6), to: today };
    if (period === "mes")    return { from: `${today.slice(0, 7)}-01`, to: today };
    if (period === "custom" && customRange) return customRange;
    return { from: addD(today, -29), to: today };
  })();

  const listFn   = useServerFn(listLogisticsOrders);
  const updateFn = useServerFn(updateOrderLogistics);
  const syncFn   = useServerFn(syncTrack123ForShops);
  const integrationsFn = useServerFn(getTrack123Integrations);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["lg-logistics", cacheKey, from, to],
    queryFn: () => listFn({ data: { shop_ids: shopIds, from, to } }),
    enabled: shopIds.length > 0,
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: true,
  });

  // Data/hora do último sync do Track123 (por loja) — mostrado ao lado do
  // botão Atualizar pra dar visibilidade de quão "fresco" é o rastreio.
  const { data: integrations = [] } = useQuery({
    queryKey: ["lg-logistics-integrations", cacheKey],
    queryFn: () => integrationsFn({ data: { shop_ids: shopIds } }),
    enabled: shopIds.length > 0,
    refetchInterval: 60_000,
  });

  // Botão "Atualizar": além de reler o banco, busca rastreio novo no Track123
  // agora (as lojas sem integração configurada são só ignoradas).
  const sync = useMutation({
    mutationFn: () => syncFn({ data: { shop_ids: shopIds } }),
    onSuccess: (r: any) => {
      if (r.total === 0) toast.info("Nenhuma loja com integração Track123 ativa");
      else if (r.errors.length) toast.error(`${r.synced}/${r.total} lojas sincronizadas · ${r.errors[0]}`);
      else toast.success(`${r.synced}/${r.total} loja(s) sincronizada(s)`);
      qc.invalidateQueries({ queryKey: ["lg-logistics", cacheKey] });
      qc.invalidateQueries({ queryKey: ["lg-logistics-integrations", cacheKey] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao sincronizar"),
  });

  const shopNames: Record<string, string> = {};
  for (const s of shops) shopNames[s.id] = s.name;
  const isConsolidated = shopIds.length > 1;

  const scopedIntegrations = shopFilter === "todas" ? integrations : (integrations as any[]).filter((i) => i.shop_id === shopFilter);
  const lastSyncAt = (scopedIntegrations as any[]).reduce((max: string | null, i) => (
    i.last_sync_at && (!max || i.last_sync_at > max) ? i.last_sync_at : max
  ), null as string | null);

  const save = useMutation({
    mutationFn: (vars: any) => updateFn({ data: vars }),
    onSuccess: () => {
      toast.success("Logística atualizada");
      qc.invalidateQueries({ queryKey: ["lg-logistics", cacheKey] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Toggle silencioso do checkbox "Fora do KPI" — sem toast, só recalcula os KPIs.
  const toggleKpi = useMutation({
    mutationFn: (vars: any) => updateFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lg-logistics", cacheKey] }),
    onError: (e: any) => toast.error(e.message),
  });

  // Contagens (cards de status + "precisa de atenção") sempre com todos os
  // pedidos do período — "fora do KPI" não deve sumir da contagem, só não deve
  // distorcer as médias de tempo abaixo (ex: pedido parado esperando cliente
  // infla o tempo médio de postagem/entrega sem ser culpa da loja). Já o filtro
  // de loja recorta os KPIs também: quando uma loja específica está selecionada,
  // os cards mostram só os números dela.
  const allOrders = orders as any[];
  const shopScopedOrders = shopFilter === "todas" ? allOrders : allOrders.filter((o) => o.shop_id === shopFilter);
  const kpis = {
    pending:   shopScopedOrders.filter((o) => inBucket(o, "pending")).length,
    shipped:   shopScopedOrders.filter((o) => inBucket(o, "shipped")).length,
    delivered: shopScopedOrders.filter((o) => inBucket(o, "delivered")).length,
    problem:   shopScopedOrders.filter((o) => inBucket(o, "problem")).length,
  };
  const attentionCount = shopScopedOrders.filter((o) => needsAttention(o, nowMs)).length;
  const waitingCustomerCount = shopScopedOrders.filter((o) => inBucket(o, "waiting_customer")).length;

  // Breakdown por loja do total de pedidos — só faz sentido mostrar quando a
  // visão está consolidada (várias lojas) e nenhum filtro de loja específica
  // já recortou o total sozinho.
  const perStoreCounts = [...shopIds]
    .sort((a, b) => (shopNames[a] ?? "").localeCompare(shopNames[b] ?? "", "pt-BR", { numeric: true }))
    .map((id) => ({ id, name: shopNames[id] ?? id, count: allOrders.filter((o) => o.shop_id === id).length }));

  const kpiOrders = shopScopedOrders.filter((o) => !o.kpi_excluded);

  // Tempo médio de postagem: dias entre o pedido (order_date) e a etiqueta (shipped_at)
  const postingDurations = kpiOrders
    .filter((o) => o.order_date && o.shipped_at)
    .map((o) => (new Date(o.shipped_at).getTime() - new Date(o.order_date).getTime()) / 86_400_000)
    .filter((d) => d >= 0);
  const avgPostingDays = postingDurations.length
    ? postingDurations.reduce((a, b) => a + b, 0) / postingDurations.length
    : null;

  // Tempo médio de entrega: dias entre postagem (shipped_at) e entrega (delivered_at)
  const deliveryDurations = kpiOrders
    .filter((o) => o.shipped_at && o.delivered_at)
    .map((o) => (new Date(o.delivered_at).getTime() - new Date(o.shipped_at).getTime()) / 86_400_000)
    .filter((d) => d >= 0);
  const avgDeliveryDays = deliveryDurations.length
    ? deliveryDurations.reduce((a, b) => a + b, 0) / deliveryDurations.length
    : null;

  const searchTerm = search.trim().toLowerCase().replace(/^#/, "");
  // Buscar pedido ignora os filtros de status e loja — é pra achar o pedido
  // onde quer que ele esteja (ex: já entregue, numa loja fora do filtro
  // atual), não só dentro do recorte ativo. O status/loja de cada linha
  // continuam visíveis na tabela pra mostrar onde ele foi encontrado.
  const byStatus = statusFilter === "todos" ? allOrders
    : statusFilter === "atencao" ? allOrders.filter((o) => needsAttention(o, nowMs))
    : allOrders.filter((o) => inBucket(o, statusFilter));
  const byShop = shopFilter === "todas" ? byStatus : byStatus.filter((o) => o.shop_id === shopFilter);
  const visibleOrders = !searchTerm ? byShop
    : allOrders.filter((o) => orderLabel(o).toLowerCase().replace(/^#/, "").includes(searchTerm));
  // Sempre por data do pedido, do mais antigo pro mais novo — é o que
  // precisa de ação primeiro.
  const sortedOrders = [...visibleOrders].sort((a, b) => {
    const dateCmp = (a.order_date as string).localeCompare(b.order_date as string);
    return dateCmp !== 0 ? dateCmp : orderNum(a) - orderNum(b);
  });

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <button
          onClick={() => setStatusFilter(statusFilter === "atencao" ? "todos" : "atencao")}
          className={cn(
            "rounded-xl border p-3 text-left transition-all",
            statusFilter === "atencao" ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="size-7 rounded-lg grid place-items-center shrink-0 bg-rose-500/10">
              <AlertTriangle className="size-4 text-rose-600" />
            </div>
            <p className="text-xl font-bold text-foreground">{attentionCount}</p>
          </div>
          <p className="text-xs text-muted-foreground">Precisa de atenção</p>
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === "waiting_customer" ? "todos" : "waiting_customer")}
          className={cn(
            "rounded-xl border p-3 text-left transition-all",
            statusFilter === "waiting_customer" ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-muted/30",
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="size-7 rounded-lg grid place-items-center shrink-0 bg-violet-500/10">
              <Hourglass className="size-4 text-violet-600" />
            </div>
            <p className="text-xl font-bold text-foreground">{waitingCustomerCount}</p>
          </div>
          <p className="text-xs text-muted-foreground">Esperando o cliente</p>
        </button>
        {([
          { key: "pending",   label: "Pendente envio", color: "amber",   icon: Package },
          { key: "shipped",   label: "Em trânsito",    color: "blue",    icon: Truck },
          { key: "delivered", label: "Entregues",       color: "emerald", icon: CheckCircle2 },
        ] as const).map(({ key, label, color, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(statusFilter === key ? "todos" : key)}
            className={cn(
              "rounded-xl border p-3 text-left transition-all",
              statusFilter === key ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-muted/30",
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={cn(
                "size-7 rounded-lg grid place-items-center shrink-0",
                color === "amber"   && "bg-amber-500/10",
                color === "blue"    && "bg-blue-500/10",
                color === "emerald" && "bg-emerald-500/10",
              )}>
                <Icon className={cn(
                  "size-4",
                  color === "amber"   && "text-amber-600",
                  color === "blue"    && "text-blue-600",
                  color === "emerald" && "text-emerald-600",
                )} />
              </div>
              <p className="text-xl font-bold text-foreground">
                {kpis[key]}
                {key === "delivered" && (
                  <span className="text-xs font-normal text-muted-foreground"> / {shopScopedOrders.length}</span>
                )}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
          </button>
        ))}
        <div
          className="rounded-xl border border-border bg-surface p-3 text-left"
          title={isConsolidated && shopFilter === "todas"
            ? perStoreCounts.map((s) => `${s.name}: ${s.count}`).join("\n")
            : undefined}
        >
          <div className="flex items-center gap-2 mb-1">
            <div className="size-7 rounded-lg grid place-items-center shrink-0 bg-slate-500/10">
              <Layers className="size-4 text-slate-600" />
            </div>
            <p className="text-xl font-bold text-foreground">{shopScopedOrders.length}</p>
          </div>
          <p className="text-xs text-muted-foreground">Total de pedidos</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center gap-2 mb-1">
            <div className="size-7 rounded-lg grid place-items-center shrink-0 bg-indigo-500/10">
              <Clock className="size-4 text-indigo-600" />
            </div>
            <p className="text-xl font-bold text-foreground">
              {avgPostingDays != null ? `${avgPostingDays.toFixed(1)}d` : "—"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">TM Postagem</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center gap-2 mb-1">
            <div className="size-7 rounded-lg grid place-items-center shrink-0 bg-violet-500/10">
              <Clock className="size-4 text-violet-600" />
            </div>
            <p className="text-xl font-bold text-foreground">
              {avgDeliveryDays != null ? `${avgDeliveryDays.toFixed(1)}d` : "—"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">TM Entrega</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          period={period} setPeriod={setPeriod}
          customRange={customRange} setCustomRange={setCustomRange}
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar pedido (ex: WV1307)"
          className="h-8 w-44 text-xs"
        />
        {isConsolidated && (
          <select
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
          >
            <option value="todas">Todas as lojas</option>
            {[...shopIds]
              .sort((a, b) => (shopNames[a] ?? "").localeCompare(shopNames[b] ?? "", "pt-BR", { numeric: true }))
              .map((id) => (
                <option key={id} value={id}>{shopNames[id] ?? id}</option>
              ))}
          </select>
        )}
        <Button
          size="sm" variant="outline"
          onClick={() => sync.mutate()}
          disabled={isLoading || sync.isPending}
          title="Busca rastreio novo no Track123 e recarrega os pedidos"
        >
          <RefreshCw className={cn("size-4", (isLoading || sync.isPending) && "animate-spin")} /> Atualizar
        </Button>
        <span
          className="text-xs text-muted-foreground"
          title={lastSyncAt ? new Date(lastSyncAt).toLocaleString("pt-BR") : undefined}
        >
          Sincronizado {timeAgo(lastSyncAt)}
        </span>
        {(statusFilter !== "todos" || shopFilter !== "todas" || search) && (
          <Button size="sm" variant="ghost" onClick={() => { setStatusFilter("todos"); setShopFilter("todas"); setSearch(""); }}>
            Limpar filtro
          </Button>
        )}
      </div>

      {/* Orders table */}
      {/* Colunas fr espremiam o cabeçalho em mobile (ex: "Fora do KPI" quebrado
          em 3 linhas) e overflow-hidden cortava o resto; agora rola horizontal. */}
      <div className="rounded-2xl border border-border bg-surface overflow-x-auto">
        {isLoading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin mx-auto mb-2" />
            Carregando pedidos...
          </div>
        )}

        {!isLoading && sortedOrders.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum pedido no período.
          </div>
        )}

        {!isLoading && sortedOrders.length > 0 && (
        <div className="min-w-[960px]">
        <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr_0.8fr_1.1fr_1fr_1.2fr_110px_100px] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border items-center">
          <div>Pedido</div>
          <div className="text-center">Data do Pedido</div>
          <div className="text-center">Data Postado</div>
          <div className="text-center">Tempo de entrega</div>
          <div>Rastreio</div>
          <div>Status</div>
          <div>Obs</div>
          <div className="text-center">Aguarda cliente</div>
          <div className="text-center" title="Exclui o pedido da contagem dos KPIs acima (ex: problema causado pelo cliente)">Fora do KPI</div>
        </div>

        {sortedOrders.map((o: any, i: number) => (
            <div
              key={o.id}
              className={cn(
                "grid grid-cols-[1.2fr_0.9fr_0.9fr_0.8fr_1.1fr_1fr_1.2fr_110px_100px] gap-3 px-4 py-2.5 items-center hover:bg-muted/30 transition-colors cursor-pointer text-sm",
                i > 0 && "border-t border-border/60",
              )}
              onClick={() => setEditingOrder(o)}
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{orderLabel(o)}</p>
                {isConsolidated && <p className="text-[10px] font-medium text-primary truncate">{shopNames[o.shop_id] ?? ""}</p>}
              </div>
              <div className="text-xs text-muted-foreground text-center">{fmtShortDate(o.order_date)}</div>
              <div className="text-xs text-muted-foreground text-center">{fmtShortDate(o.shipped_at)}</div>
              <div className="text-xs text-muted-foreground text-center">{deliveryTimeLabel(o, nowMs)}</div>
              <div className="text-xs truncate">
                {o.tracking_url ? (
                  <a
                    href={o.tracking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {o.tracking_code ?? "Ver"} <ExternalLink className="size-3" />
                  </a>
                ) : o.tracking_code ? (
                  <span className="text-muted-foreground">{o.tracking_code}</span>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </div>
              <div>
                <StatusBadge status={o.delivery_status ?? "pending_shipment"} />
                {attentionReason(o, nowMs) && (
                  <p className="text-[10px] text-rose-600 mt-0.5">{attentionReason(o, nowMs)}</p>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">{o.logistics_note || "—"}</div>
              <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={o.delivery_status === "waiting_customer"}
                  onChange={(e) => toggleKpi.mutate({
                    order_id: o.id,
                    delivery_status: e.target.checked ? "waiting_customer" : (o.shipped_at ? "shipped" : "pending_shipment"),
                  })}
                  title="Marca o pedido como esperando resposta do cliente (endereço, troca de tamanho, confirmação...)"
                  className="size-4 rounded border-border accent-primary cursor-pointer"
                />
              </div>
              <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={!!o.kpi_excluded}
                  onChange={(e) => toggleKpi.mutate({ order_id: o.id, kpi_excluded: e.target.checked })}
                  title="Excluir este pedido da contagem dos KPIs (ex: problema causado pelo cliente)"
                  className="size-4 rounded border-border accent-primary cursor-pointer"
                />
              </div>
            </div>
        ))}
        </div>
        )}
      </div>

      {/* Edit modal */}
      {editingOrder && (
        <EditLogisticsModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSave={(patch) => save.mutateAsync({ order_id: editingOrder.id, ...patch })}
        />
      )}
    </div>
  );
}

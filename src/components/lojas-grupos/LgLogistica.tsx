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
import { inBucket, daysSince, attentionReason, needsAttention, computeLogisticsKpis } from "@/lib/logistics-kpis";

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
// Tempo de entrega: só faz sentido depois que o pedido foi realmente
// entregue (postagem → entrega). Enquanto isso não acontece, mostra "—" em
// vez de um contador correndo — isso é o "Xd sem entrega" do alerta, não o
// tempo de entrega.
function deliveryTimeLabel(o: any, _nowMs: number): string {
  if (!o.shipped_at || !o.delivered_at) return "—";
  const d = daysSince(o.shipped_at, new Date(o.delivered_at).getTime());
  return d != null ? `${Math.floor(d)}d` : "—";
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
    refetchIntervalInBackground: false,
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
  // Buscando um pedido, os KPIs também recortam pra só ele — mostra em qual
  // card ele está (ex: "Em trânsito"), em vez de continuar contando todo o
  // período como se a busca não existisse.
  const searchTerm = search.trim().toLowerCase().replace(/^#/, "");
  const kpiScopedOrders = !searchTerm ? shopScopedOrders
    : shopScopedOrders.filter((o) => orderLabel(o).toLowerCase().replace(/^#/, "").includes(searchTerm));
  // Mesma conta do Dashboard (ver logistics-kpis.ts).
  const shared = computeLogisticsKpis(kpiScopedOrders, nowMs);
  const kpis = { pending: shared.pending, shipped: shared.shipped, delivered: shared.delivered, problem: shared.problem };
  const attentionCount = shared.attention;
  const waitingCustomerCount = shared.waitingCustomer;

  // Breakdown por loja do total de pedidos — só faz sentido mostrar quando a
  // visão está consolidada (várias lojas) e nenhum filtro de loja específica
  // já recortou o total sozinho.
  const perStoreCounts = [...shopIds]
    .sort((a, b) => (shopNames[a] ?? "").localeCompare(shopNames[b] ?? "", "pt-BR", { numeric: true }))
    .map((id) => ({ id, name: shopNames[id] ?? id, count: allOrders.filter((o) => o.shop_id === id).length }));

  const avgPostingDays = shared.avgPostingDays;
  const avgDeliveryDays = shared.avgDeliveryDays;

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
                  <span className="text-xs font-normal text-muted-foreground"> / {kpiScopedOrders.length}</span>
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
            <p className="text-xl font-bold text-foreground">{kpiScopedOrders.length}</p>
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

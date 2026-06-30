import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listLogisticsOrders, updateOrderLogistics } from "@/lib/lg-logistics.functions";
import { RefreshCw, Package, Truck, CheckCircle2, AlertTriangle, ExternalLink, ChevronRight } from "lucide-react";
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

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Package }> = {
  pending_shipment: { label: "Pendente envio", color: "amber",   icon: Package },
  shipped:          { label: "Enviado",         color: "blue",    icon: Truck },
  in_transit:       { label: "Em trânsito",     color: "blue",    icon: Truck },
  delivered:        { label: "Entregue",         color: "emerald", icon: CheckCircle2 },
  returned:         { label: "Devolvido",        color: "rose",    icon: AlertTriangle },
  problem:          { label: "Problema",         color: "rose",    icon: AlertTriangle },
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
  const [saving, setSaving]             = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ carrier: carrier || null, tracking_code: trackingCode || null, tracking_url: trackingUrl || null, delivery_status: status });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Logística — #{order.order_number ?? order.id.slice(0, 8)}</DialogTitle>
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
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [editingOrder, setEditingOrder] = useState<any | null>(null);
  const [expandedDay, setExpandedDay]   = useState<Set<string>>(new Set());

  const today = isoDate(new Date());
  const from = (() => {
    if (period === "7d")  return addD(today, -6);
    if (period === "mes") { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; }
    return addD(today, -29);
  })();

  const listFn   = useServerFn(listLogisticsOrders);
  const updateFn = useServerFn(updateOrderLogistics);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["lg-logistics", cacheKey, from, today, statusFilter],
    queryFn: () => listFn({ data: { shop_ids: shopIds, from, to: today, delivery_status: statusFilter === "todos" ? undefined : statusFilter } }),
    enabled: shopIds.length > 0,
  });

  const shopNames: Record<string, string> = {};
  for (const s of shops) shopNames[s.id] = s.name;
  const isConsolidated = shopIds.length > 1;

  const save = useMutation({
    mutationFn: (vars: any) => updateFn({ data: vars }),
    onSuccess: () => {
      toast.success("Logística atualizada");
      qc.invalidateQueries({ queryKey: ["lg-logistics", cacheKey] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // KPIs
  const allOrders = orders as any[];
  const kpis = {
    pending:   allOrders.filter((o) => o.delivery_status === "pending_shipment" || !o.delivery_status).length,
    shipped:   allOrders.filter((o) => o.delivery_status === "shipped" || o.delivery_status === "in_transit").length,
    delivered: allOrders.filter((o) => o.delivery_status === "delivered").length,
    problem:   allOrders.filter((o) => o.delivery_status === "problem" || o.delivery_status === "returned").length,
  };

  // Group by date
  const byDate = new Map<string, any[]>();
  for (const o of allOrders) {
    const d = o.order_date as string;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(o);
  }
  const groups = Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  const toggleDay = (date: string) => {
    setExpandedDay((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { key: "pending",   label: "Pendente envio", color: "amber",   icon: Package },
          { key: "shipped",   label: "Em trânsito",    color: "blue",    icon: Truck },
          { key: "delivered", label: "Entregues",       color: "emerald", icon: CheckCircle2 },
          { key: "problem",   label: "Com problema",   color: "rose",    icon: AlertTriangle },
        ] as const).map(({ key, label, color, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(statusFilter === key ? "todos" : key)}
            className={cn(
              "rounded-xl border p-3 text-left transition-all",
              statusFilter === key ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-muted/30",
            )}
          >
            <div className={cn(
              "size-7 rounded-lg grid place-items-center mb-2",
              color === "amber"   && "bg-amber-500/10",
              color === "blue"    && "bg-blue-500/10",
              color === "emerald" && "bg-emerald-500/10",
              color === "rose"    && "bg-rose-500/10",
            )}>
              <Icon className={cn(
                "size-4",
                color === "amber"   && "text-amber-600",
                color === "blue"    && "text-blue-600",
                color === "emerald" && "text-emerald-600",
                color === "rose"    && "text-rose-600",
              )} />
            </div>
            <p className="text-xl font-bold text-foreground">{kpis[key]}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-border overflow-hidden text-xs h-8">
          {(["7d", "mes", "30d"] as const).map((p, i, arr) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 h-full transition-colors",
                i < arr.length - 1 && "border-r border-border",
                period === p ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p === "7d" ? "7 dias" : p === "mes" ? "Este mês" : "30 dias"}
            </button>
          ))}
        </div>
        <Button
          size="sm" variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["lg-logistics", cacheKey] })}
          disabled={isLoading}
        >
          <RefreshCw className={cn("size-4", isLoading && "animate-spin")} /> Atualizar
        </Button>
        {statusFilter !== "todos" && (
          <Button size="sm" variant="ghost" onClick={() => setStatusFilter("todos")}>
            Limpar filtro
          </Button>
        )}
      </div>

      {/* Orders table */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="grid grid-cols-[24px_120px_1fr_120px_140px_100px] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <div />
          <div>Data</div>
          <div>Pedido</div>
          <div>Transportadora</div>
          <div>Rastreio</div>
          <div>Status</div>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin mx-auto mb-2" />
            Carregando pedidos...
          </div>
        )}

        {!isLoading && groups.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum pedido no período.
          </div>
        )}

        {groups.map(([date, dayOrders], i) => {
          const d = new Date(date + "T00:00:00");
          const weekday  = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
          const dayMonth = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
          const isOpen   = expandedDay.has(date);

          return (
            <div key={date} className={cn(i > 0 && "border-t border-border/60")}>
              {/* Day header */}
              <div
                className="grid grid-cols-[24px_120px_1fr_120px_140px_100px] gap-3 px-4 py-2.5 items-center hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => toggleDay(date)}
              >
                <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground uppercase">{weekday}</span>
                  <span className="text-sm font-semibold text-foreground">{dayMonth}</span>
                </div>
                <div className="text-xs text-muted-foreground">{dayOrders.length} pedido{dayOrders.length !== 1 ? "s" : ""}</div>
                <div />
                <div />
                <div />
              </div>

              {/* Expanded order rows */}
              {isOpen && (
                <div className="bg-muted/20 border-t border-border/40">
                  {dayOrders.map((o: any) => (
                    <div
                      key={o.id}
                      className="grid grid-cols-[24px_120px_1fr_120px_140px_100px] gap-3 px-4 py-2 items-center border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer text-sm"
                      onClick={() => setEditingOrder(o)}
                    >
                      <div />
                      <div className="text-xs text-muted-foreground">
                        {isConsolidated && <span className="block text-[10px] font-medium text-primary">{shopNames[o.shop_id] ?? ""}</span>}
                        {dayMonth}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">#{o.order_number ?? o.id.slice(0, 8)}</p>
                        {o.customer_name && <p className="text-xs text-muted-foreground truncate">{o.customer_name}</p>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{o.carrier ?? "—"}</div>
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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

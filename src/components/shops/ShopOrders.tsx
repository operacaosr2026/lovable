import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getOrderSettings,
  listOrders, syncShopifyOrders, recomputeRange,
  updateUnitCost, listCostHistory,
  markOrdersPaid, markOrdersShipped, listPaymentBatches, undoOrderPayment,
} from "@/lib/shop-orders.functions";
import { listOrdersTracking, setOrderTracking, getTrack123Integration } from "@/lib/track123.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, RefreshCw, History, DollarSign, ChevronRight, CheckCircle2, Truck, Undo2, Copy, ExternalLink, Package, Clock, MapPin, AlertTriangle, PackageX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PROCESSING_DELAY_DAYS = 7;

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}
function localDate(date: string) { return new Date(date + "T00:00:00"); }
function fmtMoney(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }
const EVENT_LABEL_TRANSLATIONS: [RegExp, string][] = [
  [/^order received$/i, "Pedido recebido"],
  [/^shipment information received$/i, "Informações de envio recebidas"],
  [/^accepted by carrier$/i, "Aceito pela transportadora"],
  [/^shipment picked up$/i, "Coletado pela transportadora"],
  [/^departed from sorting center$/i, "Saiu do centro de triagem"],
  [/^arrived at sorting center$/i, "Chegou ao centro de triagem"],
  [/^arrived at destination$/i, "Chegou ao destino"],
  [/^in transit$/i, "Em trânsito"],
  [/^out for delivery$/i, "Saiu para entrega"],
  [/^delivered$/i, "Entregue"],
  [/^failed delivery attempt$/i, "Tentativa de entrega falhou"],
  [/^expired$/i, "Expirado"],
  [/^exception$/i, "Exceção"],
  [/^started the customs clearance/i, "Iniciou o desembaraço aduaneiro"],
  [/^customs clearance (has been )?completed/i, "Desembaraço aduaneiro concluído"],
  [/^held by customs/i, "Retido na alfândega"],
  [/^arrived at the destination country/i, "Chegou ao país de destino"],
  [/^arrived at (a |the )?(local )?facility/i, "Chegou a uma unidade local"],
  [/^processed (at|through) (a |the )?facility/i, "Processado em uma unidade"],
  [/^shipment is on its way$/i, "Pedido a caminho"],
  [/^arriving (on time|early)/i, "Chegada prevista no prazo"],
  [/^clearance processing completed at destination$/i, "Processo aduaneiro concluído"],
];

function translateEventLabel(label: string): string {
  // Strip a leading "US, " / "BR, " country-code prefix before matching.
  const text = label.trim().replace(/^[A-Z]{2},\s*/, "");
  for (const [re, pt] of EVENT_LABEL_TRANSLATIONS) {
    if (re.test(text)) return pt;
  }
  return label;
}

function customerName(o: any): string | null {
  const r = o?.raw ?? {};
  const c = r.customer ?? {};
  const sa = r.shipping_address ?? {};
  const ba = r.billing_address ?? {};
  const name =
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
    sa.name || [sa.first_name, sa.last_name].filter(Boolean).join(" ").trim() ||
    ba.name || [ba.first_name, ba.last_name].filter(Boolean).join(" ").trim() ||
    c.email || r.email || r.contact_email;
  return name ? String(name) : null;
}

type FilterKey = "all" | "pending" | "paid" | "shipped" | "partial";

type LogisticsKey = "no_tracking" | "no_info" | "in_transit" | "delivered" | "problem";

const LOGISTICS_CATEGORIES: { key: LogisticsKey; label: string; sub: string; icon: React.ComponentType<{ className?: string }>; tone: KpiTone }[] = [
  { key: "no_tracking", label: "Sem tracking", sub: "sem código de rastreio", icon: PackageX, tone: "amber" },
  { key: "no_info", label: "Sem informação", sub: "aguardando atualização", icon: Clock, tone: "violet" },
  { key: "in_transit", label: "Em trânsito", sub: "movimentando", icon: MapPin, tone: "sky" },
  { key: "delivered", label: "Entregues", sub: "finalizados", icon: CheckCircle2, tone: "emerald" },
  { key: "problem", label: "Problemas", sub: "requer atenção", icon: AlertTriangle, tone: "rose" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  shipped: "Enviado",
};
const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  shipped: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  partial: "bg-violet-500/10 text-violet-600 border-violet-500/20",
};

export function ShopOrders({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return isoDate(d); });
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [openCost, setOpenCost] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [payOpen, setPayOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [batchesOpen, setBatchesOpen] = useState(false);
  const [logisticsView, setLogisticsView] = useState<LogisticsKey | null>(null);

  const getSettingsFn = useServerFn(getOrderSettings);
  const listOrdersFn = useServerFn(listOrders);
  const syncFn = useServerFn(syncShopifyOrders);
  const recomputeRangeFn = useServerFn(recomputeRange);
  const payFn = useServerFn(markOrdersPaid);
  const shipFn = useServerFn(markOrdersShipped);

  const settings = useQuery({ queryKey: ["order-settings", shopId], queryFn: () => getSettingsFn({ data: { shop_id: shopId } }) });
  const orders = useQuery({ queryKey: ["orders", shopId, from, to], queryFn: () => listOrdersFn({ data: { shop_id: shopId, from, to } }) });

  const listTrackingFn = useServerFn(listOrdersTracking);
  const getTrack123Fn = useServerFn(getTrack123Integration);
  const track123 = useQuery({ queryKey: ["track123-integration", shopId], queryFn: () => getTrack123Fn({ data: { shop_id: shopId } }) });
  const trackings = useQuery({
    queryKey: ["order-trackings", shopId],
    queryFn: () => listTrackingFn({ data: { shop_id: shopId } }),
  });
  const trackingByOrder = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of trackings.data ?? []) m.set(t.order_id, t);
    return m;
  }, [trackings.data]);
  const trackingTemplate = track123.data?.tracking_link_template ?? "";

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { shop_id: shopId, since_days: 30 } }),
    onSuccess: (r) => {
      toast.success(`${r.synced} pedidos sincronizados`);
      qc.invalidateQueries({ queryKey: ["orders", shopId] });
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const recompute = useMutation({
    mutationFn: () => recomputeRangeFn({ data: { shop_id: shopId, from_processing: from, to_processing: to } }),
    onSuccess: () => { toast.success("Recalculado"); qc.invalidateQueries({ queryKey: ["shop-cash"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const unitCost = Number(settings.data?.default_unit_cost ?? 0);

  // Group orders by date + compute status per day
  const groups = useMemo(() => {
    const m = new Map<string, { items: number; revenue: number; orders: any[]; pending: number; paid: number; shipped: number }>();
    for (const o of orders.data ?? []) {
      const cur = m.get(o.order_date) ?? { items: 0, revenue: 0, orders: [], pending: 0, paid: 0, shipped: 0 };
      cur.items += Number(o.items_count ?? 0);
      cur.revenue += Number(o.revenue ?? 0);
      cur.orders.push(o);
      cur[o.payment_status as "pending" | "paid" | "shipped"] += 1;
      m.set(o.order_date, cur);
    }
    return Array.from(m.entries())
      .map(([date, agg]) => {
        const total = agg.orders.length;
        let status: FilterKey = "pending";
        if (agg.shipped === total) status = "shipped";
        else if (agg.paid + agg.shipped === total) status = "paid";
        else if (agg.paid > 0 || agg.shipped > 0) status = "partial";
        return { date, ...agg, status, total };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [orders.data]);

  // KPIs
  const kpis = useMemo(() => {
    const logistics: Record<LogisticsKey, { order: any; tracking: any }[]> = {
      no_tracking: [], no_info: [], in_transit: [], delivered: [], problem: [],
    };
    for (const g of groups) {
      for (const o of g.orders) {
        const t = trackingByOrder.get(o.id);
        if (!t?.tracking_number) {
          if (!o.problem_at && !o.delivered_at) logistics.no_tracking.push({ order: o, tracking: t });
          continue;
        }
        let bucket: LogisticsKey;
        if (o.problem_at) bucket = "problem";
        else if (o.delivered_at) bucket = "delivered";
        else if (!t.last_event_at && !t.tracking_status) {
          const ageDays = (Date.now() - new Date(t.created_at).getTime()) / 86400_000;
          bucket = ageDays > 10 ? "problem" : "no_info";
        } else bucket = "in_transit";
        logistics[bucket].push({ order: o, tracking: t });
      }
    }
    return { logistics };
  }, [groups, trackingByOrder]);


  // Filtered groups
  const visibleGroups = useMemo(() => {
    if (filter === "all") return groups;
    return groups.filter((g) => g.status === filter);
  }, [groups, filter]);

  function toggleDay(date: string, checked: boolean) {
    const g = groups.find((x) => x.date === date);
    if (!g) return;
    const next = new Set(selectedOrders);
    for (const o of g.orders) {
      if (o.payment_status === "pending" || o.payment_status === "paid") {
        if (checked) next.add(o.id); else next.delete(o.id);
      }
    }
    setSelectedOrders(next);
  }
  function toggleOrder(id: string, checked: boolean) {
    const next = new Set(selectedOrders);
    if (checked) next.add(id); else next.delete(id);
    setSelectedOrders(next);
  }
  function toggleExpand(date: string) {
    const next = new Set(expanded);
    if (next.has(date)) next.delete(date); else next.add(date);
    setExpanded(next);
  }

  const selectedSummary = useMemo(() => {
    let items = 0, count = 0, pendingIds: string[] = [], paidIds: string[] = [];
    const dates = new Set<string>();
    for (const g of groups) {
      for (const o of g.orders) {
        if (selectedOrders.has(o.id)) {
          items += Number(o.items_count ?? 0);
          count += 1;
          dates.add(o.order_date);
          if (o.payment_status === "pending") pendingIds.push(o.id);
          else if (o.payment_status === "paid") paidIds.push(o.id);
        }
      }
    }
    return { items, count, amount: items * unitCost, dates: Array.from(dates).sort(), pendingIds, paidIds };
  }, [selectedOrders, groups, unitCost]);


  // Paid orders ready to ship (selection for shipping action)
  const paidSelectable = useMemo(() => {
    const ids: string[] = [];
    for (const g of groups) for (const o of g.orders) if (o.payment_status === "paid") ids.push(o.id);
    return ids;
  }, [groups]);

  const pay = useMutation({
    mutationFn: (date: string) => payFn({ data: { shop_id: shopId, order_ids: Array.from(selectedOrders), payment_date: date } }),
    onSuccess: (r) => {
      toast.success(`Lote #${r.batch_number} criado · ${fmtMoney(Number(r.total_amount))}`);
      setSelectedOrders(new Set());
      setPayOpen(false);
      qc.invalidateQueries({ queryKey: ["orders", shopId] });
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
      qc.invalidateQueries({ queryKey: ["batches", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ship = useMutation({
    mutationFn: (vars: { ids: string[]; date: string }) => shipFn({ data: { shop_id: shopId, order_ids: vars.ids, shipped_date: vars.date } }),
    onSuccess: () => {
      toast.success("Pedidos marcados como enviados");
      setShipOpen(false);
      qc.invalidateQueries({ queryKey: ["orders", shopId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const hasSelection = selectedOrders.size > 0;

  return (
    <div className="space-y-5">
      {/* Dashboard operacional */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Logística</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {LOGISTICS_CATEGORIES.map((c) => {
            const items = kpis.logistics[c.key];
            return (
              <Kpi
                key={c.key}
                icon={c.icon}
                label={c.label}
                value={String(items.length)}
                tone={c.tone}
                onClick={() => setLogisticsView(c.key)}
              />
            );
          })}
        </div>
      </div>


      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
        <span className="text-muted-foreground text-sm">→</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
        <Button onClick={() => sync.mutate()} disabled={sync.isPending} size="sm">
          {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sincronizar pedidos
        </Button>
        <div className="flex-1" />
        <Button onClick={() => setOpenCost(true)} size="sm" variant="outline">
          <DollarSign className="size-4" /> Custo: {fmtMoney(unitCost)}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        {([
          ["all", "Todos"],
          ["pending", "Pendentes"],
          ["paid", "Pagos"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-md border transition-colors",
              filter === k ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Selection bar */}
      {hasSelection && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="text-sm">
            <span className="font-medium">{selectedSummary.count}</span> pedidos · {selectedSummary.items} itens ·{" "}
            <span className="font-semibold tabular-nums">{fmtMoney(selectedSummary.amount)}</span>
          </div>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSelectedOrders(new Set())}>Limpar</Button>
          {selectedSummary.pendingIds.length > 0 && (
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <CheckCircle2 className="size-4" /> Marcar como pago ({selectedSummary.pendingIds.length})
            </Button>
          )}
        </div>
      )}

      {/* Select-all bar */}
      {visibleGroups.length > 0 && (() => {
        const allIds: string[] = [];
        for (const g of visibleGroups) for (const o of g.orders) if (o.payment_status === "pending" || o.payment_status === "paid") allIds.push(o.id);
        const allSelected = allIds.length > 0 && allIds.every((id) => selectedOrders.has(id));
        const someSel = allIds.some((id) => selectedOrders.has(id));
        return (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-muted/20 text-xs">
            <Checkbox
              checked={allSelected ? true : someSel ? "indeterminate" : false}
              disabled={allIds.length === 0}
              onCheckedChange={(v) => {
                const next = new Set(selectedOrders);
                if (v) allIds.forEach((id) => next.add(id));
                else allIds.forEach((id) => next.delete(id));
                setSelectedOrders(next);
              }}
            />
            <span className="text-muted-foreground">
              Selecionar todos ({allIds.length} pedidos pendentes/pagos no filtro)
            </span>
          </div>
        );
      })()}

      {/* List */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        {visibleGroups.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum pedido no período/filtro.
          </div>
        )}
        {visibleGroups.map((g, i) => {
          const cost = g.items * unitCost;
          const d = localDate(g.date);
          const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
          const dayMonth = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
          const isOpen = expanded.has(g.date);
          const selectableInDay = g.orders.filter((o) => o.payment_status === "pending" || o.payment_status === "paid");
          const allSelected = selectableInDay.length > 0 && selectableInDay.every((o) => selectedOrders.has(o.id));
          const someSelected = selectableInDay.some((o) => selectedOrders.has(o.id));
          return (
            <div key={g.date} className={cn(i > 0 && "border-t border-border/60")}>
              <div
                className="grid grid-cols-[28px_24px_110px_1fr_120px_140px_140px_110px] gap-3 px-4 py-2.5 text-sm items-center hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => toggleExpand(g.date)}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => toggleDay(g.date, !!v)}
                    disabled={selectableInDay.length === 0}
                  />
                </div>
                <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground text-xs uppercase">{weekday}</span>
                  <span className="font-medium tabular-nums">{dayMonth}</span>
                </div>
                <div className="text-muted-foreground text-xs">
                  <span className="tabular-nums text-foreground font-medium">{g.total}</span> pedidos ·{" "}
                  <span className="tabular-nums text-foreground font-medium">{g.items}</span> itens
                </div>
                <div className="tabular-nums text-muted-foreground"><span className="text-[11px] uppercase tracking-wide mr-1.5">Fat</span>{fmtMoney(g.revenue)}</div>
                <div className="tabular-nums font-semibold text-destructive"><span className="text-[11px] uppercase tracking-wide mr-1.5 text-muted-foreground font-normal">Custo</span>{fmtMoney(cost)}</div>
                <div className="tabular-nums text-muted-foreground text-xs">
                  D+{PROCESSING_DELAY_DAYS}: {localDate(addDays(g.date, PROCESSING_DELAY_DAYS)).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </div>
                <div>
                  <Badge variant="outline" className={cn("text-[11px] font-medium", STATUS_TONE[g.status])}>
                    {g.status === "partial" ? "Parcial" : STATUS_LABEL[g.status]}
                  </Badge>
                </div>
              </div>


              {isOpen && (
                <div className="bg-muted/20 border-t border-border/60">
                  {g.orders.map((o) => {
                    const sel = selectedOrders.has(o.id);
                    const t = trackingByOrder.get(o.id);
                    return (
                      <div key={o.id} className="grid grid-cols-[28px_24px_110px_1fr_180px_120px_110px_110px] gap-3 px-4 py-2 text-xs items-center border-b border-border/40 last:border-b-0">
                        <div>
                          <Checkbox
                            checked={sel}
                            onCheckedChange={(v) => toggleOrder(o.id, !!v)}
                            disabled={o.payment_status !== "pending" && o.payment_status !== "paid"}
                          />
                        </div>
                        <div />
                        <div className="font-mono text-muted-foreground">{o.order_number ?? `#${(o.external_id ?? "").slice(-6)}`}</div>
                        <div className="min-w-0">
                          <div className="truncate text-foreground">{customerName(o) ?? <span className="text-muted-foreground">—</span>}</div>
                          <div className="text-muted-foreground text-[11px]">{o.items_count} {o.items_count === 1 ? "item" : "itens"}</div>
                        </div>
                        <TrackingCell
                          shopId={shopId}
                          orderId={o.id}
                          tracking={t}
                          template={trackingTemplate}
                          onChanged={() => qc.invalidateQueries({ queryKey: ["order-trackings", shopId] })}
                        />
                        <div className="text-muted-foreground tabular-nums">
                          {o.paid_at ? `Pago ${localDate(o.paid_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : "—"}
                        </div>
                        <div className="text-muted-foreground tabular-nums">
                          {o.shipped_at ? `Env. ${localDate(o.shipped_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : "—"}
                        </div>
                        <div>
                          <Badge variant="outline" className={cn("text-[10px] font-medium", STATUS_TONE[o.payment_status])}>
                            {STATUS_LABEL[o.payment_status]}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground">
        Conexão Shopify e demais integrações ficam em <strong>Integrações</strong>. Aqui é só a esteira operacional.
        Pedidos pagos saem da previsão de D+{PROCESSING_DELAY_DAYS} e viram saída real na data do pagamento.
      </div>

      {openCost && (
        <CostDialog
          shopId={shopId}
          open={openCost}
          onClose={() => setOpenCost(false)}
          currentCost={unitCost}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["order-settings", shopId] });
            qc.invalidateQueries({ queryKey: ["shop-cash"] });
          }}
        />
      )}

      <PayDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        summary={selectedSummary}
        loading={pay.isPending}
        onConfirm={(date) => pay.mutate(date)}
      />

      <BatchesDialog
        shopId={shopId}
        open={batchesOpen}
        onClose={() => setBatchesOpen(false)}
        onUndone={() => {
          qc.invalidateQueries({ queryKey: ["orders", shopId] });
          qc.invalidateQueries({ queryKey: ["shop-cash"] });
        }}
      />

      <LogisticsOrdersDialog
        open={logisticsView !== null}
        onClose={() => setLogisticsView(null)}
        title={LOGISTICS_CATEGORIES.find((c) => c.key === logisticsView)?.label ?? ""}
        items={logisticsView ? kpis.logistics[logisticsView] : []}
        template={trackingTemplate}
      />
    </div>
  );
}

function TrackingCell({ shopId, orderId, tracking, template, onChanged }: {
  shopId: string; orderId: string; tracking?: any; template: string; onChanged: () => void;
}) {
  const setFn = useServerFn(setOrderTracking);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tracking?.tracking_number ?? "");

  const save = useMutation({
    mutationFn: () => setFn({ data: { order_id: orderId, tracking_number: value.trim() } }),
    onSuccess: () => { setEditing(false); onChanged(); toast.success("Tracking salvo"); },
    onError: (e: any) => toast.error(e.message),
  });

  const code = tracking?.tracking_number;
  const url = code ? template.replace("[CODE]", encodeURIComponent(code)) : null;

  if (editing) {
    return (
      <div className="flex gap-1 items-center">
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-7 text-xs" placeholder="Código de rastreio" />
        <Button size="icon" variant="ghost" className="size-7" onClick={() => save.mutate()} disabled={save.isPending || !value.trim()}>
          {save.isPending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
        </Button>
      </div>
    );
  }

  if (!code) {
    return (
      <button onClick={() => { setValue(""); setEditing(true); }} className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline text-left">
        + Adicionar tracking
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      <Package className="size-3 text-muted-foreground shrink-0" />
      <button onClick={() => { setValue(code); setEditing(true); }} className="font-mono text-[11px] truncate hover:text-primary" title={code}>
        {code}
      </button>
      <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={() => { navigator.clipboard.writeText(code); toast.success("Copiado"); }}>
        <Copy className="size-3" />
      </Button>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="size-6 grid place-items-center hover:bg-muted rounded shrink-0">
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

type KpiTone = "amber" | "emerald" | "sky" | "muted" | "rose" | "violet";

function Kpi({ icon: Icon, label, value, sub, tone, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone: KpiTone; onClick?: () => void }) {
  const toneCls = {
    amber: "border-amber-500/20 bg-amber-500/5",
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    sky: "border-sky-500/20 bg-sky-500/5",
    rose: "border-rose-500/20 bg-rose-500/5",
    violet: "border-violet-500/20 bg-violet-500/5",
    muted: "border-border bg-surface",
  }[tone];
  const iconCls = {
    amber: "bg-amber-500/10 text-amber-600",
    emerald: "bg-emerald-500/10 text-emerald-600",
    sky: "bg-sky-500/10 text-sky-600",
    rose: "bg-rose-500/10 text-rose-600",
    violet: "bg-violet-500/10 text-violet-600",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      className={cn("rounded-xl border p-3.5 text-left", toneCls, onClick && "cursor-pointer hover:brightness-95 transition-[filter]")}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("size-6 rounded-md grid place-items-center shrink-0", iconCls)}>
          <Icon className="size-3.5" />
        </div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium truncate">{label}</div>
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Comp>
  );
}

function LogisticsOrdersDialog({ open, onClose, title, items, template }: {
  open: boolean; onClose: () => void; title: string; items: { order: any; tracking: any }[]; template: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-1.5">
          {items.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">Nenhum pedido nesta categoria.</div>
          )}
          {items.map(({ order, tracking }) => {
            const code = tracking?.tracking_number as string | undefined;
            const url = code && template ? template.replace("[CODE]", encodeURIComponent(code)) : null;
            return (
              <div key={order.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <div className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                  {order.order_number ?? `#${(order.external_id ?? "").slice(-6)}`}
                </div>
                <div className="flex-1 min-w-0 truncate">
                  {customerName(order) ?? <span className="text-muted-foreground">—</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {code ? (
                    <>
                      <span className="font-mono text-[11px]">{code}</span>
                      <Button size="icon" variant="ghost" className="size-6" onClick={() => { navigator.clipboard.writeText(code); toast.success("Copiado"); }}>
                        <Copy className="size-3" />
                      </Button>
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="size-6 grid place-items-center hover:bg-muted rounded">
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">sem código</span>
                  )}
                </div>
                {tracking?.last_event_label && (
                  <div className="text-[11px] text-muted-foreground shrink-0 max-w-[160px] truncate" title={tracking.last_event_label}>
                    {translateEventLabel(tracking.last_event_label)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ open, onClose, summary, loading, onConfirm }: {
  open: boolean; onClose: () => void; loading: boolean;
  summary: { count: number; items: number; amount: number; dates: string[] };
  onConfirm: (date: string) => void;
}) {
  const [date, setDate] = useState(isoDate(new Date()));
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Marcar como pago</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-border p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Pedidos</span><span className="font-medium tabular-nums">{summary.count}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Itens</span><span className="font-medium tabular-nums">{summary.items}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Dias da venda</span><span className="font-medium">{summary.dates.length}</span></div>
            <div className="flex justify-between text-base pt-1 border-t border-border/60 mt-1.5">
              <span className="font-medium">Total</span>
              <span className="font-semibold tabular-nums">{fmtMoney(summary.amount)}</span>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Data do pagamento</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1.5">
              Cria 1 saída no Caixa nesta data e remove a previsão futura desses pedidos.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirm(date)} disabled={loading || summary.count === 0}>
            {loading && <Loader2 className="size-4 animate-spin" />} Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchesDialog({ shopId, open, onClose, onUndone }: { shopId: string; open: boolean; onClose: () => void; onUndone: () => void }) {
  const listFn = useServerFn(listPaymentBatches);
  const undoFn = useServerFn(undoOrderPayment);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["batches", shopId], queryFn: () => listFn({ data: { shop_id: shopId, limit: 50 } }), enabled: open });
  const undo = useMutation({
    mutationFn: (id: string) => undoFn({ data: { shop_id: shopId, batch_id: id } }),
    onSuccess: () => { toast.success("Pagamento desfeito"); qc.invalidateQueries({ queryKey: ["batches", shopId] }); onUndone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Lotes de pagamento</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {(q.data ?? []).length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">Nenhum lote ainda.</div>
          )}
          {(q.data ?? []).map((b: any) => (
            <div key={b.id} className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Lote #{b.batch_number}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {b.description} · {b.total_orders} pedidos · {b.total_items} itens
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{fmtMoney(Number(b.total_amount))}</div>
                <div className="text-[11px] text-muted-foreground">{b.payment_date}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => undo.mutate(b.id)} disabled={undo.isPending}>
                <Undo2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CostDialog({ shopId, open, onClose, currentCost, onSaved }: any) {
  const updateFn = useServerFn(updateUnitCost);
  const listHistoryFn = useServerFn(listCostHistory);
  const [mode, setMode] = useState<"forward" | "all" | "range">("forward");
  const [cost, setCost] = useState(String(currentCost));
  const [from, setFrom] = useState(isoDate(new Date()));
  const [to, setTo] = useState(isoDate(new Date()));
  const [note, setNote] = useState("");

  const history = useQuery({ queryKey: ["cost-history", shopId], queryFn: () => listHistoryFn({ data: { shop_id: shopId } }), enabled: open });

  const save = useMutation({
    mutationFn: () => updateFn({ data: {
      shop_id: shopId, new_cost: Number(cost) || 0, mode,
      from: mode === "range" ? from : undefined,
      to: mode === "range" ? to : undefined,
      note: note || undefined,
    } }),
    onSuccess: () => { toast.success("Custo atualizado"); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Editar custo do produto</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Novo custo unitário</label>
            <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Aplicar como</label>
            {([
              ["forward", "Daqui para frente", "Aplica apenas em novos pedidos / cálculos futuros."],
              ["all", "Recalcular tudo", "Substitui o histórico e recalcula últimos 90 dias."],
              ["range", "Apenas entre datas", "Aplica somente no intervalo selecionado abaixo."],
            ] as const).map(([k, label, desc]) => (
              <button key={k} type="button" onClick={() => setMode(k)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${mode === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </button>
            ))}
          </div>
          {mode === "range" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">De</label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Até</label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nota (opcional)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: aumento de fornecedor" />
          </div>
          {(history.data ?? []).length > 0 && (
            <div className="rounded-lg border border-border p-3 max-h-40 overflow-y-auto">
              <div className="text-xs uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5"><History className="size-3" /> Histórico</div>
              <div className="space-y-1 text-xs">
                {(history.data ?? []).map((h: any) => (
                  <div key={h.id} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {h.valid_from || "—"} → {h.valid_to || "∞"}
                      {h.note && <span className="ml-1.5">· {h.note}</span>}
                    </span>
                    <span className="tabular-nums font-medium">{fmtMoney(Number(h.unit_cost))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

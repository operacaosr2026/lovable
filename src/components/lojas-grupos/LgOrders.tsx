import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listOrders, markOrdersPaid, markOrdersShipped, recomputeRange,
  getMultiOrderSettings, upsertOrderSettings, updateBatchPaymentDate,
} from "@/lib/shop-orders.functions";
import { updateLgCardShopConfig } from "@/lib/lg-cards.functions";
import { DateRangePicker } from "@/components/lojas-grupos/LgDashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  RefreshCw, ChevronRight, CheckCircle2, Store, Settings2, Check, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function localDate(date: string) { return new Date(date + "T00:00:00"); }
function fmtDayMonth(date: string) { return localDate(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); }

type ShopConfig = { id: string; name: string; payment_days: number };

export function LgOrders({
  cardId,
  shopIds,
  shops,
}: {
  cardId:  string;
  shopIds: string[];
  shops:   ShopConfig[];
}) {
  const cacheKey = shopIds.slice().sort().join(",");
  const qc       = useQueryClient();
  const isConsolidated = shopIds.length > 1;

  const [period, setPeriod]           = useState("30d");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const { from, to } = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const addD  = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    if (period === "hoje")   return { from: today, to: today };
    if (period === "ontem")  { const y = addD(today, -1); return { from: y, to: y }; }
    if (period === "7d")     return { from: addD(today, -6), to: today };
    if (period === "mes")    { const d = new Date(); return { from: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`, to: today }; }
    if (period === "custom" && customRange) return customRange;
    return { from: addD(today, -29), to: today };
  })();
  const [paymentFilter, setPaymentFilter] = useState<"todos"|"pendente"|"pago"|"parcial">("pendente");
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [payOpen, setPayOpen]     = useState(false);
  const [payDate, setPayDate]     = useState(() => isoDate(new Date()));
  const [reDateOpen, setReDateOpen] = useState(false);
  const [reDate, setReDate]       = useState(() => isoDate(new Date()));
  const [configOpen, setConfigOpen] = useState(false);

  const listOrdersFn      = useServerFn(listOrders);
  const payFn             = useServerFn(markOrdersPaid);
  const reDateFn          = useServerFn(updateBatchPaymentDate);
  useServerFn(markOrdersShipped);
  const updateCfgFn       = useServerFn(updateLgCardShopConfig);
  const recomputeRangeFn  = useServerFn(recomputeRange);
  const getSettingsFn     = useServerFn(getMultiOrderSettings);
  const upsertSettingsFn  = useServerFn(upsertOrderSettings);

  const ordersQuery = useQuery({
    queryKey: ["lg-orders", cacheKey, from, to],
    queryFn:  () => listOrdersFn({ data: { shop_ids: shopIds, from, to } }),
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: true,
  });

  // Quando os pedidos carregam, gera automaticamente as previsões de custo no caixa
  // para cada loja, projetadas para order_date + payment_days (D+N configurado).
  useEffect(() => {
    if (!ordersQuery.data) return;
    for (const shop of shops) {
      const days = shop.payment_days ?? 7;
      recomputeRangeFn({ data: {
        shop_id: shop.id,
        from_processing: addD(from, days),
        to_processing:   addD(to,   days),
        payment_days:    days,
      }});
    }
  }, [ordersQuery.data]);

  const settingsQuery = useQuery({
    queryKey: ["lg-order-settings", cacheKey],
    queryFn:  () => getSettingsFn({ data: { shop_ids: shopIds } }),
    enabled:  shopIds.length > 0,
  });

  const [costDraft, setCostDraft] = useState<Record<string, string>>({});
  const [savingCost, setSavingCost] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsQuery.data) return;
    const init: Record<string, string> = {};
    for (const row of settingsQuery.data as any[]) {
      init[row.shop_id] = String(row.default_unit_cost ?? 0);
    }
    setCostDraft((prev) => ({ ...init, ...prev }));
  }, [settingsQuery.data]);

  const addD = (iso: string, n: number) => {
    const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  };

  const saveCost = async (shopId: string) => {
    const val = parseFloat(costDraft[shopId] ?? "0");
    if (isNaN(val) || val < 0) return;
    setSavingCost(shopId);
    try {
      await upsertSettingsFn({ data: { shop_id: shopId, patch: { default_unit_cost: val } } });
      const shop = shops.find((s) => s.id === shopId);
      const days = shop?.payment_days ?? 7;
      await recomputeRangeFn({ data: {
        shop_id: shopId,
        from_processing: addD(from, days),
        to_processing:   addD(to,   days),
        payment_days:    days,
      }});
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
      qc.invalidateQueries({ queryKey: ["lg-order-settings", cacheKey] });
      toast.success("Custo atualizado");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSavingCost(null);
    }
  };

  const allOrders = (ordersQuery.data ?? []) as any[];

  const shopNames: Record<string, string> = {};
  const shopPaymentDays: Record<string, number> = {};
  for (const s of shops) { shopNames[s.id] = s.name; shopPaymentDays[s.id] = s.payment_days ?? 7; }

  const costByShop = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of (settingsQuery.data ?? []) as any[]) {
      m.set(row.shop_id, Number(row.default_unit_cost ?? 0));
    }
    return m;
  }, [settingsQuery.data]);

  const SHOPIFY_REFUND_FS  = new Set(["refunded", "partially_refunded"]);
  const SHOPIFY_VOID_FS    = new Set(["voided"]);
  function shopifyRefundBadge(fs: string | null | undefined): "reembolso" | "estorno" | null {
    if (!fs) return null;
    if (SHOPIFY_REFUND_FS.has(fs)) return "reembolso";
    if (SHOPIFY_VOID_FS.has(fs))   return "estorno";
    return null;
  }
  // Prefere coluna dedicada; cai no campo raw para orders sincronizadas antes da migration
  function resolveFinancialStatus(o: any): string | null {
    return o.shopify_financial_status ?? (o.raw as any)?.financial_status ?? null;
  }

  // Group orders by date, then by shop within each date
  const groups = useMemo(() => {
    const byDate = new Map<string, { totalOrders: number; totalItems: number; totalCost: number; paidCount: number; pendingCount: number; byShop: Map<string, any[]> }>();
    for (const o of allOrders) {
      const rb = shopifyRefundBadge(resolveFinancialStatus(o));
      if (rb === "reembolso") continue; // pedido reembolsado: retirado da listagem
      const day = o.order_date as string;
      if (!byDate.has(day)) byDate.set(day, { totalOrders: 0, totalItems: 0, totalCost: 0, paidCount: 0, pendingCount: 0, byShop: new Map() });
      const d = byDate.get(day)!;
      d.totalOrders++;
      d.totalItems += Number(o.items_count ?? 0);
      d.totalCost  += (costByShop.get(o.shop_id as string) ?? 0) * Number(o.items_count ?? 0);
      const st = o.payment_status as string;
      if (st === "paid" || st === "shipped") d.paidCount++;
      else if (st === "pending") d.pendingCount++;
      const shopId = o.shop_id as string;
      if (!d.byShop.has(shopId)) d.byShop.set(shopId, []);
      d.byShop.get(shopId)!.push(o);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, agg]) => {
        const dayStatus = agg.pendingCount === 0 ? "pago" : agg.paidCount === 0 ? "pendente" : "parcial";
        return { date, ...agg, dayStatus };
      });
  }, [allOrders, costByShop]);

  const filteredGroups = useMemo(() =>
    paymentFilter === "todos" ? groups : groups.filter(g => g.dayStatus === paymentFilter),
  [groups, paymentFilter]);

  const toggleDay = (date: string, checked: boolean) => {
    const group = groups.find((g) => g.date === date);
    if (!group) return;
    const next = new Set(selected);
    for (const orders of group.byShop.values()) {
      for (const o of orders) {
        if (checked) next.add(o.id); else next.delete(o.id);
      }
    }
    setSelected(next);
  };

  const toggleOrder = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const toggleExpand = (date: string) => {
    const next = new Set(expanded);
    if (next.has(date)) next.delete(date); else next.add(date);
    setExpanded(next);
  };

  // Selection summary: group selected orders by shop for payment
  const selectionByShop = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const group of groups) {
      for (const [shopId, orders] of group.byShop.entries()) {
        for (const o of orders) {
          if (selected.has(o.id) && o.payment_status === "pending") {
            if (!m.has(shopId)) m.set(shopId, []);
            m.get(shopId)!.push(o.id);
          }
        }
      }
    }
    return m;
  }, [selected, groups]);

  const selectionByShopPaid = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const group of groups) {
      for (const [shopId, orders] of group.byShop.entries()) {
        for (const o of orders) {
          if (selected.has(o.id) && o.payment_status !== "pending") {
            if (!m.has(shopId)) m.set(shopId, []);
            m.get(shopId)!.push(o.id);
          }
        }
      }
    }
    return m;
  }, [selected, groups]);

  const selectionMode = useMemo(() => {
    if (selected.size === 0) return null;
    let hasPending = false, hasPaid = false;
    for (const group of groups) {
      for (const orders of group.byShop.values()) {
        for (const o of orders) {
          if (!selected.has(o.id)) continue;
          if (o.payment_status === "pending") hasPending = true;
          else hasPaid = true;
        }
      }
    }
    if (hasPending && !hasPaid) return "pending";
    if (hasPaid && !hasPending) return "paid";
    return "mixed";
  }, [selected, groups]);

  const selectedCount = selected.size;

  // Pay selected orders — per shop
  const pay = useMutation({
    mutationFn: async () => {
      const results = [];
      for (const [shopId, orderIds] of selectionByShop.entries()) {
        const r = await payFn({ data: { shop_id: shopId, order_ids: orderIds, payment_date: payDate } });
        results.push(r);
      }
      return results;
    },
    onSuccess: (results) => {
      const totalAmount = results.reduce((s, r: any) => s + Number(r.total_amount ?? 0), 0);
      toast.success(`${selectedCount} pedidos marcados como pagos · ${fmtMoney(totalAmount)}`);
      setSelected(new Set());
      setPayOpen(false);
      qc.invalidateQueries({ queryKey: ["lg-orders", cacheKey] });
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Update payment date for already-paid orders
  const reDate_ = useMutation({
    mutationFn: async () => {
      const results = [];
      for (const [shopId, orderIds] of selectionByShopPaid.entries()) {
        const r = await reDateFn({ data: { shop_id: shopId, order_ids: orderIds, payment_date: reDate } });
        results.push(r);
      }
      return results;
    },
    onSuccess: (results) => {
      const totalOrders = results.reduce((s: number, r: any) => s + Number(r.ordersFound ?? 0), 0);
      const totalBatches = results.reduce((s: number, r: any) => s + Number(r.updated ?? 0), 0);
      const totalSearched = results.reduce((s: number, r: any) => s + Number(r.searchedCount ?? 0), 0);
      toast.success(`Data atualizada · buscados:${totalSearched} encontrados:${totalOrders} lotes:${totalBatches}`);
      setSelected(new Set());
      setReDateOpen(false);
      qc.invalidateQueries({ queryKey: ["lg-orders", cacheKey] });
      qc.invalidateQueries({ queryKey: ["shop-cash"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Payment days config per shop
  const [paymentDraft, setPaymentDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of shops) init[s.id] = String(s.payment_days);
    return init;
  });
  const [savingConfig, setSavingConfig] = useState<string | null>(null);

  const savePaymentDays = async (shopId: string) => {
    const val = parseInt(paymentDraft[shopId] ?? "7", 10);
    if (isNaN(val) || val < 0) return;
    setSavingConfig(shopId);
    try {
      await updateCfgFn({ data: { card_id: cardId, shop_id: shopId, payment_days: val } });
      qc.invalidateQueries({ queryKey: ["lg-card", cardId] });
      toast.success("Prazo de pagamento atualizado");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSavingConfig(null);
    }
  };

  const loading = ordersQuery.isLoading;

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          period={period} setPeriod={setPeriod}
          customRange={customRange} setCustomRange={setCustomRange}
          onApply={() => qc.invalidateQueries({ queryKey: ["lg-orders", cacheKey] })}
        />
        <Button
          onClick={() => qc.invalidateQueries({ queryKey: ["lg-orders", cacheKey] })}
          disabled={loading}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          Atualizar
        </Button>
        <div className="flex items-center rounded-xl border border-border overflow-hidden text-xs h-8">
          {(["pendente","pago","parcial","todos"] as const).map((f, idx, arr) => (
            <button key={f}
              onClick={() => setPaymentFilter(f)}
              className={cn(
                "px-3 h-full transition-colors",
                idx < arr.length - 1 && "border-r border-border",
                paymentFilter === f
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "pendente" ? "Não pago" : f === "pago" ? "Pago" : f === "parcial" ? "Parcial" : "Todos"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setConfigOpen(true)}>
          <Settings2 className="size-4" /> Configurações
        </Button>
      </div>

      {/* ── Selection bar ── */}
      {selectedCount > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm">
            <span className="font-medium">{selectedCount}</span> pedidos selecionados
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>
          {selectionMode === "pending" && (
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <CheckCircle2 className="size-4" /> Marcar como pago ({selectedCount})
            </Button>
          )}
          {selectionMode === "paid" && (
            <Button size="sm" variant="outline" onClick={() => setReDateOpen(true)}>
              <Calendar className="size-4" /> Alterar data de pagamento ({selectedCount})
            </Button>
          )}
          {selectionMode === "mixed" && (
            <span className="text-xs text-muted-foreground">Selecione apenas pedidos do mesmo status</span>
          )}
        </div>
      )}

      {/* ── Orders list ── */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[32px_24px_140px_1fr_110px_100px_140px] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <div />
          <div />
          <div>Data</div>
          <div>Resumo</div>
          <div>Processamento</div>
          <div className="text-right">Pedidos</div>
          <div className="text-right">Custo de Produto</div>
        </div>

        {loading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin mx-auto mb-2" />
            Carregando pedidos...
          </div>
        )}

        {!loading && filteredGroups.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum pedido no período selecionado.
          </div>
        )}

        {filteredGroups.map((group, i) => {
          const isOpen = expanded.has(group.date);
          const d      = localDate(group.date);
          const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
          const dayMonth = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
          const processDates = Array.from(new Set(
            Array.from(group.byShop.keys()).map((shopId) => addD(group.date, shopPaymentDays[shopId] ?? 7))
          )).sort();

          const allDayIds: string[] = [];
          for (const orders of group.byShop.values()) {
            for (const o of orders) allDayIds.push(o.id);
          }
          const allDaySelected = allDayIds.length > 0 && allDayIds.every((id) => selected.has(id));
          const someDaySelected = allDayIds.some((id) => selected.has(id));

          return (
            <div key={group.date} className={cn(i > 0 && "border-t border-border/60")}>
              {/* Day row */}
              <div
                className="grid grid-cols-[32px_24px_140px_1fr_110px_100px_140px] gap-3 px-4 py-2.5 items-center hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => toggleExpand(group.date)}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={allDaySelected ? true : someDaySelected ? "indeterminate" : false}
                    disabled={allDayIds.length === 0}
                    onCheckedChange={(v) => toggleDay(group.date, !!v)}
                  />
                </div>
                <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground uppercase">{weekday}</span>
                  <span className="text-sm font-semibold text-foreground">{dayMonth}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {isConsolidated ? `${group.byShop.size} loja${group.byShop.size !== 1 ? "s" : ""} · ` : ""}
                  Processar dia {processDates.map(fmtDayMonth).join(", ")}
                </div>
                {/* col Processamento */}
                <div>
                  {group.dayStatus === "pago" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-medium">Pago</span>
                  )}
                  {group.dayStatus === "pendente" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20 font-medium">Não pago</span>
                  )}
                  {group.dayStatus === "parcial" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 border border-blue-500/20 font-medium">Parcial · {group.paidCount}✓ {group.pendingCount}✗</span>
                  )}
                </div>
                <div className="text-right text-sm font-medium text-foreground">
                  {group.totalOrders}
                </div>
                <div className="text-right text-sm font-semibold text-foreground">
                  {group.totalCost > 0 ? fmtMoney(group.totalCost) : "—"}
                </div>
              </div>

              {/* Expanded: orders by shop */}
              {isOpen && (
                <div className="bg-muted/20 border-t border-border/40">
                  {Array.from(group.byShop.entries()).map(([shopId, orders]) => (
                    <div key={shopId}>
                      {/* Shop label (only in consolidated) */}
                      {isConsolidated && (
                        <div className="flex items-center gap-2 px-8 py-1.5 border-b border-border/30 bg-muted/30">
                          <Store className="size-3 text-muted-foreground" />
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                            {shopNames[shopId] ?? shopId}
                          </span>
                        </div>
                      )}
                      {/* Sub-header for order rows */}
                      <div className="grid grid-cols-[32px_1fr_80px_110px_120px_100px] gap-3 px-8 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/30">
                        <div /><div /><div />
                        <div>Processamento</div>
                        <div className="text-right">Custo</div>
                        <div className="text-right">Data</div>
                      </div>
                      {/* Order rows */}
                      {orders.map((o: any) => {
                        const sel = selected.has(o.id);
                        const cost = (costByShop.get(o.shop_id as string) ?? 0) * Number(o.items_count ?? 0);
                        return (
                          <div key={o.id} className={cn("grid grid-cols-[32px_1fr_80px_110px_120px_100px] gap-3 px-8 py-2 items-center border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors text-sm", sel && "bg-primary/5")}>
                            <Checkbox
                              checked={sel}
                              onCheckedChange={(v) => toggleOrder(o.id, !!v)}
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">#{o.order_number ?? o.id.slice(0, 8)}</p>
                              {o.customer_name && <p className="text-xs text-muted-foreground truncate">{o.customer_name}</p>}
                            </div>
                            <div className="text-xs text-muted-foreground">{o.items_count ?? 0} itens</div>
                            {/* col Processamento */}
                            <div>
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-md border font-medium",
                                o.payment_status === "pending" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                                                                 "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                              )}>
                                {o.payment_status === "pending" ? "Pendente" : "Pago"}
                              </span>
                            </div>
                            <div className="text-right text-sm font-semibold text-foreground">
                              {cost > 0 ? fmtMoney(cost) : "—"}
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              {o.payment_status !== "pending" ? (o.paid_at ?? o.order_date) : o.order_date}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Pay dialog ── */}
      <Dialog open={payOpen} onOpenChange={(o) => { if (!o) setPayOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Marcar <span className="font-semibold text-foreground">{selectedCount} pedidos</span> como pagos.
              O custo será lançado no caixa na data informada.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Data de pagamento</label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
            <Button onClick={() => pay.mutate()} disabled={pay.isPending}>
              {pay.isPending && <RefreshCw className="size-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Re-date dialog ── */}
      <Dialog open={reDateOpen} onOpenChange={(o) => { if (!o) setReDateOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar data de pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Atualizar a data de pagamento de <span className="font-semibold text-foreground">{selectedCount} pedidos</span> já pagos.
              O lançamento no caixa será movido para a nova data.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Nova data de pagamento</label>
              <Input type="date" value={reDate} onChange={(e) => setReDate(e.target.value)} className="w-full" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReDateOpen(false)}>Cancelar</Button>
            <Button onClick={() => reDate_.mutate()} disabled={reDate_.isPending}>
              {reDate_.isPending && <RefreshCw className="size-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Settings dialog ── */}
      <Dialog open={configOpen} onOpenChange={(o) => { if (!o) setConfigOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurações por loja</DialogTitle>
          </DialogHeader>
          <div className="space-y-0">
            <p className="text-xs text-muted-foreground mb-3">
              Configure o prazo de pagamento ao fornecedor (D+N) e o custo unitário do produto por loja.
            </p>
            {shops.map((shop) => (
              <div key={shop.id} className="py-3 border-b border-border last:border-0 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="size-6 rounded-md bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">
                    {shop.name?.[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-foreground">{shop.name}</span>
                </div>
                {/* Prazo de pagamento */}
                <div className="flex items-center gap-2 pl-8">
                  <span className="text-xs text-muted-foreground w-28">Prazo fornecedor</span>
                  <span className="text-xs text-muted-foreground">D+</span>
                  <input
                    type="number" min={0} max={365}
                    value={paymentDraft[shop.id] ?? String(shop.payment_days)}
                    onChange={(e) => setPaymentDraft((prev) => ({ ...prev, [shop.id]: e.target.value }))}
                    className="w-14 h-7 rounded-lg border border-border bg-card text-foreground text-xs px-2 focus:outline-none focus:border-primary text-center"
                  />
                  <span className="text-xs text-muted-foreground">dias</span>
                  <button
                    onClick={() => savePaymentDays(shop.id)}
                    disabled={savingConfig === shop.id}
                    className="size-7 rounded-lg bg-primary grid place-items-center text-primary-foreground disabled:opacity-50"
                  >
                    {savingConfig === shop.id
                      ? <div className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <Check className="size-3.5" />}
                  </button>
                </div>
                {/* Custo unitário */}
                <div className="flex items-center gap-2 pl-8">
                  <span className="text-xs text-muted-foreground w-28">Custo por unidade</span>
                  <span className="text-xs text-muted-foreground">R$</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={costDraft[shop.id] ?? "0"}
                    onChange={(e) => setCostDraft((prev) => ({ ...prev, [shop.id]: e.target.value }))}
                    className="w-20 h-7 rounded-lg border border-border bg-card text-foreground text-xs px-2 focus:outline-none focus:border-primary text-center"
                  />
                  <button
                    onClick={() => saveCost(shop.id)}
                    disabled={savingCost === shop.id}
                    className="size-7 rounded-lg bg-primary grid place-items-center text-primary-foreground disabled:opacity-50"
                  >
                    {savingCost === shop.id
                      ? <div className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <Check className="size-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

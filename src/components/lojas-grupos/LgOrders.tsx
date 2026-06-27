import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listOrders, markOrdersPaid, markOrdersShipped,
} from "@/lib/shop-orders.functions";
import { updateLgCardShopConfig } from "@/lib/lg-cards.functions";
import { DateRangePicker } from "@/components/lojas-grupos/LgDashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  RefreshCw, ChevronRight, CheckCircle2, Store, Settings2, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function localDate(date: string) { return new Date(date + "T00:00:00"); }

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
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [payOpen, setPayOpen]     = useState(false);
  const [payDate, setPayDate]     = useState(() => isoDate(new Date()));
  const [configOpen, setConfigOpen] = useState(false);

  const listOrdersFn = useServerFn(listOrders);
  const payFn        = useServerFn(markOrdersPaid);
  const shipFn       = useServerFn(markOrdersShipped);
  const updateCfgFn  = useServerFn(updateLgCardShopConfig);

  const ordersQuery = useQuery({
    queryKey: ["lg-orders", cacheKey, from, to],
    queryFn:  () => listOrdersFn({ data: { shop_ids: shopIds, from, to } }),
  });

  const allOrders = (ordersQuery.data ?? []) as any[];

  // Unit cost per shop (default 0 — this page only shows cost column via items_count)
  const shopNames: Record<string, string> = {};
  for (const s of shops) shopNames[s.id] = s.name;

  // Group orders by date, then by shop within each date
  const groups = useMemo(() => {
    const byDate = new Map<string, { totalOrders: number; totalItems: number; totalCost: number; byShop: Map<string, any[]> }>();
    for (const o of allOrders) {
      const day = o.order_date as string;
      if (!byDate.has(day)) byDate.set(day, { totalOrders: 0, totalItems: 0, totalCost: 0, byShop: new Map() });
      const d = byDate.get(day)!;
      d.totalOrders++;
      d.totalItems += Number(o.items_count ?? 0);
      d.totalCost  += Number(o.unit_cost ?? 0) * Number(o.items_count ?? 1);
      const shopId = o.shop_id as string;
      if (!d.byShop.has(shopId)) d.byShop.set(shopId, []);
      d.byShop.get(shopId)!.push(o);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, agg]) => ({ date, ...agg }));
  }, [allOrders]);

  const toggleDay = (date: string, checked: boolean) => {
    const group = groups.find((g) => g.date === date);
    if (!group) return;
    const next = new Set(selected);
    for (const orders of group.byShop.values()) {
      for (const o of orders) {
        if (o.payment_status === "pending") {
          if (checked) next.add(o.id); else next.delete(o.id);
        }
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
    for (const o of allOrders) {
      if (selected.has(o.id) && o.payment_status === "pending") {
        const shopId = o.shop_id as string;
        if (!m.has(shopId)) m.set(shopId, []);
        m.get(shopId)!.push(o.id);
      }
    }
    return m;
  }, [selected, allOrders]);

  const selectedCount = Array.from(selectionByShop.values()).reduce((s, a) => s + a.length, 0);

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
          <Button size="sm" onClick={() => setPayOpen(true)}>
            <CheckCircle2 className="size-4" /> Marcar como pago ({selectedCount})
          </Button>
        </div>
      )}

      {/* ── Orders list ── */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[32px_24px_140px_1fr_100px_140px] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <div />
          <div />
          <div>Data</div>
          <div>Resumo</div>
          <div className="text-right">Pedidos</div>
          <div className="text-right">Custo de Produto</div>
        </div>

        {loading && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin mx-auto mb-2" />
            Carregando pedidos...
          </div>
        )}

        {!loading && groups.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum pedido no período selecionado.
          </div>
        )}

        {groups.map((group, i) => {
          const isOpen = expanded.has(group.date);
          const d      = localDate(group.date);
          const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
          const dayMonth = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

          // Selectable (pending) orders in this group
          const pendingIds: string[] = [];
          for (const orders of group.byShop.values()) {
            for (const o of orders) {
              if (o.payment_status === "pending") pendingIds.push(o.id);
            }
          }
          const allDaySelected = pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));
          const someDaySelected = pendingIds.some((id) => selected.has(id));

          return (
            <div key={group.date} className={cn(i > 0 && "border-t border-border/60")}>
              {/* Day row */}
              <div
                className="grid grid-cols-[32px_24px_140px_1fr_100px_140px] gap-3 px-4 py-2.5 items-center hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => toggleExpand(group.date)}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={allDaySelected ? true : someDaySelected ? "indeterminate" : false}
                    disabled={pendingIds.length === 0}
                    onCheckedChange={(v) => toggleDay(group.date, !!v)}
                  />
                </div>
                <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground uppercase">{weekday}</span>
                  <span className="text-sm font-semibold text-foreground">{dayMonth}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {isConsolidated ? `${group.byShop.size} loja${group.byShop.size !== 1 ? "s" : ""}` : ""}
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
                      {/* Order rows */}
                      {orders.map((o: any) => {
                        const sel = selected.has(o.id);
                        const cost = Number(o.unit_cost ?? 0) * Number(o.items_count ?? 1);
                        const isPending = o.payment_status === "pending";
                        return (
                          <div key={o.id} className={cn("grid grid-cols-[32px_1fr_80px_80px_120px_100px] gap-3 px-8 py-2 items-center border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors text-sm", sel && "bg-primary/5")}>
                            <Checkbox
                              checked={sel}
                              disabled={!isPending}
                              onCheckedChange={(v) => toggleOrder(o.id, !!v)}
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">#{o.order_number ?? o.id.slice(0, 8)}</p>
                              {o.customer_name && <p className="text-xs text-muted-foreground truncate">{o.customer_name}</p>}
                            </div>
                            <div className="text-xs text-muted-foreground">{o.items_count ?? 0} itens</div>
                            <div>
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-md border font-medium",
                                o.payment_status === "pending" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                                o.payment_status === "paid"    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
                                                                 "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                              )}>
                                {o.payment_status === "pending" ? "Pendente" : "Pago"}
                              </span>
                            </div>
                            <div className="text-right text-sm font-semibold text-foreground">
                              {cost > 0 ? fmtMoney(cost) : "—"}
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              {o.order_date}
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

      {/* ── Settings dialog ── */}
      <Dialog open={configOpen} onOpenChange={(o) => { if (!o) setConfigOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prazo de pagamento por loja</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground mb-3">
              Configure em quantos dias após o pedido o fornecedor será pago (D+X).
              O custo será lançado como previsão no caixa nessa data.
            </p>
            {shops.map((shop) => (
              <div key={shop.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                <div className="size-7 rounded-lg bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">
                  {shop.name?.[0]?.toUpperCase()}
                </div>
                <span className="text-sm text-foreground flex-1 truncate">{shop.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-muted-foreground">D+</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={paymentDraft[shop.id] ?? String(shop.payment_days)}
                    onChange={(e) => setPaymentDraft((prev) => ({ ...prev, [shop.id]: e.target.value }))}
                    className="w-16 h-7 rounded-lg border border-border bg-card text-foreground text-xs px-2 focus:outline-none focus:border-primary text-center"
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

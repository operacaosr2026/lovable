import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus, Trash2, ChevronDown, X, Wallet, TrendingUp, TrendingDown, Repeat, Pencil, Check, RefreshCw, Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  listShopCash, createCashEntry, updateCashEntry, deleteCashEntry,
  setOpeningBalance, setWeekendRule,
  listCashCategories, createCashCategory, renameCashCategory, deleteCashCategory,
} from "@/lib/shop-cash.functions";
import { getShopifyPendingBalance, getMonthlyProfit, getShopifyPayoutLag, syncShopifyPayouts, setPayoutLagDays, getGroupShopifyPayoutLag, getGroupShopifyPendingBalance } from "@/lib/shop-orders.functions";

type Recurrence = "none" | "daily" | "weekly" | "monthly";
type Entry = { id: string; kind: "income" | "expense"; amount: number; date: string; category: string | null; description: string | null; source: string; auto_kind?: string | null; import_id: string | null; recurrence?: Recurrence | null; recurrence_until?: string | null; skip_weekend_rule?: boolean | null; reconciled?: boolean | null };
type DayItem = Entry & { virtual?: boolean; originalDate?: string; shiftedFromWeekday?: number };

const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function dateKeyParts(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}
function dateFromKey(key: string) {
  const { year, month, day } = dateKeyParts(key);
  return new Date(Date.UTC(year, month - 1, day, 12));
}
function addDaysToKey(key: string, days: number) {
  const d = dateFromKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function addMonthsToKey(key: string, months: number) {
  const { year, month, day } = dateKeyParts(key);
  const first = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  return dateKey(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(day, lastDay));
}
function todayKeyBrazil() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return dateKey(get("year"), get("month"), get("day"));
}
function formatDateKey(key: string, options: Intl.DateTimeFormatOptions) {
  return dateFromKey(key).toLocaleDateString("pt-BR", { ...options, timeZone: BRAZIL_TIME_ZONE });
}
function weekdayFromKey(key: string) {
  return dateFromKey(key).getUTCDay();
}
// 0=Sun, 6=Sat → shift to Monday. Returns same key if not weekend.
function shiftToMondayIfWeekend(key: string): string {
  const wd = weekdayFromKey(key);
  if (wd === 6) return addDaysToKey(key, 2); // Sat → Mon
  if (wd === 0) return addDaysToKey(key, 1); // Sun → Mon
  return key;
}
function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}
function fmtMoneyCompact(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, useGrouping: false });
}
const WEEKDAYS_FULL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function ShopCashflow({ shopIds, shops }: { shopIds: string[]; shops?: { id: string; name: string }[] }) {
  const shopId = shopIds[0];
  const isConsolidated = shopIds.length > 1;
  const cacheKey = shopIds.slice().sort().join(",");
  const qc = useQueryClient();
  const listFn = useServerFn(listShopCash);
  const createFn = useServerFn(createCashEntry);
  const deleteFn = useServerFn(deleteCashEntry);
  const updateFn = useServerFn(updateCashEntry);
  const openingFn = useServerFn(setOpeningBalance);
  const listCatsFn = useServerFn(listCashCategories);
  const pendingFn = useServerFn(getShopifyPendingBalance);
  const monthlyProfitFn = useServerFn(getMonthlyProfit);
  const payoutLagFn = useServerFn(getShopifyPayoutLag);
  const syncPayoutsFn = useServerFn(syncShopifyPayouts);
  const setLagDaysFn = useServerFn(setPayoutLagDays);
  const groupPayoutLagFn = useServerFn(getGroupShopifyPayoutLag);
  const groupPendingFn = useServerFn(getGroupShopifyPendingBalance);
  const { data: payoutLag } = useQuery({
    queryKey: ["shop-payout-lag", cacheKey],
    queryFn: () => payoutLagFn({ data: { shop_id: shopId } }),
    staleTime: 5 * 60_000,
    enabled: !isConsolidated,
  });
  const { data: groupPayoutLags } = useQuery({
    queryKey: ["shop-group-payout-lag", cacheKey],
    queryFn: () => groupPayoutLagFn({ data: { shop_ids: shopIds } }),
    staleTime: 5 * 60_000,
    enabled: isConsolidated,
  });
  const { data: groupPendingData } = useQuery({
    queryKey: ["shop-group-cash-pending", cacheKey],
    queryFn: () => groupPendingFn({ data: { shop_ids: shopIds } }),
    enabled: isConsolidated,
  });

  const queryKey = ["shop-cash", cacheKey];
  const catsKey = ["shop-cash-cats", cacheKey];
  const { data, isLoading } = useQuery({ queryKey, queryFn: () => listFn({ data: { shop_ids: shopIds } }) });
  const catsQuery = useQuery({ queryKey: catsKey, queryFn: () => listCatsFn({ data: { shop_id: shopId } }) });
  const pendingQuery = useQuery({ queryKey: ["shop-cash-pending", cacheKey], queryFn: () => pendingFn({ data: { shop_id: shopId } }), enabled: !isConsolidated });
  const refresh = () => qc.invalidateQueries({ queryKey });
  const refreshCats = () => qc.invalidateQueries({ queryKey: catsKey });

  const [syncing, setSyncing] = useState(false);
  const [editingLag, setEditingLag] = useState(false);
  const [lagInput, setLagInput] = useState("");

  const saveLagDays = async (days: number) => {
    if (!shopId) return;
    try {
      await setLagDaysFn({ data: { shop_id: shopId, days } });
      qc.invalidateQueries({ queryKey: ["shop-payout-lag", cacheKey] });
      setEditingLag(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar período de repasse");
    }
  };

  const syncPayouts = async () => {
    setSyncing(true);
    try {
      if (isConsolidated) {
        let total = 0;
        for (const id of shopIds) {
          const result = await syncPayoutsFn({ data: { shop_id: id, since_days: 90 } });
          total += result?.synced ?? 0;
        }
        qc.invalidateQueries({ queryKey });
        qc.invalidateQueries({ queryKey: ["shop-group-cash-pending", cacheKey] });
        toast.success(total ? `${total} depósitos sincronizados` : "Depósitos já atualizados");
      } else {
        const result = await syncPayoutsFn({ data: { shop_id: shopId, since_days: 90 } });
        qc.invalidateQueries({ queryKey });
        qc.invalidateQueries({ queryKey: ["shop-cash-pending", cacheKey] });
        toast.success(result?.synced ? `${result.synced} depósitos sincronizados` : "Depósitos já atualizados");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao sincronizar depósitos");
    } finally {
      setSyncing(false);
    }
  };

  const allCats = (catsQuery.data ?? []) as { id: string; kind: "income" | "expense"; name: string }[];
  const incomeCats = useMemo(() => allCats.filter(c => c.kind === "income").map(c => c.name), [allCats]);
  const expenseCats = useMemo(() => allCats.filter(c => c.kind === "expense").map(c => c.name), [allCats]);

  const [rangeFrom, setRangeFrom] = useState<string | null>(null);
  const [rangeTo, setRangeTo] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRange, setPickerRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const pickerFromRef = useRef<Date | undefined>(undefined);
  const [showPending, setShowPending] = useState(false);
  const [quickAdd, setQuickAdd] = useState<{ date: string; kind: "income" | "expense" } | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [manageCats, setManageCats] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DayItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const entries = (data?.entries ?? []) as Entry[];
  const opening = data?.opening_balance ?? 0;
  const weekendToMonday = Boolean(data?.weekend_payouts_to_monday);

  const todayKey = useMemo(() => todayKeyBrazil(), []);

  const { monthStart, monthEnd, prevMonthStart, prevMonthEnd } = useMemo(() => {
    const { year, month } = dateKeyParts(todayKey);
    const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
    const prevFirst = new Date(Date.UTC(year, month - 2, 1, 12));
    const prevLastDay = new Date(Date.UTC(prevFirst.getUTCFullYear(), prevFirst.getUTCMonth() + 1, 0, 12)).getUTCDate();
    return {
      monthStart: dateKey(year, month, 1),
      monthEnd: dateKey(year, month, lastDay),
      prevMonthStart: dateKey(prevFirst.getUTCFullYear(), prevFirst.getUTCMonth() + 1, 1),
      prevMonthEnd: dateKey(prevFirst.getUTCFullYear(), prevFirst.getUTCMonth() + 1, prevLastDay),
    };
  }, [todayKey]);
  const monthlyProfitQuery = useQuery({
    queryKey: ["shop-cash-monthly-profit", cacheKey, monthStart, monthEnd],
    queryFn: () => monthlyProfitFn({ data: { shop_ids: shopIds, month_start: monthStart, month_end: monthEnd } }),
  });
  const prevMonthlyProfitQuery = useQuery({
    queryKey: ["shop-cash-monthly-profit", cacheKey, prevMonthStart, prevMonthEnd],
    queryFn: () => monthlyProfitFn({ data: { shop_ids: shopIds, month_start: prevMonthStart, month_end: prevMonthEnd } }),
  });

  const dayList = useMemo(() => {
    if (rangeFrom && rangeTo) {
      const arr: string[] = [];
      let d = rangeFrom;
      while (d <= rangeTo) { arr.push(d); d = addDaysToKey(d, 1); }
      return arr;
    }
    const wd = weekdayFromKey(todayKey);
    const mondayOffset = wd === 0 ? -6 : -(wd - 1);
    const weekStart = addDaysToKey(todayKey, mondayOffset);
    const arr: string[] = [];
    for (let i = 0; i < 7; i++) arr.push(addDaysToKey(weekStart, i));
    return arr;
  }, [todayKey, rangeFrom, rangeTo]);

  // Expand recurring entries up to a horizon (today + 60 days or end of view)
  const horizon = useMemo(() => {
    const last = dayList[dayList.length - 1] ?? todayKey;
    const sixty = addDaysToKey(todayKey, 60);
    return last > sixty ? last : sixty;
  }, [todayKey, dayList]);

  const expanded = useMemo<DayItem[]>(() => {
    const applyShift = (item: DayItem): DayItem => {
      const isShopifyEntry = item.source === "shopify_import" || item.source === "shopify_sync" || item.source === "shopify_pending";
      const isOrderCost = item.source === "auto" && item.auto_kind === "order_cost";

      // Custos de pedidos vencidos (não pagos) são transferidos para hoje.
      if (isOrderCost && item.date < todayKey) {
        const wd = weekdayFromKey(item.date);
        return { ...item, date: todayKey, originalDate: item.originalDate ?? item.date, shiftedFromWeekday: wd };
      }

      if (!weekendToMonday) return item;
      if (!isShopifyEntry && !isOrderCost) return item;
      if (item.skip_weekend_rule) return item;
      const wd = weekdayFromKey(item.date);
      if (wd !== 0 && wd !== 6) return item;
      const shifted = shiftToMondayIfWeekend(item.date);
      return { ...item, date: shifted, originalDate: item.originalDate ?? item.date, shiftedFromWeekday: wd };
    };
    const out: DayItem[] = [];
    for (const e of entries) {
      if (e.source === "shopify_pending_sync" && !showPending) continue;
      const rec = (e.recurrence ?? "none") as Recurrence;
      if (rec === "none") { out.push(applyShift(e)); continue; }
      const stop = e.recurrence_until && e.recurrence_until < horizon ? e.recurrence_until : horizon;
      let cur = e.date;
      let i = 0;
      while (cur <= stop && i < 400) {
        out.push(applyShift({ ...e, date: cur, virtual: i > 0, originalDate: e.date }));
        if (rec === "daily") cur = addDaysToKey(cur, 1);
        else if (rec === "weekly") cur = addDaysToKey(cur, 7);
        else if (rec === "monthly") cur = addMonthsToKey(cur, 1);
        i++;
      }
    }
    return out;
  }, [entries, horizon, weekendToMonday, showPending]);

  const saldoBeforeRange = useMemo(() => {
    const first = dayList[0] ?? todayKey;
    let s = opening;
    for (const e of expanded) {
      if (e.date < first) s += e.kind === "income" ? Number(e.amount) : -Number(e.amount);
    }
    return s;
  }, [expanded, opening, dayList, todayKey]);

  const byDay = useMemo(() => {
    const m = new Map<string, DayItem[]>();
    for (const e of expanded) {
      const arr = m.get(e.date) ?? [];
      arr.push(e); m.set(e.date, arr);
    }
    return m;
  }, [expanded]);

  const dayData = useMemo(() => {
    let acc = saldoBeforeRange;
    return dayList.map((key) => {
      const items = byDay.get(key) ?? [];
      const incomeItems = items.filter(e => e.kind === "income");
      const expenseItems = items.filter(e => e.kind === "expense");
      const income = incomeItems.reduce((a, e) => a + Number(e.amount), 0);
      const expense = expenseItems.reduce((a, e) => a + Number(e.amount), 0);
      acc = acc + income - expense;
      return { key, incomeItems, expenseItems, income, expense, balance: acc };
    });
  }, [dayList, byDay, saldoBeforeRange]);

  // Future indicators (next 30 days)
  const future = useMemo(() => {
    let acc = opening;
    for (const e of expanded) {
      if (e.virtual) continue;
      if (e.reconciled) acc += e.kind === "income" ? Number(e.amount) : -Number(e.amount);
    }
    const currentBalance = acc;
    const horizon30 = addDaysToKey(todayKey, 30);
    let totalIncome = 0, totalExpense = 0;
    for (const e of expanded) {
      if (e.date <= todayKey || e.date > horizon30) continue;
      if (e.kind === "income") totalIncome += Number(e.amount); else totalExpense += Number(e.amount);
    }
    return { current: currentBalance, totalIncome, totalExpense };
  }, [expanded, opening, todayKey]);

  const monthProfit = monthlyProfitQuery.data?.profit ?? 0;

  const adjustments = useMemo(() => {
    let aporteRodrigo = 0, retiradaRodrigo = 0, aporteSergio = 0, retiradaSergio = 0;
    for (const e of entries) {
      const amount = Number(e.amount);
      if (e.kind === "income" && e.category === "Aporte Rodrigo") aporteRodrigo += amount;
      else if (e.kind === "expense" && e.category === "Retirada Rodrigo") retiradaRodrigo += amount;
      else if (e.kind === "income" && e.category === "Aporte Sergio") aporteSergio += amount;
      else if (e.kind === "expense" && e.category === "Retirada Sergio") retiradaSergio += amount;
    }
    return {
      aporteRodrigo, retiradaRodrigo, aporteSergio, retiradaSergio,
      rodrigo: aporteRodrigo - retiradaRodrigo,
      sergio: aporteSergio - retiradaSergio,
    };
  }, [entries]);

  const createMut = useMutation({ mutationFn: (v: any) => createFn({ data: v }), onSuccess: refresh });
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });
  const updateMut = useMutation({ mutationFn: (v: any) => updateFn({ data: v }), onSuccess: refresh });
  const openingMut = useMutation({ mutationFn: (v: number) => openingFn({ data: { shop_id: shopId, opening_balance: v } }), onSuccess: refresh });
  const weekendFn = useServerFn(setWeekendRule);
  const weekendMut = useMutation({ mutationFn: (enabled: boolean) => weekendFn({ data: { shop_id: shopId, enabled } }), onSuccess: refresh });
  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando...</div>;

  const effectivePending = isConsolidated ? groupPendingData : pendingQuery.data;
  const connectedShopsLag = isConsolidated
    ? (groupPayoutLags ?? []).filter(s => s.connected)
    : (payoutLag?.connected ? [{ shop_id: shopId, avgDays: payoutLag.avgDays, manualDays: payoutLag.manualDays, sampleSize: payoutLag.sampleSize }] : []);

  const receivable = effectivePending?.connected
    ? ((effectivePending as any).balance ?? effectivePending.pending ?? 0)
    : future.totalIncome;
  const forecastBalance = future.current + receivable - future.totalExpense
    - adjustments.aporteRodrigo - adjustments.aporteSergio
    + adjustments.retiradaRodrigo + adjustments.retiradaSergio;

  return (
    <div className="space-y-5">
      {/* Indicators */}
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Indicator icon={Wallet} label="Saldo atual" value={fmtMoney(future.current)} accent="oklch(0.55 0.15 250)" />
          <Indicator
            icon={TrendingUp}
            label="Lucro Bruto do mês"
            value={fmtMoney(monthProfit)}
            accent="oklch(0.55 0.13 155)"
            negative={monthProfit < 0}
            sub={prevMonthlyProfitQuery.data ? `Mês passado: ${fmtMoney(prevMonthlyProfitQuery.data.profit)}` : undefined}
            tooltip={monthlyProfitQuery.data ? (
              <div className="space-y-0.5">
                <div>Vendas: {fmtMoney(monthlyProfitQuery.data.sales)}</div>
                <div>Produto: -{fmtMoney(monthlyProfitQuery.data.productCost)}</div>
                <div>Ads: -{fmtMoney(monthlyProfitQuery.data.adSpend)}</div>
              </div>
            ) : undefined}
          />
          <Indicator icon={TrendingDown} label="Saídas previstas (30d)" value={fmtMoney(future.totalExpense)} accent="oklch(0.6 0.18 25)" />
          {effectivePending?.connected ? (
            <Indicator icon={TrendingUp} label="A receber (Shopify)" value={fmtMoney(receivable)} accent="oklch(0.6 0.13 230)" />
          ) : (
            <Indicator icon={TrendingUp} label="Entradas previstas (30d)" value={fmtMoney(receivable)} accent="oklch(0.55 0.13 155)" />
          )}
          <Indicator
            icon={Wallet}
            label="Saldo previsto"
            value={fmtMoney(forecastBalance)}
            accent="oklch(0.55 0.15 250)"
            negative={forecastBalance < 0}
            tooltip={
              <div className="space-y-0.5">
                <div>Ajuste Rodrigo: {fmtMoney(adjustments.rodrigo)}</div>
                <div>Ajuste Sergio: {fmtMoney(adjustments.sergio)}</div>
              </div>
            }
          />
        </div>
      </TooltipProvider>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={(open) => {
          setPickerOpen(open);
          if (open) { setPickerRange({ from: undefined, to: undefined }); pickerFromRef.current = undefined; }
        }}>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs hover:bg-accent transition-colors">
              <CalendarIcon className="size-3.5 text-muted-foreground" />
              {rangeFrom && rangeTo
                ? rangeFrom === rangeTo
                  ? formatDateKey(rangeFrom, { day: "2-digit", month: "short" })
                  : `${formatDateKey(rangeFrom, { day: "2-digit", month: "short" })} – ${formatDateKey(rangeTo, { day: "2-digit", month: "short" })}`
                : "Semana atual"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={pickerRange}
              onSelect={(range) => {
                if (!range?.from && pickerFromRef.current) {
                  // Segundo clique na mesma data → dia único
                  const d = pickerFromRef.current;
                  const key = dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
                  setRangeFrom(key); setRangeTo(key);
                  setPickerOpen(false); return;
                }
                setPickerRange({ from: range?.from, to: range?.to });
                pickerFromRef.current = range?.from;
                if (range?.from && range?.to) {
                  setRangeFrom(dateKey(range.from.getUTCFullYear(), range.from.getUTCMonth() + 1, range.from.getUTCDate()));
                  setRangeTo(dateKey(range.to.getUTCFullYear(), range.to.getUTCMonth() + 1, range.to.getUTCDate()));
                  setPickerOpen(false);
                }
              }}
            />
            <div className="p-2 border-t flex justify-end">
              <button
                onClick={() => { setRangeFrom(null); setRangeTo(null); setPickerOpen(false); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Semana atual
              </button>
            </div>
          </PopoverContent>
        </Popover>
        <div className="flex-1" />
        {connectedShopsLag.length > 0 && (() => {
          const days = connectedShopsLag.map(s => s.avgDays != null ? Math.round(s.avgDays) : null).filter((d): d is number => d != null);
          if (days.length === 0) return null;
          const min = Math.min(...days);
          const max = Math.max(...days);
          const label = min === max ? `D+${min}` : `D+${min}–${max}`;
          return (
            <span className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" title="Tempo médio de repasse da Shopify Payments">
              {label}
            </span>
          );
        })()}
        <div className="flex-1" />
        {(effectivePending?.connected || connectedShopsLag.length > 0) && (
          <button
            onClick={syncPayouts}
            disabled={syncing}
            className="p-2 rounded-lg border border-border hover:border-primary/30 bg-card hover:bg-accent disabled:opacity-50 transition-all"
            title="Sincronizar depósitos Shopify"
          >
            <RefreshCw className={`size-3.5 text-muted-foreground ${syncing ? "animate-spin" : ""}`} />
          </button>
        )}
        {!isConsolidated && (
          <>
            <Button variant="outline" size="sm" className="text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/5" onClick={() => setQuickAdd({ date: todayKey, kind: "income" })}>
              <Plus className="size-3.5" /> Entrada
            </Button>
            <Button variant="outline" size="sm" className="text-rose-700 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/5" onClick={() => setQuickAdd({ date: todayKey, kind: "expense" })}>
              <Plus className="size-3.5" /> Saída
            </Button>
          </>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              Opções <ChevronDown className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2 space-y-1">
            <label className="flex items-center gap-2 text-xs px-2 py-2 rounded-md cursor-pointer hover:bg-accent select-none" title="Lançamentos caindo no sábado ou domingo aparecerão na segunda-feira seguinte.">
              <input
                type="checkbox"
                checked={weekendToMonday}
                onChange={(e) => weekendMut.mutate(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              <span>Fds → segunda</span>
            </label>
            <label className="flex items-center gap-2 text-xs px-2 py-2 rounded-md cursor-pointer hover:bg-accent select-none" title="Mostra uma estimativa (processado + 10 dias) dos valores pendentes de repasse pela Shopify.">
              <input
                type="checkbox"
                checked={showPending}
                onChange={(e) => setShowPending(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              <span>Mostrar pendentes</span>
            </label>
            {connectedShopsLag.length > 0 && (
              <div className="px-2 py-2 border-t border-border mt-1">
                <p className="text-xs text-muted-foreground mb-1.5">Período de repasse (pendentes)</p>
                {!isConsolidated && payoutLag?.connected && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">D+</span>
                    {editingLag ? (
                      <>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          className="w-14 text-xs text-center rounded border border-border bg-background px-1 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                          value={lagInput}
                          onChange={(e) => setLagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { const n = parseInt(lagInput); if (n >= 1 && n <= 30) saveLagDays(n); }
                            if (e.key === "Escape") setEditingLag(false);
                          }}
                          autoFocus
                        />
                        <button onClick={() => { const n = parseInt(lagInput); if (n >= 1 && n <= 30) saveLagDays(n); }} className="p-1 rounded hover:bg-accent" title="Salvar">
                          <Check className="size-3 text-emerald-600" />
                        </button>
                        <button onClick={() => setEditingLag(false)} className="p-1 rounded hover:bg-accent" title="Cancelar">
                          <X className="size-3 text-muted-foreground" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs font-semibold">
                          {payoutLag.manualDays ?? (payoutLag.avgDays != null ? Math.round(payoutLag.avgDays) : "—")}
                        </span>
                        <span className="text-xs text-muted-foreground">dias</span>
                        <button
                          onClick={() => { setLagInput(String(payoutLag.manualDays ?? (payoutLag.avgDays != null ? Math.round(payoutLag.avgDays) : 7))); setEditingLag(true); }}
                          className="p-1 rounded hover:bg-accent ml-auto"
                          title="Editar"
                        >
                          <Pencil className="size-3 text-muted-foreground" />
                        </button>
                      </>
                    )}
                  </div>
                )}
                {isConsolidated && connectedShopsLag.map(s => (
                  <PerShopLagEditor
                    key={s.shop_id}
                    shopId={s.shop_id}
                    shopName={shops?.find(sh => sh.id === s.shop_id)?.name ?? s.shop_id.slice(0, 8)}
                    avgDays={s.avgDays}
                    manualDays={s.manualDays}
                    onSave={async (days) => {
                      await setLagDaysFn({ data: { shop_id: s.shop_id, days } });
                      qc.invalidateQueries({ queryKey: ["shop-group-payout-lag", cacheKey] });
                    }}
                  />
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Day grid */}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => {
          const drag = expanded.find((x) => x.id === e.active.id && !x.virtual);
          if (drag) setActiveDrag(drag);
        }}
        onDragEnd={(e: DragEndEvent) => {
          const drag = activeDrag;
          setActiveDrag(null);
          if (!e.over || !drag) return;
          const overId = String(e.over.id);
          if (!overId.startsWith("day-")) return;
          const newDate = overId.slice(4);
          if (newDate === drag.date) return;
          updateMut.mutate({ id: drag.id, patch: { date: newDate } });
        }}
      >
        <div className="rounded-2xl border border-border bg-surface overflow-x-auto">
          <div className="grid" style={{ gridTemplateColumns: dayList.map(d => { const wd = weekdayFromKey(d); return (wd === 0 || wd === 6) ? "92px" : "minmax(130px, 1fr)"; }).join(" "), gridTemplateRows: "auto 170px 170px auto", minWidth: dayList.length * 92 }}>
            {dayData.map((dd) => {
              const weekday = weekdayFromKey(dd.key);
              const isToday = dd.key === todayKey;
              const isWeekend = weekday === 0 || weekday === 6;
              if (isWeekend) {
                return (
                  <WeekendDayCell
                    key={dd.key}
                    dd={dd}
                    weekday={weekday}
                    isToday={isToday}
                    todayKey={todayKey}
                    onEdit={setEditing}
                    onToggleReconciled={(e) => updateMut.mutate({ id: e.id, patch: { reconciled: !e.reconciled } })}
                  />
                );
              }
              return (
                <WeekdayDayCell
                  key={dd.key}
                  dd={dd}
                  weekday={weekday}
                  isToday={isToday}
                  todayKey={todayKey}
                  onEdit={setEditing}
                  onToggleReconciled={(e) => updateMut.mutate({ id: e.id, patch: { reconciled: !e.reconciled } })}
                />
              );
            })}
          </div>
        </div>
        <DragOverlay>
          {activeDrag && (
            <div className="rounded-md border bg-surface px-2 py-1.5 text-xs shadow-lg w-[180px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{activeDrag.category ?? (activeDrag.kind === "income" ? "Entrada" : "Saída")}</span>
                <span className={`font-semibold tabular-nums shrink-0 ${activeDrag.kind === "income" ? "text-emerald-600" : "text-rose-600"}`}>
                  {activeDrag.kind === "income" ? "+" : "-"}{fmtMoney(Number(activeDrag.amount))}
                </span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Quick add */}
      {quickAdd && (
        <QuickAdd
          shopId={shopId}
          date={quickAdd.date}
          kind={quickAdd.kind}
          categories={quickAdd.kind === "income" ? incomeCats : expenseCats}
          onClose={() => setQuickAdd(null)}
          onSave={(v: any) => { createMut.mutate(v); setQuickAdd(null); }}
        />
      )}

      {/* Edit */}
      {editing && (
        <EditEntry
          entry={editing}
          categories={editing.kind === "income" ? incomeCats : expenseCats}
          onClose={() => setEditing(null)}
          onSave={(patch) => { updateMut.mutate({ id: editing.id, patch }); setEditing(null); }}
          onDelete={() => { deleteMut.mutate(editing.id); setEditing(null); }}
        />
      )}

      {/* Manage categories */}
      {manageCats && (
        <ManageCategories
          shopId={shopId}
          categories={allCats}
          onClose={() => setManageCats(false)}
          onChange={() => { refreshCats(); refresh(); }}
        />
      )}

    </div>
  );
}

function PerShopLagEditor({ shopId, shopName, avgDays, manualDays, onSave }: {
  shopId: string; shopName: string;
  avgDays: number | null; manualDays: number | null;
  onSave: (days: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const save = async () => {
    const n = parseInt(input);
    if (n >= 1 && n <= 30) { await onSave(n); setEditing(false); }
  };
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{shopName}</span>
      <span className="text-xs font-medium shrink-0">D+</span>
      {editing ? (
        <>
          <input
            type="number" min={1} max={30}
            className="w-12 text-xs text-center rounded border border-border bg-background px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
          />
          <button onClick={save} className="p-1 rounded hover:bg-accent" title="Salvar"><Check className="size-3 text-emerald-600" /></button>
          <button onClick={() => setEditing(false)} className="p-1 rounded hover:bg-accent" title="Cancelar"><X className="size-3 text-muted-foreground" /></button>
        </>
      ) : (
        <>
          <span className="text-xs font-semibold shrink-0">{manualDays ?? (avgDays != null ? Math.round(avgDays) : "—")}</span>
          <button onClick={() => { setInput(String(manualDays ?? (avgDays != null ? Math.round(avgDays) : 7))); setEditing(true); }} className="p-1 rounded hover:bg-accent" title="Editar">
            <Pencil className="size-3 text-muted-foreground" />
          </button>
        </>
      )}
    </div>
  );
}

function WeekdayDayCell({ dd, weekday, isToday, todayKey, onEdit, onToggleReconciled }: {
  dd: { key: string; incomeItems: DayItem[]; expenseItems: DayItem[]; income: number; expense: number; balance: number };
  weekday: number;
  isToday: boolean;
  todayKey: string;
  onEdit: (e: DayItem) => void;
  onToggleReconciled: (e: DayItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dd.key}` });
  return (
    <div
      ref={setNodeRef}
      className={`grid row-span-4 border-r border-border last:border-r-0 transition-colors ${isOver ? "bg-primary/5 ring-2 ring-inset ring-primary/40" : ""}`}
      style={{ gridTemplateRows: "subgrid" }}
    >
      <div className={`px-3 py-3 border-b border-border ${isToday ? "bg-primary/10" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className={`text-base font-bold tracking-tight truncate ${isToday ? "text-primary" : "text-foreground"}`}>{WEEKDAYS_FULL[weekday]}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{formatDateKey(dd.key, { day: "2-digit", month: "long" })}</div>
          </div>
          {isToday && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-medium shrink-0">hoje</span>}
        </div>
      </div>
      {/* Entradas */}
      <div className="p-2 border-b border-border/60 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-1.5 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/70 font-medium">Entradas</span>
          <span className="text-[10px] tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">{dd.income > 0 ? `+${fmtMoney(dd.income)}` : "—"}</span>
        </div>
        <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1">
          {dd.incomeItems.map((e) => <EntryChip key={e.id + e.date} entry={e} todayKey={todayKey} onClick={() => onEdit(e)} onToggleReconciled={onToggleReconciled} />)}
          {dd.incomeItems.length === 0 && (
            <div className="text-center text-[10px] text-muted-foreground/60 py-2">—</div>
          )}
        </div>
      </div>
      {/* Saídas */}
      <div className="p-2 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-1.5 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-rose-700/70 dark:text-rose-400/70 font-medium">Saídas</span>
          <span className="text-[10px] tabular-nums text-rose-700 dark:text-rose-400 font-semibold">{dd.expense > 0 ? `-${fmtMoney(dd.expense)}` : "—"}</span>
        </div>
        <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1">
          {dd.expenseItems.map((e) => <EntryChip key={e.id + e.date} entry={e} todayKey={todayKey} onClick={() => onEdit(e)} onToggleReconciled={onToggleReconciled} />)}
          {dd.expenseItems.length === 0 && (
            <div className="text-center text-[10px] text-muted-foreground/60 py-2">—</div>
          )}
        </div>
      </div>
      <div className={`px-3 py-3 border-t-2 ${dd.balance < 0 ? "bg-rose-500/10 border-rose-500/40" : "bg-primary/5 border-primary/30"}`}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Saldo do dia</div>
        <div className={`text-lg font-bold tabular-nums leading-tight mt-0.5 ${dd.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>{fmtMoney(dd.balance)}</div>
      </div>
    </div>
  );
}

function WeekendDayCell({ dd, weekday, isToday, todayKey, onEdit, onToggleReconciled }: {
  dd: { key: string; incomeItems: DayItem[]; expenseItems: DayItem[]; income: number; expense: number; balance: number };
  weekday: number;
  isToday: boolean;
  todayKey: string;
  onEdit: (e: DayItem) => void;
  onToggleReconciled: (e: DayItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dd.key}` });
  const items = [...dd.incomeItems, ...dd.expenseItems];
  return (
    <div
      ref={setNodeRef}
      className={`grid row-span-4 border-r border-border last:border-r-0 bg-background/40 transition-colors ${isOver ? "bg-primary/5 ring-2 ring-inset ring-primary/40" : ""}`}
      style={{ gridTemplateRows: "subgrid" }}
    >
      <div className={`px-2 py-3 border-b border-border ${isToday ? "bg-primary/10" : ""}`}>
        <div className={`text-xs font-bold tracking-tight truncate ${isToday ? "text-primary" : "text-foreground"}`}>{WEEKDAYS_FULL[weekday].slice(0, 3)}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{formatDateKey(dd.key, { day: "2-digit", month: "2-digit" })}</div>
      </div>
      <div className="row-span-2 p-1.5 flex flex-col gap-1 overflow-y-auto">
        {items.map((e) => <EntryChip key={e.id + e.date} entry={e} todayKey={todayKey} onClick={() => onEdit(e)} onToggleReconciled={onToggleReconciled} />)}
        {items.length === 0 && (
          <div className="flex-1 grid place-items-center text-[10px] text-muted-foreground/60">—</div>
        )}
      </div>
      <div className={`px-2 py-2 border-t-2 ${dd.balance < 0 ? "bg-rose-500/10 border-rose-500/40" : "bg-primary/5 border-primary/30"}`}>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Saldo</div>
        <div className={`text-xs font-bold tabular-nums leading-tight mt-0.5 ${dd.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>{fmtMoney(dd.balance)}</div>
      </div>
    </div>
  );
}

function Indicator({ icon: Icon, label, value, sub, accent, negative, tooltip }: any) {
  const content = (
    <div className={`rounded-2xl border p-3 ${negative ? "border-rose-500/30 bg-rose-500/5" : "border-border bg-surface"} ${tooltip ? "cursor-default" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className="size-3.5" style={{ color: accent }} /> {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${negative ? "text-rose-600 dark:text-rose-400" : ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">{sub}</div>}
    </div>
  );
  if (!tooltip) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function Modal({ children, onClose, title }: any) {
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 z-50 bg-background/80 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EntryChip({ entry, todayKey, onClick, onToggleReconciled }: { entry: DayItem; todayKey: string; onClick: () => void; onToggleReconciled: (e: DayItem) => void }) {
  const isIncome = entry.kind === "income";
  const isPending = entry.source === "shopify_pending";
  const shifted = typeof entry.shiftedFromWeekday === "number";
  const fromLabel = shifted ? WEEKDAYS_FULL[entry.shiftedFromWeekday!] : null;
  const isDraggable = !isPending && !entry.virtual;
  const canReconcile = !isPending && !entry.virtual && entry.date <= todayKey;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entry.id, disabled: !isDraggable });
  return (
    <button
      ref={isDraggable ? setNodeRef : undefined}
      {...(isDraggable ? listeners : {})}
      {...(isDraggable ? attributes : {})}
      onClick={onClick}
      disabled={isPending}
      className={`group w-full text-left text-xs px-2 py-1.5 rounded-md border transition-colors ${isDragging ? "opacity-30" : ""} ${isPending ? "border-dashed border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 cursor-default" : isIncome ? "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 text-rose-700 dark:text-rose-400"} ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate inline-flex items-center gap-1 min-w-0">
          {canReconcile && !entry.reconciled && (
            <span
              role="checkbox"
              aria-checked={false}
              title="Marcar como conciliado"
              onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onToggleReconciled(entry); }}
              onPointerDown={(ev) => ev.stopPropagation()}
              className="shrink-0 size-3.5 rounded-sm border border-current/40 hover:border-current transition-colors"
            />
          )}
          {entry.recurrence && entry.recurrence !== "none" && <Repeat className="size-3 opacity-70 shrink-0" />}
          <span className="truncate">{entry.category ?? (isIncome ? "Entrada" : "Saída")}</span>
        </span>
        <span className="font-semibold tabular-nums shrink-0">{isIncome ? "+" : "-"}{fmtMoney(Number(entry.amount))}</span>
      </div>
      {entry.description && <div className="truncate text-muted-foreground text-[10px] mt-0.5">{entry.description}</div>}
      {isPending && (
        <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">
          Previsto
        </div>
      )}
      {canReconcile && !entry.reconciled && (
        <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
          Falta conciliação
        </div>
      )}
      {shifted && (
        <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
          <Repeat className="size-2.5" /> Transferido de {fromLabel?.toLowerCase()}
        </div>
      )}
    </button>
  );
}

const RECURRENCE_OPTIONS: { value: "none" | "daily" | "weekly" | "monthly"; label: string }[] = [
  { value: "none", label: "Não repete" },
  { value: "daily", label: "Diária" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
];

function QuickAdd({ shopId, date, kind, categories, onClose, onSave }: { shopId: string; date: string; kind: "income" | "expense"; categories: string[]; onClose: () => void; onSave: (v: any) => void }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>(categories[0] ?? "");
  const [description, setDescription] = useState("");
  const [d, setD] = useState(date);
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [until, setUntil] = useState("");
  const cats = categories;

  return (
    <Modal onClose={onClose} title={kind === "income" ? "Nova entrada" : "Nova saída"}>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Valor</label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Categoria</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Descrição</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Data</label>
            <Input type="date" value={d} onChange={(e) => setD(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground inline-flex items-center gap-1"><Repeat className="size-3" /> Recorrência</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        {recurrence !== "none" && (
          <div>
            <label className="text-xs text-muted-foreground">Repetir até (opcional)</label>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => {
          const v = parseFloat(amount);
          if (isNaN(v) || v <= 0) return;
          onSave({ shop_id: shopId, kind, amount: v, date: d, category, description: description || null, recurrence, recurrence_until: until || null });
        }}>Salvar</Button>
      </div>
    </Modal>
  );
}

function EditEntry({ entry, categories, onClose, onSave, onDelete }: { entry: DayItem; categories: string[]; onClose: () => void; onSave: (p: any) => void; onDelete: () => void }) {
  const [amount, setAmount] = useState(String(entry.amount));
  const [category, setCategory] = useState(entry.category ?? "");
  const [description, setDescription] = useState(entry.description ?? "");
  const [d, setD] = useState(entry.originalDate ?? entry.date);
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">((entry.recurrence ?? "none") as any);
  const [until, setUntil] = useState(entry.recurrence_until ?? "");
  const [skipWeekend, setSkipWeekend] = useState<boolean>(Boolean(entry.skip_weekend_rule));
  const [reconciled, setReconciled] = useState<boolean>(Boolean(entry.reconciled));
  const cats = categories;
  const isShopify = entry.source === "shopify_import" || entry.source === "shopify_sync";
  const canReconcile = !entry.virtual && entry.source !== "shopify_pending";

  return (
    <Modal onClose={onClose} title={`Editar ${entry.kind === "income" ? "entrada" : "saída"}`}>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Valor</label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Categoria</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">—</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Descrição</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Data {entry.virtual && <span className="text-[10px]">(início)</span>}</label>
            <Input type="date" value={d} onChange={(e) => setD(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground inline-flex items-center gap-1"><Repeat className="size-3" /> Recorrência</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        {recurrence !== "none" && (
          <div>
            <label className="text-xs text-muted-foreground">Repetir até (opcional)</label>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        )}
        {entry.virtual && (
          <div className="text-[11px] text-muted-foreground">Esta é uma ocorrência recorrente. Editar afeta toda a série.</div>
        )}
        {entry.source !== "manual" && (
          <div className="text-[11px] text-muted-foreground">Importado do Shopify · alterações são manuais.</div>
        )}
        {isShopify && (
          <label className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-border bg-surface cursor-pointer select-none">
            <input type="checkbox" checked={skipWeekend} onChange={(e) => setSkipWeekend(e.target.checked)} className="size-3.5 accent-primary" />
            <span>Ignorar regra de fim de semana neste lançamento</span>
          </label>
        )}
        {typeof entry.shiftedFromWeekday === "number" && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400">Originalmente previsto para {WEEKDAYS_FULL[entry.shiftedFromWeekday]}.</div>
        )}
        {canReconcile && (
          <label className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-border bg-surface cursor-pointer select-none">
            <input type="checkbox" checked={reconciled} onChange={(e) => setReconciled(e.target.checked)} className="size-3.5 accent-primary" />
            <span>Conciliado · incluído no saldo atual</span>
          </label>
        )}
      </div>
      <div className="flex justify-between gap-2 mt-4">
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
          <Trash2 className="size-4" /> Excluir{entry.recurrence && entry.recurrence !== "none" ? " série" : ""}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => {
            const v = parseFloat(amount);
            if (isNaN(v)) return;
            onSave({ amount: v, category: category || null, description: description || null, date: d, recurrence, recurrence_until: until || null, skip_weekend_rule: skipWeekend, ...(canReconcile ? { reconciled } : {}) });
          }}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}

function ManageCategories({ shopId, categories, onClose, onChange }: { shopId: string; categories: { id: string; kind: "income" | "expense"; name: string }[]; onClose: () => void; onChange: () => void }) {
  const createFn = useServerFn(createCashCategory);
  const renameFn = useServerFn(renameCashCategory);
  const deleteFn = useServerFn(deleteCashCategory);
  const createMut = useMutation({ mutationFn: (v: any) => createFn({ data: v }), onSuccess: onChange });
  const renameMut = useMutation({ mutationFn: (v: any) => renameFn({ data: v }), onSuccess: onChange });
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: onChange });
  const confirm = useConfirm();

  const income = categories.filter(c => c.kind === "income");
  const expense = categories.filter(c => c.kind === "expense");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newIncome, setNewIncome] = useState("");
  const [newExpense, setNewExpense] = useState("");

  function Section({ title, kind, items, newValue, setNewValue, accent }: { title: string; kind: "income" | "expense"; items: { id: string; name: string }[]; newValue: string; setNewValue: (v: string) => void; accent: string }) {
    return (
      <div>
        <div className={`text-[10px] uppercase tracking-wider font-medium mb-2 ${accent}`}>{title}</div>
        <ul className="space-y-1 mb-2">
          {items.map(c => (
            <li key={c.id} className="flex items-center gap-2 px-2 h-9 rounded-lg bg-muted group">
              {editingId === c.id ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm" autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter" && editName.trim()) { renameMut.mutate({ id: c.id, name: editName.trim() }); setEditingId(null); } if (e.key === "Escape") setEditingId(null); }} />
                  <button onClick={() => { if (editName.trim()) { renameMut.mutate({ id: c.id, name: editName.trim() }); setEditingId(null); } }} className="text-muted-foreground hover:text-primary p-1"><Check className="size-3.5" /></button>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground p-1"><X className="size-3.5" /></button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1 truncate">{c.name}</span>
                  <button onClick={() => { setEditingId(c.id); setEditName(c.name); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-1"><Pencil className="size-3.5" /></button>
                  <button onClick={() => { confirm(`Excluir categoria "${c.name}"? Lançamentos existentes mantêm o nome como texto livre.`).then((ok) => { if (ok) deleteMut.mutate(c.id); }); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"><Trash2 className="size-3.5" /></button>
                </>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="text-xs text-muted-foreground px-2">Nenhuma categoria.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); const n = newValue.trim(); if (!n) return; createMut.mutate({ shop_id: shopId, kind, name: n }); setNewValue(""); }} className="flex items-center gap-2">
          <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Nova categoria" className="h-9 text-sm" />
          <Button type="submit" size="sm" variant="outline"><Plus className="size-3.5" /></Button>
        </form>
      </div>
    );
  }

  return (
    <Modal onClose={onClose} title="Gerenciar categorias">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Section title="Entradas" kind="income" items={income} newValue={newIncome} setNewValue={setNewIncome} accent="text-emerald-700/80 dark:text-emerald-400/80" />
        <Section title="Saídas" kind="expense" items={expense} newValue={newExpense} setNewValue={setNewExpense} accent="text-rose-700/80 dark:text-rose-400/80" />
      </div>
      <div className="flex justify-end mt-5">
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}

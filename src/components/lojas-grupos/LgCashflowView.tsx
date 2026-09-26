/**
 * LgCashflowView — visual idêntica ao ShopCashflow, com as seguintes diferenças:
 *   • Cores por tipo de payout: pendente=vermelho, agendado=amarelo, depositado=azul,
 *     saídas=cinza, entrada manual=azul
 *   • 3 KPIs: Saldo atual + A receber (Shopify) + Saldo total
 *   • Date picker igual ao dashboard (dropdown de período + calendário range com bug fix)
 *   • Tag de loja em cada chip (modo consolidado)
 *   • Scroll horizontal com barra visível
 *   • Sem seção D+X nas opções (já fica no collapsible de LgCaixa)
 *
 * ShopCashflow.tsx NÃO foi modificado.
 */
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Plus, Trash2, ChevronDown, X, Wallet, TrendingUp,
  Repeat, Pencil, Check, RefreshCw, Database, ArrowUp, ArrowDown,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DateRangePicker } from "@/components/lojas-grupos/LgDashboard";
import {
  listShopCash, createCashEntry, updateCashEntry, deleteCashEntry,
  setOpeningBalance, setWeekendRule, resetShopCash,
  listCashCategories, createCashCategory, renameCashCategory, deleteCashCategory,
  getCaixaSnapshots,
} from "@/lib/shop-cash.functions";
import {
  listShopCashConsolidated, createConsolidatedCashEntry,
  updateConsolidatedCashEntry, deleteConsolidatedCashEntry,
} from "@/lib/shop-cash-consolidated.functions";
import {
  getShopifyPendingBalance, syncShopifyPayouts,
  getGroupShopifyPendingBalance, getShopifyLastSyncedAt, setManualOverride,
} from "@/lib/shop-orders.functions";
import { US_TIME_ZONE, isoTodayUS } from "@/lib/timezone";

// ─── Types ────────────────────────────────────────────────────────────────────

type Recurrence = "none" | "daily" | "weekly" | "monthly";
type Entry = {
  id: string; kind: "income" | "expense"; amount: number; date: string;
  category: string | null; description: string | null; source: string;
  auto_kind?: string | null; auto_ref_date?: string | null; import_id: string | null;
  recurrence?: Recurrence | null; recurrence_until?: string | null;
  skip_weekend_rule?: boolean | null; reconciled?: boolean | null;
  shop_id?: string;
};
type DayItem = Entry & { virtual?: boolean; originalDate?: string; shiftedFromWeekday?: number };

function fmtLastSynced(iso: string | null) {
  if (!iso) return "Nunca sincronizado";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Sincronizado agora";
  if (minutes < 60) return `Sincronizado há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Sincronizado há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Sincronizado há ${days} ${days === 1 ? "dia" : "dias"}`;
}

// ─── Date helpers (same as ShopCashflow) ─────────────────────────────────────

const WEEKDAYS_FULL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function dateKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function dateKeyParts(k: string) {
  const [y,m,d] = k.split("-").map(Number); return { year:y, month:m, day:d };
}
function dateFromKey(k: string) {
  const {year,month,day} = dateKeyParts(k);
  return new Date(Date.UTC(year, month-1, day, 12));
}
function addDaysToKey(k: string, n: number) {
  const d = dateFromKey(k); d.setUTCDate(d.getUTCDate()+n);
  return dateKey(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate());
}
function addMonthsToKey(k: string, n: number) {
  const {year,month,day} = dateKeyParts(k);
  const f = new Date(Date.UTC(year, month-1+n, 1, 12));
  const last = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth()+1, 0, 12)).getUTCDate();
  return dateKey(f.getUTCFullYear(), f.getUTCMonth()+1, Math.min(day, last));
}
const todayKeyUS = isoTodayUS;
function formatDateKey(k: string, opts: Intl.DateTimeFormatOptions) {
  return dateFromKey(k).toLocaleDateString("pt-BR", {...opts, timeZone: US_TIME_ZONE});
}
function weekdayFromKey(k: string) { return dateFromKey(k).getUTCDay(); }
function isoWeekNumber(k: string): number {
  const d = new Date(k + "T12:00:00Z");
  const thu = new Date(d);
  thu.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  return Math.ceil(((thu.getTime() - jan4.getTime()) / 86400000 + ((jan4.getUTCDay() + 6) % 7)) / 7) + 1;
}
function shiftToMondayIfWeekend(k: string) {
  const wd = weekdayFromKey(k);
  if (wd===6) return addDaysToKey(k,2);
  if (wd===0) return addDaysToKey(k,1);
  return k;
}
function fmtMoney(n: number) {
  return n.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false});
}

// ─── Entry chip — cores diferenciadas por tipo ────────────────────────────────

function entryChipClasses(entry: DayItem, isToday: boolean): string {
  if (entry.kind === "expense") {
    return "border-neutral-400/20 bg-neutral-500/5 hover:bg-neutral-500/10 text-neutral-600 dark:text-neutral-400";
  }
  const src = entry.source ?? "";
  // Pendente
  if (src === "shopify_pending") {
    return "border-dashed border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400 cursor-default";
  }
  // Agendado
  if (src === "shopify_pending_sync") {
    return "border-dashed border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 cursor-default";
  }
  // Depositado
  if (src === "shopify_import" || src === "shopify_sync") {
    return "border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 text-blue-700 dark:text-blue-400";
  }
  // Manual income
  return "border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 text-blue-700 dark:text-blue-400";
}

function payoutStatusLabel(entry: DayItem): string | null {
  const src = entry.source ?? "";
  if (src === "shopify_pending")      return "Pendente";
  if (src === "shopify_pending_sync") return "Agendado";
  return null;
}

function EntryChip({
  entry, todayKey, onClick, onToggleReconciled, shopName,
}: {
  entry: DayItem; todayKey: string;
  onClick: () => void;
  onToggleReconciled: (e: DayItem) => void;
  shopName?: string;
}) {
  const isIncome  = entry.kind === "income";
  const src       = entry.source ?? "";
  const isPending = src === "shopify_pending" || src === "shopify_pending_sync";
  const shifted   = typeof entry.shiftedFromWeekday === "number";
  const fromLabel = shifted ? WEEKDAYS_FULL[entry.shiftedFromWeekday!] : null;
  const isDraggable = !isPending && !entry.virtual;
  const canReconcile = !isPending && !entry.virtual && entry.date <= todayKey;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entry.id, disabled: !isDraggable });
  const statusLabel = payoutStatusLabel(entry);

  return (
    <button
      ref={isDraggable ? setNodeRef : undefined}
      {...(isDraggable ? listeners : {})}
      {...(isDraggable ? attributes : {})}
      onClick={isPending ? undefined : onClick}
      disabled={isPending && !entry.virtual}
      className={cn(
        "group w-full text-left text-xs px-2 py-1.5 rounded-md border transition-colors",
        isDragging ? "opacity-30" : "",
        entryChipClasses(entry, entry.date === todayKey),
        isDraggable ? "cursor-grab active:cursor-grabbing" : "",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate inline-flex items-center gap-1 min-w-0">
          {canReconcile && !entry.reconciled && (
            <span
              role="checkbox" aria-checked={false} title="Marcar como conciliado"
              onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onToggleReconciled(entry); }}
              onPointerDown={(ev) => ev.stopPropagation()}
              className="shrink-0 size-3.5 rounded-sm border border-current/40 hover:border-current transition-colors"
            />
          )}
          {entry.recurrence && entry.recurrence !== "none" && <Repeat className="size-3 opacity-70 shrink-0" />}
          <span className="truncate">{entry.category ?? (isIncome ? "Entrada" : "Saída")}</span>
        </span>
        <span className="font-semibold tabular-nums shrink-0">
          {isIncome ? "+" : "-"}{fmtMoney(Number(entry.amount))}
        </span>
      </div>
      {entry.description && (
        <div className="truncate text-muted-foreground text-[10px] mt-0.5">{entry.description}</div>
      )}
      {shopName && (
        <div className="mt-1 inline-flex items-center text-[10px] bg-muted/60 border border-border text-muted-foreground rounded px-1.5 py-0.5 max-w-full truncate">
          {shopName}
        </div>
      )}
      {statusLabel && (
        <div className={cn(
          "mt-1 inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5",
          src === "shopify_pending"
            ? "text-rose-700 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20"
            : "text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20"
        )}>
          {statusLabel}
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

// ─── Grouped entries (modo simplificado) ───────────────────────────────────────
// Junta todas as entradas do dia num único "Vendas", e as saídas por categoria
// (Facebook, Fornecedor, etc.), mostrando a soma. O detalhamento de quais
// valores compõem a soma aparece no title (tooltip nativo, ao passar o mouse).

type EntryGroup = { key: string; label: string; kind: "income" | "expense"; total: number; entries: DayItem[]; pending?: boolean };

function isPendingItem(e: DayItem) {
  const src = e.source ?? "";
  return src === "shopify_pending" || src === "shopify_pending_sync";
}

// Lançamentos pendentes/previstos (mostrados só com "Mostrar pendentes" ligado)
// ficam num grupo à parte, fora do agrupamento normal por categoria — não dá
// pra conciliar previsão, então não faz sentido somar junto com o confirmado.
function groupDayItems(items: DayItem[], kind: "income" | "expense"): EntryGroup[] {
  if (items.length === 0) return [];
  const confirmed = items.filter((e) => !isPendingItem(e));
  const pending = items.filter(isPendingItem);

  const groupConfirmed = (list: DayItem[]): EntryGroup[] => {
    if (list.length === 0) return [];
    if (kind === "income") {
      return [{
        key: "income",
        label: "Vendas",
        kind,
        total: list.reduce((s, e) => s + Number(e.amount), 0),
        entries: list,
      }];
    }
    const byCategory = new Map<string, DayItem[]>();
    for (const e of list) {
      const cat = e.category ?? "Saída";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(e);
    }
    return Array.from(byCategory.entries()).map(([cat, entries]) => ({
      key: cat,
      label: cat,
      kind,
      total: entries.reduce((s, e) => s + Number(e.amount), 0),
      entries,
    }));
  };

  const pendingGroup: EntryGroup[] = pending.length > 0 ? [{
    key: `${kind}-pending`,
    label: kind === "income" ? "Vendas (previsto)" : "Previsto",
    kind,
    total: pending.reduce((s, e) => s + Number(e.amount), 0),
    entries: pending,
    pending: true,
  }] : [];

  return [...groupConfirmed(confirmed), ...pendingGroup];
}

function GroupedEntryChip({ group, onEdit, onToggleReconciled, shopNamesMap, isConsolidated, todayKey }: {
  group: EntryGroup;
  onEdit: (e: DayItem) => void;
  onToggleReconciled: (e: DayItem) => void;
  shopNamesMap?: Record<string, string>;
  isConsolidated: boolean;
  todayKey: string;
}) {
  const isIncome = group.kind === "income";
  const isPendingGroup = Boolean(group.pending);
  const title = group.entries.length > 1
    ? `${group.entries.map((e) => fmtMoney(Number(e.amount))).join(" + ")} = ${fmtMoney(group.total)}`
    : undefined;
  const chipClasses = cn(
    "w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-md border transition-colors",
    isPendingGroup
      ? "border-dashed border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 cursor-default"
      : isIncome
        ? "border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 text-blue-700 dark:text-blue-400"
        : "border-neutral-400/20 bg-neutral-500/5 hover:bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
  );

  // Grupo com um único lançamento: clique abre a edição direto, sem popover.
  // Previsão (pendente) não é editável nem conciliável — só exibe o valor.
  if (group.entries.length === 1) {
    const e = group.entries[0];
    const src = e.source ?? "";
    const isPending = src === "shopify_pending" || src === "shopify_pending_sync";
    const canReconcile = !isPending && !e.virtual && e.date <= todayKey;
    return (
      <button
        type="button" title={title}
        onClick={isPending ? undefined : () => onEdit(e)}
        disabled={isPending}
        className={chipClasses}
      >
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          {canReconcile && (
            <span
              role="checkbox" aria-checked={!!e.reconciled}
              title={e.reconciled ? "Conciliado" : "Marcar como conciliado"}
              onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onToggleReconciled(e); }}
              onPointerDown={(ev) => ev.stopPropagation()}
              className={cn(
                "shrink-0 size-3.5 rounded-sm border grid place-items-center transition-colors",
                e.reconciled ? "bg-primary border-primary text-primary-foreground" : "border-current/40 hover:border-current",
              )}
            >
              {e.reconciled && <Check className="size-2.5" />}
            </span>
          )}
          <span className="truncate">{group.label}</span>
        </span>
        <span className="font-semibold tabular-nums shrink-0">{isIncome ? "+" : "-"}{fmtMoney(group.total)}</span>
      </button>
    );
  }

  const reconcilable = group.entries.filter((e) => {
    const src = e.source ?? "";
    const isPending = src === "shopify_pending" || src === "shopify_pending_sync";
    return !isPending && !e.virtual && e.date <= todayKey;
  });
  const allReconciled = reconcilable.length > 0 && reconcilable.every((e) => e.reconciled);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title={title} className={chipClasses}>
          <span className="flex items-center gap-1.5 min-w-0 truncate">
            {reconcilable.length > 0 && (
              <span
                role="checkbox" aria-checked={allReconciled}
                title={allReconciled ? "Conciliado" : "Marcar todos como conciliados"}
                onClick={(ev) => {
                  ev.stopPropagation(); ev.preventDefault();
                  const target = !allReconciled;
                  for (const e of reconcilable) if (Boolean(e.reconciled) !== target) onToggleReconciled(e);
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
                className={cn(
                  "shrink-0 size-3.5 rounded-sm border grid place-items-center transition-colors",
                  allReconciled ? "bg-primary border-primary text-primary-foreground" : "border-current/40 hover:border-current",
                )}
              >
                {allReconciled && <Check className="size-2.5" />}
              </span>
            )}
            <span className="truncate">{group.label}</span>
          </span>
          <span className="font-semibold tabular-nums shrink-0">{isIncome ? "+" : "-"}{fmtMoney(group.total)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2 space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1 mb-1">
          {group.label} · {group.entries.length} lançamentos{isPendingGroup ? " · previsto" : ""}
        </div>
        {group.entries.map((e) => {
          const src = e.source ?? "";
          const isPending = src === "shopify_pending" || src === "shopify_pending_sync";
          const canReconcile = !isPending && !e.virtual && e.date <= todayKey;
          return (
            <button
              key={e.id + e.date}
              type="button"
              onClick={isPending ? undefined : () => onEdit(e)}
              disabled={isPending}
              className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-left disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="flex items-center gap-1.5 min-w-0 truncate text-muted-foreground">
                {canReconcile && (
                  <span
                    role="checkbox" aria-checked={!!e.reconciled}
                    title={e.reconciled ? "Conciliado" : "Marcar como conciliado"}
                    onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); onToggleReconciled(e); }}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    className={cn(
                      "shrink-0 size-3.5 rounded-sm border grid place-items-center transition-colors",
                      e.reconciled ? "bg-primary border-primary text-primary-foreground" : "border-current/40 hover:border-current",
                    )}
                  >
                    {e.reconciled && <Check className="size-2.5" />}
                  </span>
                )}
                <span className="truncate">
                  {isConsolidated ? (shopNamesMap?.[e.shop_id ?? ""] ?? "—") : (e.category ?? (isIncome ? "Entrada" : "Saída"))}
                </span>
              </span>
              <span className="font-semibold tabular-nums shrink-0">{isIncome ? "+" : "-"}{fmtMoney(Number(e.amount))}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ─── Day cells ────────────────────────────────────────────────────────────────

function WeekdayDayCell({ dd, weekday, isToday, todayKey, onEdit, onToggleReconciled, shopNamesMap, isConsolidated, simplified }: {
  dd: { key: string; incomeItems: DayItem[]; expenseItems: DayItem[]; income: number; expense: number; balance: number };
  weekday: number; isToday: boolean; todayKey: string;
  onEdit: (e: DayItem) => void;
  onToggleReconciled: (e: DayItem) => void;
  shopNamesMap?: Record<string, string>;
  isConsolidated: boolean;
  simplified?: boolean;
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
            <div className="text-xs text-muted-foreground mt-0.5">{formatDateKey(dd.key, { day:"2-digit", month:"long" })}</div>
          </div>
          {isToday && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-medium shrink-0">hoje</span>}
        </div>
      </div>
      {/* Entradas */}
      <div className="p-2 border-b border-border/60 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-1.5 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-blue-700/70 dark:text-blue-400/70 font-medium">Entradas</span>
          <span className="text-[10px] tabular-nums text-blue-700 dark:text-blue-400 font-semibold">{dd.income > 0 ? `+${fmtMoney(dd.income)}` : "—"}</span>
        </div>
        <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1">
          {simplified
            ? groupDayItems(dd.incomeItems, "income").map((g) => (
              <GroupedEntryChip key={g.key} group={g} onEdit={onEdit} onToggleReconciled={onToggleReconciled} shopNamesMap={shopNamesMap} isConsolidated={isConsolidated} todayKey={todayKey} />
            ))
            : dd.incomeItems.map((e) => (
              <EntryChip
                key={e.id+e.date} entry={e} todayKey={todayKey}
                onClick={() => onEdit(e)} onToggleReconciled={onToggleReconciled}
                shopName={isConsolidated ? shopNamesMap?.[e.shop_id ?? ""] : undefined}
              />
            ))}
          {dd.incomeItems.length === 0 && <div className="text-center text-[10px] text-muted-foreground/60 py-2">—</div>}
        </div>
      </div>
      {/* Saídas */}
      <div className="p-2 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-1.5 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500/70 font-medium">Saídas</span>
          <span className="text-[10px] tabular-nums text-neutral-600 dark:text-neutral-400 font-semibold">{dd.expense > 0 ? `-${fmtMoney(dd.expense)}` : "—"}</span>
        </div>
        <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1">
          {simplified
            ? groupDayItems(dd.expenseItems, "expense").map((g) => (
              <GroupedEntryChip key={g.key} group={g} onEdit={onEdit} onToggleReconciled={onToggleReconciled} shopNamesMap={shopNamesMap} isConsolidated={isConsolidated} todayKey={todayKey} />
            ))
            : dd.expenseItems.map((e) => (
              <EntryChip
                key={e.id+e.date} entry={e} todayKey={todayKey}
                onClick={() => onEdit(e)} onToggleReconciled={onToggleReconciled}
                shopName={isConsolidated ? shopNamesMap?.[e.shop_id ?? ""] : undefined}
              />
            ))}
          {dd.expenseItems.length === 0 && <div className="text-center text-[10px] text-muted-foreground/60 py-2">—</div>}
        </div>
      </div>
      <div className={`px-3 py-3 border-t-2 ${dd.balance < 0 ? "bg-rose-500/10 border-rose-500/40" : "bg-primary/5 border-primary/30"}`}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Saldo do dia</div>
        <div className={`text-lg font-bold tabular-nums leading-tight mt-0.5 ${dd.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>{fmtMoney(dd.balance)}</div>
      </div>
    </div>
  );
}

function WeekendDayCell({ dd, weekday, isToday, todayKey, onEdit, onToggleReconciled, shopNamesMap, isConsolidated, simplified }: {
  dd: { key: string; incomeItems: DayItem[]; expenseItems: DayItem[]; income: number; expense: number; balance: number };
  weekday: number; isToday: boolean; todayKey: string;
  onEdit: (e: DayItem) => void;
  onToggleReconciled: (e: DayItem) => void;
  shopNamesMap?: Record<string, string>;
  isConsolidated: boolean;
  simplified?: boolean;
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
        <div className={`text-xs font-bold tracking-tight truncate ${isToday ? "text-primary" : "text-foreground"}`}>{WEEKDAYS_FULL[weekday].slice(0,3)}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{formatDateKey(dd.key, { day:"2-digit", month:"2-digit" })}</div>
      </div>
      <div className="row-span-2 p-1.5 flex flex-col gap-1 overflow-y-auto">
        {simplified ? (
          <>
            {groupDayItems(dd.incomeItems, "income").map((g) => (
              <GroupedEntryChip key={g.key} group={g} onEdit={onEdit} onToggleReconciled={onToggleReconciled} shopNamesMap={shopNamesMap} isConsolidated={isConsolidated} todayKey={todayKey} />
            ))}
            {groupDayItems(dd.expenseItems, "expense").map((g) => (
              <GroupedEntryChip key={g.key} group={g} onEdit={onEdit} onToggleReconciled={onToggleReconciled} shopNamesMap={shopNamesMap} isConsolidated={isConsolidated} todayKey={todayKey} />
            ))}
          </>
        ) : items.map((e) => (
          <EntryChip
            key={e.id+e.date} entry={e} todayKey={todayKey}
            onClick={() => onEdit(e)} onToggleReconciled={onToggleReconciled}
            shopName={isConsolidated ? shopNamesMap?.[e.shop_id ?? ""] : undefined}
          />
        ))}
        {items.length === 0 && <div className="flex-1 grid place-items-center text-[10px] text-muted-foreground/60">—</div>}
      </div>
      <div className={`px-2 py-2 border-t-2 ${dd.balance < 0 ? "bg-rose-500/10 border-rose-500/40" : "bg-primary/5 border-primary/30"}`}>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Saldo</div>
        <div className={`text-xs font-bold tabular-nums leading-tight mt-0.5 ${dd.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>{fmtMoney(dd.balance)}</div>
      </div>
    </div>
  );
}

// Último "A receber" visto neste navegador, pra abrir o card na hora.
const RECEIVABLE_CACHE_PREFIX = "caixa-a-receber:";
function readCachedReceivable(key: string): any {
  try {
    const raw = localStorage.getItem(RECEIVABLE_CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch { return undefined; }
}
function writeCachedReceivable(key: string, value: unknown) {
  try { localStorage.setItem(RECEIVABLE_CACHE_PREFIX + key, JSON.stringify(value)); } catch { /* sem storage: só não guarda */ }
}

// ─── KPIs do topo (Saldo atual / A receber / Saldo total) ─────────────────────

function fmtMoneyGrouped(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const KPI_TONES = {
  blue:   { tile: "bg-blue-600",    card: "bg-blue-500/[0.05] border-blue-500/15",       line: "#3b6fe8" },
  violet: { tile: "bg-violet-500",  card: "bg-violet-500/[0.05] border-violet-500/15",   line: "#8b5cf6" },
  green:  { tile: "bg-emerald-500", card: "bg-emerald-500/[0.06] border-emerald-500/20", line: "#22b35e" },
} as const;

// Cores dos números da lista "A receber" (por posição da loja no grupo).
const SHOP_BADGE_TONES = [
  "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
];

function KpiSparkline({ data, color, id }: { data: { key: string; v: number }[]; color: string; id: string }) {
  if (data.length < 2) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 opacity-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false}
            dot={(p: any) => p.index === data.length - 1
              ? <circle key="last" cx={p.cx} cy={p.cy} r={3} fill={color} stroke="white" strokeWidth={1.5} />
              : <g key={p.index} />}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiChange({ current, base, label }: { current: number; base: number | null; label: string }) {
  if (base == null) return null;
  const diff = current - base;
  const up = diff >= 0;
  // Sem saldo positivo lá atrás (Caixa recém-iniciado), % não existe: mostra a diferença em $.
  const text = base > 0 ? `${up ? "+" : ""}${((diff / base) * 100).toFixed(1)}%` : `${up ? "+" : "-"}${fmtMoneyGrouped(Math.abs(diff))}`;
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <div className="flex items-center gap-1 text-[11px]">
      <Arrow className={`size-3 ${up ? "text-emerald-600" : "text-rose-600"}`} />
      <span className={`font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{text}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function KpiCard({ icon: Icon, tone, title, subtitle, value, negative, badge, children, spark, sparkId }: {
  icon: any; tone: keyof typeof KPI_TONES; title: string; subtitle: string; value: string; negative?: boolean;
  badge?: string; children?: React.ReactNode; spark?: { key: string; v: number }[]; sparkId?: string;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className={`relative overflow-hidden rounded-2xl border p-3 ${negative ? "border-rose-500/30 bg-rose-500/5" : t.card}`}>
      <div className="relative z-10 flex items-center gap-2.5">
        <div className={`grid size-8 shrink-0 place-items-center rounded-lg text-white shadow-sm ${t.tile}`}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold leading-tight">{title}</div>
          <div className="text-[11px] text-muted-foreground leading-tight">{subtitle}</div>
        </div>
        {badge && <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-600 dark:text-violet-400">{badge}</span>}
      </div>
      <div className={`relative z-10 mt-2 text-xl font-bold leading-none tracking-tight tabular-nums ${negative ? "text-rose-600 dark:text-rose-400" : ""}`}>{value}</div>
      {children && <div className="relative z-10 mt-2">{children}</div>}
      {spark && sparkId && <KpiSparkline data={spark} color={t.line} id={sparkId} />}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

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

const RECURRENCE_OPTIONS = [
  { value: "none"    as const, label: "Não repete" },
  { value: "daily"   as const, label: "Diária" },
  { value: "weekly"  as const, label: "Semanal" },
  { value: "monthly" as const, label: "Mensal" },
];

const QUICK_ADD_ALL_SHOPS = "__all__";

// Divide um valor total em N parcelas em centavos, sem perder ou sobrar
// centavo por arredondamento (o resto fica com as primeiras parcelas).
function splitAmountEvenly(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}

function QuickAdd({ shopIds, shopNamesMap, date, kind, onClose, onSave }: any) {
  const [shopId, setShopId] = useState<string>(shopIds[0]);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("");
  const [description, setDescription] = useState("");
  const [d, setD] = useState(date);
  const [recurrence, setRecurrence] = useState<"none"|"daily"|"weekly"|"monthly">("none");
  const [until, setUntil] = useState("");

  const isAllShops = shopId === QUICK_ADD_ALL_SHOPS;
  const catsShopId = isAllShops ? shopIds[0] : shopId;
  const listCatsFn = useServerFn(listCashCategories);
  const catsQuery = useQuery({
    queryKey: ["shop-cash-cats", catsShopId],
    queryFn: () => listCatsFn({ data: { shop_id: catsShopId } }),
  });
  const categories = useMemo(
    () => ((catsQuery.data ?? []) as { kind: "income"|"expense"; name: string }[])
      .filter(c => c.kind === kind).map(c => c.name),
    [catsQuery.data, kind]
  );
  // Categorias são por loja: ao trocar de loja (ou carregar a lista), garante que a
  // categoria selecionada continua válida, voltando pra primeira disponível senão.
  useEffect(() => {
    if (!category || !categories.includes(category)) setCategory(categories[0] ?? "");
  }, [categories]);

  const isConsolidated = shopIds.length > 1;
  return (
    <Modal onClose={onClose} title={kind === "income" ? "Nova entrada" : "Nova saída"}>
      <div className="space-y-3">
        {isConsolidated && (
          <div><label className="text-xs text-muted-foreground">Loja</label>
            <select value={shopId} onChange={(e) => setShopId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value={QUICK_ADD_ALL_SHOPS}>Todas as lojas</option>
              {shopIds.map((id: string) => <option key={id} value={id}>{shopNamesMap[id] ?? id}</option>)}
            </select></div>
        )}
        <div><label className="text-xs text-muted-foreground">Valor{isAllShops ? " (total, dividido entre as lojas)" : ""}</label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
        <div><label className="text-xs text-muted-foreground">Categoria</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><label className="text-xs text-muted-foreground">Descrição</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-muted-foreground">Data</label>
            <Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground inline-flex items-center gap-1"><Repeat className="size-3" /> Recorrência</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></div>
        </div>
        {recurrence !== "none" && (
          <div><label className="text-xs text-muted-foreground">Repetir até (opcional)</label>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => {
          const v = parseFloat(amount);
          if (isNaN(v) || v <= 0) return;
          if (isAllShops) {
            const shares = splitAmountEvenly(v, shopIds.length);
            for (let i = 0; i < shopIds.length; i++) {
              onSave({ shop_id: shopIds[i], kind, amount: shares[i], date: d, category, description: description||null, recurrence, recurrence_until: until||null });
            }
          } else {
            onSave({ shop_id: shopId, kind, amount: v, date: d, category, description: description||null, recurrence, recurrence_until: until||null });
          }
        }}>Salvar</Button>
      </div>
    </Modal>
  );
}

function EditEntry({ entry, categories, onClose, onSave, onDelete }: any) {
  const [amount, setAmount]           = useState(String(entry.amount));
  const [category, setCategory]       = useState(entry.category ?? "");
  const [description, setDescription] = useState(entry.description ?? "");
  const [d, setD]                     = useState(entry.originalDate ?? entry.date);
  const [recurrence, setRecurrence]   = useState<any>((entry.recurrence ?? "none"));
  const [until, setUntil]             = useState(entry.recurrence_until ?? "");
  const [skipWeekend, setSkipWeekend] = useState(Boolean(entry.skip_weekend_rule));
  const [reconciled, setReconciled]   = useState(Boolean(entry.reconciled));
  const isShopify   = entry.source === "shopify_import" || entry.source === "shopify_sync";
  const canReconcile = !entry.virtual && entry.source !== "shopify_pending";
  return (
    <Modal onClose={onClose} title={`Editar ${entry.kind === "income" ? "entrada" : "saída"}`}>
      <div className="space-y-3">
        <div><label className="text-xs text-muted-foreground">Valor</label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className="text-xs text-muted-foreground">Categoria</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">—</option>
            {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><label className="text-xs text-muted-foreground">Descrição</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-muted-foreground">Data{entry.virtual && <span className="text-[10px]"> (início)</span>}</label>
            <Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground inline-flex items-center gap-1"><Repeat className="size-3" /> Recorrência</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></div>
        </div>
        {recurrence !== "none" && (
          <div><label className="text-xs text-muted-foreground">Repetir até (opcional)</label>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
        )}
        {entry.virtual && <div className="text-[11px] text-muted-foreground">Esta é uma ocorrência recorrente. Editar afeta toda a série.</div>}
        {entry.source === "auto" && entry.auto_kind === "order_cost" && (
          <div className="text-[11px] text-muted-foreground">Custo calculado automaticamente a partir dos pedidos pendentes desse dia. Excluir cria um ajuste manual de $0 pra não ser recalculado.</div>
        )}
        {entry.source !== "manual" && !(entry.source === "auto" && entry.auto_kind === "order_cost") && (
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
            onSave({ amount:v, category:category||null, description:description||null, date:d, recurrence, recurrence_until:until||null, skip_weekend_rule:skipWeekend, ...(canReconcile ? { reconciled } : {}) });
          }}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}

function ManageCategories({ shopId, categories, onClose, onChange }: any) {
  const createFn = useServerFn(createCashCategory);
  const renameFn = useServerFn(renameCashCategory);
  const deleteFn = useServerFn(deleteCashCategory);
  const createMut = useMutation({ mutationFn: (v:any) => createFn({ data:v }), onSuccess:onChange });
  const renameMut = useMutation({ mutationFn: (v:any) => renameFn({ data:v }), onSuccess:onChange });
  const deleteMut = useMutation({ mutationFn: (id:string) => deleteFn({ data:{id} }), onSuccess:onChange });
  const confirm   = useConfirm();
  const income  = categories.filter((c:any) => c.kind === "income");
  const expense = categories.filter((c:any) => c.kind === "expense");
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editName, setEditName]   = useState("");
  const [newIncome, setNewIncome]   = useState("");
  const [newExpense, setNewExpense] = useState("");

  function Section({ title, kind, items, newValue, setNewValue, accent }: any) {
    return (
      <div>
        <div className={`text-[10px] uppercase tracking-wider font-medium mb-2 ${accent}`}>{title}</div>
        <ul className="space-y-1 mb-2">
          {items.map((c:any) => (
            <li key={c.id} className="flex items-center gap-2 px-2 h-9 rounded-lg bg-muted group">
              {editingId === c.id ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm" autoFocus
                    onKeyDown={(e) => { if (e.key==="Enter" && editName.trim()) { renameMut.mutate({id:c.id,name:editName.trim()}); setEditingId(null); } if (e.key==="Escape") setEditingId(null); }} />
                  <button onClick={() => { if (editName.trim()) { renameMut.mutate({id:c.id,name:editName.trim()}); setEditingId(null); }}} className="text-muted-foreground hover:text-primary p-1"><Check className="size-3.5" /></button>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground p-1"><X className="size-3.5" /></button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1 truncate">{c.name}</span>
                  <button onClick={() => { setEditingId(c.id); setEditName(c.name); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-1"><Pencil className="size-3.5" /></button>
                  <button onClick={() => { confirm(`Excluir "${c.name}"?`).then((ok:boolean) => { if (ok) deleteMut.mutate(c.id); }); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"><Trash2 className="size-3.5" /></button>
                </>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="text-xs text-muted-foreground px-2">Nenhuma categoria.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); const n=newValue.trim(); if (!n) return; createMut.mutate({shop_id:shopId,kind,name:n}); setNewValue(""); }} className="flex items-center gap-2">
          <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Nova categoria" className="h-9 text-sm" />
          <Button type="submit" size="sm" variant="outline"><Plus className="size-3.5" /></Button>
        </form>
      </div>
    );
  }

  return (
    <Modal onClose={onClose} title="Gerenciar categorias">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Section title="Entradas" kind="income" items={income} newValue={newIncome} setNewValue={setNewIncome} accent="text-blue-700/80 dark:text-blue-400/80" />
        <Section title="Saídas" kind="expense" items={expense} newValue={newExpense} setNewValue={setNewExpense} accent="text-neutral-600/80 dark:text-neutral-400/80" />
      </div>
      <div className="flex justify-end mt-5">
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LgCashflowView({
  shopIds, shopNamesMap, simplified, standalone, fill, onManagePayoutDays,
}: {
  shopIds:      string[];
  shopNamesMap: Record<string, string>;
  simplified?: boolean;
  // Cópia isolada: puxa os lançamentos das lojas, mas editar/excluir/conciliar
  // aqui não altera o registro compartilhado usado pela loja/Grupo.
  standalone?: boolean;
  // Quadro da semana estica até o fim da tela (página Caixa).
  fill?: boolean;
  // Abre o painel de "Configurações de Repasse" (D+X por loja), quando o
  // card pai (LgCaixa) fornece esse gerenciamento.
  onManagePayoutDays?: () => void;
}) {
  const shopId         = shopIds[0];
  const isConsolidated = shopIds.length > 1;
  const cacheKey       = shopIds.slice().sort().join(",");
  const qc             = useQueryClient();
  const confirm         = useConfirm();

  const sharedListFn   = useServerFn(listShopCash);
  const sharedCreateFn = useServerFn(createCashEntry);
  const sharedDeleteFn = useServerFn(deleteCashEntry);
  const sharedUpdateFn = useServerFn(updateCashEntry);
  const standaloneListFn   = useServerFn(listShopCashConsolidated);
  const standaloneCreateFn = useServerFn(createConsolidatedCashEntry);
  const standaloneDeleteFn = useServerFn(deleteConsolidatedCashEntry);
  const standaloneUpdateFn = useServerFn(updateConsolidatedCashEntry);
  const listFn: any   = standalone ? standaloneListFn   : sharedListFn;
  const createFn: any = standalone ? standaloneCreateFn : sharedCreateFn;
  const deleteFn: any = standalone ? standaloneDeleteFn : sharedDeleteFn;
  const updateFn: any = standalone ? standaloneUpdateFn : sharedUpdateFn;
  const openingFn   = useServerFn(setOpeningBalance);
  const listCatsFn  = useServerFn(listCashCategories);
  const pendingFn   = useServerFn(getShopifyPendingBalance);
  const syncPaysFn  = useServerFn(syncShopifyPayouts);
  const groupPendFn = useServerFn(getGroupShopifyPendingBalance);
  const snapshotsFn = useServerFn(getCaixaSnapshots);
  const lastSyncFn  = useServerFn(getShopifyLastSyncedAt);

  const queryKey = [standalone ? "shop-cash-standalone" : "shop-cash", cacheKey];
  const catsKey  = ["shop-cash-cats", cacheKey];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => listFn({ data: { shop_ids: shopIds } }) });
  const catsQuery = useQuery({ queryKey: catsKey, queryFn: () => listCatsFn({ data: { shop_id: shopId } }) });
  const pendingQuery = useQuery({
    queryKey: ["shop-cash-pending", cacheKey],
    queryFn:  () => pendingFn({ data: { shop_id: shopId } }),
    enabled:  !isConsolidated,
  });
  const groupPendQuery = useQuery({
    queryKey: ["shop-group-cash-pending", cacheKey],
    queryFn:  () => groupPendFn({ data: { shop_ids: shopIds } }),
    enabled:  isConsolidated,
  });
  // "A receber" consulta a Shopify ao vivo (~1 s). Enquanto a resposta não
  // chega, o card mostra o último valor visto neste navegador. Lido depois de
  // montar (não no 1º render) pra não divergir do HTML vindo do servidor.
  const receivableCacheKey = `${isConsolidated ? "group" : "single"}:${cacheKey}`;
  const [cachedPending, setCachedPending] = useState<any>(undefined);
  useEffect(() => { setCachedPending(readCachedReceivable(receivableCacheKey)); }, [receivableCacheKey]);
  const livePending = isConsolidated ? groupPendQuery.data : pendingQuery.data;
  useEffect(() => { if (livePending) writeCachedReceivable(receivableCacheKey, livePending); }, [livePending, receivableCacheKey]);
  const lastSyncQuery = useQuery({
    queryKey: ["shop-cash-last-synced", cacheKey],
    queryFn:  () => lastSyncFn({ data: { shop_ids: shopIds } }),
  });

  const refresh     = () => qc.invalidateQueries({ queryKey });
  const refreshCats = () => qc.invalidateQueries({ queryKey: catsKey });

  const [syncing,    setSyncing]    = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [quickAdd,   setQuickAdd]   = useState<{ date: string; kind: "income"|"expense" } | null>(null);
  const [editing,    setEditing]    = useState<DayItem | null>(null);
  const [manageCats, setManageCats] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DayItem | null>(null);

  // Period date picker state
  const [period, setPeriod]           = useState("semana");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const [weekOffset, setWeekOffset]   = useState(0); // 0 = semana atual, -1 = anterior, +1 = próxima

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const entries      = (data?.entries ?? []) as Entry[];
  const opening      = data?.opening_balance ?? 0;
  const weekendToMonday = Boolean(data?.weekend_payouts_to_monday);
  const todayKey     = useMemo(() => todayKeyUS(), []);

  const allCats     = (catsQuery.data ?? []) as { id: string; kind: "income"|"expense"; name: string }[];
  const incomeCats  = useMemo(() => allCats.filter(c => c.kind==="income").map(c=>c.name), [allCats]);
  const expenseCats = useMemo(() => allCats.filter(c => c.kind==="expense").map(c=>c.name), [allCats]);

  // Compute day list from period
  const dayList = useMemo(() => {
    if (period === "custom" && customRange) {
      const arr: string[] = [];
      let d = customRange.from;
      while (d <= customRange.to) { arr.push(d); d = addDaysToKey(d, 1); }
      return arr;
    }
    if (period === "7d") {
      return Array.from({ length: 7 }, (_, i) => addDaysToKey(todayKey, i - 6));
    }
    if (period === "30d") {
      return Array.from({ length: 30 }, (_, i) => addDaysToKey(todayKey, i - 29));
    }
    if (period === "mes") {
      const { year, month } = dateKeyParts(todayKey);
      const start = dateKey(year, month, 1);
      const last  = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
      return Array.from({ length: last }, (_, i) => addDaysToKey(start, i));
    }
    // default: semana com offset (0 = atual, -1 = anterior, ...)
    const wd = weekdayFromKey(todayKey);
    const offsetToMonday = wd === 0 ? -6 : -(wd - 1);
    const mondayOfWeek = addDaysToKey(todayKey, offsetToMonday + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => addDaysToKey(mondayOfWeek, i));
  }, [period, customRange, todayKey, weekOffset]);

  const weekLabel = useMemo(() => {
    if (period !== "semana") return "Semana";
    const monday = dayList[0];
    const weekNum = isoWeekNumber(monday);
    const monthAbbr = new Date(monday + "T12:00:00Z")
      .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
      .replace(".", "")
      .replace(/^\w/, c => c.toUpperCase());
    return `SEM #${weekNum} - ${monthAbbr}`;
  }, [period, dayList]);

  const horizon = useMemo(() => {
    const last   = dayList[dayList.length - 1] ?? todayKey;
    const sixty  = addDaysToKey(todayKey, 60);
    return last > sixty ? last : sixty;
  }, [todayKey, dayList]);

  const expanded = useMemo<DayItem[]>(() => {
    const applyShift = (item: DayItem): DayItem => {
      const isShopify  = item.source==="shopify_import"||item.source==="shopify_sync"||item.source==="shopify_pending"||item.source==="shopify_pending_sync";
      if (!weekendToMonday) return item;
      if (!isShopify) return item;
      if (item.skip_weekend_rule) return item;
      const wd = weekdayFromKey(item.date);
      if (wd!==0 && wd!==6) return item;
      const shifted = shiftToMondayIfWeekend(item.date);
      return { ...item, date:shifted, originalDate:item.originalDate??item.date, shiftedFromWeekday:wd };
    };
    const out: DayItem[] = [];
    for (const e of entries) {
      if (e.auto_kind === "meta_ads_spend") continue;
      if (e.source==="shopify_pending_sync" && (!showPending || e.date<=todayKey)) continue;
      const rec = (e.recurrence ?? "none") as Recurrence;
      if (rec==="none") { out.push(applyShift(e)); continue; }
      const stop = e.recurrence_until && e.recurrence_until<horizon ? e.recurrence_until : horizon;
      let cur=e.date, i=0;
      while (cur<=stop && i<400) {
        out.push(applyShift({ ...e, date:cur, virtual:i>0, originalDate:e.date }));
        if (rec==="daily") cur=addDaysToKey(cur,1);
        else if (rec==="weekly") cur=addDaysToKey(cur,7);
        else if (rec==="monthly") cur=addMonthsToKey(cur,1);
        i++;
      }
    }
    return out;
  }, [entries, horizon, weekendToMonday, showPending, todayKey]);

  const saldoBeforeRange = useMemo(() => {
    const first = dayList[0] ?? todayKey;
    let s = opening;
    for (const e of expanded) {
      if (e.date < first) s += e.kind==="income" ? Number(e.amount) : -Number(e.amount);
    }
    return s;
  }, [expanded, opening, dayList, todayKey]);

  const byDay = useMemo(() => {
    const m = new Map<string, DayItem[]>();
    for (const e of expanded) { const arr=m.get(e.date)??[]; arr.push(e); m.set(e.date,arr); }
    return m;
  }, [expanded]);

  const dayData = useMemo(() => {
    let acc = saldoBeforeRange;
    return dayList.map((key) => {
      const items    = byDay.get(key) ?? [];
      const incomeItems  = items.filter(e=>e.kind==="income" && Number(e.amount)!==0);
      const expenseItems = items.filter(e=>e.kind==="expense" && Number(e.amount)!==0);
      const income   = incomeItems.reduce((a,e)=>a+Number(e.amount),0);
      const expense  = expenseItems.reduce((a,e)=>a+Number(e.amount),0);
      acc = acc + income - expense;
      return { key, incomeItems, expenseItems, income, expense, balance: acc };
    });
  }, [dayList, byDay, saldoBeforeRange]);

  // KPIs: only Saldo atual + A receber
  const future = useMemo(() => {
    let acc = opening;
    for (const e of expanded) {
      if (e.virtual) continue;
      if (e.reconciled) acc += e.kind==="income" ? Number(e.amount) : -Number(e.amount);
    }
    return acc;
  }, [expanded, opening]);

  // Saldo atual dia a dia nos últimos 30 dias (mesma regra do KPI: só
  // lançamentos conciliados), pro gráfico e a variação do card.
  const saldoHistory = useMemo(() => {
    const start = addDaysToKey(todayKey, -30);
    let acc = opening;
    const byDate = new Map<string, number>();
    for (const e of expanded) {
      if (e.virtual || !e.reconciled) continue;
      const v = e.kind==="income" ? Number(e.amount) : -Number(e.amount);
      if (e.date < start) acc += v;
      else if (e.date <= todayKey) byDate.set(e.date, (byDate.get(e.date) ?? 0) + v);
    }
    const out: { key: string; v: number }[] = [];
    for (let k = start; k <= todayKey; k = addDaysToKey(k, 1)) {
      acc += byDate.get(k) ?? 0;
      out.push({ key: k, v: acc });
    }
    return out;
  }, [expanded, opening, todayKey]);

  const effectivePending = livePending ?? cachedPending;
  // Mesma sequência das lojas em todo o grupo (Loja 1, Loja 2… Loja 10).
  const perShopReceivable = isConsolidated
    ? [...(((effectivePending as any)?.perShop ?? []) as { shop_id: string; amount: number }[])]
        .sort((a, b) => (shopNamesMap[a.shop_id] ?? "").localeCompare(shopNamesMap[b.shop_id] ?? "", "pt-BR", { numeric: true, sensitivity: "base" }))
    : [];
  const receivable = effectivePending?.connected
    ? (isConsolidated
        ? perShopReceivable.reduce((s, p) => s + Number(p.amount ?? 0), 0)
        // Saldo ao vivo (não alocado a payout) + payouts já agendados com
        // data futura — não se sobrepõem, então soma os dois.
        : (Number((effectivePending as any).balance ?? 0) + Number(effectivePending.pending ?? 0)))
    : 0;

  // Gráfico do Saldo total: fotos diárias gravadas no fim de cada dia
  // (caixa-snapshot.server.ts) + o valor ao vivo de hoje. Enquanto não houver
  // nenhuma foto, usa a curva do saldo somada ao a receber de hoje.
  const snapshotsFrom = addDaysToKey(todayKey, -30);
  const snapshotsQuery = useQuery({
    queryKey: ["caixa-snapshots", cacheKey, snapshotsFrom],
    queryFn:  () => snapshotsFn({ data: { shop_ids: shopIds, from: snapshotsFrom } }),
    staleTime: 60 * 60_000,
  });
  const saldoTotalHistory = useMemo(() => {
    const snaps = (snapshotsQuery.data ?? []).filter((r) => r.date < todayKey);
    if (!snaps.length) return { points: saldoHistory.map((p) => ({ key: p.key, v: p.v + receivable })), real: false };
    const points = snaps.map((r) => ({ key: r.date, v: r.saldo + r.receivable }));
    points.push({ key: todayKey, v: future + receivable });
    return { points, real: true };
  }, [snapshotsQuery.data, saldoHistory, receivable, future, todayKey]);
  const saldoTotalSince = saldoTotalHistory.real && saldoTotalHistory.points[0].key > snapshotsFrom
    ? `desde ${saldoTotalHistory.points[0].key.slice(8, 10)}/${saldoTotalHistory.points[0].key.slice(5, 7)}`
    : "em relação a 30 dias atrás";

  const syncPayouts = async () => {
    setSyncing(true);
    try {
      let total = 0;
      for (const id of shopIds) {
        const r = await syncPaysFn({ data: { shop_id: id, since_days: 90 } });
        total += r?.synced ?? 0;
      }
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["shop-group-cash-pending", cacheKey] });
      qc.invalidateQueries({ queryKey: ["shop-cash-pending", cacheKey] });
      qc.invalidateQueries({ queryKey: ["shop-cash-last-synced", cacheKey] });
      toast.success(total ? `${total} depósitos sincronizados` : "Depósitos já atualizados");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  // Não sincroniza a cada vez que a tela abre — o sync completo automático
  // (sync-shop-orders, de hora em hora) mantém os depósitos em dia, grava o
  // "Sincronizado há ..." e avisa esta tela pelo tempo real (useRealtimeSync).
  // Sync sob demanda continua no botão de refresh manual.

  const createMut  = useMutation({ mutationFn: (v:any) => createFn({ data:v }), onSuccess: refresh });
  const deleteMut  = useMutation({ mutationFn: (id:string) => deleteFn({ data:{id} }), onSuccess: refresh });
  const updateMut  = useMutation({
    mutationFn: (v: any) => updateFn({ data: v }),
    // Atualização otimista: o toggle de conciliado (principalmente o "marcar
    // todos" do grupo, que dispara N mutações de uma vez) fica visível na
    // hora. Usa a forma funcional de setQueryData pra ler o cache mais
    // recente em cada chamada — senão, com várias mutações concorrentes, uma
    // que resolve depois sobrescreve o cache com um snapshot desatualizado
    // (sem as outras alterações otimistas) e o check "pisca e volta".
    // Não força refetch em caso de sucesso: como o patch já é o que o
    // servidor vai gravar, o refetch só serviria pra reintroduzir a mesma
    // corrida — só corrige (via refresh) se der erro de verdade.
    onMutate: async (v: { id: string; patch: any }) => {
      await qc.cancelQueries({ queryKey });
      let previousEntry: any = null;
      qc.setQueryData(queryKey, (old: any) => {
        if (!old?.entries) return old;
        return {
          ...old,
          entries: old.entries.map((e: any) => {
            if (e.id !== v.id) return e;
            previousEntry = e;
            return { ...e, ...v.patch };
          }),
        };
      });
      return { previousEntry };
    },
    onError: (_err, v: { id: string; patch: any }, ctx: any) => {
      if (!ctx?.previousEntry) { refresh(); return; }
      qc.setQueryData(queryKey, (old: any) => {
        if (!old?.entries) return old;
        return { ...old, entries: old.entries.map((e: any) => (e.id === v.id ? ctx.previousEntry : e)) };
      });
    },
  });
  const overrideFn  = useServerFn(setManualOverride);
  const overrideMut = useMutation({ mutationFn: (v: any) => overrideFn({ data: v }), onSuccess: refresh, onError: (e: any) => toast.error(e?.message ?? "Erro ao excluir lançamento") });
  const weekendFn  = useServerFn(setWeekendRule);
  const weekendMut = useMutation({ mutationFn: (enabled:boolean) => weekendFn({ data:{ shop_id:shopId, enabled } }), onSuccess: refresh });
  const resetCashFn = useServerFn(resetShopCash);
  const resetMut = useMutation({
    mutationFn: async () => { for (const id of shopIds) await resetCashFn({ data: { shop_id: id } }); },
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["shop-group-cash-pending", cacheKey] });
      qc.invalidateQueries({ queryKey: ["shop-cash-pending", cacheKey] });
      toast.success("Caixa resetado");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao resetar caixa"),
  });
  const handleResetCash = () => {
    confirm({
      title: "Resetar caixa",
      description: isConsolidated
        ? "Isso apaga todos os lançamentos, importações e lotes de pagamento de todas as lojas deste card. O saldo volta para o valor inicial configurado. Essa ação não pode ser desfeita."
        : "Isso apaga todos os lançamentos, importações e lotes de pagamento desta loja. O saldo volta para o valor inicial configurado. Essa ação não pode ser desfeita.",
      confirmText: "Resetar",
      variant: "destructive",
    }).then((ok) => { if (ok) resetMut.mutate(); });
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando...</div>;

  return (
    <div className={`space-y-5 ${fill ? "lg:flex-1 lg:min-h-0 lg:flex lg:flex-col" : ""}`}>
      {/* ── 3 KPIs ── */}
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <KpiCard
            icon={Wallet} tone="blue" title="Saldo atual" subtitle="Disponível na conta"
            value={fmtMoneyGrouped(future)} negative={future < 0}
            spark={saldoHistory} sparkId="caixa-kpi-saldo"
          >
            <KpiChange current={future} base={saldoHistory.length ? saldoHistory[0].v : null} label="em relação a 30 dias atrás" />
          </KpiCard>
          <KpiCard
            icon={TrendingUp} tone="violet"
            title={effectivePending?.connected ? "A receber (Shopify)" : "Entradas previstas (30d)"}
            subtitle={effectivePending?.connected ? "Pedidos aguardando repasse" : "Entradas lançadas nos próximos 30 dias"}
            value={fmtMoneyGrouped(receivable)}
            badge={isConsolidated && perShopReceivable.length > 1 ? `${perShopReceivable.length} lojas` : undefined}
          >
            {isConsolidated && effectivePending?.connected && perShopReceivable.length > 1 && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {perShopReceivable.map((p, i) => (
                  <div key={p.shop_id} className="flex items-center gap-1.5 min-w-0 text-[11px]">
                    <span className={`grid size-3.5 shrink-0 place-items-center rounded-full text-[8px] font-semibold ${SHOP_BADGE_TONES[i % SHOP_BADGE_TONES.length]}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{shopNamesMap[p.shop_id] ?? p.shop_id}</span>
                    <span className="shrink-0 font-medium tabular-nums">{fmtMoneyGrouped(Number(p.amount ?? 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </KpiCard>
          <KpiCard
            icon={Database} tone="green" title="Saldo total" subtitle="Disponível + A receber"
            value={fmtMoneyGrouped(future + receivable)} negative={future + receivable < 0}
            spark={saldoTotalHistory.points} sparkId="caixa-kpi-total"
          >
            {saldoTotalHistory.real && saldoTotalHistory.points.length > 1 && (
              <KpiChange current={future + receivable} base={saldoTotalHistory.points[0].v} label={saldoTotalSince} />
            )}
          </KpiCard>
        </div>
      </TooltipProvider>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Period dropdown + calendar range (igual ao dashboard) */}
        <DateRangePicker
          period={period === "semana" ? "hoje" : period}
          setPeriod={(p) => {
            if (p === "hoje") { setPeriod("semana"); setCustomRange(undefined); setWeekOffset(0); }
            else { setPeriod(p); setWeekOffset(0); }
          }}
          customRange={customRange}
          setCustomRange={setCustomRange}
        />
        {/* Navegação de semanas */}
        <div className={`flex items-center h-8 rounded-xl border text-xs transition-all overflow-hidden ${period === "semana" ? "border-primary/40 bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground"}`}>
          <button
            onClick={() => { setPeriod("semana"); setCustomRange(undefined); setWeekOffset(w => w - 1); }}
            className="px-2 h-full hover:bg-primary/10 transition-colors"
            title="Semana anterior"
          >‹</button>
          <button
            onClick={() => { setPeriod("semana"); setCustomRange(undefined); setWeekOffset(0); }}
            className="px-3 h-full hover:bg-primary/10 transition-colors font-medium whitespace-nowrap"
          >{weekLabel}</button>
          <button
            onClick={() => { setPeriod("semana"); setCustomRange(undefined); setWeekOffset(w => w + 1); }}
            className="px-2 h-full hover:bg-primary/10 transition-colors"
            title="Próxima semana"
          >›</button>
        </div>

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {syncing ? "Sincronizando..." : fmtLastSynced(lastSyncQuery.data?.lastSyncedAt ?? null)}
        </span>
        <button
          onClick={syncPayouts}
          disabled={syncing}
          className="size-8 rounded-lg border border-border hover:border-primary/30 bg-card hover:bg-accent disabled:opacity-50 transition-all grid place-items-center"
          title="Sincronizar depósitos Shopify"
        >
          <RefreshCw className={`size-3.5 text-muted-foreground ${syncing ? "animate-spin" : ""}`} />
        </button>

        <Button variant="outline" size="sm" className="text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/5" onClick={() => setQuickAdd({ date:todayKey, kind:"income" })}>
          <Plus className="size-3.5" /> Entrada
        </Button>
        <Button variant="outline" size="sm" className="text-neutral-600 dark:text-neutral-400 border-neutral-400/30 hover:bg-neutral-500/5" onClick={() => setQuickAdd({ date:todayKey, kind:"expense" })}>
          <Plus className="size-3.5" /> Saída
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">Opções <ChevronDown className="size-3.5" /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2 space-y-1">
            <label className="flex items-center gap-2 text-xs px-2 py-2 rounded-md cursor-pointer hover:bg-accent select-none">
              <input type="checkbox" checked={weekendToMonday} onChange={(e) => weekendMut.mutate(e.target.checked)} className="size-3.5 accent-primary" />
              <span>Fds → segunda</span>
            </label>
            <label className="flex items-center gap-2 text-xs px-2 py-2 rounded-md cursor-pointer hover:bg-accent select-none">
              <input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} className="size-3.5 accent-primary" />
              <span>Mostrar pendentes</span>
            </label>
            <button onClick={() => setManageCats(true)} className="w-full text-left text-xs px-2 py-2 rounded-md hover:bg-accent">
              Gerenciar categorias
            </button>
            {onManagePayoutDays && (
              <button onClick={onManagePayoutDays} className="w-full text-left text-xs px-2 py-2 rounded-md hover:bg-accent">
                Configurações de Repasse
              </button>
            )}
            {/* "Resetar caixa" apaga direto shop_cash_entries — a tabela compartilhada
                com a loja/Grupo. Não faz sentido no modo standalone (edições isoladas),
                então fica escondido aqui pra não contradizer a promessa de isolamento. */}
            {!standalone && (
              <>
                <div className="h-px bg-border my-1" />
                <button
                  onClick={handleResetCash}
                  disabled={resetMut.isPending}
                  className="w-full text-left text-xs px-2 py-2 rounded-md hover:bg-destructive/10 text-destructive disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Trash2 className="size-3.5" /> {resetMut.isPending ? "Resetando..." : "Resetar caixa"}
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* ── Day grid (mesmo layout do ShopCashflow) ── */}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => {
          const drag = expanded.find(x => x.id===e.active.id && !x.virtual);
          if (drag) setActiveDrag(drag);
        }}
        onDragEnd={(e: DragEndEvent) => {
          const drag = activeDrag; setActiveDrag(null);
          if (!e.over || !drag) return;
          const overId = String(e.over.id);
          if (!overId.startsWith("day-")) return;
          const newDate = overId.slice(4);
          if (newDate === drag.date) return;
          updateMut.mutate({ id:drag.id, patch:{ date:newDate } });
        }}
      >
        <div
          className={`rounded-2xl border border-border bg-surface overflow-x-auto ${fill ? "lg:flex-1 lg:flex lg:flex-col" : ""}`}
          style={{ scrollbarWidth:"thin", scrollbarColor:"var(--color-border) transparent" }}
        >
          <div
            className={`grid ${fill ? "lg:flex-1 lg:min-h-0" : ""}`}
            style={{
              gridTemplateColumns: dayList.map(d => { const wd=weekdayFromKey(d); return (wd===0||wd===6)?"92px":"minmax(130px,1fr)"; }).join(" "),
              // fill: entradas/saídas dividem a altura que sobrar (cada uma rola por dentro).
              gridTemplateRows: fill ? "auto minmax(110px,1fr) minmax(110px,1fr) auto" : "auto 170px 170px auto",
              minWidth: dayList.length * 92,
            }}
          >
            {dayData.map((dd) => {
              const weekday  = weekdayFromKey(dd.key);
              const isToday  = dd.key === todayKey;
              const isWeekend = weekday===0 || weekday===6;
              const props = { dd, weekday, isToday, todayKey, onEdit:setEditing, onToggleReconciled:(e:DayItem) => updateMut.mutate({ id:e.id, patch:{ reconciled:!e.reconciled } }), shopNamesMap, isConsolidated, simplified };
              return isWeekend
                ? <WeekendDayCell key={dd.key} {...props} />
                : <WeekdayDayCell key={dd.key} {...props} />;
            })}
          </div>
        </div>
        <DragOverlay>
          {activeDrag && (
            <div className="rounded-md border bg-surface px-2 py-1.5 text-xs shadow-lg w-[180px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{activeDrag.category ?? (activeDrag.kind==="income" ? "Entrada" : "Saída")}</span>
                <span className={`font-semibold tabular-nums shrink-0 ${activeDrag.kind==="income" ? "text-blue-600" : "text-neutral-600"}`}>
                  {activeDrag.kind==="income" ? "+" : "-"}{fmtMoney(Number(activeDrag.amount))}
                </span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* ── Modals ── */}
      {quickAdd && (
        <QuickAdd
          shopIds={shopIds} shopNamesMap={shopNamesMap} date={quickAdd.date} kind={quickAdd.kind}
          onClose={() => setQuickAdd(null)}
          onSave={(v:any) => { createMut.mutate(v); setQuickAdd(null); }}
        />
      )}
      {editing && (
        <EditEntry
          entry={editing}
          categories={editing.kind==="income" ? incomeCats : expenseCats}
          onClose={() => setEditing(null)}
          onSave={(patch:any) => { updateMut.mutate({ id:editing.id, patch }); setEditing(null); }}
          onDelete={() => {
            if (!standalone && editing.source === "auto" && editing.auto_kind === "order_cost") {
              // Excluir a linha não basta: o custo é recalculado a partir dos pedidos
              // pendentes e voltaria a aparecer. Um override manual em $0 impede a
              // regeneração automática (mesmo mecanismo usado para ajustar o valor).
              // No modo standalone isso não se aplica: a exclusão fica isolada na
              // cópia local (shop_cash_overrides), sem tocar na automação da loja.
              overrideMut.mutate({ shop_id: editing.shop_id ?? shopId, processing_date: editing.originalDate ?? editing.date, amount: 0, auto_ref_date: editing.auto_ref_date ?? undefined });
            } else {
              deleteMut.mutate(editing.id);
            }
            setEditing(null);
          }}
        />
      )}
      {manageCats && (
        <ManageCategories
          shopId={shopId} categories={allCats}
          onClose={() => setManageCats(false)}
          onChange={() => { refreshCats(); refresh(); }}
        />
      )}
    </div>
  );
}

import { orderDateFor } from "@/lib/order-date";

// Regras de dinheiro em funções puras (só cálculo, sem banco): reembolso,
// chargeback, diluição, previsão de pagamento ao fornecedor no Caixa e
// depósitos da Shopify. As telas e rotinas chamam estas funções, e os testes
// automáticos (finance-rules.test.ts) conferem cada regra — se uma mudança
// quebrar alguma conta, o deploy não sobe.

export type RefundCbRow = {
  shop_id: string; refAmt: number; cbAmt: number;
  refByDate: Record<string, number>; cbByDate: Record<string, number>;
};

export function addDayISO(d: string, n: number) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Último dia do mês "YYYY-MM", sem passar de `cap` (mês corrente).
export function monthEndCapped(m: string, cap: string) {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  return last < cap ? last : cap;
}

// Valor reembolsado de um pedido por dia do reembolso (raw.refunds). Usa as
// transações de reembolso/estorno com sucesso; se a diferença entre o total e
// o total atual do pedido for maior (reembolso sem transação), o resto cai no
// dia do último reembolso.
export function orderRefundAmountByDate(o: any, fallbackDate: string): { total: number; byDate: Record<string, number> } {
  const byDate: Record<string, number> = {};
  let txSum = 0;
  for (const r of (o.refunds ?? [])) {
    for (const t of (r.transactions ?? [])) {
      if ((t.kind === "refund" || t.kind === "void") && t.status === "success") {
        const amt = Number(t.amount ?? 0);
        const date = String(t.processed_at || r.created_at || "").slice(0, 10) || fallbackDate;
        byDate[date] = (byDate[date] ?? 0) + amt;
        txSum += amt;
      }
    }
  }
  const priceDiff = Math.max(0, Number(o.total_price ?? 0) - Number(o.current_total_price ?? 0));
  const extra = priceDiff - txSum;
  if (extra > 0) {
    const lastRefundDate = (o.refunds ?? [])
      .map((r: any) => String(r.created_at ?? "").slice(0, 10))
      .filter(Boolean).sort().pop();
    const date = lastRefundDate || fallbackDate;
    byDate[date] = (byDate[date] ?? 0) + extra;
  }
  return { total: Math.max(txSum, priceDiff), byDate };
}

// Cada movimento de reembolso/chargeback do período [from, to], no dia em que o
// dinheiro mexeu (é o que a lista do card "Custos Adicionais" mostra):
//  - reembolso no dia do reembolso (não no dia do pedido);
//  - chargeback no dia em que foi aberto, qualquer que seja o status depois;
//  - chargeback ganho volta (valor negativo) no dia do ganho (finalized_on);
//  - pagamento da cobrança do alerta abate o reembolso no dia do pagamento.
// `amount` já vem com o sinal do efeito no custo (devolução = negativo).
export type RefundCbItem = {
  kind: "reembolso" | "chargeback" | "chargeback_ganho" | "recuperado";
  shop_id: string; order_external_id: string | null; date: string; amount: number;
  status?: string | null; reason?: string | null;
};
export type RefundCbSources = {
  refundOrders: any[];   // shop_id, external_id, refunds, total_price, current_total_price
  disputes: { shop_id: string; order_external_id?: string | null; amount: any; initiated_at: string | null; status?: string | null; reason?: string | null }[];
  wonDisputes: { shop_id: string; order_external_id?: string | null; amount: any; finalized_on: string; reason?: string | null }[];
  recoveries: { shop_id: string; order_external_id?: string | null; recovered_amount: any; recovery_paid_at: string }[];
};
export function refundChargebackItems(shopIds: string[], fromISO: string, toISO: string, src: RefundCbSources): RefundCbItem[] {
  const shops = new Set(shopIds);
  const out: RefundCbItem[] = [];
  for (const o of src.refundOrders) {
    if (!shops.has(o.shop_id)) continue;
    const { byDate } = orderRefundAmountByDate(o, toISO);
    for (const [d, amt] of Object.entries(byDate)) {
      if (d < fromISO || d > toISO) continue;
      out.push({ kind: "reembolso", shop_id: o.shop_id, order_external_id: o.external_id != null ? String(o.external_id) : null, date: d, amount: amt });
    }
  }
  for (const d of src.disputes) {
    if (!shops.has(d.shop_id)) continue;
    const date = String(d.initiated_at ?? "").slice(0, 10) || toISO;
    if (date < fromISO || date > toISO) continue;
    out.push({ kind: "chargeback", shop_id: d.shop_id, order_external_id: d.order_external_id ?? null, date, amount: Number(d.amount ?? 0), status: d.status ?? null, reason: d.reason ?? null });
  }
  for (const d of src.wonDisputes) {
    if (!shops.has(d.shop_id) || d.finalized_on < fromISO || d.finalized_on > toISO) continue;
    out.push({ kind: "chargeback_ganho", shop_id: d.shop_id, order_external_id: d.order_external_id ?? null, date: d.finalized_on, amount: -Number(d.amount ?? 0), status: "won", reason: d.reason ?? null });
  }
  for (const r of src.recoveries) {
    if (!shops.has(r.shop_id)) continue;
    out.push({ kind: "recuperado", shop_id: r.shop_id, order_external_id: r.order_external_id ?? null, date: orderDateFor(r.recovery_paid_at), amount: -Number(r.recovered_amount ?? 0) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Totais por loja e por dia — a soma dos itens acima (reembolso + recuperado
// em refAmt; chargeback + ganho em cbAmt).
export function aggregateRefundsAndChargebacks(shopIds: string[], fromISO: string, toISO: string, src: RefundCbSources): RefundCbRow[] {
  const byShop = new Map<string, RefundCbRow>(shopIds.map((id) => [id, { shop_id: id, refAmt: 0, cbAmt: 0, refByDate: {}, cbByDate: {} }]));
  for (const it of refundChargebackItems(shopIds, fromISO, toISO, src)) {
    const row = byShop.get(it.shop_id)!;
    if (it.kind === "reembolso" || it.kind === "recuperado") {
      row.refAmt += it.amount;
      row.refByDate[it.date] = (row.refByDate[it.date] ?? 0) + it.amount;
    } else {
      row.cbAmt += it.amount;
      row.cbByDate[it.date] = (row.cbByDate[it.date] ?? 0) + it.amount;
    }
  }
  return [...byShop.values()];
}

// Meses "YYYY-MM" de `from` até `to`.
export function monthsBetween(fromISO: string, toISO: string): string[] {
  const months: string[] = [];
  for (let m = fromISO.slice(0, 7); m <= toISO.slice(0, 7); ) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return months;
}

// Diluição: o total de cada mês é dividido igual pelos dias do mês e cada dia
// do período fica com a sua parte. Mês fechado divide pelo mês todo; o mês
// corrente divide só até D-2 (hoje e ontem ficam sem desconto). A soma do mês
// fechado bate com o total real. `monthly` = totais reais de cada mês (do 1º
// até o fim do mês, ou até hoje no mês corrente).
export function diluteRefundsAndChargebacks(
  shopIds: string[], fromISO: string, toISO: string, today: string,
  monthly: { m: string; rows: RefundCbRow[] }[],
) {
  const end = toISO < today ? toISO : today;
  const lastDiluted = addDayISO(today, -2);
  const byShop = new Map<string, RefundCbRow>(shopIds.map((id) => [id, { shop_id: id, refAmt: 0, cbAmt: 0, refByDate: {}, cbByDate: {} }]));
  const monthTotals: Record<string, { reembolsos: number; chargebacks: number }> = {};
  if (fromISO > end) return { rows: [...byShop.values()], monthTotals };
  for (const { m, rows } of monthly) {
    const mStart = `${m}-01`;
    const mEnd = m < today.slice(0, 7) ? monthEndCapped(m, today) : monthEndCapped(m, lastDiluted);
    const nDays = Math.round((Date.parse(`${mEnd}T00:00:00Z`) - Date.parse(`${mStart}T00:00:00Z`)) / 86_400_000) + 1;
    const pStart = fromISO > mStart ? fromISO : mStart;
    const pEnd = end < mEnd ? end : mEnd;
    monthTotals[m] = {
      reembolsos: rows.reduce((t, r) => t + r.refAmt, 0),
      chargebacks: rows.reduce((t, r) => t + r.cbAmt, 0),
    };
    if (nDays <= 0) continue;
    for (const r of rows) {
      const row = byShop.get(r.shop_id);
      if (!row) continue;
      const refDay = r.refAmt / nDays, cbDay = r.cbAmt / nDays;
      if (!refDay && !cbDay) continue;
      for (let d = pStart; d <= pEnd; d = addDayISO(d, 1)) {
        if (refDay) { row.refAmt += refDay; row.refByDate[d] = (row.refByDate[d] ?? 0) + refDay; }
        if (cbDay) { row.cbAmt += cbDay; row.cbByDate[d] = (row.cbByDate[d] ?? 0) + cbDay; }
      }
    }
  }
  return { rows: [...byShop.values()], monthTotals };
}

// Período de comparação dos cards do Dashboard ("vs. …"):
//  - período que começa no dia 1º e fica dentro do mês ("Este mês", 1º a N):
//    os mesmos dias do mês anterior (1º a N; N limitado ao último dia daquele mês);
//  - qualquer outro: a mesma quantidade de dias logo antes.
// Antes era sempre o segundo caso — "Este mês" no dia 6 comparava com os 6
// últimos dias do mês anterior, e o card dizia "vs. mês anterior".
export function comparisonPeriod(fromISO: string, toISO: string): { prevFrom: string; prevTo: string; sameDaysPrevMonth: boolean } {
  if (fromISO.endsWith("-01") && fromISO.slice(0, 7) === toISO.slice(0, 7)) {
    const prevMonthLast = addDayISO(fromISO, -1);
    const prevFrom = `${prevMonthLast.slice(0, 7)}-01`;
    const day = toISO.slice(8, 10);
    const candidate = `${prevMonthLast.slice(0, 7)}-${day}`;
    return { prevFrom, prevTo: candidate < prevMonthLast ? candidate : prevMonthLast, sameDaysPrevMonth: true };
  }
  const days = Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000) + 1;
  const prevTo = addDayISO(fromISO, -1);
  return { prevFrom: addDayISO(prevTo, -(days - 1)), prevTo, sameDaysPrevMonth: false };
}

// Lucro = faturamento líquido (vendas − reembolsos − chargebacks) − custo dos
// produtos − taxas Shopify − anúncios.
export function netRevenue(vendas: number, reembolsos: number, chargebacks: number) {
  return vendas - reembolsos - chargebacks;
}
export function profit(p: { faturamento: number; custoProduto: number; taxas: number; anuncios: number }) {
  return p.faturamento - p.custoProduto - p.taxas - p.anuncios;
}

// ─── Caixa: previsão de pagamento ao fornecedor ───────────────────────────────

// Pedidos do dia que entram na previsão: só os ainda NÃO pagos ao fornecedor
// (os pagos já saíram em lote — contar de novo era o custo em dobro), sem
// reembolsados e sem chargeback (chargeback ganho volta a contar).
export function supplierForecastOrders<O extends { payment_status?: string | null; shopify_financial_status?: string | null; external_id?: string | null }>(
  orders: O[], chargebacks: { order_external_id: string; status: string | null }[],
): O[] {
  const withChargeback = new Set(chargebacks.filter((d) => d.status !== "won").map((d) => d.order_external_id));
  return orders.filter((o) => (o.payment_status ?? "pending") === "pending"
    && !["refunded", "partially_refunded"].includes(o.shopify_financial_status ?? "")
    && !(o.external_id && withChargeback.has(o.external_id)));
}

type CostEntry = { source?: string | null; reconciled?: boolean | null; date_locked?: boolean | null; amount_locked?: boolean | null } | null;

// Antes de calcular: o que fazer com o lançamento automático do dia.
//  - ajuste manual (manual_override) ou conciliado: não mexe;
//  - pedido antes do início do Caixa: apaga o automático (se houver) e não lança.
export function orderCostGuard(existing: CostEntry, cutoff: string | null, orderDate: string): "keep" | "cutoff" | "compute" {
  if (existing && existing.source === "manual_override") return "keep";
  if (existing?.reconciled) return "keep";
  if (cutoff && orderDate < cutoff) return "cutoff";
  return "compute";
}

// Depois de calcular: inserir, atualizar (respeitando data/valor travados),
// apagar (valor zerou e nada travado) ou nada.
export function orderCostWrite(existing: CostEntry, amount: number, items: number, processingDate: string):
  | { action: "insert" } | { action: "delete" } | { action: "none" }
  | { action: "update"; patch: { description: string; amount?: number; date?: string } } {
  if (!existing) return amount > 0 ? { action: "insert" } : { action: "none" };
  const amountLocked = Boolean(existing.amount_locked), dateLocked = Boolean(existing.date_locked);
  if (amount <= 0 && !amountLocked && !dateLocked) return { action: "delete" };
  const patch: { description: string; amount?: number; date?: string } = { description: `${items} itens` };
  if (!amountLocked) patch.amount = amount;
  if (!dateLocked) patch.date = processingDate;
  return { action: "update", patch };
}

// ─── Caixa: depósitos da Shopify ──────────────────────────────────────────────

export const PAYOUT_STATUS_LABEL: Record<string, string> = {
  paid: "depositado", in_transit: "em trânsito", scheduled: "agendado", pending: "previsto",
};

// Depósitos que entram no Caixa: com id, status relevante e não apagados à mão
// (apagado fica em shop_cash_dismissed_payouts e não volta no sync).
export function relevantPayouts<P extends { id: any; status: string }>(payouts: P[], dismissedIds: Set<string>): P[] {
  return payouts.filter((p) => p.id != null && !dismissedIds.has(String(p.id))
    && ["paid", "in_transit", "scheduled", "pending"].includes(p.status));
}

// Atualização de um depósito que já está no Caixa: status sempre; data e valor
// só se não estiverem travados nem conciliados (ajuste manual é sagrado).
export function payoutPatch(
  row: { date_locked?: boolean | null; amount_locked?: boolean | null; reconciled?: boolean | null } | null | undefined,
  p: { status: string; date: string; amount: any },
) {
  const patch: { description: string; shopify_payout_status: string; date?: string; amount?: number } = {
    description: `Payout Shopify · ${PAYOUT_STATUS_LABEL[p.status] ?? p.status}`,
    shopify_payout_status: p.status,
  };
  if (!row?.date_locked && !row?.reconciled) patch.date = p.date;
  if (!row?.amount_locked && !row?.reconciled) patch.amount = Number(p.amount ?? 0);
  return patch;
}

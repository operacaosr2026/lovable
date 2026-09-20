import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCaixaShops } from "@/lib/lg-cards.functions";
import { isoTodayUS } from "@/lib/timezone";

export const SIM_RECURRENCE = ["none", "daily", "weekly", "monthly"] as const;

const SimExpenseInput = z.object({
  description:      z.string().trim().min(1).max(120),
  amount:            z.number().positive(),
  start_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurrence:        z.enum(SIM_RECURRENCE).default("none"),
  recurrence_until:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

// ─── CRUD ──────────────────────────────────────────────────────────────────

export const listSimulatedExpenses = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("simulated_expenses")
      .select("*")
      .eq("user_id", context.ownerId)
      .order("start_date", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSimulatedExpense = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => SimExpenseInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("simulated_expenses")
      .insert({ user_id: context.ownerId, ...data, recurrence_until: data.recurrence_until ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateSimulatedExpense = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id:    z.string().uuid(),
    patch: SimExpenseInput.partial(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("simulated_expenses")
      .update(data.patch)
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSimulatedExpense = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("simulated_expenses")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Estimativa de vendas via Ads (investimento diário / CPA * ticket) ───────

const AdEstimateInput = z.object({
  description:      z.string().trim().min(1).max(120),
  daily_spend:       z.number().positive(),
  cpa:               z.number().positive(),
  avg_ticket:        z.number().positive(),
  conversion_rate:   z.number().positive().max(100).default(100),
  payout_lag_days:   z.number().int().min(0).max(60).default(7),
  start_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const listSimulatedAdEstimates = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("simulated_ad_estimates")
      .select("*")
      .eq("user_id", context.ownerId)
      .order("start_date", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSimulatedAdEstimate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => AdEstimateInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("simulated_ad_estimates")
      .insert({ user_id: context.ownerId, ...data, end_date: data.end_date ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateSimulatedAdEstimate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id:    z.string().uuid(),
    patch: AdEstimateInput.partial(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("simulated_ad_estimates")
      .update(data.patch)
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSimulatedAdEstimate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("simulated_ad_estimates")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Projection ──────────────────────────────────────────────────────────────

function addDaysToDate(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Sexta/Sábado/Domingo -> segunda seguinte, só pro custo de Fornecedor
// (mesma categoria usada pelos lançamentos automáticos de custo de pedido).
function shiftWeekendSupplierToMonday(dateStr: string): string {
  const wd = new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=dom, 5=sex, 6=sáb
  if (wd === 5) return addDaysToDate(dateStr, 3);
  if (wd === 6) return addDaysToDate(dateStr, 2);
  if (wd === 0) return addDaysToDate(dateStr, 1);
  return dateStr;
}

// Todos os dias entre startDate e endDate (ou sem fim), clipado a [from, to] —
// usado pelo investimento diário de Ads, que não tem opção de recorrência
// (é sempre diário) mas pode ter data de término opcional.
function expandDailyRange(startDate: string, endDate: string | null | undefined, from: string, to: string): string[] {
  const dates: string[] = [];
  const fromD = new Date(from + "T00:00:00Z");
  const toD   = new Date(to + "T00:00:00Z");
  const endD  = endDate ? new Date(endDate + "T00:00:00Z") : null;
  let d = new Date(startDate + "T00:00:00Z");
  let guard = 0;
  while (d <= toD && guard < 2000) {
    guard++;
    if (endD && d > endD) break;
    if (d >= fromD) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

// Expands a (possibly recurring) dated amount into individual occurrence
// dates, clipped to [from, to] and to recurrenceUntil when set.
function expandOccurrences(
  startDate: string,
  recurrence: string,
  recurrenceUntil: string | null,
  from: string,
  to: string,
): string[] {
  const dates: string[] = [];
  const fromD  = new Date(from + "T00:00:00Z");
  const toD    = new Date(to + "T00:00:00Z");
  const untilD = recurrenceUntil ? new Date(recurrenceUntil + "T00:00:00Z") : null;
  let d = new Date(startDate + "T00:00:00Z");

  let guard = 0;
  while (d <= toD && guard < 2000) {
    guard++;
    if (untilD && d > untilD) break;
    if (d >= fromD) dates.push(d.toISOString().slice(0, 10));
    if (recurrence === "none") break;
    const next = new Date(d);
    if (recurrence === "daily")        next.setUTCDate(next.getUTCDate() + 1);
    else if (recurrence === "weekly")  next.setUTCDate(next.getUTCDate() + 7);
    else if (recurrence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
    d = next;
  }
  return dates;
}

// Projeta o saldo dia a dia de `from` até `to`, a partir do saldo real de hoje:
//   saldo real de hoje  +  entradas/saídas reais já datadas no futuro  −  gastos simulados (expandidos)
// Não expande recorrência de lançamentos REAIS (isso é feito só na tela do
// Caixa, no cliente) — só dos gastos simulados, que são o ponto do simulador.
export const getCaixaSimulation = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    show_pending: z.boolean().optional().default(false),
    weekend_supplier_to_monday: z.boolean().optional().default(false),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    // Fuso de Nova York (horário padrão do negócio), não UTC do servidor —
    // perto da virada, UTC já mostra "amanhã" e um lançamento real datado de
    // hoje caía num buraco: não entrava no saldo inicial (ainda não
    // reconciliado) nem nas entradas futuras (`date > today` excluía hoje).
    const today = isoTodayUS();

    const shops   = await getCaixaShops(ownerId);
    const shopIds = (shops as any[]).map((s) => s.id as string);

    let startingBalance = 0;
    let realFuture: { date: string; kind: string; amount: number; category: string | null }[] = [];
    if (shopIds.length > 0) {
      const [openingRes, reconciledRes, futureRes] = await Promise.all([
        supabaseAdmin.from("shops").select("opening_balance").in("id", shopIds),
        supabaseAdmin.from("shop_cash_entries").select("kind, amount")
          .in("shop_id", shopIds).eq("reconciled", true)
          .neq("source", "shopify_fees_sync").neq("source", "shopify_auto_sync"),
        supabaseAdmin.from("shop_cash_entries").select("date, kind, amount, category, source, description")
          .in("shop_id", shopIds).gt("date", today).gte("date", data.from).lte("date", data.to),
      ]);
      startingBalance = (openingRes.data ?? []).reduce((s, r: any) => s + Number(r.opening_balance ?? 0), 0)
        + (reconciledRes.data ?? []).reduce((s, r: any) => s + (r.kind === "income" ? Number(r.amount) : -Number(r.amount)), 0);

      // "Depósito Shopify" ainda não confirmado (previsto/estimado a partir de
      // transações pendentes, source shopify_pending_sync, ou um payout real
      // mas com status "previsto") é otimista demais pra projeção por padrão —
      // só conta depósito já em trânsito ou agendado pelo Shopify, a menos que
      // show_pending esteja ligado (mesmo toggle "Mostrar pendentes" do Caixa).
      realFuture = ((futureRes.data ?? []) as any[]).filter((e) => {
        if (e.category !== "Depósito Shopify") return true;
        if (data.show_pending) return true;
        if (e.source === "shopify_pending_sync") return false;
        return /trânsito|agendado/i.test(e.description ?? "");
      });
    }

    const { data: simExpenses } = await supabaseAdmin
      .from("simulated_expenses")
      .select("*")
      .eq("user_id", ownerId);

    const { data: adEstimates } = await supabaseAdmin
      .from("simulated_ad_estimates")
      .select("*")
      .eq("user_id", ownerId);

    // Entradas/saídas quebradas por origem, pra dar pra ver no extrato o que
    // é real (do caixa de verdade) e o que é simulado/estimado.
    const entradaRealByDate = new Map<string, number>();
    const entradaAdsByDate  = new Map<string, number>();
    const saidaRealByDate   = new Map<string, number>();
    const saidaSimByDate    = new Map<string, number>();
    for (const e of realFuture) {
      const map = e.kind === "income" ? entradaRealByDate : saidaRealByDate;
      const isSupplierCost = e.kind === "expense" && e.category === "Fornecedor";
      const date = data.weekend_supplier_to_monday && isSupplierCost
        ? shiftWeekendSupplierToMonday(e.date)
        : e.date;
      map.set(date, (map.get(date) ?? 0) + Number(e.amount));
    }
    // Gastos simulados não têm categoria própria — reconhece "fornecedor" pela
    // descrição pra aplicar o mesmo desvio de fim de semana que os lançamentos
    // reais de custo de pedido (categoria "Fornecedor").
    const isSimulatedSupplier = (description: string) => /fornecedor/i.test(description ?? "");
    for (const se of (simExpenses ?? []) as any[]) {
      const dates = expandOccurrences(se.start_date, se.recurrence, se.recurrence_until, data.from, data.to);
      const shiftThis = data.weekend_supplier_to_monday && isSimulatedSupplier(se.description);
      for (const date of dates) {
        const key = shiftThis ? shiftWeekendSupplierToMonday(date) : date;
        saidaSimByDate.set(key, (saidaSimByDate.get(key) ?? 0) + Number(se.amount));
      }
    }

    // Investimento diário em Ads: só serve pra calcular vendas estimadas
    // (investimento/cpa) que viram receita (vendas * ticket médio) projetada
    // payout_lag_days depois — imita o atraso de repasse da loja (D+7 por
    // padrão). O investimento em si NÃO entra como saída aqui: quem quiser
    // simular esse gasto no caixa cadastra separadamente em "Gastos
    // simulados" (evita contar o mesmo gasto duas vezes). Nem toda venda cai
    // como receita (recusa, cancelamento etc.), daí a % de conversão.
    for (const ae of (adEstimates ?? []) as any[]) {
      const spendDates = expandDailyRange(ae.start_date, ae.end_date, data.from, data.to);
      const salesPerDay = Number(ae.daily_spend) / Number(ae.cpa);
      const conversionRate = Number(ae.conversion_rate ?? 100) / 100;
      const revenuePerDay = salesPerDay * Number(ae.avg_ticket) * conversionRate;
      for (const date of spendDates) {
        const payoutDate = addDaysToDate(date, ae.payout_lag_days);
        entradaAdsByDate.set(payoutDate, (entradaAdsByDate.get(payoutDate) ?? 0) + revenuePerDay);
      }
    }

    const series: {
      date: string; saldo: number; entrada: number; saida: number;
      entradaReal: number; entradaAds: number; saidaReal: number; saidaSim: number;
    }[] = [];
    const statement: {
      date: string; entrada: number; saida: number; total: number;
      entradaReal: number; entradaAds: number; saidaReal: number; saidaSim: number;
    }[] = [];
    let running = startingBalance;
    const d = new Date(data.from + "T00:00:00Z");
    const toD = new Date(data.to + "T00:00:00Z");
    while (d <= toD) {
      // Entradas/saídas reais já vêm filtradas a partir de amanhã (query usa
      // .gt("date", today), já que o saldo de hoje entra em startingBalance);
      // gastos simulados podem começar hoje, então não zeram aqui de novo —
      // isso jogava o gasto de hoje pro dia seguinte na projeção.
      const dateStr = d.toISOString().slice(0, 10);
      const entradaReal = entradaRealByDate.get(dateStr) ?? 0;
      const entradaAds  = entradaAdsByDate.get(dateStr) ?? 0;
      const saidaReal   = saidaRealByDate.get(dateStr) ?? 0;
      const saidaSim    = saidaSimByDate.get(dateStr) ?? 0;
      const entrada = entradaReal + entradaAds;
      const saida   = saidaReal + saidaSim;
      running += entrada - saida;
      const total = Math.round(running * 100) / 100;
      const row = { date: dateStr, saldo: total, entrada, saida, entradaReal, entradaAds, saidaReal, saidaSim };
      series.push(row);
      if (entrada > 0 || saida > 0) statement.push({ date: dateStr, entrada, saida, total, entradaReal, entradaAds, saidaReal, saidaSim });
      d.setUTCDate(d.getUTCDate() + 1);
    }

    const negativeDay = series.find((s) => s.saldo < 0) ?? null;
    const simulatedTotal = (simExpenses ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0);
    const adDailySpendTotal = (adEstimates ?? []).reduce((s: number, e: any) => s + Number(e.daily_spend), 0);
    const adEstimatedSalesPerDay = (adEstimates ?? []).reduce((s: number, e: any) => s + Number(e.daily_spend) / Number(e.cpa), 0);
    const adEstimatedRevenuePerDay = (adEstimates ?? []).reduce((s: number, e: any) => s + (Number(e.daily_spend) / Number(e.cpa)) * Number(e.avg_ticket) * (Number(e.conversion_rate ?? 100) / 100), 0);

    return {
      startingBalance, series, statement,
      negativeFrom: negativeDay?.date ?? null,
      simulatedCount: (simExpenses ?? []).length,
      simulatedTotal,
      adEstimatesCount: (adEstimates ?? []).length,
      adDailySpendTotal, adEstimatedSalesPerDay, adEstimatedRevenuePerDay,
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCaixaShops } from "@/lib/lg-cards.functions";

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

// ─── Projection ──────────────────────────────────────────────────────────────

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
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const today = new Date().toISOString().slice(0, 10);

    const shops   = await getCaixaShops(ownerId);
    const shopIds = (shops as any[]).map((s) => s.id as string);

    let startingBalance = 0;
    let realFuture: { date: string; kind: string; amount: number }[] = [];
    if (shopIds.length > 0) {
      const [openingRes, reconciledRes, futureRes] = await Promise.all([
        supabaseAdmin.from("shops").select("opening_balance").in("id", shopIds),
        supabaseAdmin.from("shop_cash_entries").select("kind, amount")
          .in("shop_id", shopIds).eq("reconciled", true)
          .neq("source", "shopify_fees_sync").neq("source", "shopify_auto_sync"),
        supabaseAdmin.from("shop_cash_entries").select("date, kind, amount")
          .in("shop_id", shopIds).gt("date", today).gte("date", data.from).lte("date", data.to),
      ]);
      startingBalance = (openingRes.data ?? []).reduce((s, r: any) => s + Number(r.opening_balance ?? 0), 0)
        + (reconciledRes.data ?? []).reduce((s, r: any) => s + (r.kind === "income" ? Number(r.amount) : -Number(r.amount)), 0);
      realFuture = (futureRes.data ?? []) as any[];
    }

    const { data: simExpenses } = await supabaseAdmin
      .from("simulated_expenses")
      .select("*")
      .eq("user_id", ownerId);

    const deltaByDate = new Map<string, number>();
    for (const e of realFuture) {
      const amt = e.kind === "income" ? Number(e.amount) : -Number(e.amount);
      deltaByDate.set(e.date, (deltaByDate.get(e.date) ?? 0) + amt);
    }
    for (const se of (simExpenses ?? []) as any[]) {
      const dates = expandOccurrences(se.start_date, se.recurrence, se.recurrence_until, data.from, data.to);
      for (const date of dates) {
        deltaByDate.set(date, (deltaByDate.get(date) ?? 0) - Number(se.amount));
      }
    }

    const series: { date: string; saldo: number }[] = [];
    let running = startingBalance;
    const d = new Date(data.from + "T00:00:00Z");
    const toD = new Date(data.to + "T00:00:00Z");
    while (d <= toD) {
      const dateStr = d.toISOString().slice(0, 10);
      if (dateStr > today) running += deltaByDate.get(dateStr) ?? 0;
      series.push({ date: dateStr, saldo: Math.round(running * 100) / 100 });
      d.setUTCDate(d.getUTCDate() + 1);
    }

    const negativeDay = series.find((s) => s.saldo < 0) ?? null;
    const simulatedTotal = (simExpenses ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0);

    return { startingBalance, series, negativeFrom: negativeDay?.date ?? null, simulatedCount: (simExpenses ?? []).length, simulatedTotal };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ==================== HELPERS ==================== */

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
function addWeeks(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n * 7);
  return d;
}
function addYears(date: Date, n: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + n);
  return d;
}
function nextOccurrence(date: Date, freq: "weekly" | "monthly" | "yearly"): Date {
  if (freq === "weekly") return addWeeks(date, 1);
  if (freq === "monthly") return addMonths(date, 1);
  return addYears(date, 1);
}

/* ==================== DASHBOARD ==================== */

export const getFinanceDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [accountsRes, txRes, recRes, goalsRes, fxRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId).eq("archived", false).order("position"),
      supabase.from("transactions").select("*").eq("user_id", userId).order("date", { ascending: true }),
      supabase.from("recurrences").select("*").eq("user_id", userId).eq("active", true),
      supabase.from("financial_goals").select("*").eq("user_id", userId),
      supabase.from("fx_rates").select("*").eq("user_id", userId).maybeSingle(),
    ]);

    const accounts = accountsRes.data ?? [];
    const txs = txRes.data ?? [];
    const recurrences = recRes.data ?? [];
    const goals = goalsRes.data ?? [];
    const fx = fxRes.data?.usd_to_brl ? Number(fxRes.data.usd_to_brl) : 5.0;

    const today = todayISO();

    // Compute balance per account (in account currency) — only paid + on/before today
    const balances: Record<string, number> = {};
    for (const a of accounts) balances[a.id] = 0;
    for (const t of txs) {
      if (!t.paid || t.date > today) continue;
      const amt = Number(t.amount);
      if (t.kind === "income" && balances[t.account_id] !== undefined) balances[t.account_id] += amt;
      else if (t.kind === "expense" && balances[t.account_id] !== undefined) balances[t.account_id] -= amt;
      else if (t.kind === "transfer") {
        if (balances[t.account_id] !== undefined) balances[t.account_id] -= amt;
        if (t.to_account_id && balances[t.to_account_id] !== undefined) balances[t.to_account_id] += amt;
      }
    }

    // Convert to BRL for total
    const toBRL = (v: number, cur: string) => (cur === "USD" ? v * fx : v);
    const totalBRL = accounts.reduce((s, a) => s + toBRL(balances[a.id] ?? 0, a.currency), 0);

    // Net worth history (daily snapshot from transactions)
    const sortedTx = [...txs].filter((t) => t.paid && t.date <= today).sort((a, b) => a.date.localeCompare(b.date));
    const accountCur: Record<string, string> = Object.fromEntries(accounts.map((a) => [a.id, a.currency]));
    const running: Record<string, number> = Object.fromEntries(accounts.map((a) => [a.id, 0]));
    const history: { date: string; brl: number }[] = [];
    let lastDate = "";
    const flushPoint = (date: string) => {
      const total = accounts.reduce((s, a) => s + toBRL(running[a.id] ?? 0, a.currency), 0);
      history.push({ date, brl: total });
    };
    for (const t of sortedTx) {
      if (lastDate && lastDate !== t.date) flushPoint(lastDate);
      const amt = Number(t.amount);
      if (t.kind === "income" && running[t.account_id] !== undefined) running[t.account_id] += amt;
      else if (t.kind === "expense" && running[t.account_id] !== undefined) running[t.account_id] -= amt;
      else if (t.kind === "transfer") {
        if (running[t.account_id] !== undefined) running[t.account_id] -= amt;
        if (t.to_account_id && running[t.to_account_id] !== undefined) running[t.to_account_id] += amt;
      }
      lastDate = t.date;
    }
    if (lastDate) flushPoint(lastDate);
    // Keep last 60 points max
    const trimmedHistory = history.slice(-60);

    // Upcoming bills (next 60 days): expense recurrences upcoming + unpaid transactions in future
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);
    const horizonStr = horizon.toISOString().slice(0, 10);

    type Upcoming = { date: string; name: string; amount: number; currency: string; brl: number; source: "recurrence" | "transaction"; id: string };
    const upcoming: Upcoming[] = [];

    for (const t of txs) {
      if (!t.paid && t.kind === "expense" && t.date <= horizonStr) {
        upcoming.push({
          date: t.date,
          name: t.description ?? "Lançamento",
          amount: Number(t.amount),
          currency: t.currency,
          brl: toBRL(Number(t.amount), t.currency),
          source: "transaction",
          id: t.id,
        });
      }
    }

    for (const r of recurrences) {
      if (r.kind !== "expense") continue;
      let cur = new Date(r.next_date + "T00:00:00");
      let occ = 0;
      while (cur.toISOString().slice(0, 10) <= horizonStr && occ < 12) {
        const dStr = cur.toISOString().slice(0, 10);
        upcoming.push({
          date: dStr,
          name: r.description ?? "Recorrência",
          amount: Number(r.amount),
          currency: r.currency,
          brl: toBRL(Number(r.amount), r.currency),
          source: "recurrence",
          id: r.id,
        });
        cur = nextOccurrence(cur, r.frequency as any);
        occ++;
      }
    }

    upcoming.sort((a, b) => a.date.localeCompare(b.date));

    // 12-month cashflow projection
    const monthsAhead = 12;
    const cashflow: { month: string; income: number; expense: number; balance: number }[] = [];
    let runningBalance = totalBRL;
    const now = new Date();
    for (let i = 0; i < monthsAhead; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
      const mStartStr = m.toISOString().slice(0, 10);
      const mEndStr = mEnd.toISOString().slice(0, 10);
      const periodStart = i === 0 ? today : mStartStr;

      let income = 0, expense = 0;

      // unpaid future transactions
      for (const t of txs) {
        if (t.paid) continue;
        if (t.date < periodStart || t.date > mEndStr) continue;
        const v = toBRL(Number(t.amount), t.currency);
        if (t.kind === "income") income += v;
        else if (t.kind === "expense") expense += v;
      }

      // recurrences
      for (const r of recurrences) {
        let cur = new Date(r.next_date + "T00:00:00");
        let occ = 0;
        while (cur.toISOString().slice(0, 10) <= mEndStr && occ < 50) {
          const dStr = cur.toISOString().slice(0, 10);
          if (dStr >= periodStart) {
            const v = toBRL(Number(r.amount), r.currency);
            if (r.kind === "income") income += v;
            else expense += v;
          }
          cur = nextOccurrence(cur, r.frequency as any);
          occ++;
        }
      }

      runningBalance += income - expense;
      cashflow.push({
        month: m.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        income,
        expense,
        balance: runningBalance,
      });
    }

    // Goal: most recent for current period
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const monthlyGoal = goals.find((g) => g.period === "monthly" && g.year === curYear && g.month === curMonth) ?? null;
    const yearlyGoal = goals.find((g) => g.period === "yearly" && g.year === curYear) ?? null;

    return {
      accounts: accounts.map((a) => ({
        ...a,
        balance: balances[a.id] ?? 0,
        balanceBRL: toBRL(balances[a.id] ?? 0, a.currency),
      })),
      totalBRL,
      fx,
      history: trimmedHistory,
      upcoming: upcoming.slice(0, 20),
      cashflow,
      monthlyGoal,
      yearlyGoal,
    };
  });

/* ==================== ACCOUNTS ==================== */

const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  currency: z.enum(["BRL", "USD"]),
  color: z.string().max(80).default("oklch(0.6 0.22 285)"),
  icon_url: z.string().url().nullable().optional(),
  match_keywords: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => accountSchema.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { count } = await supabase.from("accounts").select("*", { count: "exact", head: true }).eq("user_id", userId);
    const { error } = await supabase.from("accounts").insert({
      user_id: userId,
      name: data.name,
      currency: data.currency,
      color: data.color,
      icon_url: data.icon_url ?? null,
      match_keywords: data.match_keywords ?? [],
      position: count ?? 0,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const updateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), patch: accountSchema.partial().extend({ archived: z.boolean().optional() }) }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("accounts").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ==================== CATEGORIES ==================== */

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("categories").select("*").eq("user_id", context.userId).order("kind").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(["income", "expense"]),
    color: z.string().max(80).default("oklch(0.62 0.012 270)"),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("categories").insert({
      user_id: context.userId,
      name: data.name,
      kind: data.kind,
      color: data.color,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ==================== TRANSACTIONS ==================== */

const txBaseSchema = z.object({
  kind: z.enum(["income", "expense", "transfer"]),
  amount: z.number().positive(),
  account_id: z.string().uuid(),
  to_account_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  description: z.string().max(200).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paid: z.boolean().optional(),
});

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().min(1).max(500).default(200) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("transactions")
      .select("*")
      .eq("user_id", context.userId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    tx: txBaseSchema,
    recurrence: z.object({
      frequency: z.enum(["weekly", "monthly", "yearly"]),
    }).nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // Resolve currency from account
    const { data: acc, error: accErr } = await supabase.from("accounts").select("currency").eq("id", data.tx.account_id).single();
    if (accErr || !acc) throw new Error("Conta não encontrada");

    if (data.tx.kind === "transfer" && !data.tx.to_account_id) {
      throw new Error("Transferência precisa de conta de destino");
    }

    let recurrence_id: string | null = null;
    if (data.recurrence && data.tx.kind !== "transfer") {
      const { data: rec, error: recErr } = await supabase.from("recurrences").insert({
        user_id: userId,
        kind: data.tx.kind,
        amount: data.tx.amount,
        currency: acc.currency,
        account_id: data.tx.account_id,
        category_id: data.tx.category_id ?? null,
        description: data.tx.description ?? null,
        frequency: data.recurrence.frequency,
        next_date: data.tx.date,
        active: true,
      }).select("id").single();
      if (recErr) throw new Error(recErr.message);
      recurrence_id = rec.id;
    }

    const { error } = await supabase.from("transactions").insert({
      user_id: userId,
      kind: data.tx.kind,
      amount: data.tx.amount,
      currency: acc.currency,
      account_id: data.tx.account_id,
      to_account_id: data.tx.kind === "transfer" ? data.tx.to_account_id : null,
      category_id: data.tx.kind === "transfer" ? null : data.tx.category_id ?? null,
      description: data.tx.description ?? null,
      date: data.tx.date,
      paid: data.tx.paid ?? true,
      recurrence_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      amount: z.number().positive().optional(),
      category_id: z.string().uuid().nullable().optional(),
      description: z.string().max(200).nullable().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      paid: z.boolean().optional(),
    }),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const patch: any = { ...data.patch };
    // Auto-clear needs_review when a category is assigned
    if (patch.category_id) patch.needs_review = false;
    const { error } = await context.supabase.from("transactions").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("transactions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ==================== RECURRENCES ==================== */

export const listRecurrences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("recurrences").select("*").eq("user_id", context.userId).order("next_date");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const toggleRecurrenceActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("recurrences").update({ active: data.active }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("recurrences").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ==================== GOALS ==================== */

export const setGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    period: z.enum(["monthly", "yearly"]),
    target_amount_brl: z.number().positive(),
    year: z.number().int().min(2000).max(3000),
    month: z.number().int().min(1).max(12).nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("financial_goals").upsert(
      {
        user_id: context.userId,
        period: data.period,
        target_amount_brl: data.target_amount_brl,
        year: data.year,
        month: data.period === "monthly" ? data.month ?? null : null,
      },
      { onConflict: "user_id,period,year,month" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ==================== FX ==================== */

export const setFxRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ usd_to_brl: z.number().positive() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("fx_rates").upsert(
      { user_id: context.userId, usd_to_brl: data.usd_to_brl, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

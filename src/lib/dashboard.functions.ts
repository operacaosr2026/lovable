import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ==================== READ ==================== */

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    const sevenStr = sevenDaysAgo.toISOString().slice(0, 10);

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    const [
      profile, stores, revenues, tasks, habits, habitLogs, gratitude,
      accounts, fxRow,
    ] = await Promise.all([
      supabase.from("profiles").select("full_name, avatar_url").eq("id", userId).maybeSingle(),
      supabase.from("stores").select("*").eq("user_id", userId).order("position"),
      supabase.from("store_revenues").select("*").gte("date", sevenStr).lte("date", todayStr),
      supabase.from("tasks").select("*").eq("scheduled_date", todayStr).order("scheduled_time", { nullsFirst: false }),
      supabase.from("habits").select("*").order("position"),
      supabase.from("habit_logs").select("*").gte("date", weekStartStr),
      supabase.from("gratitude_entries").select("*").eq("date", todayStr).maybeSingle(),
      supabase.from("accounts").select("*").eq("user_id", userId).eq("archived", false),
      supabase.from("fx_rates").select("*").eq("user_id", userId).maybeSingle(),
    ]);

    // Compute total net worth in BRL
    const fx = fxRow.data?.usd_to_brl ? Number(fxRow.data.usd_to_brl) : 5.0;
    const accs = accounts.data ?? [];
    let totalBRL = 0;
    if (accs.length > 0) {
      const ids = accs.map((a) => a.id);
      const { data: txs } = await supabase
        .from("transactions").select("kind, amount, currency, account_id, to_account_id, paid, date")
        .in("account_id", ids).eq("paid", true).lte("date", todayStr);
      const balances: Record<string, number> = Object.fromEntries(accs.map((a) => [a.id, 0]));
      for (const t of txs ?? []) {
        const amt = Number(t.amount);
        if (t.kind === "income" && balances[t.account_id] !== undefined) balances[t.account_id] += amt;
        else if (t.kind === "expense" && balances[t.account_id] !== undefined) balances[t.account_id] -= amt;
        else if (t.kind === "transfer") {
          if (balances[t.account_id] !== undefined) balances[t.account_id] -= amt;
          if (t.to_account_id && balances[t.to_account_id] !== undefined) balances[t.to_account_id] += amt;
        }
      }
      for (const a of accs) {
        const b = balances[a.id] ?? 0;
        totalBRL += a.currency === "USD" ? b * fx : b;
      }
    }

    return {
      profile: profile.data,
      stores: stores.data ?? [],
      revenues: revenues.data ?? [],
      tasks: tasks.data ?? [],
      habits: habits.data ?? [],
      habitLogs: habitLogs.data ?? [],
      gratitude: gratitude.data,
      totalBRL,
      accountsCount: accs.length,
      todayStr,
      weekStartStr,
    };
  });

/* ==================== TASKS ==================== */

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      title: z.string().trim().min(1).max(200),
      scheduled_time: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      title: data.title,
      scheduled_time: data.scheduled_time ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), done: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("tasks")
      .update({ done: data.done, done_at: data.done ? new Date().toISOString() : null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ==================== GRATITUDE ==================== */

export const upsertGratitude = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ content: z.string().trim().min(1).max(2000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("gratitude_entries")
      .upsert(
        { user_id: userId, date: today, content: data.content, updated_at: new Date().toISOString() },
        { onConflict: "user_id,date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ==================== HABITS ==================== */

export const toggleHabitToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ habit_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const today = new Date().toISOString().slice(0, 10);
    const existing = await supabase
      .from("habit_logs")
      .select("id")
      .eq("habit_id", data.habit_id)
      .eq("date", today)
      .maybeSingle();

    if (existing.data) {
      await supabase.from("habit_logs").delete().eq("id", existing.data.id);
    } else {
      await supabase.from("habit_logs").insert({ user_id: userId, habit_id: data.habit_id, date: today });
    }
    return { ok: true };
  });

export const createHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      name: z.string().trim().min(1).max(100),
      weekly_goal: z.number().int().min(1).max(7).default(7),
      annual_goal: z.number().int().min(1).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("habits").insert({
      user_id: userId,
      name: data.name,
      weekly_goal: data.weekly_goal,
      annual_goal: data.annual_goal ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ==================== STORE REVENUE ==================== */

export const addStoreRevenue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      store_id: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amount: z.number().min(0),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("store_revenues")
      .upsert(
        { user_id: userId, store_id: data.store_id, date: data.date, amount: data.amount },
        { onConflict: "store_id,date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

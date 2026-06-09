import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ROUTINE_FREQUENCIES = ["daily", "weekly", "monthly", "custom"] as const;

function computeNextDueAt(
  current: string | null,
  frequency: typeof ROUTINE_FREQUENCIES[number],
  weekdays: number[],
  time: string | null,
): string {
  const base = current ? new Date(current) : new Date();
  const next = new Date(base);
  if (frequency === "daily") next.setDate(next.getDate() + 1);
  else if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  else if (frequency === "custom") {
    const days = (weekdays ?? []).filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
    if (days.length === 0) next.setDate(next.getDate() + 1);
    else {
      const cur = base.getDay();
      let delta = 7;
      for (const d of days) {
        const diff = (d - cur + 7) % 7 || 7;
        if (diff < delta) delta = diff;
      }
      next.setDate(base.getDate() + delta);
    }
  }
  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(":").map(Number);
    next.setHours(h, m, 0, 0);
  }
  return next.toISOString();
}

const RoutineInput = z.object({
  shop_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  frequency: z.enum(ROUTINE_FREQUENCIES).default("daily"),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  reminder_minutes: z.array(z.number().int().min(1).max(43200)).max(5).optional(),
});

export const listShopRoutines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: routines, error } = await context.supabase
      .from("shop_routines").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (routines ?? []).map((r: any) => r.id);
    const since = new Date(); since.setDate(since.getDate() - 60);
    const logsByRoutine: Record<string, string[]> = {};
    if (ids.length) {
      const { data: logs } = await context.supabase
        .from("shop_routine_logs").select("routine_id,completed_on")
        .in("routine_id", ids).gte("completed_on", since.toISOString().slice(0, 10));
      for (const l of logs ?? []) {
        const k = (l as any).routine_id;
        (logsByRoutine[k] ??= []).push((l as any).completed_on);
      }
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    const now = new Date();
    return {
      routines: (routines ?? []).map((r: any) => {
        const logs = logsByRoutine[r.id] ?? [];
        const dueAt = r.due_at ? new Date(r.due_at) : null;
        // "Concluída no período atual" = já foi feita e o próximo vencimento é futuro
        const completedThisPeriod = !!dueAt && dueAt > now && !!r.last_completed_at;
        return {
          ...r,
          recent_logs: logs,
          done_today: logs.includes(todayKey) || completedThisPeriod,
          is_due: !dueAt || dueAt <= now,
          next_due_at: r.due_at,
        };
      }),
    };
  });

export const createShopRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RoutineInput.parse(d))
  .handler(async ({ context, data }) => {
    const due_at = computeNextDueAt(null, data.frequency, data.weekdays ?? [], data.time ?? null);
    const { data: row, error } = await context.supabase.from("shop_routines").insert({
      user_id: context.userId,
      shop_id: data.shop_id,
      title: data.title,
      description: data.description ?? null,
      frequency: data.frequency,
      weekdays: data.weekdays ?? [],
      time: data.time ?? null,
      reminder_minutes: data.reminder_minutes ?? [],
      due_at,
    }).select().single();
    if (error) throw new Error(error.message);
    return { routine: row };
  });

export const updateShopRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: RoutineInput.partial().omit({ shop_id: true }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_routines").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const completeShopRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: r } = await context.supabase
      .from("shop_routines").select("*").eq("id", data.id).maybeSingle();
    if (!r) throw new Error("Rotina não encontrada");

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const { data: existingLog } = await context.supabase
      .from("shop_routine_logs").select("id")
      .eq("routine_id", data.id).eq("completed_on", today).maybeSingle();

    if (!existingLog) {
      await context.supabase.from("shop_routine_logs").insert({
        user_id: context.userId, routine_id: data.id,
      });
    }

    const lastDate = r.last_completed_at ? new Date(r.last_completed_at).toISOString().slice(0, 10) : null;
    let streak = r.streak ?? 0;
    if (lastDate === today) {
      // already counted today
    } else if (lastDate === yesterday) {
      streak += 1;
    } else {
      streak = 1;
    }

    const due_at = computeNextDueAt(
      new Date().toISOString(),
      r.frequency as typeof ROUTINE_FREQUENCIES[number],
      r.weekdays ?? [],
      r.time,
    );
    await context.supabase.from("shop_routines").update({
      due_at,
      last_completed_at: new Date().toISOString(),
      streak,
    }).eq("id", data.id);

    return { ok: true };
  });

export const deleteShopRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await context.supabase.from("shop_routines").delete().eq("id", data.id);
    return { ok: true };
  });

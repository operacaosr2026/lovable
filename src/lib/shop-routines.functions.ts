import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { computeNextDueAt } from "@/lib/recurrence";
import { isoDateUS, isoTodayUS, addDaysIso } from "@/lib/timezone";

export const ROUTINE_FREQUENCIES = ["daily", "weekly", "monthly", "custom"] as const;

// Próxima ocorrência no horário de Nova York (lib/recurrence.ts).

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
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: routines, error } = await context.supabase
      .from("shop_routines").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (routines ?? []).map((r: any) => r.id);
    const logsByRoutine: Record<string, string[]> = {};
    if (ids.length) {
      const { data: logs } = await context.supabase
        .from("shop_routine_logs").select("routine_id,completed_on")
        .in("routine_id", ids).gte("completed_on", addDaysIso(isoTodayUS(), -60));
      for (const l of logs ?? []) {
        const k = (l as any).routine_id;
        (logsByRoutine[k] ??= []).push((l as any).completed_on);
      }
    }
    const todayKey = isoTodayUS();
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
  .middleware([requireOwnerContext])
  .inputValidator((d) => RoutineInput.parse(d))
  .handler(async ({ context, data }) => {
    const due_at = computeNextDueAt(null, data.frequency, data.weekdays ?? [], data.time ?? null);
    const { data: row, error } = await context.supabase.from("shop_routines").insert({
      user_id: context.ownerId,
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

    const today = isoTodayUS();
    const yesterday = addDaysIso(today, -1);
    const { data: existingLog } = await context.supabase
      .from("shop_routine_logs").select("id")
      .eq("routine_id", data.id).eq("completed_on", today).maybeSingle();

    if (!existingLog) {
      await context.supabase.from("shop_routine_logs").insert({
        user_id: context.userId, routine_id: data.id, completed_on: today,
      });
    }

    const lastDate = r.last_completed_at ? isoDateUS(r.last_completed_at) : null;
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

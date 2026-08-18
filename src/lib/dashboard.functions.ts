import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext, getSectionResourceFilter } from "@/integrations/supabase/workspace-middleware";

/* ==================== READ ==================== */

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { supabase, userId, ownerId } = context;
    const shopFilter = getSectionResourceFilter(context, "shops");

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    const sevenStr = sevenDaysAgo.toISOString().slice(0, 10);

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    const todayEnd = `${todayStr}T23:59:59.999Z`;
    const todayStart = `${todayStr}T00:00:00.000Z`;

    const [
      profile, stores, revenues, gratitude, shopTasksToday,
    ] = await Promise.all([
      supabase.from("profiles").select("full_name, avatar_url").eq("id", userId).maybeSingle(),
      supabase.from("stores").select("*").eq("user_id", userId).order("position"),
      supabase.from("store_revenues").select("*").gte("date", sevenStr).lte("date", todayStr),
      supabase.from("gratitude_entries").select("*").eq("date", todayStr).maybeSingle(),
      shopFilter === "none"
        ? Promise.resolve({ data: [] as any[] })
        : (() => {
            let q = supabase.from("shop_tasks").select("id,shop_id,title,status,due_at")
              .eq("user_id", ownerId).neq("status", "done")
              .gte("due_at", todayStart).lte("due_at", todayEnd);
            if (Array.isArray(shopFilter)) q = q.in("shop_id", shopFilter);
            return q;
          })(),
    ]);

    const shopIds = Array.from(new Set((shopTasksToday.data ?? []).map((t: any) => t.shop_id)));
    const shopNames = new Map<string, string>();
    if (shopIds.length > 0) {
      const { data: shopRows } = await supabase.from("shops").select("id,name").in("id", shopIds);
      for (const s of shopRows ?? []) shopNames.set(s.id, s.name);
    }

    return {
      profile: profile.data,
      stores: stores.data ?? [],
      revenues: revenues.data ?? [],
      shopTasksToday: (shopTasksToday.data ?? []).map((t: any) => ({
        id: t.id,
        title: t.title,
        done: t.status === "done",
        shop_id: t.shop_id,
        shop_name: shopNames.get(t.shop_id) ?? null,
        source: "shop_task" as const,
      })),
      gratitude: gratitude.data,
      todayStr,
      weekStartStr,
    };
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

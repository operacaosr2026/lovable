import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SHOP_STATUSES = ["ativa", "pausada", "arquivada"] as const;
export const PIPELINE_STAGES = [
  "para_criar",
  "criando",
  "prontas",
  "aquecimento",
  "validacao_produto",
  "escalando",
  "congelada",
] as const;

const ShopInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(SHOP_STATUSES).default("ativa"),
  country: z.string().max(60).nullable().optional(),
  tag: z.string().max(40).nullable().optional(),
  logo_url: z.string().max(2_000_000).nullable().optional(),
  pipeline_stage: z.string().trim().min(1).max(64).optional(),
  pipeline_position: z.number().int().optional(),
});

export const listShops = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: shops, error } = await supabase
      .from("shops").select("*").eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (shops ?? []).map((s: any) => s.id);
    const counters: Record<string, { products: number; pendingTasks: number; routinesToday: number; balance: number }> = {};
    if (ids.length) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const [{ data: prods }, { data: tasks }, { data: routines }, { data: cash }] = await Promise.all([
        supabase.from("shop_products").select("shop_id").in("shop_id", ids),
        supabase.from("shop_tasks").select("shop_id,status").in("shop_id", ids).neq("status", "done"),
        supabase.from("shop_routines").select("shop_id,due_at").in("shop_id", ids),
        supabase.from("shop_cash_entries").select("shop_id,kind,amount,date").in("shop_id", ids).lte("date", todayStr),
      ]);
      const today = new Date(); today.setHours(23, 59, 59, 999);
      const init = (k: string) => (counters[k] ??= { products: 0, pendingTasks: 0, routinesToday: 0, balance: 0 });
      for (const s of shops ?? []) init((s as any).id).balance = Number((s as any).opening_balance ?? 0);
      for (const p of prods ?? []) init((p as any).shop_id).products++;
      for (const t of tasks ?? []) init((t as any).shop_id).pendingTasks++;
      for (const r of routines ?? []) {
        const c = init((r as any).shop_id);
        if (!(r as any).due_at || new Date((r as any).due_at) <= today) c.routinesToday++;
      }
      for (const e of cash ?? []) {
        const c = init((e as any).shop_id);
        const amt = Number((e as any).amount ?? 0);
        c.balance += (e as any).kind === "income" ? amt : -amt;
      }
    }
    return {
      shops: (shops ?? []).map((s: any) => ({
        ...s,
        ...(counters[s.id] ?? { products: 0, pendingTasks: 0, routinesToday: 0, balance: Number(s.opening_balance ?? 0) }),
      })),
    };
  });

export const getShop = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: shop, error } = await context.supabase
      .from("shops").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!shop) throw new Error("Loja não encontrada");
    return { shop };
  });

export const createShop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ShopInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("shops").insert({
      user_id: context.userId,
      name: data.name,
      description: data.description ?? null,
      status: data.status,
      country: data.country ?? null,
      tag: data.tag ?? null,
      logo_url: data.logo_url ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { shop: row };
  });

export const updateShop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: ShopInput.partial().extend({ archived: z.boolean().optional() }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shops").update(data.patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteShop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shops").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

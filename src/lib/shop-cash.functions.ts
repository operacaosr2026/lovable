import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";

export const CASH_KINDS = ["income", "expense"] as const;
export const EXPENSE_CATEGORIES = [
  "Fornecedor",
  "Facebook Ads",
  "Ferramentas",
  "Retirada Rodrigo",
  "Retirada Sergio",
  "Lucro Rodrigo",
  "Lucro Sergio",
  "Outros",
] as const;
export const INCOME_CATEGORIES = ["Depósito Shopify", "Aporte Rodrigo", "Aporte Sergio", "Outros recebimentos"] as const;

const ImportRow = z.object({ date: z.string(), amount: z.number() });
const RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;

export const listShopCash = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const [entries, imports, shop] = await Promise.all([
      context.supabase.from("shop_cash_entries").select("*")
        .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
        .order("date", { ascending: true }),
      context.supabase.from("shop_cash_imports").select("*")
        .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
        .order("created_at", { ascending: false }),
      context.supabase.from("shops").select("opening_balance, weekend_payouts_to_monday")
        .eq("user_id", context.ownerId).eq("id", data.shop_id).maybeSingle(),
    ]);
    if (entries.error) throw new Error(entries.error.message);
    if (imports.error) throw new Error(imports.error.message);
    return {
      entries: entries.data ?? [],
      imports: imports.data ?? [],
      opening_balance: Number(shop.data?.opening_balance ?? 0),
      weekend_payouts_to_monday: Boolean(shop.data?.weekend_payouts_to_monday ?? false),
    };
  });

export const listCashCategories = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("shop_cash_categories")
      .select("*")
      .eq("user_id", context.ownerId)
      .eq("shop_id", data.shop_id)
      .order("kind", { ascending: true })
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    // Seed defaults on first use
    if (!rows || rows.length === 0) {
      const seed = [
        ...INCOME_CATEGORIES.map((name, i) => ({
          user_id: context.ownerId, shop_id: data.shop_id, kind: "income" as const, name, position: i,
        })),
        ...EXPENSE_CATEGORIES.map((name, i) => ({
          user_id: context.ownerId, shop_id: data.shop_id, kind: "expense" as const, name, position: i,
        })),
      ];
      const { data: ins, error: insErr } = await context.supabase
        .from("shop_cash_categories").insert(seed).select();
      if (insErr) throw new Error(insErr.message);
      return ins ?? [];
    }
    return rows;
  });

export const createCashCategory = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    kind: z.enum(CASH_KINDS),
    name: z.string().trim().min(1).max(80),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("shop_cash_categories").insert({
      user_id: context.ownerId,
      shop_id: data.shop_id,
      kind: data.kind,
      name: data.name,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const renameCashCategory = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
  }).parse(d))
  .handler(async ({ context, data }) => {
    // get old
    const { data: old, error: getErr } = await context.supabase
      .from("shop_cash_categories").select("*")
      .eq("user_id", context.ownerId).eq("id", data.id).single();
    if (getErr) throw new Error(getErr.message);
    const { error } = await context.supabase.from("shop_cash_categories")
      .update({ name: data.name }).eq("user_id", context.ownerId).eq("id", data.id);
    if (error) throw new Error(error.message);
    // cascade rename on entries
    if (old?.name && old.name !== data.name) {
      await context.supabase.from("shop_cash_entries")
        .update({ category: data.name })
        .eq("user_id", context.ownerId)
        .eq("shop_id", old.shop_id)
        .eq("kind", old.kind)
        .eq("category", old.name);
    }
    return { ok: true };
  });

export const deleteCashCategory = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_cash_categories")
      .delete().eq("user_id", context.ownerId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setWeekendRule = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shops")
      .update({ weekend_payouts_to_monday: data.enabled })
      .eq("user_id", context.ownerId).eq("id", data.shop_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createCashEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) =>
    z.object({
      shop_id: z.string().uuid(),
      kind: z.enum(CASH_KINDS),
      amount: z.number(),
      date: z.string(),
      category: z.string().max(80).nullable().optional(),
      description: z.string().max(300).nullable().optional(),
      recurrence: z.enum(RECURRENCES).optional(),
      recurrence_until: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("shop_cash_entries").insert({
      user_id: context.ownerId,
      shop_id: data.shop_id,
      kind: data.kind,
      amount: data.amount,
      date: data.date,
      category: data.category ?? null,
      description: data.description ?? null,
      recurrence: data.recurrence ?? "none",
      recurrence_until: data.recurrence_until ?? null,
      source: "manual",
    }).select().single();
    if (error) throw new Error(error.message);
    return { entry: row };
  });

export const updateCashEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        amount: z.number().optional(),
        date: z.string().optional(),
        category: z.string().max(80).nullable().optional(),
        description: z.string().max(300).nullable().optional(),
        kind: z.enum(CASH_KINDS).optional(),
        recurrence: z.enum(RECURRENCES).optional(),
        recurrence_until: z.string().nullable().optional(),
        skip_weekend_rule: z.boolean().optional(),
        reconciled: z.boolean().optional(),
      }),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_cash_entries")
      .update(data.patch).eq("user_id", context.ownerId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCashEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_cash_entries")
      .delete().eq("user_id", context.ownerId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setOpeningBalance = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid(), opening_balance: z.number() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shops")
      .update({ opening_balance: data.opening_balance })
      .eq("user_id", context.ownerId).eq("id", data.shop_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const importShopifyPayouts = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) =>
    z.object({
      shop_id: z.string().uuid(),
      file_name: z.string().max(255),
      file_hash: z.string().max(128).nullable().optional(),
      rows: z.array(ImportRow).min(1).max(20000),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    // duplicate check
    if (data.file_hash) {
      const { data: existing } = await context.supabase.from("shop_cash_imports")
        .select("id").eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
        .eq("file_hash", data.file_hash).maybeSingle();
      if (existing) return { duplicate: true, import_id: existing.id };
    }

    // group by date
    const byDate = new Map<string, number>();
    for (const r of data.rows) {
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amount);
    }
    const total = Array.from(byDate.values()).reduce((a, b) => a + b, 0);

    const { data: imp, error: impErr } = await context.supabase.from("shop_cash_imports").insert({
      user_id: context.ownerId,
      shop_id: data.shop_id,
      file_name: data.file_name,
      file_hash: data.file_hash ?? null,
      total_rows: data.rows.length,
      total_amount: total,
    }).select().single();
    if (impErr) throw new Error(impErr.message);

    const inserts = Array.from(byDate.entries()).map(([date, amount]) => ({
      user_id: context.ownerId,
      shop_id: data.shop_id,
      kind: "income" as const,
      amount,
      date,
      category: "Depósito Shopify",
      description: `Importação ${data.file_name}`,
      source: "shopify_import",
      import_id: imp.id,
    }));
    const { error: insErr } = await context.supabase.from("shop_cash_entries").insert(inserts);
    if (insErr) throw new Error(insErr.message);

    return { duplicate: false, import_id: imp.id, days: byDate.size, total };
  });

export const deleteCashImport = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_cash_imports")
      .delete().eq("user_id", context.ownerId).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetShopCash = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const uid = context.ownerId;
    // Reset orders tied to payment batches back to pending
    await sb.from("shop_orders")
      .update({ payment_status: "pending", paid_at: null, payment_batch_id: null, shipped_at: null })
      .eq("user_id", uid).eq("shop_id", data.shop_id).neq("payment_status", "pending");
    // Delete payment batches
    await sb.from("shop_order_payment_batches")
      .delete().eq("user_id", uid).eq("shop_id", data.shop_id);
    // Delete all cash entries
    const e1 = await sb.from("shop_cash_entries")
      .delete().eq("user_id", uid).eq("shop_id", data.shop_id);
    if (e1.error) throw new Error(e1.error.message);
    // Delete import records
    const e2 = await sb.from("shop_cash_imports")
      .delete().eq("user_id", uid).eq("shop_id", data.shop_id);
    if (e2.error) throw new Error(e2.error.message);
    return { ok: true };
  });

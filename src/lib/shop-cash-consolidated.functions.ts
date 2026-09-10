/**
 * Versão "independente" do Caixa, usada só pela tela consolidada geral
 * (menu lateral "Caixa"). Os lançamentos continuam vindo de shop_cash_entries
 * (sincronização com a Shopify não muda em nada), mas criar/editar/excluir/
 * conciliar aqui grava em shop_cash_overrides — uma cópia isolada — em vez de
 * mexer na tabela compartilhada com a loja individual e o Grupo.
 *
 * O merge (fundir shop_cash_entries + overrides) acontece no servidor e
 * devolve o mesmo formato de `entries` que listShopCash, pra reaproveitar
 * toda a lógica de agrupamento por dia já existente no client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { CASH_KINDS, RECURRENCES } from "@/lib/shop-cash.functions";

async function findOrCreateOverride(supabase: any, ownerId: string, id: string) {
  // `id` pode ser o id do próprio override (edição de algo criado direto
  // nessa tela) ou o id do lançamento original em shop_cash_entries (edição
  // de algo sincronizado — na primeira vez ou nas seguintes). Tenta os dois
  // antes de criar, senão a 2ª edição do mesmo lançamento tenta inserir outro
  // override com o mesmo source_entry_id e esbarra no índice único.
  const { data: byId, error: byIdErr } = await supabase
    .from("shop_cash_overrides").select("*")
    .eq("user_id", ownerId).eq("id", id).maybeSingle();
  if (byIdErr) throw new Error(byIdErr.message);
  if (byId) return byId;

  const { data: bySource, error: bySourceErr } = await supabase
    .from("shop_cash_overrides").select("*")
    .eq("user_id", ownerId).eq("source_entry_id", id).maybeSingle();
  if (bySourceErr) throw new Error(bySourceErr.message);
  if (bySource) return bySource;

  const { data: source, error: srcErr } = await supabase
    .from("shop_cash_entries").select("*")
    .eq("user_id", ownerId).eq("id", id).maybeSingle();
  if (srcErr) throw new Error(srcErr.message);
  if (!source) throw new Error("Lançamento não encontrado");

  const { data: created, error: insErr } = await supabase.from("shop_cash_overrides").insert({
    user_id: ownerId,
    shop_id: source.shop_id,
    source_entry_id: source.id,
    kind: source.kind,
    category: source.category,
    description: source.description,
    amount: source.amount,
    date: source.date,
    recurrence: source.recurrence ?? "none",
    recurrence_until: source.recurrence_until,
    skip_weekend_rule: source.skip_weekend_rule ?? false,
    reconciled: source.reconciled ?? false,
  }).select().single();
  if (insErr) throw new Error(insErr.message);
  return created;
}

export const listShopCashConsolidated = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_ids: z.array(z.string().uuid()).min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const [entriesRes, overridesRes, importsRes, shopsRes] = await Promise.all([
      context.supabase.from("shop_cash_entries").select("*")
        .eq("user_id", context.ownerId).in("shop_id", data.shop_ids)
        .neq("source", "shopify_fees_sync")
        .neq("source", "shopify_auto_sync")
        .order("date", { ascending: true }),
      context.supabase.from("shop_cash_overrides").select("*")
        .eq("user_id", context.ownerId).in("shop_id", data.shop_ids),
      context.supabase.from("shop_cash_imports").select("*")
        .eq("user_id", context.ownerId).in("shop_id", data.shop_ids)
        .order("created_at", { ascending: false }),
      context.supabase.from("shops").select("opening_balance, weekend_payouts_to_monday")
        .eq("user_id", context.ownerId).in("id", data.shop_ids),
    ]);
    if (entriesRes.error) throw new Error(entriesRes.error.message);
    if (overridesRes.error) throw new Error(overridesRes.error.message);
    if (importsRes.error) throw new Error(importsRes.error.message);

    const overridesBySource = new Map<string, any>();
    const localOverrides: any[] = [];
    for (const o of overridesRes.data ?? []) {
      if (o.source_entry_id) overridesBySource.set(o.source_entry_id, o);
      else localOverrides.push(o);
    }

    const merged: any[] = [];
    for (const e of entriesRes.data ?? []) {
      const ov = overridesBySource.get(e.id);
      if (!ov) { merged.push(e); continue; }
      if (ov.deleted) continue;
      merged.push({
        ...e,
        kind: ov.kind,
        category: ov.category,
        description: ov.description,
        amount: ov.amount,
        date: ov.date,
        recurrence: ov.recurrence,
        recurrence_until: ov.recurrence_until,
        skip_weekend_rule: ov.skip_weekend_rule,
        reconciled: ov.reconciled,
      });
    }
    for (const o of localOverrides) {
      if (o.deleted) continue;
      merged.push({
        id: o.id,
        shop_id: o.shop_id,
        kind: o.kind,
        category: o.category,
        description: o.description,
        amount: o.amount,
        date: o.date,
        source: "manual",
        auto_kind: null,
        auto_ref_date: null,
        import_id: null,
        recurrence: o.recurrence,
        recurrence_until: o.recurrence_until,
        skip_weekend_rule: o.skip_weekend_rule,
        reconciled: o.reconciled,
      });
    }
    merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const shopRows = shopsRes.data ?? [];
    const opening_balance = shopRows.reduce((s: number, r: any) => s + Number(r.opening_balance ?? 0), 0);
    const weekend_payouts_to_monday = shopRows.some((r: any) => Boolean(r.weekend_payouts_to_monday));
    return {
      entries: merged,
      imports: importsRes.data ?? [],
      opening_balance,
      weekend_payouts_to_monday,
    };
  });

export const createConsolidatedCashEntry = createServerFn({ method: "POST" })
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
    const { data: row, error } = await context.supabase.from("shop_cash_overrides").insert({
      user_id: context.ownerId,
      shop_id: data.shop_id,
      source_entry_id: null,
      kind: data.kind,
      amount: data.amount,
      date: data.date,
      category: data.category ?? null,
      description: data.description ?? null,
      recurrence: data.recurrence ?? "none",
      recurrence_until: data.recurrence_until ?? null,
      reconciled: true,
    }).select().single();
    if (error) throw new Error(error.message);
    return { entry: row };
  });

export const updateConsolidatedCashEntry = createServerFn({ method: "POST" })
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
    const row = await findOrCreateOverride(context.supabase, context.ownerId, data.id);
    const { error } = await context.supabase.from("shop_cash_overrides")
      .update(data.patch).eq("user_id", context.ownerId).eq("id", row.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteConsolidatedCashEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const row = await findOrCreateOverride(context.supabase, context.ownerId, data.id);
    if (row.source_entry_id) {
      // Mantém o override marcado como excluído — assim o lançamento não
      // reaparece se a loja sincronizar de novo.
      const { error } = await context.supabase.from("shop_cash_overrides")
        .update({ deleted: true }).eq("user_id", context.ownerId).eq("id", row.id);
      if (error) throw new Error(error.message);
    } else {
      // Lançamento criado direto nessa tela: sem origem pra "reaparecer", só apaga.
      const { error } = await context.supabase.from("shop_cash_overrides")
        .delete().eq("user_id", context.ownerId).eq("id", row.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

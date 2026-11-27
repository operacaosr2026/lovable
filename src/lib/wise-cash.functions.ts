import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, getSectionResourceFilter } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Caixa Geral › Wise (R$). A Wise é a conta no Brasil: recebe o dinheiro que sai
// do caixa em dólar (lançado lá como saída "Retirada Empresa") e paga
// funcionário, contabilidade etc. em reais. Tudo manual; Saldo atual = só os
// conciliados. Envio do caixa em US$ que ainda não foi todo convertido aparece
// como "chegou quanto em R$?" — cada conversão vira uma entrada com o valor em
// dólar (câmbio). Dá pra converter aos poucos: o envio some quando a soma em
// dólar cobre o enviado, ou quando uma entrada encerra o envio (resto = taxa).

// Saída do caixa em dólar que é dinheiro indo pra Wise.
const TO_WISE = /^\s*retirada empresa\s*$|wise/i;
// Envios antes disso já estavam acertados quando a aba Wise nasceu: não cobra.
const PENDING_FROM = "2026-11-01";

type Ctx = { role: "admin" | "member"; ownerId: string; userId: string; permissions: { section: string; resource_id: string | null }[] };
const db = () => (supabaseAdmin as any).from("wise_cash_entries");

function assertCaixa(ctx: Ctx) {
  if (getSectionResourceFilter(ctx as any, "caixa") === "none") throw new Error("Sem acesso ao Caixa");
}

export type WiseEntry = {
  id: string; kind: "income" | "expense"; amount: number; date: string; category: string | null; description: string | null;
  reconciled: boolean; usd_amount: number | null; source_cash_id: string | null; closes_transfer: boolean; note: string | null; created_at: string;
};
// converted = US$ já convertido em entradas ligadas a este envio; remaining = o que falta.
export type WisePendingTransfer = {
  id: string; date: string; amount: number; shop: string | null; description: string | null;
  converted: number; remaining: number; parts: number;
};

export const getWiseCash = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    assertCaixa(ctx);
    const [{ data: rows, error }, entries, overrides, shops] = await Promise.all([
      db().select("*").eq("owner_id", ctx.ownerId).order("date", { ascending: false }).order("created_at", { ascending: false }),
      supabaseAdmin.from("shop_cash_entries").select("id,shop_id,kind,amount,date,category,description")
        .eq("user_id", ctx.ownerId).eq("kind", "expense").gte("date", PENDING_FROM),
      supabaseAdmin.from("shop_cash_overrides").select("id,shop_id,source_entry_id,kind,amount,date,category,description,deleted")
        .eq("user_id", ctx.ownerId).gte("date", PENDING_FROM),
      supabaseAdmin.from("shops").select("id,name").eq("user_id", ctx.ownerId),
    ]);
    if (error) throw new Error(error.message);
    const list = ((rows ?? []) as any[]).map((r) => ({
      ...r, amount: Number(r.amount), usd_amount: r.usd_amount == null ? null : Number(r.usd_amount),
    })) as WiseEntry[];

    // Mesma fusão do Caixa Geral: override (editado/excluído lá) vale sobre o original.
    const ov = (overrides.data ?? []) as any[];
    const overridden = new Map(ov.filter((o) => o.source_entry_id).map((o) => [o.source_entry_id as string, o]));
    const cash: { id: string; shop_id: string; kind: string; amount: number; date: string; category: string | null; description: string | null }[] = [];
    for (const e of (entries.data ?? []) as any[]) {
      const o = overridden.get(e.id);
      if (o?.deleted) continue;
      cash.push(o ? { ...o, id: e.id } : e);
    }
    for (const o of ov) if (!o.source_entry_id && !o.deleted) cash.push(o);

    const linked = new Map<string, { usd: number; parts: number; closed: boolean }>();
    for (const r of list) {
      if (!r.source_cash_id) continue;
      const l = linked.get(r.source_cash_id) ?? { usd: 0, parts: 0, closed: false };
      l.usd += r.usd_amount ?? 0; l.parts += 1; l.closed ||= !!r.closes_transfer;
      linked.set(r.source_cash_id, l);
    }
    const shopName = new Map(((shops.data ?? []) as any[]).map((s) => [s.id, s.name as string]));
    const pending: WisePendingTransfer[] = cash
      .filter((c) => c.kind === "expense" && TO_WISE.test(c.category ?? ""))
      .map((c) => {
        const l = linked.get(c.id);
        const amount = Number(c.amount);
        const converted = Math.round((l?.usd ?? 0) * 100) / 100;
        // Entrada antiga sem valor em dólar ligada ao envio = envio inteiro (regra de antes).
        const legacyWhole = !!l && l.usd === 0;
        const remaining = l?.closed || legacyWhole ? 0 : Math.max(0, Math.round((amount - converted) * 100) / 100);
        return { id: c.id, date: c.date, amount, shop: shopName.get(c.shop_id) ?? null, description: c.description, converted, remaining, parts: l?.parts ?? 0 };
      })
      .filter((t) => t.remaining >= 0.01)
      .sort((a, b) => a.date.localeCompare(b.date));

    return { entries: list, pending };
  });

const EntryInput = z.object({
  kind: z.enum(["income", "expense"]),
  amount: z.number().positive().max(10_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().trim().max(80).nullable(),
  description: z.string().trim().max(300).nullable(),
  reconciled: z.boolean(),
  usd_amount: z.number().positive().max(10_000_000).nullable().default(null),
  source_cash_id: z.string().uuid().nullable().default(null),
  closes_transfer: z.boolean().default(false),
  note: z.string().trim().max(2000).nullable().default(null),
});

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return t.toISOString().slice(0, 10);
};

export const createWiseEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => EntryInput.extend({ repeatMonths: z.number().int().min(1).max(24).default(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    assertCaixa(ctx);
    const { repeatMonths, ...e } = data;
    // Repetir todo mês (salário, contabilidade): os meses seguintes entram como a pagar.
    const rows = Array.from({ length: repeatMonths }, (_, i) => ({
      ...e, owner_id: ctx.ownerId, created_by: ctx.userId, date: addMonths(e.date, i),
      reconciled: i === 0 ? e.reconciled : false, source_cash_id: i === 0 ? e.source_cash_id : null,
      closes_transfer: i === 0 ? e.closes_transfer : false,
    }));
    const { error } = await db().insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateWiseEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), patch: EntryInput.partial() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    assertCaixa(ctx);
    const { error } = await db().update(data.patch).eq("id", data.id).eq("owner_id", ctx.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWiseEntry = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    assertCaixa(ctx);
    const { error } = await db().delete().eq("id", data.id).eq("owner_id", ctx.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Dashboard: saldo do Caixa Geral (US$) e da Wise (R$) lado a lado. O do caixa
// segue a regra do card "Saldo atual" do Caixa Geral (LgCashflowView): saldo
// inicial + lançamentos conciliados até hoje, com as edições feitas lá
// (shop_cash_overrides) valendo sobre o original, fora taxas/sync automático,
// gasto diário de anúncio e depósito previsto; repasse de sábado/domingo conta
// na segunda quando a loja usa essa regra. Sem acesso ao Caixa → null.
export const getDashboardBalances = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    if (getSectionResourceFilter(ctx as any, "caixa") === "none") return null;
    const [{ getCaixaShops }, { selectAll }, { isoTodayUS }] = await Promise.all([
      import("@/lib/lg-cards.functions"), import("@/lib/select-all"), import("@/lib/timezone"),
    ]);
    const today = isoTodayUS();
    const shopIds = ((await getCaixaShops(ctx.ownerId)) as { id: string }[]).map((s) => s.id);

    let caixa: number | null = null;
    if (shopIds.length) {
      const [entries, overrides, shops] = await Promise.all([
        selectAll(supabaseAdmin.from("shop_cash_entries")
          .select("id,kind,amount,date,reconciled,source,auto_kind,skip_weekend_rule")
          .eq("user_id", ctx.ownerId).in("shop_id", shopIds)
          .neq("source", "shopify_fees_sync").neq("source", "shopify_auto_sync")),
        selectAll(supabaseAdmin.from("shop_cash_overrides")
          .select("source_entry_id,kind,amount,date,reconciled,skip_weekend_rule,deleted")
          .eq("user_id", ctx.ownerId).in("shop_id", shopIds)),
        supabaseAdmin.from("shops").select("opening_balance,weekend_payouts_to_monday").eq("user_id", ctx.ownerId).in("id", shopIds),
      ]);
      if (entries.error) throw new Error(entries.error.message);
      if (overrides.error) throw new Error(overrides.error.message);
      const shopRows = (shops.data ?? []) as any[];
      const toMonday = shopRows.some((s) => s.weekend_payouts_to_monday);
      const bySource = new Map<string, any>();
      const local: any[] = [];
      for (const o of (overrides.data ?? []) as any[]) (o.source_entry_id ? bySource.set(o.source_entry_id, o) : local.push(o));
      const items: any[] = [];
      for (const e of (entries.data ?? []) as any[]) {
        const o = bySource.get(e.id);
        if (o?.deleted) continue;
        items.push(o ? { ...e, kind: o.kind, amount: o.amount, date: o.date, reconciled: o.reconciled, skip_weekend_rule: o.skip_weekend_rule } : e);
      }
      for (const o of local) if (!o.deleted) items.push({ ...o, source: "manual", auto_kind: null });

      const shopify = new Set(["shopify_import", "shopify_sync", "shopify_pending", "shopify_pending_sync"]);
      const shift = (d: string) => {
        const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
        if (wd !== 0 && wd !== 6) return d;
        const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + (wd === 6 ? 2 : 1));
        return t.toISOString().slice(0, 10);
      };
      let s = shopRows.reduce((a, r) => a + Number(r.opening_balance ?? 0), 0);
      for (const e of items) {
        if (e.auto_kind === "meta_ads_spend" || e.source === "shopify_pending_sync" || !e.reconciled) continue;
        const date = toMonday && shopify.has(e.source) && !e.skip_weekend_rule ? shift(e.date) : e.date;
        if (date > today) continue;
        s += e.kind === "income" ? Number(e.amount) : -Number(e.amount);
      }
      // Saldo total = saldo atual (conciliado) + A receber (saldo Shopify Payments),
      // mesma conta do card "Saldo Total" do Caixa Geral.
      const { computeShopsReceivable } = await import("@/lib/shop-orders.functions");
      const rec = await computeShopsReceivable(supabaseAdmin, ctx.ownerId, shopIds);
      if (rec.connected) s += rec.perShop.reduce((a, p) => a + Number(p.amount ?? 0), 0);
      caixa = Math.round(s * 100) / 100;
    }

    const { data: wise } = await db().select("kind,amount").eq("owner_id", ctx.ownerId).eq("reconciled", true);
    const wiseRows = (wise ?? []) as { kind: string; amount: number }[];
    return {
      caixa,
      wise: wiseRows.length ? Math.round(wiseRows.reduce((a, r) => a + (r.kind === "income" ? 1 : -1) * Number(r.amount), 0) * 100) / 100 : null,
    };
  });

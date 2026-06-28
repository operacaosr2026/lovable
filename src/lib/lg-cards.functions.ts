import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const LG_STATUSES = ["ativo", "pausado", "arquivado"] as const;

const CardInput = z.object({
  name:           z.string().trim().min(1).max(120),
  description:    z.string().nullable().optional(),
  status:         z.enum(LG_STATUSES).default("ativo"),
  country:        z.string().nullable().optional(),
  tag:            z.string().nullable().optional(),
  logo_url:       z.string().nullable().optional(),
  matriz_shop_id: z.string().uuid().nullable().optional(),
});

const ShopEntry = z.object({
  shop_id:      z.string().uuid(),
  payout_days:  z.number().int().min(0).max(365).default(10),
  payment_days: z.number().int().min(0).max(365).default(7),
});

// ─── List ────────────────────────────────────────────────────────────────────

export const listLgCards = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;

    const { data: cards, error } = await supabaseAdmin
      .from("lg_cards")
      .select("*")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const cardIds = (cards ?? []).map((c: any) => c.id);

    let shops: any[] = [];
    if (cardIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("lg_card_shops")
        .select("card_id, shop_id, payout_days, payment_days, shops(id, name, status)")
        .in("card_id", cardIds);
      shops = data ?? [];
    }

    const shopsByCard: Record<string, any[]> = {};
    for (const s of shops) {
      (shopsByCard[s.card_id] ??= []).push(s);
    }

    return {
      cards: (cards ?? []).map((c: any) => ({
        ...c,
        card_shops: shopsByCard[c.id] ?? [],
      })),
    };
  });

// ─── Get single ──────────────────────────────────────────────────────────────

export const getLgCard = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: card, error } = await supabaseAdmin
      .from("lg_cards")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", ownerId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!card) return { card: null, shops: [] };

    const { data: cardShops } = await supabaseAdmin
      .from("lg_card_shops")
      .select("id, shop_id, payout_days, payment_days, shops(id, name, status, country)")
      .eq("card_id", data.id);

    return { card, shops: cardShops ?? [] };
  });

// ─── Create ──────────────────────────────────────────────────────────────────

export const createLgCard = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { card: unknown; shops: unknown[] }) =>
    z.object({
      card:  CardInput,
      shops: z.array(ShopEntry),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: card, error } = await supabaseAdmin
      .from("lg_cards")
      .insert({ ...data.card, user_id: ownerId })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    if (data.shops.length > 0) {
      const rows = data.shops.map((s) => ({
        card_id:      card.id,
        shop_id:      s.shop_id,
        payout_days:  s.payout_days,
        payment_days: s.payment_days,
      }));
      const { error: se } = await supabaseAdmin.from("lg_card_shops").insert(rows);
      if (se) throw new Error(se.message);
    }

    return { id: card.id };
  });

// ─── Update ──────────────────────────────────────────────────────────────────

export const updateLgCard = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { id: string; patch: unknown; shops: unknown[] }) =>
    z.object({
      id:    z.string().uuid(),
      patch: CardInput.partial(),
      shops: z.array(ShopEntry),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { error } = await supabaseAdmin
      .from("lg_cards")
      .update(data.patch)
      .eq("id", data.id)
      .eq("user_id", ownerId);

    if (error) throw new Error(error.message);

    // Rebuild shop links
    await supabaseAdmin.from("lg_card_shops").delete().eq("card_id", data.id);

    if (data.shops.length > 0) {
      const rows = data.shops.map((s) => ({
        card_id:      data.id,
        shop_id:      s.shop_id,
        payout_days:  s.payout_days,
        payment_days: s.payment_days,
      }));
      const { error: se } = await supabaseAdmin.from("lg_card_shops").insert(rows);
      if (se) throw new Error(se.message);
    }

    return { ok: true };
  });

// ─── Delete ──────────────────────────────────────────────────────────────────

export const deleteLgCard = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { error } = await supabaseAdmin
      .from("lg_cards")
      .delete()
      .eq("id", data.id)
      .eq("user_id", ownerId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Update shop config (payout/payment days) ────────────────────────────────

export const updateLgCardShopConfig = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { card_id: string; shop_id: string; payout_days?: number; payment_days?: number }) =>
    z.object({
      card_id:      z.string().uuid(),
      shop_id:      z.string().uuid(),
      payout_days:  z.number().int().min(0).max(365).optional(),
      payment_days: z.number().int().min(0).max(365).optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    // Verify ownership
    const { data: card } = await supabaseAdmin
      .from("lg_cards")
      .select("id")
      .eq("id", data.card_id)
      .eq("user_id", ownerId)
      .maybeSingle();

    if (!card) throw new Error("Card não encontrado");

    const patch: { payout_days?: number; payment_days?: number } = {};
    if (data.payout_days !== undefined)  patch.payout_days  = data.payout_days;
    if (data.payment_days !== undefined) patch.payment_days = data.payment_days;

    const { error } = await supabaseAdmin
      .from("lg_card_shops")
      .update(patch)
      .eq("card_id", data.card_id)
      .eq("shop_id", data.shop_id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Notes ───────────────────────────────────────────────────────────────────

export const listLgCardNotes = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { card_id: string }) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: notes, error } = await supabaseAdmin
      .from("lg_card_notes")
      .select("*")
      .eq("card_id", data.card_id)
      .eq("user_id", ownerId)
      .order("note_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return notes ?? [];
  });

export const createLgCardNote = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { card_id: string; content: string; note_date: string }) =>
    z.object({
      card_id:   z.string().uuid(),
      content:   z.string().trim().min(1),
      note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: note, error } = await supabaseAdmin
      .from("lg_card_notes")
      .insert({ card_id: data.card_id, user_id: ownerId, content: data.content, note_date: data.note_date })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return { id: note.id };
  });

export const deleteLgCardNote = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { error } = await supabaseAdmin
      .from("lg_card_notes")
      .delete()
      .eq("id", data.id)
      .eq("user_id", ownerId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── List all shops (for picker) ─────────────────────────────────────────────

export const listAllShopsForPicker = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;

    const { data, error } = await supabaseAdmin
      .from("shops")
      .select("id, name, status, country, tag")
      .eq("user_id", ownerId)
      .order("name", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ─── Update matriz_shop_id ────────────────────────────────────────────────────

export const updateLgCardMatriz = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { id: string; matriz_shop_id: string | null }) =>
    z.object({
      id:             z.string().uuid(),
      matriz_shop_id: z.string().uuid().nullable(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { error } = await supabaseAdmin
      .from("lg_cards")
      .update({ matriz_shop_id: data.matriz_shop_id })
      .eq("id", data.id)
      .eq("user_id", ownerId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Update note ──────────────────────────────────────────────────────────────

export const updateLgCardNote = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { id: string; content: string; visitors?: number | null }) =>
    z.object({
      id:       z.string().uuid(),
      content:  z.string().trim().min(1),
      visitors: z.number().int().min(0).nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { error } = await supabaseAdmin
      .from("lg_card_notes")
      .update({ content: data.content, visitors: data.visitors ?? null })
      .eq("id", data.id)
      .eq("user_id", ownerId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Currency rates ───────────────────────────────────────────────────────────

export const getLgCurrencyRates = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { card_id: string }) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: row } = await supabaseAdmin
      .from("lg_card_currency_rates")
      .select("brl_rate, eur_rate")
      .eq("card_id", data.card_id)
      .eq("user_id", ownerId)
      .maybeSingle();

    return { brl_rate: Number(row?.brl_rate ?? 5.0), eur_rate: Number(row?.eur_rate ?? 0.92) };
  });

export const saveLgCurrencyRates = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { card_id: string; brl_rate: number; eur_rate: number }) =>
    z.object({
      card_id:  z.string().uuid(),
      brl_rate: z.number().positive(),
      eur_rate: z.number().positive(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { error } = await supabaseAdmin
      .from("lg_card_currency_rates")
      .upsert({
        card_id:    data.card_id,
        user_id:    ownerId,
        brl_rate:   data.brl_rate,
        eur_rate:   data.eur_rate,
        updated_at: new Date().toISOString(),
      }, { onConflict: "card_id,user_id" });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Card quick metrics ───────────────────────────────────────────────────────

export const getLgCardQuickMetrics = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { card_id: string }) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    // A) shops in this card
    const { data: cardShops } = await supabaseAdmin
      .from("lg_card_shops")
      .select("shop_id, shops(id, name)")
      .eq("card_id", data.card_id);

    if (!cardShops?.length) {
      return { lucro: 0, taxaEstorno: 0, totalPedidos: 0, totalEstornos: 0, payoutLag: [] };
    }

    const shopIds = cardShops.map((s: any) => s.shop_id as string);
    const shopNameById = new Map(cardShops.map((s: any) => [s.shop_id as string, (s.shops as any)?.name as string ?? s.shop_id]));

    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const to   = now.toISOString().slice(0, 10);

    // B, C, D, E in parallel
    const [ordersRes, settingsRes, feesRes, adsRes, reembolsosRes, chargebacksRes, batchesRes] = await Promise.all([
      supabaseAdmin
        .from("shop_orders")
        .select("revenue, items_count, payment_status, shop_id")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .gte("order_date", from)
        .lte("order_date", to),
      supabaseAdmin
        .from("shop_order_settings")
        .select("shop_id, default_unit_cost, payout_lag_avg_days, payout_lag_days")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds),
      supabaseAdmin
        .from("shop_cash_entries")
        .select("amount")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .eq("category", "Taxas Shopify")
        .gte("date", from)
        .lte("date", to),
      supabaseAdmin
        .from("shop_cash_entries")
        .select("amount")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .eq("category", "Facebook Ads")
        .gte("date", from)
        .lte("date", to),
      supabaseAdmin
        .from("shop_cash_entries")
        .select("amount")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .eq("category", "Reembolso")
        .gte("date", from)
        .lte("date", to),
      supabaseAdmin
        .from("shop_cash_entries")
        .select("amount")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .eq("category", "Chargeback")
        .gte("date", from)
        .lte("date", to),
      supabaseAdmin
        .from("shop_order_payment_batches")
        .select("shop_id, payment_date, order_dates")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .order("batch_number", { ascending: false }),
    ]);

    const orders      = ordersRes.data ?? [];
    const settings    = settingsRes.data ?? [];
    const fees        = feesRes.data ?? [];
    const ads         = adsRes.data ?? [];
    const reembolsos_ = reembolsosRes.data ?? [];
    const chargebacks_= chargebacksRes.data ?? [];
    const batches     = batchesRes.data ?? [];

    // Settings by shop
    const costByShop = new Map(settings.map((s: any) => [s.shop_id as string, Number(s.default_unit_cost ?? 0)]));
    const configuredCosts = Array.from(costByShop.values()).filter(c => c > 0);
    const avgCost = configuredCosts.length > 0 ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length : 0;

    // Last batch per shop (batches already ordered DESC by batch_number)
    const lastBatchByShop = new Map<string, any>();
    for (const b of batches) {
      if (!lastBatchByShop.has(b.shop_id as string)) lastBatchByShop.set(b.shop_id as string, b);
    }

    // Lucro
    const sumAmt = (rows: any[]) => rows.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
    const ordersRevenue = orders.reduce((s: number, o: any) => s + Number(o.revenue ?? 0), 0);
    const reembolsos    = sumAmt(reembolsos_);
    const chargebacks   = sumAmt(chargebacks_);
    const faturamento   = ordersRevenue - reembolsos - chargebacks;
    const custoProduto  = orders.reduce((s: number, o: any) => {
      const shopCost = costByShop.get(o.shop_id as string);
      const unit = shopCost != null && shopCost > 0 ? shopCost : avgCost;
      return s + Number(o.items_count ?? 0) * unit;
    }, 0);
    const taxas    = sumAmt(fees);
    const anuncios = sumAmt(ads);
    const lucro    = faturamento - custoProduto - taxas - anuncios;

    // Taxa de estorno
    const totalPedidos  = orders.length;
    const totalEstornos = orders.filter((o: any) => o.payment_status === "estornado").length;
    const taxaEstorno   = totalPedidos > 0 ? totalEstornos / totalPedidos : 0;

    // Payout lag por shop
    const settingsByShop = new Map(settings.map((s: any) => [s.shop_id as string, s]));

    const payoutLag = shopIds.map((shopId) => {
      const shopName = shopNameById.get(shopId) ?? shopId;
      const batch    = lastBatchByShop.get(shopId);

      if (batch && Array.isArray(batch.order_dates) && batch.order_dates.length > 0) {
        const payoutMs = new Date(`${batch.payment_date}T00:00:00Z`).getTime();
        const diffs = (batch.order_dates as string[]).map(
          (d) => (payoutMs - new Date(`${d}T00:00:00Z`).getTime()) / 86400_000
        ).filter((d) => d >= 0);
        const avgDays = diffs.length > 0 ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
        return { shop_id: shopId, shopName, days: avgDays };
      }

      // Fallback to cached setting
      const s = settingsByShop.get(shopId);
      const fallback = s?.payout_lag_days != null
        ? Math.round(Number(s.payout_lag_days))
        : s?.payout_lag_avg_days != null
          ? Math.round(Number(s.payout_lag_avg_days))
          : null;
      return { shop_id: shopId, shopName, days: fallback };
    });

    return { lucro, taxaEstorno, totalPedidos, totalEstornos, payoutLag };
  });

// ─── Daily analytics ──────────────────────────────────────────────────────────

export const listShopDailyAnalytics = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string; from: string; to: string }) =>
    z.object({
      shop_id: z.string().uuid(),
      from:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: rows, error } = await supabaseAdmin
      .from("shop_daily_analytics")
      .select("date, sessions")
      .eq("shop_id", data.shop_id)
      .eq("user_id", ownerId)
      .gte("date", data.from)
      .lte("date", data.to)
      .order("date", { ascending: true });

    if (error) throw new Error(error.message);
    return rows ?? [];
  });

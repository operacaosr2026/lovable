import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeEstornoByShop } from "@/lib/estorno-daily.server";
import { attachLiveShopifyNames, costProductsFor, getGroupShopifyRefundsAndChargebacks, recomputeShopAutomation } from "@/lib/shop-orders.functions";
import { orderLineItemsCost } from "@/lib/product-cost-match";
import { isoTodayUS, isoMonthStartUS } from "@/lib/timezone";
import { selectAll } from "@/lib/select-all";

// supabaseAdmin ignora RLS, então o dono de cada shop_id vindo do cliente
// precisa ser checado à mão antes de vinculá-lo a um card — senão um usuário
// autenticado podia colar o shop_id de outro workspace e passar a ler o
// faturamento/lucro daquela loja pelas rotas de card (achado de segurança).
async function assertShopsOwnedBy(ownerId: string, shopIds: string[]) {
  const uniqueIds = Array.from(new Set(shopIds));
  if (uniqueIds.length === 0) return;
  const { data: owned } = await supabaseAdmin
    .from("shops").select("id").eq("user_id", ownerId).in("id", uniqueIds);
  const ownedSet = new Set((owned ?? []).map((s: any) => s.id as string));
  const missing = uniqueIds.filter((id) => !ownedSet.has(id));
  if (missing.length > 0) throw new Error("Loja não encontrada ou não pertence a este workspace.");
}

function addDaysISO(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Same as attachLiveShopifyNames, but for rows carrying a nested `shops` object
// (as returned by PostgREST embedding, e.g. lg_card_shops.select("...,shops(id,name,...)")).
async function patchEmbeddedShopNames<T extends { shops: { id: string; name: string } | null }>(
  ownerId: string,
  rows: T[],
): Promise<T[]> {
  const inner = rows.map((r) => r.shops).filter(Boolean) as { id: string; name: string }[];
  if (inner.length === 0) return rows;
  const patched = await attachLiveShopifyNames(ownerId, inner);
  const nameById = new Map(patched.map((p) => [p.id, p.name]));
  return rows.map((r) => (r.shops ? { ...r, shops: { ...r.shops, name: nameById.get(r.shops.id) ?? r.shops.name } } : r));
}

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
      shops = await patchEmbeddedShopNames(ownerId, data ?? []);
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

    return { card, shops: await patchEmbeddedShopNames(ownerId, cardShops ?? []) };
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
      await assertShopsOwnedBy(ownerId, data.shops.map((s) => s.shop_id));
      const rows = data.shops.map((s) => ({
        card_id:      card.id,
        shop_id:      s.shop_id,
        payout_days:  s.payout_days,
        payment_days: s.payment_days,
      }));
      const { error: se } = await supabaseAdmin.from("lg_card_shops").insert(rows);
      if (se) throw new Error(se.message);
      await Promise.all(data.shops.map((s) => recomputeShopAutomation(s.shop_id)));
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

    // supabaseAdmin ignora RLS e um UPDATE que não casa nenhuma linha não
    // gera erro no supabase-js — sem essa checagem, passar o id de um card de
    // outro dono ainda seguia até o delete/insert de lg_card_shops abaixo e
    // apagava/reescrevia os vínculos de loja daquele card alheio.
    const { data: ownedCard } = await supabaseAdmin
      .from("lg_cards").select("id").eq("id", data.id).eq("user_id", ownerId).maybeSingle();
    if (!ownedCard) throw new Error("Card não encontrado.");

    if (data.shops.length > 0) await assertShopsOwnedBy(ownerId, data.shops.map((s) => s.shop_id));

    // Shops linked before this edit — needed so we can also recompute their
    // sync state if they're being dropped from the card (or the card is
    // being archived/reactivated).
    const { data: previousLinks } = await supabaseAdmin
      .from("lg_card_shops")
      .select("shop_id")
      .eq("card_id", data.id);
    const previousShopIds = (previousLinks ?? []).map((s: any) => s.shop_id as string);

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

    // Archiving/reactivating a card, or changing which shops it holds, can
    // change whether those shops should keep syncing.
    const affectedShopIds = new Set([...previousShopIds, ...data.shops.map((s) => s.shop_id)]);
    await Promise.all([...affectedShopIds].map((id) => recomputeShopAutomation(id)));

    return { ok: true };
  });

// ─── Delete ──────────────────────────────────────────────────────────────────

export const deleteLgCard = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: links } = await supabaseAdmin.from("lg_card_shops").select("shop_id").eq("card_id", data.id);
    const shopIds = (links ?? []).map((s: any) => s.shop_id as string);

    const { error } = await supabaseAdmin
      .from("lg_cards")
      .delete()
      .eq("id", data.id)
      .eq("user_id", ownerId);

    if (error) throw new Error(error.message);
    // A deleted archived card can no longer keep its shops paused.
    await Promise.all(shopIds.map((id) => recomputeShopAutomation(id)));
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

    // `shops` rows are mirrored from `shopify_stores` on connect/rename/delete
    // (see syncMirrorShop in shop-orders.functions.ts) — only mirrored rows
    // that still point at a live Shopify connection belong in this picker.
    const { data, error } = await supabaseAdmin
      .from("shops")
      .select("id, name, status, country, tag, shopify_store_id")
      .eq("user_id", ownerId)
      .not("shopify_store_id", "is", null)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return [];

    const { data: liveStores, error: storesError } = await supabaseAdmin
      .from("shopify_stores")
      .select("id")
      .eq("user_id", ownerId)
      .in("id", [...new Set(data.map((s) => s.shopify_store_id))] as string[]);
    if (storesError) throw new Error(storesError.message);
    const liveStoreIds = new Set((liveStores ?? []).map((s) => s.id));

    const connected = data.filter((s) => liveStoreIds.has(s.shopify_store_id as string));
    return attachLiveShopifyNames(ownerId, connected);
  });

// ─── List shops for the consolidated Caixa page ──────────────────────────────
// Same base set as the picker above, minus any shop currently sitting in a
// Banco de Lojas board column marked "Excluir do Caixa" (e.g. Em Hold,
// Cemitério) — those shouldn't count toward the combined balance/receivable.
// Shared with the Simulador (caixa-simulator.functions.ts), which needs the
// same shop set to compute the real starting balance.
export const getCaixaShops = createServerOnlyFn(async (ownerId: string) => {
  const { data, error } = await supabaseAdmin
    .from("shops")
    .select("id, name, shopify_store_id")
    .eq("user_id", ownerId)
    .not("shopify_store_id", "is", null)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const { data: liveStores, error: storesError } = await supabaseAdmin
    .from("shopify_stores")
    .select("id, board_column_id")
    .eq("user_id", ownerId)
    .in("id", [...new Set(data.map((s) => s.shopify_store_id))] as string[]);
  if (storesError) throw new Error(storesError.message);
  const columnIdByStoreId = new Map((liveStores ?? []).map((s: any) => [s.id, s.board_column_id]));

  const columnIds = [...new Set((liveStores ?? []).map((s: any) => s.board_column_id).filter(Boolean))] as string[];
  const { data: columns } = columnIds.length > 0
    ? await supabaseAdmin.from("store_board_columns").select("id, excluded_from_caixa").in("id", columnIds)
    : { data: [] as any[] };
  const excludedColumnIds = new Set((columns ?? []).filter((c: any) => c.excluded_from_caixa).map((c: any) => c.id));

  const connected = data.filter((s) => {
    const storeId = s.shopify_store_id as string;
    if (!columnIdByStoreId.has(storeId)) return false; // not a live Shopify connection
    const columnId = columnIdByStoreId.get(storeId);
    return !columnId || !excludedColumnIds.has(columnId);
  });
  return attachLiveShopifyNames(ownerId, connected);
});

export const listCaixaShops = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => getCaixaShops(context.ownerId));

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

// ─── Overview do Dashboard (home) ──────────────────────────────────────────────

const emptyDashboardOverview = {
  totals: {
    faturamento: 0, faturamentoDelta: 0,
    anuncios: 0, anunciosDelta: 0,
    custoProduto: 0, custoProdutoDelta: 0,
    lucro: 0, lucroDelta: 0,
    taxaEstorno: 0, taxaEstornoDeltaPP: 0,
    pedidos: 0, pedidosDelta: 0,
  },
  chartData: [] as { date: string; faturamento: number; anuncios: number; custo: number; lucro: number }[],
  shopBreakdown: [] as { shop_id: string; shop_name: string; faturamento: number; taxaEstorno: number; totalPedidos: number; totalEstornos: number }[],
  // Lojas/cards do Dashboard — usados pelos indicadores de logística e tarefas
  // ao lado do gráfico (mesma busca da aba Rastreamento).
  shopIds: [] as string[],
  cardIds: [] as string[],
};

function dashboardDelta(curr: number, prev: number) {
  if (prev === 0) return 0;
  return Math.round(((curr - prev) / prev) * 100 * 10) / 10;
}

export const getDashboardOverview = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional().parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;

    // Lojas dos grupos ativos numa consulta só (antes: grupos, depois lojas).
    const { data: cardShops, error } = await supabaseAdmin
      .from("lg_card_shops")
      .select("card_id,shop_id,lg_cards!inner(user_id,status)")
      .eq("lg_cards.user_id", ownerId)
      .eq("lg_cards.status", "ativo");
    if (error) throw new Error(error.message);
    const cardIds = Array.from(new Set((cardShops ?? []).map((cs: any) => cs.card_id as string)));
    const shopIds = Array.from(new Set((cardShops ?? []).map((cs: any) => cs.shop_id as string)));
    if (!shopIds.length) return emptyDashboardOverview;

    // "Hoje"/"mês corrente" sempre no fuso de Nova York (horário padrão do
    // negócio), não UTC nem o horário local do servidor.
    const todayStr = isoTodayUS();
    const defaultMonthStart = isoMonthStartUS();
    const from = data?.from ?? defaultMonthStart;
    const to = data?.to ?? todayStr;

    // "vs mês anterior": mesma quantidade de dias, imediatamente anterior a `from`.
    const days = Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86_400_000) + 1;
    const prevTo = addDaysISO(from, -1);
    const prevFrom = addDaysISO(prevTo, -(days - 1));

    // Taxa de estorno é sempre uma janela rolante fixa de 30 dias, independente
    // do seletor de datas: estorno demora a acontecer depois da compra
    // (semanas), então medir só o período selecionado deixaria a taxa
    // artificialmente perto de 0. O delta compara com os 30 dias anteriores.
    const estornoStart = addDaysISO(todayStr, -30);
    const prevEstornoEnd = addDaysISO(estornoStart, -1);
    const prevEstornoStart = addDaysISO(prevEstornoEnd, -29);

    // supabaseAdmin ignora RLS — todo filtro de posse abaixo é manual. shopIds
    // já vem só de cards do próprio ownerId (linhas acima), mas filtramos por
    // user_id aqui também (defesa em profundidade, e pra não depender só do
    // create/updateLgCard nunca deixarem um shop_id de outro dono entrar em
    // lg_card_shops).
    const [
      shopsWithLiveNames, monthOrdersRes, prevOrdersRes,
      estornoOrdersRes, prevEstornoOrdersRes,
      chargebackDisputesRes, prevChargebackDisputesRes,
      costRes, feesRes, prevFeesRes, adsRes, prevAdsRes,
      refundsAndChargebacks, prevRefundsAndChargebacks,
      costProducts,
    ] = await Promise.all([
      // Nome exibido segue o vínculo ao vivo com a Shopify (shopify_store_id),
      // não o nome interno cadastrado em `shops` — evita mostrar um nome antigo
      // quando a loja Shopify já foi renomeada. Em paralelo com o resto.
      supabaseAdmin.from("shops").select("id, name").eq("user_id", ownerId).in("id", shopIds)
        .then((shopsRes) => attachLiveShopifyNames(
          ownerId,
          (shopsRes.data ?? []).map((s: any) => ({ id: s.id as string, name: s.name as string })),
        )),
      selectAll(supabaseAdmin.from("shop_orders").select("shop_id, order_date, revenue, line_items:raw->line_items").eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", from).lte("order_date", to)),
      selectAll(supabaseAdmin.from("shop_orders").select("shop_id, revenue, line_items:raw->line_items").eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", prevFrom).lte("order_date", prevTo)),
      selectAll(supabaseAdmin.from("shop_orders").select("shop_id").eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", estornoStart).lte("order_date", todayStr)),
      selectAll(supabaseAdmin.from("shop_orders").select("shop_id").eq("user_id", ownerId).in("shop_id", shopIds).gte("order_date", prevEstornoStart).lte("order_date", prevEstornoEnd)),
      // Taxa de estorno = chargeback real (disputa formal do banco/cartão do
      // cliente, sincronizada em shop_order_disputes) ÷ total de pedidos —
      // mesma fonte usada em getLgCardQuickMetrics, pra bater com a tela de
      // Lojas e Grupos. Diferente de um simples cancelamento de pedido.
      selectAll(supabaseAdmin.from("shop_order_disputes").select("shop_id, order_external_id")
        .eq("user_id", ownerId).in("shop_id", shopIds).eq("type", "chargeback")
        .gte("initiated_at", `${estornoStart}T00:00:00Z`).lte("initiated_at", `${todayStr}T23:59:59Z`)),
      selectAll(supabaseAdmin.from("shop_order_disputes").select("shop_id, order_external_id")
        .eq("user_id", ownerId).in("shop_id", shopIds).eq("type", "chargeback")
        .gte("initiated_at", `${prevEstornoStart}T00:00:00Z`).lte("initiated_at", `${prevEstornoEnd}T23:59:59Z`)),
      supabaseAdmin.from("shop_order_settings").select("shop_id, default_unit_cost").eq("user_id", ownerId).in("shop_id", shopIds),
      selectAll(supabaseAdmin.from("shop_cash_entries").select("shop_id, date, amount").eq("user_id", ownerId).in("shop_id", shopIds).eq("category", "Taxas Shopify").gte("date", from).lte("date", to)),
      selectAll(supabaseAdmin.from("shop_cash_entries").select("shop_id, amount").eq("user_id", ownerId).in("shop_id", shopIds).eq("category", "Taxas Shopify").gte("date", prevFrom).lte("date", prevTo)),
      selectAll(supabaseAdmin.from("shop_cash_entries").select("shop_id, date, amount").eq("user_id", ownerId).in("shop_id", shopIds).eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend").gte("date", from).lte("date", to)),
      selectAll(supabaseAdmin.from("shop_cash_entries").select("shop_id, amount").eq("user_id", ownerId).in("shop_id", shopIds).eq("category", "Facebook Ads").eq("auto_kind", "meta_ads_spend").gte("date", prevFrom).lte("date", prevTo)),
      // Ao vivo da Shopify (não do cache em shop_cash_entries) — mesma fonte
      // usada pelo Dashboard, pelo card de Lojas e Grupos e por Metas, pra
      // "lucro" bater em todas as telas.
      getGroupShopifyRefundsAndChargebacks(ownerId, shopIds, from, to),
      getGroupShopifyRefundsAndChargebacks(ownerId, shopIds, prevFrom, prevTo),
      costProductsFor(supabaseAdmin, ownerId),
    ]);

    const shopNameById = new Map(shopsWithLiveNames.map((s) => [s.id, s.name]));

    const costByShop = new Map((costRes.data ?? []).map((s: any) => [s.shop_id, Number(s.default_unit_cost ?? 0)]));
    const configuredCosts = Array.from(costByShop.values()).filter((c) => c > 0);
    const avgCost = configuredCosts.length > 0 ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length : 0;
    // Mesmo cálculo por produto/palavra-chave usado no Dashboard (orderLineItemsCost),
    // em vez de items_count × custo fixo da loja.
    function costFor(shopId: string, rawLineItems: any) {
      const shopCost = costByShop.get(shopId);
      const fallback = shopCost != null && shopCost > 0 ? shopCost : avgCost;
      return orderLineItemsCost(rawLineItems, costProducts, fallback);
    }

    // Período atual — por loja e por dia (a série diária vira o gráfico principal)
    const revenueByShop = new Map<string, number>();
    const custoByShop = new Map<string, number>();
    const byDate = new Map<string, { faturamento: number; custo: number }>();
    for (const o of (monthOrdersRes.data ?? []) as any[]) {
      const sid = o.shop_id as string;
      const rev = Number(o.revenue ?? 0);
      const cost = costFor(sid, o.line_items);
      revenueByShop.set(sid, (revenueByShop.get(sid) ?? 0) + rev);
      custoByShop.set(sid, (custoByShop.get(sid) ?? 0) + cost);
      const d = o.order_date as string;
      const prevDay = byDate.get(d) ?? { faturamento: 0, custo: 0 };
      byDate.set(d, { faturamento: prevDay.faturamento + rev, custo: prevDay.custo + cost });
    }
    const pedidos = (monthOrdersRes.data ?? []).length;

    // Período anterior — só totais por loja, não precisa de série diária
    const prevRevenueByShop = new Map<string, number>();
    const prevCustoByShop = new Map<string, number>();
    for (const o of (prevOrdersRes.data ?? []) as any[]) {
      const sid = o.shop_id as string;
      prevRevenueByShop.set(sid, (prevRevenueByShop.get(sid) ?? 0) + Number(o.revenue ?? 0));
      prevCustoByShop.set(sid, (prevCustoByShop.get(sid) ?? 0) + costFor(sid, o.line_items));
    }
    const prevPedidos = (prevOrdersRes.data ?? []).length;

    const feesByShop = new Map<string, number>();
    const feesByDate = new Map<string, number>();
    for (const r of (feesRes.data ?? []) as any[]) {
      feesByShop.set(r.shop_id, (feesByShop.get(r.shop_id) ?? 0) + Number(r.amount ?? 0));
      feesByDate.set(r.date, (feesByDate.get(r.date) ?? 0) + Number(r.amount ?? 0));
    }
    const prevFeesByShop = new Map<string, number>();
    for (const r of (prevFeesRes.data ?? []) as any[]) prevFeesByShop.set(r.shop_id, (prevFeesByShop.get(r.shop_id) ?? 0) + Number(r.amount ?? 0));

    const adsByShop = new Map<string, number>();
    const adsByDate = new Map<string, number>();
    for (const r of (adsRes.data ?? []) as any[]) {
      adsByShop.set(r.shop_id, (adsByShop.get(r.shop_id) ?? 0) + Number(r.amount ?? 0));
      adsByDate.set(r.date, (adsByDate.get(r.date) ?? 0) + Number(r.amount ?? 0));
    }
    const prevAdsByShop = new Map<string, number>();
    for (const r of (prevAdsRes.data ?? []) as any[]) prevAdsByShop.set(r.shop_id, (prevAdsByShop.get(r.shop_id) ?? 0) + Number(r.amount ?? 0));

    const reembolsosByShop = new Map<string, number>(refundsAndChargebacks.map((r: any) => [r.shop_id, r.refAmt]));
    const chargebacksByShop = new Map<string, number>(refundsAndChargebacks.map((r: any) => [r.shop_id, r.cbAmt]));
    const refundsByDate = new Map<string, number>();
    const chargebacksByDate = new Map<string, number>();
    for (const r of refundsAndChargebacks as any[]) {
      for (const [d, amt] of Object.entries(r.refByDate ?? {})) refundsByDate.set(d, (refundsByDate.get(d) ?? 0) + (amt as number));
      for (const [d, amt] of Object.entries(r.cbByDate ?? {})) chargebacksByDate.set(d, (chargebacksByDate.get(d) ?? 0) + (amt as number));
    }
    const prevReembolsosByShop = new Map<string, number>(prevRefundsAndChargebacks.map((r: any) => [r.shop_id, r.refAmt]));
    const prevChargebacksByShop = new Map<string, number>(prevRefundsAndChargebacks.map((r: any) => [r.shop_id, r.cbAmt]));

    // Taxa de estorno em janela rolante de 30 dias (ver comentário acima)
    const totalOrdersByShop = new Map<string, number>();
    for (const o of (estornoOrdersRes.data ?? []) as any[]) totalOrdersByShop.set(o.shop_id, (totalOrdersByShop.get(o.shop_id) ?? 0) + 1);
    const estornosPorLojaSet = new Map<string, Set<string>>();
    for (const d of (chargebackDisputesRes.data ?? []) as any[]) {
      if (d.order_external_id == null) continue;
      if (!estornosPorLojaSet.has(d.shop_id)) estornosPorLojaSet.set(d.shop_id, new Set());
      estornosPorLojaSet.get(d.shop_id)!.add(d.order_external_id);
    }
    const totalEstornosByShop = new Map<string, number>(
      Array.from(estornosPorLojaSet.entries()).map(([shopId, set]) => [shopId, set.size]),
    );

    const prevTotalOrdersByShop = new Map<string, number>();
    for (const o of (prevEstornoOrdersRes.data ?? []) as any[]) prevTotalOrdersByShop.set(o.shop_id, (prevTotalOrdersByShop.get(o.shop_id) ?? 0) + 1);
    const prevEstornosPorLojaSet = new Map<string, Set<string>>();
    for (const d of (prevChargebackDisputesRes.data ?? []) as any[]) {
      if (d.order_external_id == null) continue;
      if (!prevEstornosPorLojaSet.has(d.shop_id)) prevEstornosPorLojaSet.set(d.shop_id, new Set());
      prevEstornosPorLojaSet.get(d.shop_id)!.add(d.order_external_id);
    }
    const prevTotalEstornosByShop = new Map<string, number>(
      Array.from(prevEstornosPorLojaSet.entries()).map(([shopId, set]) => [shopId, set.size]),
    );

    // ── Totais globais (soma de todas as lojas dos grupos ativos) + delta ──
    let faturamento = 0, custoProduto = 0, anuncios = 0, taxas = 0;
    let prevFaturamento = 0, prevCustoProduto = 0, prevAnuncios = 0, prevTaxas = 0;
    let totalPedidosEstorno = 0, totalEstornosEstorno = 0;
    let prevTotalPedidosEstorno = 0, prevTotalEstornosEstorno = 0;
    for (const id of shopIds) {
      faturamento += (revenueByShop.get(id) ?? 0) - (reembolsosByShop.get(id) ?? 0) - (chargebacksByShop.get(id) ?? 0);
      custoProduto += custoByShop.get(id) ?? 0;
      taxas += feesByShop.get(id) ?? 0;
      anuncios += adsByShop.get(id) ?? 0;
      prevFaturamento += (prevRevenueByShop.get(id) ?? 0) - (prevReembolsosByShop.get(id) ?? 0) - (prevChargebacksByShop.get(id) ?? 0);
      prevCustoProduto += prevCustoByShop.get(id) ?? 0;
      prevTaxas += prevFeesByShop.get(id) ?? 0;
      prevAnuncios += prevAdsByShop.get(id) ?? 0;
      totalPedidosEstorno += totalOrdersByShop.get(id) ?? 0;
      totalEstornosEstorno += totalEstornosByShop.get(id) ?? 0;
      prevTotalPedidosEstorno += prevTotalOrdersByShop.get(id) ?? 0;
      prevTotalEstornosEstorno += prevTotalEstornosByShop.get(id) ?? 0;
    }
    const lucro = faturamento - custoProduto - taxas - anuncios;
    const prevLucro = prevFaturamento - prevCustoProduto - prevTaxas - prevAnuncios;
    const taxaEstorno = totalPedidosEstorno > 0 ? totalEstornosEstorno / totalPedidosEstorno : 0;
    const prevTaxaEstorno = prevTotalPedidosEstorno > 0 ? prevTotalEstornosEstorno / prevTotalPedidosEstorno : 0;

    // ── Série diária pro gráfico principal (Faturamento / Ads / Lucro) ──
    for (const d of feesByDate.keys()) if (!byDate.has(d)) byDate.set(d, { faturamento: 0, custo: 0 });
    for (const d of adsByDate.keys()) if (!byDate.has(d)) byDate.set(d, { faturamento: 0, custo: 0 });
    for (const d of refundsByDate.keys()) if (!byDate.has(d)) byDate.set(d, { faturamento: 0, custo: 0 });
    for (const d of chargebacksByDate.keys()) if (!byDate.has(d)) byDate.set(d, { faturamento: 0, custo: 0 });

    const chartData = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const dayTaxas = feesByDate.get(date) ?? 0;
        const dayAnuncios = adsByDate.get(date) ?? 0;
        const dayReembolsos = refundsByDate.get(date) ?? 0;
        const dayChargebacks = chargebacksByDate.get(date) ?? 0;
        const dayFaturamento = v.faturamento - dayReembolsos - dayChargebacks;
        return {
          date: `${date.slice(8, 10)}/${date.slice(5, 7)}`, // YYYY-MM-DD → DD/MM
          faturamento: Math.round(dayFaturamento * 100) / 100,
          anuncios: Math.round(dayAnuncios * 100) / 100,
          custo: Math.round(v.custo * 100) / 100,
          lucro: Math.round((dayFaturamento - v.custo - dayTaxas - dayAnuncios) * 100) / 100,
        };
      });

    // ── Breakdown por loja pra rosca "Composição do faturamento" e o ranking ──
    const shopBreakdown = shopIds.map((sid) => {
      const totalPedidos = totalOrdersByShop.get(sid) ?? 0;
      const totalEstornos = totalEstornosByShop.get(sid) ?? 0;
      return {
        shop_id: sid,
        shop_name: shopNameById.get(sid) ?? sid,
        faturamento: (revenueByShop.get(sid) ?? 0) - (reembolsosByShop.get(sid) ?? 0) - (chargebacksByShop.get(sid) ?? 0),
        taxaEstorno: totalPedidos > 0 ? totalEstornos / totalPedidos : 0,
        totalPedidos,
        totalEstornos,
      };
    });

    return {
      totals: {
        faturamento,   faturamentoDelta:   dashboardDelta(faturamento, prevFaturamento),
        anuncios,      anunciosDelta:      dashboardDelta(anuncios, prevAnuncios),
        custoProduto,  custoProdutoDelta:  dashboardDelta(custoProduto, prevCustoProduto),
        lucro,         lucroDelta:         dashboardDelta(lucro, prevLucro),
        // Pontos percentuais, não delta relativo — cair de 2% pra 1% é "-1 p.p.", não "-50%".
        taxaEstorno,   taxaEstornoDeltaPP: Math.round((taxaEstorno - prevTaxaEstorno) * 1000) / 10,
        pedidos,       pedidosDelta:       dashboardDelta(pedidos, prevPedidos),
      },
      chartData,
      shopBreakdown,
      shopIds,
      cardIds,
    };
  });

// ─── Card quick metrics ───────────────────────────────────────────────────────

export const getLgCardQuickMetrics = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { card_id: string }) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    // A) lojas do card — o join com lg_cards filtrado por user_id é a checagem
    // de dono: card_id vem cru do cliente e supabaseAdmin ignora RLS, então sem
    // ela qualquer usuário logado podia ler nome de loja e métricas de um card
    // de outro dono só adivinhando o UUID. (Antes eram 2 consultas em fila.)
    const { data: cardShops } = await supabaseAdmin
      .from("lg_card_shops")
      .select("shop_id, shops(id, name), lg_cards!inner(user_id)")
      .eq("card_id", data.card_id)
      .eq("lg_cards.user_id", ownerId);

    if (!cardShops?.length) {
      return { lucro: 0, taxaEstorno: 0, totalPedidos: 0, totalEstornos: 0, payoutLag: [], estornoPorLoja: [] };
    }

    const shopIds = cardShops.map((s: any) => s.shop_id as string);
    // Nomes ao vivo da Shopify em paralelo com as métricas (antes vinham antes).
    const namesPromise = patchEmbeddedShopNames(ownerId, cardShops as any[]);

    // "Hoje"/"mês corrente" sempre no fuso de Nova York (horário padrão do
    // negócio), não UTC — pra não incluir/excluir um dia de pedidos perto da
    // virada e não bater com Dashboard/Metas, que já usam esse fuso.
    const to   = isoTodayUS();
    const from = isoMonthStartUS();

    // B, C, D, E in parallel
    const [ordersRes, settingsRes, feesRes, adsRes, refundsAndChargebacks, costProducts, patchedCardShops] = await Promise.all([
      selectAll(supabaseAdmin
        .from("shop_orders")
        .select("revenue, items_count, shop_id, line_items:raw->line_items")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .gte("order_date", from)
        .lte("order_date", to)),
      supabaseAdmin
        .from("shop_order_settings")
        .select("shop_id, default_unit_cost, payout_lag_avg_days, payout_lag_days, chargeback_orders_30d, chargeback_count_30d, chargeback_stats_at")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds),
      selectAll(supabaseAdmin
        .from("shop_cash_entries")
        .select("amount")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .eq("category", "Taxas Shopify")
        .gte("date", from)
        .lte("date", to)),
      selectAll(supabaseAdmin
        .from("shop_cash_entries")
        .select("amount")
        .eq("user_id", ownerId)
        .in("shop_id", shopIds)
        .eq("category", "Facebook Ads")
        .eq("auto_kind", "meta_ads_spend")
        .gte("date", from)
        .lte("date", to)),
      // Ao vivo da Shopify (não do cache em shop_cash_entries) — mesma fonte
      // usada pelo Dashboard, pra "lucro" bater entre as duas telas.
      getGroupShopifyRefundsAndChargebacks(ownerId, shopIds, from, to),
      costProductsFor(supabaseAdmin, ownerId),
      namesPromise,
    ]);
    const shopNameById = new Map((patchedCardShops as any[]).map((s: any) => [s.shop_id as string, (s.shops as any)?.name as string ?? s.shop_id]));

    const orders             = ordersRes.data ?? [];
    const settings           = settingsRes.data ?? [];
    const fees        = feesRes.data ?? [];
    const ads         = adsRes.data ?? [];

    // Settings by shop
    const costByShop = new Map(settings.map((s: any) => [s.shop_id as string, Number(s.default_unit_cost ?? 0)]));
    const configuredCosts = Array.from(costByShop.values()).filter(c => c > 0);
    const avgCost = configuredCosts.length > 0 ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length : 0;

    // Lucro
    const sumAmt = (rows: any[]) => rows.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
    const ordersRevenue = orders.reduce((s: number, o: any) => s + Number(o.revenue ?? 0), 0);
    const reembolsos    = refundsAndChargebacks.reduce((s: number, r: any) => s + r.refAmt, 0);
    const chargebacks   = refundsAndChargebacks.reduce((s: number, r: any) => s + r.cbAmt, 0);
    const faturamento   = ordersRevenue - reembolsos - chargebacks;
    // Mesmo cálculo por produto/palavra-chave usado no Dashboard (orderLineItemsCost),
    // pra "lucro" bater entre as duas telas em vez de items_count × custo fixo da loja.
    const custoProduto  = orders.reduce((s: number, o: any) => {
      const shopCost = costByShop.get(o.shop_id as string);
      const fallback = shopCost != null && shopCost > 0 ? shopCost : avgCost;
      return s + orderLineItemsCost(o.line_items, costProducts, fallback);
    }, 0);
    const taxas    = sumAmt(fees);
    const anuncios = sumAmt(ads);
    const lucro    = faturamento - custoProduto - taxas - anuncios;

    // Taxa de estorno (30 dias) por loja: calculada 1x por dia à meia-noite
    // (estorno-daily.server.ts) e guardada em shop_order_settings — aqui só lê.
    // Enquanto alguma loja ainda não tiver o valor guardado, calcula na hora.
    const allStored = shopIds.every((id) => settings.some((s: any) => s.shop_id === id && s.chargeback_stats_at));
    const estornoStats = allStored
      ? new Map(settings.map((s: any) => [s.shop_id as string, { pedidos: Number(s.chargeback_orders_30d ?? 0), estornos: Number(s.chargeback_count_30d ?? 0) }]))
      : await computeEstornoByShop(ownerId, shopIds, to);
    let totalPedidos = 0, totalEstornos = 0;
    for (const id of shopIds) {
      totalPedidos  += estornoStats.get(id)?.pedidos ?? 0;
      totalEstornos += estornoStats.get(id)?.estornos ?? 0;
    }
    const taxaEstorno = totalPedidos > 0 ? totalEstornos / totalPedidos : 0;

    // Mesma taxa, mas por loja — cada uma tem um mix de produto/público
    // diferente, então a taxa agregada do card esconde lojas com estorno alto.
    const estornoPorLoja = shopIds.map((shopId) => {
      const pedidos  = estornoStats.get(shopId)?.pedidos ?? 0;
      const estornos = estornoStats.get(shopId)?.estornos ?? 0;
      return {
        shop_id: shopId,
        shopName: shopNameById.get(shopId) ?? shopId,
        totalPedidos: pedidos,
        totalEstornos: estornos,
        taxaEstorno: pedidos > 0 ? estornos / pedidos : 0,
      };
    });

    // Payout lag por shop — D+X real, sincronizado dos payouts do Shopify
    // (payout_lag_days = ajuste manual do usuário; payout_lag_avg_days = média
    // calculada a partir dos payouts reais). Não usar shop_order_payment_batches
    // aqui: aquilo é o registro de quando o custo do produto foi pago (COGS),
    // sem relação com o depósito que o Shopify faz na conta do lojista.
    const settingsByShop = new Map(settings.map((s: any) => [s.shop_id as string, s]));

    const payoutLag = shopIds.map((shopId) => {
      const shopName = shopNameById.get(shopId) ?? shopId;
      const s = settingsByShop.get(shopId);
      const days = s?.payout_lag_days != null
        ? Math.round(Number(s.payout_lag_days))
        : s?.payout_lag_avg_days != null
          ? Math.round(Number(s.payout_lag_avg_days))
          : null;
      return { shop_id: shopId, shopName, days };
    });

    return { lucro, taxaEstorno, totalPedidos, totalEstornos, payoutLag, estornoPorLoja };
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

    const { data: rows, error } = await selectAll(supabaseAdmin
      .from("shop_daily_analytics")
      .select("date, sessions")
      .eq("shop_id", data.shop_id)
      .eq("user_id", ownerId)
      .gte("date", data.from)
      .lte("date", data.to)
      .order("date", { ascending: true }));

    if (error) throw new Error(error.message);
    return rows ?? [];
  });

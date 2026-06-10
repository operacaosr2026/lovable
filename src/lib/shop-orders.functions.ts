import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const COST_CATEGORY = "Custo de pedidos";
const PROCESSING_DELAY_DAYS = 7;

// ---------- Helpers ----------
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}

// access_token is no longer readable by the user role (column SELECT was revoked).
// Use the admin client and scope strictly by user_id to keep authorization correct.
async function getShopifyCreds(_supabase: any, userId: string, shopify_store_id: string) {
  const { data, error } = await supabaseAdmin
    .from("shopify_stores")
    .select("shop_domain,access_token")
    .eq("user_id", userId)
    .eq("id", shopify_store_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Loja Shopify não encontrada");
  if (!data.access_token) throw new Error("Loja Shopify sem access_token");
  return { domain: data.shop_domain as string, token: data.access_token as string };
}

async function fetchShopifyOrders(domain: string, token: string, sinceISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(sinceISO)}`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    out.push(...(json.orders ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

async function fetchShopifyPayouts(domain: string, token: string, sinceISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/payouts.json?limit=250&date_min=${encodeURIComponent(sinceISO.slice(0, 10))}`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) {
      // Loja sem Shopify Payments habilitado, ou app sem o escopo necessário.
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    }
    const json: any = await res.json();
    out.push(...(json.payouts ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

async function ensureCostCategory(supabase: any, userId: string, shopId: string) {
  const { data } = await supabase.from("shop_cash_categories").select("id")
    .eq("user_id", userId).eq("shop_id", shopId).eq("kind", "expense").eq("name", COST_CATEGORY).maybeSingle();
  if (data) return;
  await supabase.from("shop_cash_categories").insert({
    user_id: userId, shop_id: shopId, kind: "expense", name: COST_CATEGORY, position: 999,
  });
}

async function unitCostFor(supabase: any, userId: string, shopId: string, date: string, fallback: number) {
  const { data } = await supabase.from("shop_product_cost_history").select("unit_cost,valid_from,valid_to")
    .eq("user_id", userId).eq("shop_id", shopId)
    .or(`valid_from.is.null,valid_from.lte.${date}`)
    .order("valid_from", { ascending: false, nullsFirst: false });
  for (const r of data ?? []) {
    const okFrom = !r.valid_from || r.valid_from <= date;
    const okTo = !r.valid_to || r.valid_to >= date;
    if (okFrom && okTo) return Number(r.unit_cost);
  }
  return Number(fallback ?? 0);
}

// ---------- Settings ----------
export const getOrderSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      const { data: ins, error: insErr } = await context.supabase.from("shop_order_settings").insert({
        user_id: context.userId, shop_id: data.shop_id,
      }).select().single();
      if (insErr) throw new Error(insErr.message);
      return ins;
    }
    return row;
  });

export const upsertOrderSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    patch: z.object({
      processing_delay_days: z.number().int().min(0).max(60).optional(),
      automation_enabled: z.boolean().optional(),
      default_unit_cost: z.number().min(0).optional(),
      shopify_store_id: z.string().uuid().nullable().optional(),
      linked_product_id: z.string().nullable().optional(),
      cashflow_start_date: z.string().nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_order_settings")
      .update(data.patch).eq("user_id", context.userId).eq("shop_id", data.shop_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listShopifyStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("shopify_stores")
      .select("id,name,shop_domain").eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

function normalizeShopDomain(input: string) {
  let d = input.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  if (!d.includes(".")) d = `${d}.myshopify.com`;
  return d;
}

function resolveAppOrigin(): string {
  const explicit = process.env.SHOPIFY_REDIRECT_ORIGIN;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (process.env.VERCEL_ENV === "production") return "https://lojas-one.vercel.app";
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
}

export const startShopifyOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().trim().min(1).max(100),
    shop_domain: z.string().trim().min(3).max(200),
    client_id: z.string().trim().min(5).max(200),
    client_secret: z.string().trim().min(5).max(500),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const domain = normalizeShopDomain(data.shop_domain);
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(domain)) {
      throw new Error("Domínio inválido. Use formato loja.myshopify.com");
    }
    const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabaseAdmin.from("shopify_oauth_states").insert({
      user_id: context.userId,
      name: data.name,
      shop_domain: domain,
      state,
      client_id: data.client_id,
      client_secret: data.client_secret,
    });
    if (error) throw new Error(error.message);
    const scopes = "read_orders,read_products,read_shopify_payments_payouts";
    const redirectUri = `${resolveAppOrigin()}/api/public/shopify/callback`;
    const url = `https://${domain}/admin/oauth/authorize?client_id=${encodeURIComponent(data.client_id)}` +
      `&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;
    return { url };
  });


export const connectShopifyStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().trim().min(1).max(100),
    shop_domain: z.string().trim().min(3).max(200),
    access_token: z.string().trim().min(5).max(500),
    client_id: z.string().trim().max(200).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    // Normalize domain (strip protocol/trailing slashes)
    let domain = data.shop_domain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    if (!domain.includes(".")) domain = `${domain}.myshopify.com`;

    // Validate credentials by calling Shopify
    const res = await fetch(`https://${domain}/admin/api/2024-10/shop.json`, {
      headers: { "X-Shopify-Access-Token": data.access_token, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Falha ao conectar (${res.status}): verifique domínio e token`);
    }

    // Upsert by (user_id, shop_domain): try update first, else insert
    const { data: existing } = await context.supabase.from("shopify_stores")
      .select("id").eq("user_id", context.userId).eq("shop_domain", domain).maybeSingle();

    const payload = {
      name: data.name,
      shop_domain: domain,
      access_token: data.access_token,
      scope: data.client_id ?? null,
      installed_at: new Date().toISOString(),
      last_sync_status: "ok" as const,
      last_sync_error: null,
    };

    if (existing) {
      const { data: row, error } = await supabaseAdmin.from("shopify_stores")
        .update(payload).eq("id", existing.id).eq("user_id", context.userId)
        .select("id,name,shop_domain").single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabaseAdmin.from("shopify_stores")
      .insert({ user_id: context.userId, ...payload })
      .select("id,name,shop_domain").single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- Orders ----------
export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    from: z.string(),
    to: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase.from("shop_orders").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .gte("order_date", data.from).lte("order_date", data.to)
      .order("created_at_shopify", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const syncShopifyOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    since_days: z.number().int().min(1).max(90).default(30),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
    if (!settings?.shopify_store_id) throw new Error("Vincule uma loja Shopify nas configurações");

    const { domain, token } = await getShopifyCreds(context.supabase, context.userId, settings.shopify_store_id);
    const since = new Date(); since.setUTCDate(since.getUTCDate() - data.since_days);
    const orders = await fetchShopifyOrders(domain, token, since.toISOString());

    if (orders.length) {
      const rows = orders.map((o: any) => {
        const items = (o.line_items ?? []).reduce((s: number, li: any) => s + Number(li.quantity ?? 0), 0);
        return {
          user_id: context.userId,
          shop_id: data.shop_id,
          source: "shopify",
          external_id: String(o.id),
          order_number: o.name ?? null,
          created_at_shopify: o.created_at,
          order_date: (o.created_at as string).slice(0, 10),
          items_count: items,
          revenue: Number(o.total_price ?? 0),
          currency: o.currency ?? null,
          raw: o,
        };
      });
      const { error } = await context.supabase.from("shop_orders")
        .upsert(rows, { onConflict: "shop_id,source,external_id" });
      if (error) throw new Error(error.message);

      // Auto-pull tracking from Shopify fulfillments
      const { data: dbOrders } = await context.supabase.from("shop_orders")
        .select("id,external_id")
        .eq("user_id", context.userId).eq("shop_id", data.shop_id)
        .eq("source", "shopify")
        .in("external_id", orders.map((o: any) => String(o.id)));
      const orderIdByExt = new Map((dbOrders ?? []).map((r: any) => [r.external_id, r.id]));

      const trackingRows: any[] = [];
      for (const o of orders) {
        const orderId = orderIdByExt.get(String(o.id));
        if (!orderId) continue;
        const fulfillments = (o.fulfillments ?? []) as any[];
        // pick latest fulfillment with a tracking number
        const fWithTrack = [...fulfillments]
          .reverse()
          .find((f) => f.tracking_number || (f.tracking_numbers && f.tracking_numbers.length));
        if (!fWithTrack) continue;
        const trackingNumber = fWithTrack.tracking_number ?? fWithTrack.tracking_numbers?.[0] ?? null;
        if (!trackingNumber) continue;
        trackingRows.push({
          user_id: context.userId,
          shop_id: data.shop_id,
          order_id: orderId,
          tracking_number: String(trackingNumber),
          carrier: fWithTrack.tracking_company ?? null,
        });
      }
      if (trackingRows.length) {
        await context.supabase.from("shop_order_tracking")
          .upsert(trackingRows, { onConflict: "order_id" });
      }
    }


    // Mark sync
    await context.supabase.from("shopify_stores").update({
      last_sync_at: new Date().toISOString(), last_sync_status: "ok", last_sync_error: null,
    }).eq("id", settings.shopify_store_id).eq("user_id", context.userId);

    // Recompute processing entries that depend on the synced orders.
    // Orders from order_date D project to processing_date D+7. Sync covers
    // the last `since_days`, so processing dates from (today - since_days + delay)
    // up to (today + delay) may have changed.
    const today = isoDate(new Date());
    const { data: settingsFull } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
    const fromProc = addDays(today, -data.since_days + PROCESSING_DELAY_DAYS);
    const toProc = addDays(today, PROCESSING_DELAY_DAYS);
    const days: string[] = [];
    let cur = fromProc;
    while (cur <= toProc && days.length < 200) { days.push(cur); cur = addDays(cur, 1); }
    const CHUNK = 10;
    for (let i = 0; i < days.length; i += CHUNK) {
      await Promise.all(days.slice(i, i + CHUNK).map((d) => recomputeForShop(context, data.shop_id, d, settingsFull)));
    }
    return { synced: orders.length };
  });

// ---------- Shopify Payments payouts (entradas no caixa) ----------
const PAYOUT_CATEGORY = "Depósito Shopify";
const PAYOUT_STATUS_LABEL: Record<string, string> = {
  paid: "depositado",
  in_transit: "em trânsito",
  scheduled: "agendado",
};

export const syncShopifyPayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    since_days: z.number().int().min(1).max(365).default(60),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
    if (!settings?.shopify_store_id) throw new Error("Vincule uma loja Shopify nas configurações");

    const { domain, token } = await getShopifyCreds(context.supabase, context.userId, settings.shopify_store_id);
    const since = new Date(); since.setUTCDate(since.getUTCDate() - data.since_days);
    const payouts = await fetchShopifyPayouts(domain, token, since.toISOString());
    const relevant = payouts.filter((p: any) => p.id != null && ["paid", "in_transit", "scheduled"].includes(p.status));

    // Migração única: remove lançamentos de "Depósito Shopify" feitos manualmente
    // (importação de planilha) para que a sincronização automática vire a fonte da verdade.
    await context.supabase.from("shop_cash_entries").delete()
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .eq("category", PAYOUT_CATEGORY).is("shopify_payout_id", null);
    await context.supabase.from("shop_cash_imports")
      .delete().eq("user_id", context.userId).eq("shop_id", data.shop_id);

    if (!relevant.length) return { synced: 0 };

    const { data: existing } = await context.supabase.from("shop_cash_entries")
      .select("id,shopify_payout_id")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .in("shopify_payout_id", relevant.map((p: any) => String(p.id)));
    const existingById = new Map((existing ?? []).map((r: any) => [r.shopify_payout_id, r.id]));

    const toInsert = relevant.filter((p: any) => !existingById.has(String(p.id))).map((p: any) => ({
      user_id: context.userId,
      shop_id: data.shop_id,
      kind: "income" as const,
      amount: Number(p.amount ?? 0),
      date: p.date,
      category: PAYOUT_CATEGORY,
      description: `Payout Shopify · ${PAYOUT_STATUS_LABEL[p.status] ?? p.status}`,
      source: "shopify_sync",
      shopify_payout_id: String(p.id),
    }));
    if (toInsert.length) {
      const { error } = await context.supabase.from("shop_cash_entries").insert(toInsert);
      if (error) throw new Error(error.message);
    }

    for (const p of relevant) {
      const id = existingById.get(String(p.id));
      if (!id) continue;
      await context.supabase.from("shop_cash_entries").update({
        amount: Number(p.amount ?? 0),
        date: p.date,
        description: `Payout Shopify · ${PAYOUT_STATUS_LABEL[p.status] ?? p.status}`,
      }).eq("id", id).eq("user_id", context.userId);
    }

    return { synced: relevant.length };
  });

// ---------- Recompute ----------
async function recomputeForShop(context: any, shopId: string, processingDate: string, preloadedSettings?: any) {
  let settings = preloadedSettings;
  if (!settings) {
    const { data } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", shopId).maybeSingle();
    settings = data;
  }
  if (!settings) return { skipped: true };

  const orderDate = addDays(processingDate, -PROCESSING_DELAY_DAYS);

  // existing manual override?
  const { data: existing } = await context.supabase.from("shop_cash_entries").select("*")
    .eq("user_id", context.userId).eq("shop_id", shopId)
    .eq("auto_kind", "order_cost").eq("auto_ref_date", orderDate).maybeSingle();
  if (existing && existing.source === "manual_override") return { kept: true };

  // Cashflow cutoff: if order is older than the configured start date, skip and clean any existing auto entry.
  const cutoff: string | null = settings.cashflow_start_date ?? null;
  if (cutoff && orderDate < cutoff) {
    if (existing) {
      await context.supabase.from("shop_cash_entries").delete()
        .eq("id", existing.id).eq("user_id", context.userId);
    }
    return { skippedByCutoff: true };
  }

  // sum items for orderDate — apenas pedidos pendentes (pagos já saíram via lote)
  const { data: orders } = await context.supabase.from("shop_orders").select("items_count,payment_status")
    .eq("user_id", context.userId).eq("shop_id", shopId).eq("order_date", orderDate)
    .eq("payment_status", "pending");
  const items = (orders ?? []).reduce((s: number, o: any) => s + Number(o.items_count ?? 0), 0);
  const unit = await unitCostFor(context.supabase, context.userId, shopId, orderDate, settings.default_unit_cost);
  const amount = items * unit;

  await ensureCostCategory(context.supabase, context.userId, shopId);

  if (existing) {
    if (amount <= 0) {
      await context.supabase.from("shop_cash_entries").delete()
        .eq("id", existing.id).eq("user_id", context.userId);
    } else {
      await context.supabase.from("shop_cash_entries").update({
        amount, date: processingDate, description: `${items} itens × ${unit}`,
      }).eq("id", existing.id).eq("user_id", context.userId);
    }
  } else if (amount > 0) {
    await context.supabase.from("shop_cash_entries").insert({
      user_id: context.userId, shop_id: shopId,
      kind: "expense", amount, date: processingDate,
      category: COST_CATEGORY,
      description: `${items} itens × ${unit}`,
      source: "auto", auto_kind: "order_cost", auto_ref_date: orderDate,
    });
  }
  return { items, unit, amount, orderDate, processingDate };
}

export const recomputeDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    processing_date: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    return await recomputeForShop(context, data.shop_id, data.processing_date);
  });

export const recomputeRange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    from_processing: z.string(),
    to_processing: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
    const days: string[] = [];
    let cur = data.from_processing;
    while (cur <= data.to_processing && days.length < 366) { days.push(cur); cur = addDays(cur, 1); }
    const CHUNK = 10;
    for (let i = 0; i < days.length; i += CHUNK) {
      await Promise.all(days.slice(i, i + CHUNK).map((d) => recomputeForShop(context, data.shop_id, d, settings)));
    }
    return { days: days.length };
  });

// ---------- Cost editing ----------
export const updateUnitCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    new_cost: z.number().min(0),
    mode: z.enum(["forward", "all", "range"]),
    from: z.string().optional(),
    to: z.string().optional(),
    note: z.string().max(200).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const today = isoDate(new Date());
    if (data.mode === "all") {
      await context.supabase.from("shop_product_cost_history")
        .delete().eq("user_id", context.userId).eq("shop_id", data.shop_id);
      await context.supabase.from("shop_product_cost_history").insert({
        user_id: context.userId, shop_id: data.shop_id,
        unit_cost: data.new_cost, valid_from: null, valid_to: null, note: data.note ?? "Recálculo total",
      });
      await context.supabase.from("shop_order_settings").update({ default_unit_cost: data.new_cost })
        .eq("user_id", context.userId).eq("shop_id", data.shop_id);
      // recompute last 90 days (parallel in chunks)
      const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
        .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
      const days: string[] = [];
      let cur = addDays(today, -90);
      while (cur <= today && days.length < 200) { days.push(cur); cur = addDays(cur, 1); }
      const CHUNK = 10;
      for (let i = 0; i < days.length; i += CHUNK) {
        await Promise.all(days.slice(i, i + CHUNK).map((d) => recomputeForShop(context, data.shop_id, d, settings)));
      }
      return { ok: true };
    }
    if (data.mode === "forward") {
      // close any open-ended segment
      await context.supabase.from("shop_product_cost_history")
        .update({ valid_to: addDays(today, -1) })
        .eq("user_id", context.userId).eq("shop_id", data.shop_id).is("valid_to", null);
      await context.supabase.from("shop_product_cost_history").insert({
        user_id: context.userId, shop_id: data.shop_id,
        unit_cost: data.new_cost, valid_from: today, valid_to: null, note: data.note ?? "A partir de hoje",
      });
      await context.supabase.from("shop_order_settings").update({ default_unit_cost: data.new_cost })
        .eq("user_id", context.userId).eq("shop_id", data.shop_id);
      // recompute today + future entries existing
      await recomputeForShop(context, data.shop_id, today);
      return { ok: true };
    }
    // range
    if (!data.from || !data.to) throw new Error("Período obrigatório para modo intervalo");
    await context.supabase.from("shop_product_cost_history").insert({
      user_id: context.userId, shop_id: data.shop_id,
      unit_cost: data.new_cost, valid_from: data.from, valid_to: data.to, note: data.note ?? `Intervalo ${data.from}–${data.to}`,
    });
    // recompute the corresponding processing dates: order_date in [from,to] → processing = order_date + delay
    const delay = PROCESSING_DELAY_DAYS;
    const procFrom = addDays(data.from, delay);
    const procTo = addDays(data.to, delay);
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
    const days: string[] = [];
    let cur = procFrom;
    while (cur <= procTo && days.length < 200) { days.push(cur); cur = addDays(cur, 1); }
    const CHUNK = 10;
    for (let i = 0; i < days.length; i += CHUNK) {
      await Promise.all(days.slice(i, i + CHUNK).map((d) => recomputeForShop(context, data.shop_id, d, settings)));
    }
    return { ok: true };
  });

export const setManualOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    processing_date: z.string(),
    amount: z.number().min(0),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const orderDate = addDays(data.processing_date, -PROCESSING_DELAY_DAYS);
    await ensureCostCategory(context.supabase, context.userId, data.shop_id);
    const { data: existing } = await context.supabase.from("shop_cash_entries").select("id")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .eq("auto_kind", "order_cost").eq("auto_ref_date", orderDate).maybeSingle();
    if (existing) {
      await context.supabase.from("shop_cash_entries").update({
        amount: data.amount, source: "manual_override", date: data.processing_date,
      }).eq("id", existing.id).eq("user_id", context.userId);
    } else {
      await context.supabase.from("shop_cash_entries").insert({
        user_id: context.userId, shop_id: data.shop_id,
        kind: "expense", amount: data.amount, date: data.processing_date,
        category: COST_CATEGORY, description: "Override manual",
        source: "manual_override", auto_kind: "order_cost", auto_ref_date: orderDate,
      });
    }
    return { ok: true };
  });

export const clearManualOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    processing_date: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const orderDate = addDays(data.processing_date, -PROCESSING_DELAY_DAYS);
    await context.supabase.from("shop_cash_entries").delete()
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .eq("auto_kind", "order_cost").eq("auto_ref_date", orderDate);
    await recomputeForShop(context, data.shop_id, data.processing_date);
    return { ok: true };
  });

export const listCostHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase.from("shop_product_cost_history")
      .select("*").eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- Operational status: pay & ship ----------

async function nextBatchNumber(context: any, shopId: string): Promise<number> {
  const { data } = await context.supabase.from("shop_order_payment_batches")
    .select("batch_number")
    .eq("user_id", context.userId).eq("shop_id", shopId)
    .order("batch_number", { ascending: false }).limit(1).maybeSingle();
  return ((data?.batch_number as number | undefined) ?? 0) + 1;
}

export const markOrdersPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    order_ids: z.array(z.string().uuid()).min(1).max(2000),
    payment_date: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    // Fetch pending orders only
    const { data: orders, error } = await context.supabase.from("shop_orders")
      .select("id,order_date,items_count,payment_status")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .in("id", data.order_ids).eq("payment_status", "pending");
    if (error) throw new Error(error.message);
    if (!orders || orders.length === 0) throw new Error("Nenhum pedido pendente selecionado");

    // Settings (for default cost)
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
    const defaultCost = Number(settings?.default_unit_cost ?? 0);

    // Compute totals by order_date with the cost in effect
    const dates = Array.from(new Set(orders.map((o) => o.order_date as string)));
    const costByDate = new Map<string, number>();
    for (const d of dates) {
      costByDate.set(d, await unitCostFor(context.supabase, context.userId, data.shop_id, d, defaultCost));
    }
    let totalItems = 0;
    let totalAmount = 0;
    for (const o of orders) {
      const items = Number(o.items_count ?? 0);
      totalItems += items;
      totalAmount += items * (costByDate.get(o.order_date as string) ?? defaultCost);
    }

    await ensureCostCategory(context.supabase, context.userId, data.shop_id);

    // Create batch
    const batchNumber = await nextBatchNumber(context, data.shop_id);
    const sortedDates = [...dates].sort();
    const desc = sortedDates.length === 1
      ? `Lote #${batchNumber} · ${sortedDates[0]}`
      : `Lote #${batchNumber} · ${sortedDates[0]} – ${sortedDates[sortedDates.length - 1]}`;

    const { data: batch, error: bErr } = await context.supabase.from("shop_order_payment_batches")
      .insert({
        user_id: context.userId, shop_id: data.shop_id,
        batch_number: batchNumber,
        payment_date: data.payment_date,
        total_amount: totalAmount,
        total_items: totalItems,
        total_orders: orders.length,
        order_dates: sortedDates,
        description: desc,
      }).select("id").single();
    if (bErr) throw new Error(bErr.message);

    // Create cash entry (1 per batch). Não usar auto_kind/auto_ref_date aqui
    // pois há índice único (shop_id, auto_kind, auto_ref_date) que impede
    // múltiplos lotes pagos no mesmo dia. O vínculo é feito via cash_entry_id no batch.
    const { data: cashRow, error: cErr } = await context.supabase.from("shop_cash_entries").insert({
      user_id: context.userId, shop_id: data.shop_id,
      kind: "expense", amount: totalAmount, date: data.payment_date,
      category: COST_CATEGORY,
      description: `${desc} · ${totalItems} itens · ${orders.length} pedidos`,
      source: "auto",
    }).select("id").single();
    if (cErr) {
      // Cleanup orphan batch
      await context.supabase.from("shop_order_payment_batches").delete()
        .eq("id", batch.id).eq("user_id", context.userId);
      throw new Error(cErr.message);
    }

    // Link entry to batch
    await context.supabase.from("shop_order_payment_batches")
      .update({ cash_entry_id: cashRow.id })
      .eq("id", batch.id).eq("user_id", context.userId);

    // Update orders → paid
    await context.supabase.from("shop_orders").update({
      payment_status: "paid",
      payment_batch_id: batch.id,
      paid_at: data.payment_date,
    }).in("id", orders.map((o) => o.id)).eq("user_id", context.userId);

    // Recompute affected processing days (D+7) so previsões somem/reduzam
    for (const d of dates) {
      await recomputeForShop(context, data.shop_id, addDays(d, PROCESSING_DELAY_DAYS), settings);
    }

    return { batch_id: batch.id, batch_number: batchNumber, total_amount: totalAmount, total_items: totalItems, total_orders: orders.length };
  });

export const markOrdersShipped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    order_ids: z.array(z.string().uuid()).min(1).max(5000),
    shipped_date: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    // Only paid orders can ship
    const { error } = await context.supabase.from("shop_orders").update({
      payment_status: "shipped",
      shipped_at: data.shipped_date,
    }).in("id", data.order_ids)
      .eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .in("payment_status", ["paid"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const undoOrderPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    batch_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: batch } = await context.supabase.from("shop_order_payment_batches")
      .select("*").eq("id", data.batch_id).eq("user_id", context.userId).maybeSingle();
    if (!batch) throw new Error("Lote não encontrado");

    // Revert orders → pending (only those still paid, never re-open shipped)
    await context.supabase.from("shop_orders").update({
      payment_status: "pending", payment_batch_id: null, paid_at: null,
    }).eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .eq("payment_batch_id", data.batch_id).eq("payment_status", "paid");

    // Delete cash entry
    if (batch.cash_entry_id) {
      await context.supabase.from("shop_cash_entries").delete()
        .eq("id", batch.cash_entry_id).eq("user_id", context.userId);
    }

    // Delete batch
    await context.supabase.from("shop_order_payment_batches").delete()
      .eq("id", data.batch_id).eq("user_id", context.userId);

    // Recompute affected days
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.userId).eq("shop_id", data.shop_id).maybeSingle();
    for (const d of (batch.order_dates as string[]) ?? []) {
      await recomputeForShop(context, data.shop_id, addDays(d, PROCESSING_DELAY_DAYS), settings);
    }
    return { ok: true };
  });

export const listPaymentBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase.from("shop_order_payment_batches")
      .select("*").eq("user_id", context.userId).eq("shop_id", data.shop_id)
      .order("batch_number", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

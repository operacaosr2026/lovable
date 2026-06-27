import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const COST_CATEGORY = "Fornecedor";
const PROCESSING_DELAY_DAYS = 7;

// ---------- Helpers ----------
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}
function daysBetween(from: string, to: string) {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400_000);
}

// access_token is no longer readable by the user role (column SELECT was revoked).
// Use the admin client and scope strictly by user_id to keep authorization correct.
async function getShopifyCreds(_supabase: any, ownerId: string, shopify_store_id: string) {
  const { data, error } = await supabaseAdmin
    .from("shopify_stores")
    .select("shop_domain,access_token,iana_timezone")
    .eq("user_id", ownerId)
    .eq("id", shopify_store_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Loja Shopify não encontrada");
  if (!data.access_token) throw new Error("Loja Shopify sem access_token");
  return { domain: data.shop_domain as string, token: data.access_token as string, ianaTimezone: data.iana_timezone as string | null };
}

function shopifyLocalDate(created_at: string, ianaTimezone: string | null): string {
  if (!ianaTimezone) return created_at.slice(0, 10);
  try {
    return new Date(created_at).toLocaleDateString("en-CA", { timeZone: ianaTimezone });
  } catch {
    return created_at.slice(0, 10);
  }
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

async function fetchShopifyBalanceTransactions(domain: string, token: string, maxPages: number) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/balance/transactions.json?limit=250`;
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) {
      // Loja sem Shopify Payments habilitado, ou app sem o escopo necessário.
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    }
    const json: any = await res.json();
    out.push(...(json.transactions ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

async function fetchShopifyDisputes(domain: string, token: string, sinceISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/disputes.json?limit=250&initiated_at_min=${encodeURIComponent(sinceISO)}`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) {
      // Loja sem Shopify Payments habilitado, ou app sem o escopo necessário.
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    }
    const json: any = await res.json();
    out.push(...(json.disputes ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  return out;
}

async function fetchShopifyOrdersCount(domain: string, token: string, sinceISO: string) {
  const url = `https://${domain}/admin/api/2024-10/orders/count.json?financial_status=paid&status=any&created_at_min=${encodeURIComponent(sinceISO)}`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return Number(json.count ?? 0);
}

async function fetchShopifyPaymentsBalance(domain: string, token: string) {
  const url = `https://${domain}/admin/api/2024-10/shopify_payments/balance.json`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
  if (!res.ok) {
    // Loja sem Shopify Payments habilitado, ou app sem o escopo necessário.
    if (res.status === 404 || res.status === 403) return null;
    throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  }
  const json: any = await res.json();
  const balances: any[] = json.balance ?? [];
  if (balances.length === 0) return null;
  const total = balances.reduce((s, b) => s + Number(b.amount ?? 0), 0);
  return { amount: total, currency: balances[0]?.currency ?? null };
}

async function ensureCostCategory(supabase: any, ownerId: string, shopId: string) {
  const { data } = await supabase.from("shop_cash_categories").select("id")
    .eq("user_id", ownerId).eq("shop_id", shopId).eq("kind", "expense").eq("name", COST_CATEGORY).maybeSingle();
  if (data) return;
  await supabase.from("shop_cash_categories").insert({
    user_id: ownerId, shop_id: shopId, kind: "expense", name: COST_CATEGORY, position: 999,
  });
}

async function unitCostFor(supabase: any, ownerId: string, shopId: string, date: string, fallback: number) {
  const { data } = await supabase.from("shop_product_cost_history").select("unit_cost,valid_from,valid_to")
    .eq("user_id", ownerId).eq("shop_id", shopId)
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
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      const { data: ins, error: insErr } = await context.supabase.from("shop_order_settings").insert({
        user_id: context.ownerId, shop_id: data.shop_id,
      }).select().single();
      if (insErr) throw new Error(insErr.message);
      return ins;
    }
    return row;
  });

export const upsertOrderSettings = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
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
      .upsert({ user_id: context.ownerId, shop_id: data.shop_id, ...data.patch }, { onConflict: "user_id,shop_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listShopifyStores = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("shopify_stores")
      .select("id,name,shop_domain").eq("user_id", context.ownerId);
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
  .middleware([requireOwnerContext])
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
      user_id: context.ownerId,
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
  .middleware([requireOwnerContext])
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

    // Validate credentials and fetch store metadata (including timezone)
    const res = await fetch(`https://${domain}/admin/api/2024-10/shop.json`, {
      headers: { "X-Shopify-Access-Token": data.access_token, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Falha ao conectar (${res.status}): verifique domínio e token`);
    }
    const shopJson: any = await res.json();
    const ianaTimezone: string | null = shopJson?.shop?.iana_timezone ?? null;

    // Upsert by (user_id, shop_domain): try update first, else insert
    const { data: existing } = await context.supabase.from("shopify_stores")
      .select("id").eq("user_id", context.ownerId).eq("shop_domain", domain).maybeSingle();

    const payload = {
      name: data.name,
      shop_domain: domain,
      access_token: data.access_token,
      scope: data.client_id ?? null,
      installed_at: new Date().toISOString(),
      last_sync_status: "ok" as const,
      last_sync_error: null,
      iana_timezone: ianaTimezone,
    };

    if (existing) {
      const { data: row, error } = await supabaseAdmin.from("shopify_stores")
        .update(payload).eq("id", existing.id).eq("user_id", context.ownerId)
        .select("id,name,shop_domain").single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabaseAdmin.from("shopify_stores")
      .insert({ user_id: context.ownerId, ...payload })
      .select("id,name,shop_domain").single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- Orders ----------
export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_ids: z.array(z.string().uuid()).min(1),
    from: z.string(),
    to: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase.from("shop_orders").select("*")
      .eq("user_id", context.ownerId).in("shop_id", data.shop_ids)
      .gte("order_date", data.from).lte("order_date", data.to)
      .order("created_at_shopify", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const syncOrderPaymentTasks = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: pending, error } = await context.supabase.from("shop_orders")
      .select("order_date,items_count")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("payment_status", "pending");
    if (error) throw new Error(error.message);
    if (!pending || pending.length === 0) return { created: 0 };

    const byDate = new Map<string, number>();
    for (const o of pending) {
      byDate.set(o.order_date as string, (byDate.get(o.order_date as string) ?? 0) + Number(o.items_count ?? 0));
    }
    if (byDate.size === 0) return { created: 0 };

    const { data: existing } = await context.supabase.from("shop_tasks")
      .select("source_ref")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("source", "order_payment")
      .in("source_ref", Array.from(byDate.keys()));
    const existingRefs = new Set((existing ?? []).map((r: any) => r.source_ref));

    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    const defaultCost = Number(settings?.default_unit_cost ?? 0);

    let created = 0;
    for (const [date, items] of byDate.entries()) {
      if (existingRefs.has(date)) continue;
      const cost = await unitCostFor(context.supabase, context.ownerId, data.shop_id, date, defaultCost);
      const total = items * cost;
      const dueAt = `${addDays(date, PROCESSING_DELAY_DAYS)}T12:00:00.000Z`;
      const dateLabel = `${date.slice(8, 10)}/${date.slice(5, 7)}`;
      const { data: top } = await context.supabase.from("shop_tasks").select("position")
        .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).eq("status", "todo")
        .order("position", { ascending: true }).limit(1).maybeSingle();
      const position = (top?.position ?? 0) - 1;
      const { error: insErr } = await context.supabase.from("shop_tasks").insert({
        user_id: context.ownerId, shop_id: data.shop_id,
        title: `Pagar fornecedor · pedidos de ${dateLabel}`,
        description: `${items} itens · ${total.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
        status: "todo",
        priority: "alta",
        due_at: dueAt,
        position,
        source: "order_payment",
        source_ref: date,
      });
      if (!insErr) created++;
    }
    return { created };
  });

export const syncShopifyOrders = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    since_days: z.number().int().min(1).max(90).optional(),
    since_date: z.string().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!settings?.shopify_store_id) throw new Error("Vincule uma loja Shopify nas configurações");

    const { domain, token, ianaTimezone } = await getShopifyCreds(context.supabase, context.ownerId, settings.shopify_store_id);
    const todayForSince = isoDate(new Date());
    const sinceDateStr = data.since_date ?? addDays(todayForSince, -(data.since_days ?? 30));
    const sinceDays = Math.max(1, Math.min(90, daysBetween(sinceDateStr, todayForSince)));
    const orders = await fetchShopifyOrders(domain, token, `${sinceDateStr}T00:00:00.000Z`);

    if (orders.length) {
      const rows = orders.map((o: any) => {
        const items = (o.line_items ?? []).reduce((s: number, li: any) => s + Number(li.quantity ?? 0), 0);
        return {
          user_id: context.ownerId,
          shop_id: data.shop_id,
          source: "shopify",
          external_id: String(o.id),
          order_number: o.name ?? null,
          created_at_shopify: o.created_at,
          order_date: shopifyLocalDate(o.created_at as string, ianaTimezone),
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
        .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
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
          user_id: context.ownerId,
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
    }).eq("id", settings.shopify_store_id).eq("user_id", context.ownerId);

    // Recompute processing entries that depend on the synced orders.
    // Orders from order_date D project to processing_date D+7. Sync covers
    // the last `since_days`, so processing dates from (today - since_days + delay)
    // up to (today + delay) may have changed.
    const today = isoDate(new Date());
    const { data: settingsFull } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    const fromProc = addDays(today, -sinceDays + PROCESSING_DELAY_DAYS);
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
  pending: "previsto",
};

export const syncShopifyPayouts = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    since_days: z.number().int().min(1).max(365).default(60),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!settings?.shopify_store_id) throw new Error("Vincule uma loja Shopify nas configurações");

    const { domain, token } = await getShopifyCreds(context.supabase, context.ownerId, settings.shopify_store_id);
    const since = new Date(); since.setUTCDate(since.getUTCDate() - data.since_days);
    const payouts = await fetchShopifyPayouts(domain, token, since.toISOString());
    const relevant = payouts.filter((p: any) => p.id != null && ["paid", "in_transit", "scheduled", "pending"].includes(p.status));

    // Migração única: remove lançamentos de "Depósito Shopify" feitos manualmente
    // (importação de planilha) para que a sincronização automática vire a fonte da verdade.
    await context.supabase.from("shop_cash_entries").delete()
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("category", PAYOUT_CATEGORY).is("shopify_payout_id", null);
    await context.supabase.from("shop_cash_imports")
      .delete().eq("user_id", context.ownerId).eq("shop_id", data.shop_id);

    if (!relevant.length) return { synced: 0 };

    const { data: existing } = await context.supabase.from("shop_cash_entries")
      .select("id,shopify_payout_id")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .in("shopify_payout_id", relevant.map((p: any) => String(p.id)));
    const existingById = new Map((existing ?? []).map((r: any) => [r.shopify_payout_id, r.id]));

    const toInsert = relevant.filter((p: any) => !existingById.has(String(p.id))).map((p: any) => ({
      user_id: context.ownerId,
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
      }).eq("id", id).eq("user_id", context.ownerId);
    }

    // ---------- Transações pendentes ----------
    // Usa payout_id da transação para buscar a data real do payout quando disponível.
    // Para transações sem payout ainda, estima com o período manual (payout_lag_days),
    // fallback para o lag calculado automaticamente, ou D+7 se nenhum disponível.
    const lagDays = settings.payout_lag_days != null
      ? Number(settings.payout_lag_days)
      : settings.payout_lag_avg_days != null
        ? Math.round(Number(settings.payout_lag_avg_days))
        : 7;

    // Mapa payout_id → date a partir dos payouts já buscados
    const payoutDateById = new Map(payouts.map((p: any) => [String(p.id), p.date as string]));

    const transactions = await fetchShopifyBalanceTransactions(domain, token, 3);
    // Exclui transações cujo payout já foi sincronizado como entrada real (in_transit, scheduled, paid)
    const pendingTx = transactions.filter((t: any) =>
      t.payout_status === "pending" &&
      (t.payout_id == null || !payoutDateById.has(String(t.payout_id)))
    );

    // Remove provisórios antigos e recria com dados atuais
    await context.supabase.from("shop_cash_entries").delete()
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("source", "shopify_pending_sync");

    if (pendingTx.length) {
      const byDate = new Map<string, number>();
      for (const t of pendingTx) {
        // Se a transação já tem um payout_id, usa a data real; senão estima com lag
        const realDate = t.payout_id ? payoutDateById.get(String(t.payout_id)) : null;
        let key: string;
        if (realDate) {
          key = realDate;
        } else {
          const d = new Date(t.processed_at);
          d.setUTCDate(d.getUTCDate() + lagDays);
          key = d.toISOString().slice(0, 10);
        }
        byDate.set(key, (byDate.get(key) ?? 0) + Number(t.net ?? 0));
      }
      const provisionals = Array.from(byDate.entries()).map(([date, amount]) => ({
        user_id: context.ownerId,
        shop_id: data.shop_id,
        kind: "income" as const,
        amount,
        date,
        category: PAYOUT_CATEGORY,
        description: `Payout Shopify · previsto`,
        source: "shopify_pending_sync",
      }));
      await context.supabase.from("shop_cash_entries").insert(provisionals);
    }

    return { synced: relevant.length + pendingTx.length };
  });

// ---------- Shopify Payments — taxas (apenas para KPI, não aparecem no caixa) ----------

const FEES_CATEGORY = "Taxas Shopify";
const FEES_SOURCE   = "shopify_fees_sync";

async function ensureCategory(supabase: any, ownerId: string, shopId: string, kind: "expense" | "income", name: string) {
  const { data } = await supabase.from("shop_cash_categories").select("id")
    .eq("user_id", ownerId).eq("shop_id", shopId).eq("kind", kind).eq("name", name).maybeSingle();
  if (!data) {
    await supabase.from("shop_cash_categories").insert({
      user_id: ownerId, shop_id: shopId, kind, name, position: 999,
    });
  }
}

export const syncShopifyPaymentsFees = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    pages: z.number().int().min(1).max(20).default(8),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, ownerId } = context;
    const { data: settings } = await supabase.from("shop_order_settings").select("*")
      .eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!settings?.shopify_store_id) throw new Error("Vincule uma loja Shopify nas configurações");

    const { domain, token, ianaTimezone } = await getShopifyCreds(supabase, ownerId, settings.shopify_store_id);
    const txs = await fetchShopifyBalanceTransactions(domain, token, data.pages);
    const feeTxs = txs.filter((t: any) => Number(t.fee ?? 0) > 0);
    if (!feeTxs.length) return { synced: 0, total_found: 0 };

    const extIds = feeTxs.map((t: any) => `shopify_fee_${t.id}`);
    const { data: existing } = await supabase.from("shop_cash_entries")
      .select("id,mercury_transaction_id,date")
      .eq("user_id", ownerId).eq("shop_id", data.shop_id)
      .in("mercury_transaction_id", extIds);
    const existingById = new Map((existing ?? []).map((r: any) => [r.mercury_transaction_id, r]));

    const toInsert: any[] = [];
    const toUpdate: { id: string; date: string }[] = [];
    for (const t of feeTxs) {
      const extId = `shopify_fee_${t.id}`;
      const correctDate = shopifyLocalDate(t.processed_at as string, ianaTimezone);
      const ex = existingById.get(extId);
      if (!ex) {
        toInsert.push({
          user_id: ownerId, shop_id: data.shop_id, kind: "expense" as const,
          amount: Math.abs(Number(t.fee)), date: correctDate,
          category: FEES_CATEGORY,
          description: `Taxa Shopify Payments · ${t.type ?? "charge"} #${t.source_id ?? t.id}`,
          source: FEES_SOURCE, mercury_transaction_id: extId,
        });
      } else if (ex.date !== correctDate) {
        toUpdate.push({ id: ex.id, date: correctDate });
      }
    }

    await ensureCategory(supabase, ownerId, data.shop_id, "expense", FEES_CATEGORY);
    if (toInsert.length) {
      const { error } = await supabase.from("shop_cash_entries").insert(toInsert);
      if (error) throw new Error(error.message);
    }
    for (const u of toUpdate) {
      await supabase.from("shop_cash_entries").update({ date: u.date }).eq("id", u.id).eq("user_id", ownerId);
    }

    return { synced: toInsert.length, updated: toUpdate.length, total_found: feeTxs.length };
  });

export const getShopifyPendingBalance = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!settings?.shopify_store_id) return { connected: false, pending: 0, balance: null, currency: null };

    const { domain, token } = await getShopifyCreds(context.supabase, context.ownerId, settings.shopify_store_id);
    const paymentsBalance = await fetchShopifyPaymentsBalance(domain, token);
    const currency = paymentsBalance?.currency ?? null;
    const balance = paymentsBalance?.amount ?? null;

    // Payouts já sincronizados no banco com datas reais da Shopify
    const today = new Date().toISOString().slice(0, 10);
    const { data: upcomingEntries } = await context.supabase.from("shop_cash_entries")
      .select("shopify_payout_id,date,amount")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("source", "shopify_sync")
      .not("shopify_payout_id", "is", null)
      .gte("date", today)
      .order("date", { ascending: true });

    const byDate = new Map<string, number>();
    for (const e of upcomingEntries ?? []) {
      const key = e.date as string;
      byDate.set(key, (byDate.get(key) ?? 0) + Number(e.amount ?? 0));
    }
    const items = Array.from(byDate.entries()).map(([date, amount]) => ({
      id: `shopify-pending-${date}`,
      date,
      amount,
      currency,
    }));
    const pending = items.reduce((s, i) => s + i.amount, 0);

    return { connected: true, pending, balance, currency, items };
  });

// Taxa de chargeback (estorno via banco/cartão) dos últimos 30 dias, igual ao
// relatório "Taxa de estorno" da Shopify (chargebacks / pedidos no período).
export const getShopifyChargebackRate = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!settings?.shopify_store_id) return { connected: false, rate: null };

    const { domain, token } = await getShopifyCreds(context.supabase, context.ownerId, settings.shopify_store_id);
    const since = new Date(); since.setUTCDate(since.getUTCDate() - 30);
    const sinceISO = since.toISOString();

    const [disputes, totalOrders] = await Promise.all([
      fetchShopifyDisputes(domain, token, sinceISO),
      fetchShopifyOrdersCount(domain, token, sinceISO),
    ]);
    const chargebacks = disputes.filter((d: any) => d.type === "chargeback").length;
    const rate = totalOrders > 0 ? (chargebacks / totalOrders) * 100 : 0;
    return { connected: true, rate, chargebacks, totalOrders };
  });

// Tempo médio de repasse: calculado 1x/dia pela automação (sync-shop-orders cron)
// e guardado em shop_order_settings, para não depender de chamada lenta à Shopify
// a cada carregamento de tela.
export const getShopifyPayoutLag = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings")
      .select("shopify_store_id,payout_lag_avg_days,payout_lag_sample_size,payout_lag_days")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!settings?.shopify_store_id) return { connected: false, avgDays: null, sampleSize: 0, manualDays: null };
    return {
      connected: true,
      avgDays: settings.payout_lag_avg_days != null ? Number(settings.payout_lag_avg_days) : null,
      sampleSize: settings.payout_lag_sample_size ?? 0,
      manualDays: settings.payout_lag_days != null ? Number(settings.payout_lag_days) : null,
    };
  });

export const setPayoutLagDays = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    days: z.number().int().min(1).max(30).nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("shop_order_settings")
      .update({ payout_lag_days: data.days })
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getGroupShopifyPayoutLag = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_ids: z.array(z.string().uuid()).min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows } = await context.supabase.from("shop_order_settings")
      .select("shop_id,shopify_store_id,payout_lag_avg_days,payout_lag_sample_size,payout_lag_days")
      .eq("user_id", context.ownerId).in("shop_id", data.shop_ids);
    return (rows ?? []).map(s => ({
      shop_id: s.shop_id as string,
      connected: Boolean(s.shopify_store_id),
      avgDays: s.payout_lag_avg_days != null ? Number(s.payout_lag_avg_days) : null,
      sampleSize: s.payout_lag_sample_size ?? 0,
      manualDays: s.payout_lag_days != null ? Number(s.payout_lag_days) : null,
    }));
  });

export const getGroupShopifyPendingBalance = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_ids: z.array(z.string().uuid()).min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: entries } = await context.supabase.from("shop_cash_entries")
      .select("shop_id,amount")
      .eq("user_id", context.ownerId)
      .in("shop_id", data.shop_ids)
      .eq("source", "shopify_sync")
      .not("shopify_payout_id", "is", null)
      .gte("date", today);

    const { data: settings } = await context.supabase.from("shop_order_settings")
      .select("shop_id,shopify_store_id")
      .eq("user_id", context.ownerId).in("shop_id", data.shop_ids);

    const connectedIds = new Set((settings ?? []).filter(s => s.shopify_store_id).map(s => s.shop_id));
    const connected = connectedIds.size > 0;

    const byShop = new Map<string, number>();
    for (const e of entries ?? []) {
      const id = e.shop_id as string;
      byShop.set(id, (byShop.get(id) ?? 0) + Number(e.amount ?? 0));
    }
    const pending = Array.from(byShop.values()).reduce((a, b) => a + b, 0);
    const perShop = Array.from(byShop.entries()).map(([shop_id, p]) => ({ shop_id, pending: p }));
    return { connected, pending, perShop };
  });

export const getMonthlyProfit = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_ids: z.array(z.string().uuid()).min(1),
    month_start: z.string(),
    month_end: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, ownerId } = context;
    const { shop_ids, month_start, month_end } = data;

    const { data: orders, error: ordersErr } = await supabase
      .from("shop_orders").select("revenue,order_date,items_count,shop_id")
      .eq("user_id", ownerId).in("shop_id", shop_ids)
      .gte("order_date", month_start).lte("order_date", month_end);
    if (ordersErr) throw new Error(ordersErr.message);
    const sales = (orders ?? []).reduce((s: number, o: any) => s + Number(o.revenue ?? 0), 0);

    const { data: settingsRows } = await supabase.from("shop_order_settings").select("shop_id,default_unit_cost")
      .eq("user_id", ownerId).in("shop_id", shop_ids);
    const costByShop = new Map((settingsRows ?? []).map((r: any) => [r.shop_id, Number(r.default_unit_cost ?? 0)]));
    const configuredCosts = Array.from(costByShop.values()).filter(c => c > 0);
    const avgCost = configuredCosts.length > 0 ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length : 0;

    const productCost = (orders ?? []).reduce((s: number, o: any) => {
      const items = Number(o.items_count ?? 0);
      const shopCost = costByShop.get(o.shop_id);
      return s + items * (shopCost != null && shopCost > 0 ? shopCost : avgCost);
    }, 0);

    const { data: adRows, error: adErr } = await supabase
      .from("shop_cash_entries").select("amount")
      .eq("user_id", ownerId).in("shop_id", shop_ids).eq("kind", "expense").eq("category", "Facebook Ads")
      .gte("date", month_start).lte("date", month_end);
    if (adErr) throw new Error(adErr.message);
    const adSpend = (adRows ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

    return { sales, productCost, adSpend, profit: sales - productCost - adSpend };
  });

// ---------- Recompute ----------
async function recomputeForShop(context: any, shopId: string, processingDate: string, preloadedSettings?: any) {
  let settings = preloadedSettings;
  if (!settings) {
    const { data } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", shopId).maybeSingle();
    settings = data;
  }
  if (!settings) return { skipped: true };

  const orderDate = addDays(processingDate, -PROCESSING_DELAY_DAYS);

  // existing manual override?
  const { data: existing } = await context.supabase.from("shop_cash_entries").select("*")
    .eq("user_id", context.ownerId).eq("shop_id", shopId)
    .eq("auto_kind", "order_cost").eq("auto_ref_date", orderDate).maybeSingle();
  if (existing && existing.source === "manual_override") return { kept: true };

  // Cashflow cutoff: if order is older than the configured start date, skip and clean any existing auto entry.
  const cutoff: string | null = settings.cashflow_start_date ?? null;
  if (cutoff && orderDate < cutoff) {
    if (existing) {
      await context.supabase.from("shop_cash_entries").delete()
        .eq("id", existing.id).eq("user_id", context.ownerId);
    }
    return { skippedByCutoff: true };
  }

  // sum items for orderDate — apenas pedidos pendentes (pagos já saíram via lote)
  const { data: orders } = await context.supabase.from("shop_orders").select("items_count,payment_status")
    .eq("user_id", context.ownerId).eq("shop_id", shopId).eq("order_date", orderDate)
    .eq("payment_status", "pending");
  const items = (orders ?? []).reduce((s: number, o: any) => s + Number(o.items_count ?? 0), 0);
  const unit = await unitCostFor(context.supabase, context.ownerId, shopId, orderDate, settings.default_unit_cost);
  const amount = items * unit;

  await ensureCostCategory(context.supabase, context.ownerId, shopId);

  if (existing) {
    if (amount <= 0) {
      await context.supabase.from("shop_cash_entries").delete()
        .eq("id", existing.id).eq("user_id", context.ownerId);
    } else {
      await context.supabase.from("shop_cash_entries").update({
        amount, date: processingDate, description: `${items} itens × ${unit}`,
      }).eq("id", existing.id).eq("user_id", context.ownerId);
    }
  } else if (amount > 0) {
    await context.supabase.from("shop_cash_entries").insert({
      user_id: context.ownerId, shop_id: shopId,
      kind: "expense", amount, date: processingDate,
      category: COST_CATEGORY,
      description: `${items} itens × ${unit}`,
      source: "auto", auto_kind: "order_cost", auto_ref_date: orderDate,
    });
  }
  return { items, unit, amount, orderDate, processingDate };
}

export const recomputeDay = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    processing_date: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    return await recomputeForShop(context, data.shop_id, data.processing_date);
  });

export const recomputeRange = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    from_processing: z.string(),
    to_processing: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
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
  .middleware([requireOwnerContext])
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
        .delete().eq("user_id", context.ownerId).eq("shop_id", data.shop_id);
      await context.supabase.from("shop_product_cost_history").insert({
        user_id: context.ownerId, shop_id: data.shop_id,
        unit_cost: data.new_cost, valid_from: null, valid_to: null, note: data.note ?? "Recálculo total",
      });
      await context.supabase.from("shop_order_settings").update({ default_unit_cost: data.new_cost })
        .eq("user_id", context.ownerId).eq("shop_id", data.shop_id);
      // recompute last 90 days (parallel in chunks)
      const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
        .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
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
        .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).is("valid_to", null);
      await context.supabase.from("shop_product_cost_history").insert({
        user_id: context.ownerId, shop_id: data.shop_id,
        unit_cost: data.new_cost, valid_from: today, valid_to: null, note: data.note ?? "A partir de hoje",
      });
      await context.supabase.from("shop_order_settings").update({ default_unit_cost: data.new_cost })
        .eq("user_id", context.ownerId).eq("shop_id", data.shop_id);
      // recompute today + future entries existing
      await recomputeForShop(context, data.shop_id, today);
      return { ok: true };
    }
    // range
    if (!data.from || !data.to) throw new Error("Período obrigatório para modo intervalo");
    await context.supabase.from("shop_product_cost_history").insert({
      user_id: context.ownerId, shop_id: data.shop_id,
      unit_cost: data.new_cost, valid_from: data.from, valid_to: data.to, note: data.note ?? `Intervalo ${data.from}–${data.to}`,
    });
    // recompute the corresponding processing dates: order_date in [from,to] → processing = order_date + delay
    const delay = PROCESSING_DELAY_DAYS;
    const procFrom = addDays(data.from, delay);
    const procTo = addDays(data.to, delay);
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
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
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    processing_date: z.string(),
    amount: z.number().min(0),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const orderDate = addDays(data.processing_date, -PROCESSING_DELAY_DAYS);
    await ensureCostCategory(context.supabase, context.ownerId, data.shop_id);
    const { data: existing } = await context.supabase.from("shop_cash_entries").select("id")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("auto_kind", "order_cost").eq("auto_ref_date", orderDate).maybeSingle();
    if (existing) {
      await context.supabase.from("shop_cash_entries").update({
        amount: data.amount, source: "manual_override", date: data.processing_date,
      }).eq("id", existing.id).eq("user_id", context.ownerId);
    } else {
      await context.supabase.from("shop_cash_entries").insert({
        user_id: context.ownerId, shop_id: data.shop_id,
        kind: "expense", amount: data.amount, date: data.processing_date,
        category: COST_CATEGORY, description: "Override manual",
        source: "manual_override", auto_kind: "order_cost", auto_ref_date: orderDate,
      });
    }
    return { ok: true };
  });

export const clearManualOverride = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    processing_date: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const orderDate = addDays(data.processing_date, -PROCESSING_DELAY_DAYS);
    await context.supabase.from("shop_cash_entries").delete()
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("auto_kind", "order_cost").eq("auto_ref_date", orderDate);
    await recomputeForShop(context, data.shop_id, data.processing_date);
    return { ok: true };
  });

export const listCostHistory = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase.from("shop_product_cost_history")
      .select("*").eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- Operational status: pay & ship ----------

async function nextBatchNumber(context: any, shopId: string): Promise<number> {
  const { data } = await context.supabase.from("shop_order_payment_batches")
    .select("batch_number")
    .eq("user_id", context.ownerId).eq("shop_id", shopId)
    .order("batch_number", { ascending: false }).limit(1).maybeSingle();
  return ((data?.batch_number as number | undefined) ?? 0) + 1;
}

export const markOrdersPaid = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    order_ids: z.array(z.string().uuid()).min(1).max(2000),
    payment_date: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    // Fetch pending orders only
    const { data: orders, error } = await context.supabase.from("shop_orders")
      .select("id,order_date,items_count,payment_status")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .in("id", data.order_ids).eq("payment_status", "pending");
    if (error) throw new Error(error.message);
    if (!orders || orders.length === 0) throw new Error("Nenhum pedido pendente selecionado");

    // Settings (for default cost)
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    const defaultCost = Number(settings?.default_unit_cost ?? 0);

    // Compute totals by order_date with the cost in effect
    const dates = Array.from(new Set(orders.map((o) => o.order_date as string)));
    const costByDate = new Map<string, number>();
    for (const d of dates) {
      costByDate.set(d, await unitCostFor(context.supabase, context.ownerId, data.shop_id, d, defaultCost));
    }
    let totalItems = 0;
    let totalAmount = 0;
    for (const o of orders) {
      const items = Number(o.items_count ?? 0);
      totalItems += items;
      totalAmount += items * (costByDate.get(o.order_date as string) ?? defaultCost);
    }

    await ensureCostCategory(context.supabase, context.ownerId, data.shop_id);

    // Create batch
    const batchNumber = await nextBatchNumber(context, data.shop_id);
    const sortedDates = [...dates].sort();
    const desc = sortedDates.length === 1
      ? `Lote #${batchNumber} · ${sortedDates[0]}`
      : `Lote #${batchNumber} · ${sortedDates[0]} – ${sortedDates[sortedDates.length - 1]}`;

    const { data: batch, error: bErr } = await context.supabase.from("shop_order_payment_batches")
      .insert({
        user_id: context.ownerId, shop_id: data.shop_id,
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
      user_id: context.ownerId, shop_id: data.shop_id,
      kind: "expense", amount: totalAmount, date: data.payment_date,
      category: COST_CATEGORY,
      description: `${desc} · ${totalItems} itens · ${orders.length} pedidos`,
      source: "auto",
      reconciled: true,
    }).select("id").single();
    if (cErr) {
      // Cleanup orphan batch
      await context.supabase.from("shop_order_payment_batches").delete()
        .eq("id", batch.id).eq("user_id", context.ownerId);
      throw new Error(cErr.message);
    }

    // Link entry to batch
    await context.supabase.from("shop_order_payment_batches")
      .update({ cash_entry_id: cashRow.id })
      .eq("id", batch.id).eq("user_id", context.ownerId);

    // Update orders → paid
    await context.supabase.from("shop_orders").update({
      payment_status: "paid",
      payment_batch_id: batch.id,
      paid_at: data.payment_date,
    }).in("id", orders.map((o) => o.id)).eq("user_id", context.ownerId);

    // Recompute affected processing days (D+7) so previsões somem/reduzam
    for (const d of dates) {
      await recomputeForShop(context, data.shop_id, addDays(d, PROCESSING_DELAY_DAYS), settings);
    }

    // Complete any auto-generated payment tasks for these order dates
    await context.supabase.from("shop_tasks").update({
      status: "done", done_at: new Date().toISOString(),
    }).eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("source", "order_payment").in("source_ref", dates).neq("status", "done");

    return { batch_id: batch.id, batch_number: batchNumber, total_amount: totalAmount, total_items: totalItems, total_orders: orders.length };
  });

export const markOrdersShipped = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
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
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .in("payment_status", ["paid"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const undoOrderPayment = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    batch_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: batch } = await context.supabase.from("shop_order_payment_batches")
      .select("*").eq("id", data.batch_id).eq("user_id", context.ownerId).maybeSingle();
    if (!batch) throw new Error("Lote não encontrado");

    // Revert orders → pending (only those still paid, never re-open shipped)
    await context.supabase.from("shop_orders").update({
      payment_status: "pending", payment_batch_id: null, paid_at: null,
    }).eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("payment_batch_id", data.batch_id).eq("payment_status", "paid");

    // Delete cash entry
    if (batch.cash_entry_id) {
      await context.supabase.from("shop_cash_entries").delete()
        .eq("id", batch.cash_entry_id).eq("user_id", context.ownerId);
    }

    // Delete batch
    await context.supabase.from("shop_order_payment_batches").delete()
      .eq("id", data.batch_id).eq("user_id", context.ownerId);

    // Recompute affected days
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    for (const d of (batch.order_dates as string[]) ?? []) {
      await recomputeForShop(context, data.shop_id, addDays(d, PROCESSING_DELAY_DAYS), settings);
    }

    // Reopen auto-generated payment tasks for these order dates
    await context.supabase.from("shop_tasks").update({
      status: "todo", done_at: null,
    }).eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .eq("source", "order_payment").in("source_ref", (batch.order_dates as string[]) ?? []);

    return { ok: true };
  });

export const deleteOrders = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_id: z.string().uuid(),
    order_ids: z.array(z.string().uuid()).min(1).max(2000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: orders, error } = await context.supabase.from("shop_orders")
      .select("id,order_date,payment_status")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .in("id", data.order_ids).neq("payment_status", "shipped");
    if (error) throw new Error(error.message);
    if (!orders || orders.length === 0) throw new Error("Nenhum pedido elegível para exclusão (pedidos enviados não podem ser excluídos)");

    const ids = orders.map((o) => o.id);
    await context.supabase.from("shop_order_tracking").delete()
      .eq("user_id", context.ownerId).in("order_id", ids);
    const { error: delErr } = await context.supabase.from("shop_orders").delete()
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).in("id", ids);
    if (delErr) throw new Error(delErr.message);

    const dates = Array.from(new Set(orders.map((o) => o.order_date as string)));
    const { data: settings } = await context.supabase.from("shop_order_settings").select("*")
      .eq("user_id", context.ownerId).eq("shop_id", data.shop_id).maybeSingle();
    for (const d of dates) {
      await recomputeForShop(context, data.shop_id, addDays(d, PROCESSING_DELAY_DAYS), settings);
    }

    return { deleted: ids.length };
  });

export const listPaymentBatches = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ shop_id: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase.from("shop_order_payment_batches")
      .select("*").eq("user_id", context.ownerId).eq("shop_id", data.shop_id)
      .order("batch_number", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- Dashboard Metrics ----------

export const getShopDashboardMetrics = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shop_ids: z.array(z.string().uuid()).min(1),
    from: z.string(),
    to: z.string(),
    prev_from: z.string(),
    prev_to: z.string(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, ownerId } = context;
    const { shop_ids, from, to, prev_from, prev_to } = data;

    const [ordersRes, prevOrdersRes, settingsRes, goalRes, feesRes, prevFeesRes, adsRes, prevAdsRes] = await Promise.all([
      supabase.from("shop_orders").select("revenue,items_count,order_date,shop_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .gte("order_date", from).lte("order_date", to),
      supabase.from("shop_orders").select("revenue,items_count,shop_id")
        .eq("user_id", ownerId).in("shop_id", shop_ids)
        .gte("order_date", prev_from).lte("order_date", prev_to),
      supabase.from("shop_order_settings").select("shop_id,default_unit_cost")
        .eq("user_id", ownerId).in("shop_id", shop_ids),
      supabase.from("shop_profit_goals").select("target_profit,total_revenue,currency")
        .in("shop_id", shop_ids),
      // Taxas Shopify Payments no período (apenas KPI, não aparecem no caixa)
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids).eq("category", "Taxas Shopify")
        .gte("date", from).lte("date", to),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids).eq("category", "Taxas Shopify")
        .gte("date", prev_from).lte("date", prev_to),
      // Gastos de anúncios Meta Ads
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids).eq("category", "Facebook Ads")
        .gte("date", from).lte("date", to),
      supabase.from("shop_cash_entries").select("amount")
        .eq("user_id", ownerId).in("shop_id", shop_ids).eq("category", "Facebook Ads")
        .gte("date", prev_from).lte("date", prev_to),
    ]);

    const orders = ordersRes.data ?? [];
    const prevOrders = prevOrdersRes.data ?? [];
    const costByShop = new Map((settingsRes.data ?? []).map((r: any) => [r.shop_id, Number(r.default_unit_cost ?? 0)]));
    const configuredCosts = Array.from(costByShop.values()).filter(c => c > 0);
    const avgCost = configuredCosts.length > 0 ? configuredCosts.reduce((a, b) => a + b, 0) / configuredCosts.length : 0;
    const unitCost = avgCost;

    // Taxas e anúncios
    const taxas        = (feesRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
    const prevTaxas    = (prevFeesRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
    const anuncios     = (adsRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
    const prevAnuncios = (prevAdsRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

    function orderCost(o: any) {
      const shopCost = costByShop.get((o as any).shop_id);
      return Number(o.items_count ?? 0) * (shopCost != null && shopCost > 0 ? shopCost : avgCost);
    }

    // Current period
    const faturamento  = orders.reduce((s, o) => s + Number(o.revenue ?? 0), 0);
    const pedidos      = orders.length;
    const unidades     = orders.reduce((s, o) => s + Number(o.items_count ?? 0), 0);
    const custoProduto = orders.reduce((s, o) => s + orderCost(o), 0);
    const lucro        = faturamento - custoProduto - taxas - anuncios;
    const margem       = faturamento > 0 ? (lucro / faturamento) * 100 : 0;
    const ticketMedio  = pedidos > 0 ? faturamento / pedidos : 0;
    const cpa          = anuncios > 0 && pedidos > 0 ? anuncios / pedidos : 0;
    const roas         = anuncios > 0 ? faturamento / anuncios : 0;
    const roi          = anuncios > 0 ? ((faturamento - custoProduto - taxas - anuncios) / anuncios) * 100 : 0;

    // Previous period (for deltas)
    const prevFaturamento = prevOrders.reduce((s, o) => s + Number(o.revenue ?? 0), 0);
    const prevPedidos     = prevOrders.length;
    const prevUnidades    = prevOrders.reduce((s, o) => s + Number(o.items_count ?? 0), 0);
    const prevCusto       = prevOrders.reduce((s, o) => s + orderCost(o), 0);
    const prevLucro       = prevFaturamento - prevCusto - prevTaxas - prevAnuncios;
    const prevMargem      = prevFaturamento > 0 ? (prevLucro / prevFaturamento) * 100 : 0;
    const prevTicket      = prevPedidos > 0 ? prevFaturamento / prevPedidos : 0;
    const prevCpa         = prevAnuncios > 0 && prevPedidos > 0 ? prevAnuncios / prevPedidos : 0;
    const prevRoas        = prevAnuncios > 0 ? prevFaturamento / prevAnuncios : 0;

    function delta(curr: number, prev: number) {
      if (prev === 0) return 0;
      return Math.round(((curr - prev) / prev) * 100 * 10) / 10;
    }

    // Daily chart data grouped by order_date
    const byDate = new Map<string, { faturamento: number; lucro: number; custo: number }>();
    for (const o of orders) {
      const d = o.order_date as string;
      const prev = byDate.get(d) ?? { faturamento: 0, lucro: 0, custo: 0 };
      const rev = Number(o.revenue ?? 0);
      const cost = orderCost(o);
      byDate.set(d, { faturamento: prev.faturamento + rev, custo: prev.custo + cost, lucro: prev.lucro + (rev - cost) });
    }
    const chartData = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date: date.slice(5).replace("-", "/"), // MM/DD → DD/MM display
        faturamento: Math.round(v.faturamento * 100) / 100,
        lucro: Math.round(v.lucro * 100) / 100,
        custo: Math.round(v.custo * 100) / 100,
      }));

    const goalsData = goalRes.data ?? [];
    const aggregatedGoal = goalsData.length === 0 ? null : {
      target_profit: goalsData.reduce((s: number, g: any) => s + Number(g.target_profit ?? 0), 0),
      total_revenue: goalsData.reduce((s: number, g: any) => s + Number(g.total_revenue ?? 0), 0),
      currency: goalsData[0]?.currency ?? null,
    };

    return {
      unitCost,
      metrics: {
        faturamento,       faturamentoDelta:  delta(faturamento, prevFaturamento),
        lucro,             lucroDelta:        delta(lucro, prevLucro),
        custoProduto,      custoProdutoDelta: delta(custoProduto, prevCusto),
        taxas,             taxasDelta:        delta(taxas, prevTaxas),
        anuncios,          anunciosDelta:     delta(anuncios, prevAnuncios),
        cpa,               cpaDelta:          delta(cpa, prevCpa),
        roas,              roasDelta:         delta(roas, prevRoas),
        roi,
        margem,            margemDelta:       delta(margem, prevMargem),
        pedidos,           pedidosDelta:      delta(pedidos, prevPedidos),
        unidades,          unidadesDelta:     delta(unidades, prevUnidades),
        ticketMedio,       ticketMedioDelta:  delta(ticketMedio, prevTicket),
      },
      chartData,
      goal: aggregatedGoal,
    };
  });

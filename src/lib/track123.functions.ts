import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";


const TRACK123_API_BASE = "https://api.track123.com/gateway/open-api/tk/v2.1";

const DEFAULT_EVENT_RULES: Array<{ key: string; label: string; target: "shipped" | "delivered" | "problem" | "ignore" }> = [
  { key: "accepted_by_carrier", label: "Accepted by carrier", target: "shipped" },
  { key: "shipment_picked_up", label: "Shipment picked up", target: "shipped" },
  { key: "departed_from_sorting_center", label: "Departed from sorting center", target: "shipped" },
  { key: "in_transit", label: "In transit", target: "shipped" },
  { key: "arrived_at_destination", label: "Arrived at destination", target: "ignore" },
  { key: "out_for_delivery", label: "Out for delivery", target: "ignore" },
  { key: "delivered", label: "Delivered", target: "delivered" },
  { key: "exception", label: "Exception", target: "problem" },
  { key: "failed_attempt", label: "Failed delivery attempt", target: "problem" },
  { key: "expired", label: "Expired", target: "problem" },
  { key: "shipment_information_received", label: "Shipment information received", target: "ignore" },
];

function maskKey(s: string | null | undefined): string | null {
  if (!s) return null;
  if (s.length <= 8) return "•".repeat(s.length);
  return s.slice(0, 4) + "•".repeat(Math.max(4, s.length - 8)) + s.slice(-4);
}

// ===== Integration config =====

export const getTrack123Integration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabaseAdmin.from("track123_integrations")
      .select("*").eq("user_id", userId).eq("shop_id", data.shop_id).maybeSingle();

    if (!row) {
      return {
        configured: false,
        enabled: false,
        api_key_masked: null,
        token_masked: null,
        webhook_secret: null,
        webhook_url: null,
        tracking_link_template: null,
        last_sync_at: null,
        last_sync_status: null,
        last_sync_error: null,
      };
    }

    const origin = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    return {
      configured: Boolean(row.api_key),
      enabled: row.enabled,
      api_key_masked: maskKey(row.api_key),
      token_masked: maskKey(row.token),
      webhook_secret: row.webhook_secret,
      webhook_url: `${origin}/api/public/hooks/track123/${data.shop_id}/${row.webhook_secret}`,
      tracking_link_template: row.tracking_link_template,
      last_sync_at: row.last_sync_at,
      last_sync_status: row.last_sync_status,
      last_sync_error: row.last_sync_error,
    };
  });

export const upsertTrack123Integration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string; api_key?: string; token?: string; tracking_link_template?: string; enabled?: boolean }) =>
    z.object({
      shop_id: z.string().uuid(),
      api_key: z.string().min(1).max(500).optional(),
      token: z.string().max(500).optional(),
      tracking_link_template: z.string().min(1).max(500).optional(),
      enabled: z.boolean().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: { api_key?: string; token?: string; tracking_link_template?: string; enabled?: boolean } = {};
    if (data.api_key !== undefined) patch.api_key = data.api_key;
    if (data.token !== undefined) patch.token = data.token;
    if (data.tracking_link_template !== undefined) patch.tracking_link_template = data.tracking_link_template;
    if (data.enabled !== undefined) patch.enabled = data.enabled;

    const { data: existing } = await supabaseAdmin.from("track123_integrations")
      .select("id").eq("user_id", userId).eq("shop_id", data.shop_id).maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin.from("track123_integrations")
        .update(patch).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("track123_integrations")
        .insert({ user_id: userId, shop_id: data.shop_id, enabled: true, ...patch });
      if (error) throw new Error(error.message);
      // seed default event rules
      const rules = DEFAULT_EVENT_RULES.map((r, i) => ({
        user_id: userId, shop_id: data.shop_id,
        event_key: r.key, event_label: r.label, target_status: r.target, enabled: true, position: i,
      }));
      await supabase.from("track123_event_rules").insert(rules);
    }
    return { ok: true };
  });

export const testTrack123Connection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: row } = await supabaseAdmin.from("track123_integrations")
      .select("api_key").eq("user_id", userId).eq("shop_id", data.shop_id).maybeSingle();
    if (!row?.api_key) throw new Error("API Key não configurada");

    try {
      const r = await fetch(`${TRACK123_API_BASE}/courier/list`, {
        method: "GET",
        headers: { "accept": "application/json", "Track123-Api-Secret": row.api_key },
      });
      const text = await r.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch {/* non-JSON response */}
      // Track123 returns HTTP 200 even on auth failures, with an error "code" in the body.
      const ok = r.ok && (!j?.code || j.code === "00000");
      await supabaseAdmin.from("track123_integrations")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: ok ? "ok" : "error",
          last_sync_error: ok ? null : text.slice(0, 500),
        })
        .eq("user_id", userId).eq("shop_id", data.shop_id);
      if (!ok) throw new Error(`Falha (${r.status}): ${text.slice(0, 200)}`);
      return { ok: true };
    } catch (e: any) {
      await supabaseAdmin.from("track123_integrations")
        .update({ last_sync_status: "error", last_sync_error: String(e?.message ?? e).slice(0, 500) })
        .eq("user_id", userId).eq("shop_id", data.shop_id);
      throw e;
    }
  });

export async function runTrack123Sync(shopId: string, apiKey: string, supabase: typeof supabaseAdmin) {
    // Get tracking numbers from existing tracking rows
    const { data: trackings } = await supabase.from("shop_order_tracking")
      .select("id,order_id,tracking_number,timeline").eq("shop_id", shopId)
      .not("tracking_number", "is", null).limit(50);

    const { data: rules } = await supabase.from("track123_event_rules")
      .select("event_key,event_label,target_status,enabled")
      .eq("shop_id", shopId).eq("enabled", true);

    const ruleMap = new Map<string, string>();
    for (const r of rules ?? []) {
      ruleMap.set(r.event_key.toLowerCase(), r.target_status);
      ruleMap.set(r.event_label.toLowerCase(), r.target_status);
    }
    function matchRule(text: string | null | undefined): string | null {
      if (!text) return null;
      const t = text.toLowerCase().trim();
      if (ruleMap.has(t)) return ruleMap.get(t)!;
      for (const [k, v] of ruleMap.entries()) {
        if (t.includes(k) || k.includes(t)) return v;
      }
      return null;
    }

    const numbers = (trackings ?? []).map((t) => t.tracking_number).filter((n): n is string => !!n);

    let updated = 0;
    let lastError: string | null = null;
    const byTrackNo = new Map<string, any>();

    const track123Headers = {
      "Content-Type": "application/json",
      "accept": "application/json",
      "Track123-Api-Secret": apiKey,
    };

    let importError: string | null = null;
    if (numbers.length) {
      // Best-effort registration: numbers already registered just come back as "duplicate" rejects, which is fine.
      // Small batches so a low remaining credit balance only blocks the numbers that don't fit.
      for (let i = 0; i < numbers.length; i += 25) {
        const chunk = numbers.slice(i, i + 25);
        try {
          const r = await fetch(`${TRACK123_API_BASE}/track/import`, {
            method: "POST",
            headers: track123Headers,
            body: JSON.stringify(chunk.map((n) => ({ trackNo: n }))),
          });
          const text = await r.text();
          let j: any;
          try { j = JSON.parse(text); } catch { continue; }
          if (j?.code && j.code !== "00000") {
            importError = `Registro (${j.code}): ${j.msg ?? text.slice(0, 200)}`;
            if (j.code === "101107") break; // out of credit — further chunks will fail too
          }
        } catch {/* ignore — querying below will surface real errors */}
      }

      for (let i = 0; i < numbers.length; i += 100) {
        const chunk = numbers.slice(i, i + 100);
        try {
          const r = await fetch(`${TRACK123_API_BASE}/track/query`, {
            method: "POST",
            headers: track123Headers,
            body: JSON.stringify({ trackNoInfos: chunk.map((trackNo) => ({ trackNo })), queryPageSize: 100 }),
          });
          const text = await r.text();
          if (!r.ok) { lastError = `Falha (${r.status}): ${text.slice(0, 200)}`; continue; }
          let j: any;
          try { j = JSON.parse(text); } catch { lastError = `Resposta inválida: ${text.slice(0, 200)}`; continue; }
          if (j?.code && j.code !== "00000" && !j?.data) { lastError = `${j.code}: ${j.msg ?? text.slice(0, 200)}`; continue; }

          const content = j?.data?.accepted?.content ?? j?.data?.list ?? j?.data?.content ?? [];
          for (const item of content) {
            if (item?.trackNo) byTrackNo.set(item.trackNo, item);
          }
          const rejected = j?.data?.rejected?.content ?? j?.data?.rejected ?? [];
          for (const rej of rejected) {
            const reason = rej.error?.msg ?? rej.msg ?? rej.message ?? "rejeitado";
            lastError = `${rej.trackNo ?? "?"}: ${reason}`.slice(0, 200);
          }
        } catch (e: any) {
          lastError = String(e?.message ?? e).slice(0, 500);
        }
      }
    }

    for (const t of trackings ?? []) {
      if (!t.tracking_number) continue;
      const item = byTrackNo.get(t.tracking_number);
      if (!item) { lastError = lastError ?? `Sem dados para ${t.tracking_number}`; continue; }

      const logistics = item.localLogisticsInfo ?? item;
      const events = logistics.trackingDetails ?? [];
      const last = events[0] ?? null;
      const lastLabel: string | null = last?.eventDetail ?? null;
      const lastAt: string | null = last?.eventTime ?? last?.eventTimeZeroUTC ?? null;

      const update: any = {
        carrier: logistics.courierCode ?? null,
        tracking_status: item.transitStatus ?? null,
        last_event_at: lastAt,
        last_event_label: lastLabel,
        timeline: events.length ? events : t.timeline,
      };

      const target = matchRule(lastLabel) ?? matchRule(item.transitStatus) ?? matchRule(item.transitSubStatus);
      const nowDate = new Date().toISOString().slice(0, 10);
      const orderUpdate: { payment_status?: string; shipped_at?: string; delivered_at?: string; problem_at?: string } = {};
      if (target === "shipped") {
        update.shipped_at = new Date().toISOString();
        orderUpdate.payment_status = "shipped";
        orderUpdate.shipped_at = nowDate;
      } else if (target === "delivered") {
        update.delivered_at = new Date().toISOString();
        orderUpdate.delivered_at = nowDate;
        orderUpdate.payment_status = "shipped";
      } else if (target === "problem") {
        update.problem_at = new Date().toISOString();
        orderUpdate.problem_at = nowDate;
      }

      await supabase.from("shop_order_tracking").update(update).eq("id", t.id);
      if (Object.keys(orderUpdate).length) {
        await supabase.from("shop_orders").update(orderUpdate).eq("id", t.order_id);
      }
      updated++;
    }

    const total = trackings?.length ?? 0;
    let status: string;
    let errorMsg: string | null;
    if (total === 0) {
      status = "ok";
      errorMsg = "Nenhum pedido com código de rastreio para sincronizar.";
    } else if (updated === 0) {
      status = "error";
      errorMsg = importError ?? lastError ?? "Falha ao sincronizar rastreios.";
    } else {
      status = "ok";
      const err = importError ?? lastError;
      errorMsg = err ? `${updated}/${total} sincronizados. Último erro: ${err}` : null;
    }

    await supabaseAdmin.from("track123_integrations")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: status, last_sync_error: errorMsg })
      .eq("shop_id", shopId);

    return { updated, total, status, errorMsg };
}

export const syncTrack123Tracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: integ } = await supabaseAdmin.from("track123_integrations")
      .select("api_key").eq("user_id", userId).eq("shop_id", data.shop_id).maybeSingle();
    if (!integ?.api_key) throw new Error("Integração não configurada");

    const result = await runTrack123Sync(data.shop_id, integ.api_key, supabase);
    return { updated: result.updated, total: result.total };
  });

// ===== Event rules =====

export const listTrack123EventRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("track123_event_rules")
      .select("*").eq("shop_id", data.shop_id).order("position", { ascending: true });
    return rows ?? [];
  });

export const upsertTrack123EventRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string; id?: string; event_key: string; event_label: string; target_status: string; enabled: boolean }) =>
    z.object({
      shop_id: z.string().uuid(),
      id: z.string().uuid().optional(),
      event_key: z.string().min(1).max(120).regex(/^[a-z0-9_-]+$/),
      event_label: z.string().min(1).max(200),
      target_status: z.enum(["shipped", "delivered", "problem", "ignore"]),
      enabled: z.boolean(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase.from("track123_event_rules").update({
        event_key: data.event_key, event_label: data.event_label,
        target_status: data.target_status, enabled: data.enabled,
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("track123_event_rules").insert({
        user_id: userId, shop_id: data.shop_id,
        event_key: data.event_key, event_label: data.event_label,
        target_status: data.target_status, enabled: data.enabled,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteTrack123EventRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("track123_event_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===== Order tracking lookup =====

export const setOrderTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order_id: string; tracking_number: string }) =>
    z.object({ order_id: z.string().uuid(), tracking_number: z.string().min(1).max(120) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: order } = await supabase.from("shop_orders")
      .select("id,shop_id").eq("id", data.order_id).maybeSingle();
    if (!order) throw new Error("Pedido não encontrado");

    const { data: existing } = await supabase.from("shop_order_tracking")
      .select("id").eq("order_id", data.order_id).maybeSingle();
    if (existing) {
      const { error } = await supabase.from("shop_order_tracking")
        .update({ tracking_number: data.tracking_number }).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("shop_order_tracking").insert({
        user_id: userId, shop_id: order.shop_id, order_id: order.id,
        tracking_number: data.tracking_number,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const listOrdersTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string }) =>
    z.object({ shop_id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("shop_order_tracking")
      .select("*").eq("shop_id", data.shop_id);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ===== Metrics =====

export const getTrack123Metrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const today = new Date().toISOString().slice(0, 10);

    const { data: orders } = await supabase.from("shop_orders")
      .select("id,payment_status,paid_at,shipped_at,delivered_at,problem_at")
      .eq("shop_id", data.shop_id);

    const { data: trackings } = await supabase.from("shop_order_tracking")
      .select("order_id,tracking_number,last_event_at")
      .eq("shop_id", data.shop_id);

    const trackingByOrder = new Map((trackings ?? []).map((t: any) => [t.order_id, t]));
    const all = orders ?? [];

    let shippedToday = 0, withoutTracking = 0, inTransit = 0, delivered = 0, problem = 0, stale = 0;
    let leadSum = 0, leadCount = 0;

    const TEN_DAYS_AGO = Date.now() - 10 * 86400_000;

    for (const o of all) {
      const t = trackingByOrder.get(o.id);
      if (!t?.tracking_number) {
        if (o.payment_status === "paid" || o.payment_status === "shipped") withoutTracking++;
      } else {
        if (t.last_event_at && new Date(t.last_event_at).getTime() < TEN_DAYS_AGO && o.payment_status === "shipped") stale++;
      }
      if (o.shipped_at === today) shippedToday++;
      if (o.payment_status === "shipped" && !o.delivered_at) inTransit++;
      if (o.delivered_at) delivered++;
      if (o.problem_at) problem++;
      if (o.paid_at && o.shipped_at) {
        const diff = (new Date(o.shipped_at).getTime() - new Date(o.paid_at).getTime()) / 86400_000;
        if (diff >= 0 && diff < 90) { leadSum += diff; leadCount++; }
      }
    }

    return {
      avg_time_to_ship: leadCount ? Number((leadSum / leadCount).toFixed(1)) : null,
      shipped_today: shippedToday,
      without_tracking: withoutTracking,
      stale_tracking: stale,
      in_transit: inTransit,
      delivered,
      problem,
    };
  });

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualString } from "@/lib/cron-auth";

/**
 * Track123 webhook receiver (secret in path).
 * URL: /api/public/hooks/track123/[SHOP_ID]/[WEBHOOK_SECRET]
 *
 * Some webhook providers (Track123 included) reject URLs containing query
 * strings, so we expose the secret as a path segment.
 */
export const Route = createFileRoute("/api/public/hooks/track123/$shopId/$secret")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, service: "track123-webhook" }),
      HEAD: async () => new Response(null, { status: 200 }),
      OPTIONS: async () => new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Webhook-Secret",
        },
      }),
      POST: async ({ request, params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const shopId = params.shopId;
        const secret = params.secret;
        if (!shopId || !secret) return new Response("Unauthorized", { status: 401 });

        const { data: integ } = await supabaseAdmin
          .from("track123_integrations")
          .select("user_id,shop_id,webhook_secret")
          .eq("shop_id", shopId)
          .maybeSingle();

        if (!integ || !integ.webhook_secret || !timingSafeEqualString(integ.webhook_secret, secret)) {
          return new Response("Invalid secret", { status: 401 });
        }

        let payload: any;
        try { payload = await request.json(); }
        catch { return new Response("Invalid JSON", { status: 400 }); }

        const items: any[] = Array.isArray(payload) ? payload
          : Array.isArray(payload?.data) ? payload.data
          : payload?.data ? [payload.data]
          : [payload];

        const { data: rules } = await supabaseAdmin
          .from("track123_event_rules")
          .select("event_key,event_label,target_status,enabled")
          .eq("shop_id", shopId)
          .eq("enabled", true);

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

        let processed = 0;
        for (const it of items) {
          const trackingNumber: string | undefined = it?.trackNo ?? it?.tracking_number ?? it?.number;
          if (!trackingNumber) continue;

          const events: any[] = it?.events ?? it?.trackInfo ?? it?.tracks ?? [];
          const last = events[0] ?? it;
          const lastLabel: string = last?.statusDescription ?? last?.context ?? last?.description ?? last?.status ?? "";
          const lastAt: string | null = last?.date ?? last?.eventTime ?? last?.time ?? null;

          const { data: tracking } = await supabaseAdmin
            .from("shop_order_tracking")
            .select("id,order_id,timeline")
            .eq("shop_id", shopId)
            .eq("tracking_number", trackingNumber)
            .maybeSingle();

          if (!tracking) continue;

          const target = matchRule(lastLabel) ?? matchRule(it?.status);

          const update: any = {
            carrier: it?.courierCode ?? it?.carrierCode ?? null,
            tracking_status: it?.status ?? null,
            last_event_at: lastAt,
            last_event_label: lastLabel,
            timeline: events.length ? events : tracking.timeline,
          };

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

          await supabaseAdmin.from("shop_order_tracking").update(update).eq("id", tracking.id);
          if (Object.keys(orderUpdate).length) {
            await supabaseAdmin.from("shop_orders").update(orderUpdate).eq("id", tracking.order_id);
          }
          processed++;
        }

        await supabaseAdmin.from("track123_integrations")
          .update({ last_sync_at: new Date().toISOString(), last_sync_status: "webhook" })
          .eq("shop_id", shopId);

        return Response.json({ ok: true, processed });
      },
    },
  },
});

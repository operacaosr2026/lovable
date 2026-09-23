import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualString } from "@/lib/cron-auth";
import { applyTrackingTargetToOrder, isOlderEvent } from "@/lib/track123-sync.server";

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
            .select("id,order_id,timeline,last_event_at,shipped_at,delivered_at,problem_at")
            .eq("shop_id", shopId)
            .eq("tracking_number", trackingNumber)
            .maybeSingle();

          if (!tracking) continue;

          // Webhook atrasado/reentregue com evento mais antigo que o já gravado:
          // ignora, pra não voltar o pedido pra um status anterior.
          if (isOlderEvent(lastAt, tracking.last_event_at)) { processed++; continue; }

          const target = matchRule(lastLabel) ?? matchRule(it?.status);

          const update: any = {
            tracking_status: it?.status ?? null,
            last_event_at: lastAt,
            last_event_label: lastLabel,
            timeline: events.length ? events : tracking.timeline,
          };
          const carrier = it?.courierCode ?? it?.carrierCode;
          if (carrier) update.carrier = carrier;

          // Datas só na primeira vez — o mesmo webhook chegando 2, 5, 10 vezes
          // não pode ficar empurrando a data pra "agora".
          const nowIso = new Date().toISOString();
          if (target === "shipped" && !tracking.shipped_at) update.shipped_at = nowIso;
          else if (target === "delivered" && !tracking.delivered_at) update.delivered_at = lastAt ?? nowIso;
          else if (target === "problem" && !tracking.problem_at) update.problem_at = lastAt ?? nowIso;

          await supabaseAdmin.from("shop_order_tracking").update(update).eq("id", tracking.id);
          await applyTrackingTargetToOrder(supabaseAdmin, tracking.order_id, target, lastAt);
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

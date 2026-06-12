import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runTrack123Sync } from "@/lib/track123-sync.server";

export const Route = createFileRoute("/api/public/hooks/sync-track123")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;

        const { data: integrations, error } = await supabaseAdmin
          .from("track123_integrations")
          .select("shop_id,api_key")
          .eq("enabled", true)
          .not("api_key", "is", null);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

        let processed = 0;
        for (const integ of integrations ?? []) {
          if (!integ.api_key) continue;
          try {
            await runTrack123Sync(integ.shop_id, integ.api_key, supabaseAdmin);
            processed++;
          } catch (e) {
            console.error("track123 sync fail", integ.shop_id, e);
          }
        }
        return new Response(JSON.stringify({ processed }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});

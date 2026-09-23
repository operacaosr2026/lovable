import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { runTrack123Sync } from "@/lib/track123-sync.server";
import { runTrack123McpSync } from "@/lib/track123-mcp-sync.server";

export const Route = createFileRoute("/api/public/hooks/sync-track123")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verifyCronApiKey(request);
        if (unauthorized) return unauthorized;

        const { data: integrations, error } = await supabaseAdmin
          .from("track123_integrations")
          .select("shop_id,api_key,mcp_store_uuid,last_sync_at")
          .eq("enabled", true)
          .or("api_key.not.is.null,mcp_store_uuid.not.is.null");
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

        // Só sincroniza lojas ativas (não pausadas/arquivadas) — e, se a loja
        // pertence a um grupo, o grupo também precisa estar ativo. Evita gastar
        // crédito do Track123 com lojas paradas (ex: Chierie pausada).
        const shopIds = (integrations ?? []).map((i) => i.shop_id);
        const { data: shopsData } = shopIds.length
          ? await supabaseAdmin.from("shops").select("id,status,archived,group_id").in("id", shopIds)
          : { data: [] as any[] };

        const groupIds = [...new Set((shopsData ?? []).map((s: any) => s.group_id).filter(Boolean))];
        const { data: groupsData } = groupIds.length
          ? await supabaseAdmin.from("shop_groups").select("id,status").in("id", groupIds)
          : { data: [] as any[] };
        const groupStatus = new Map((groupsData ?? []).map((g: any) => [g.id, g.status]));

        const activeShopIds = new Set(
          (shopsData ?? [])
            .filter((s: any) => s.status === "ativa" && !s.archived && (!s.group_id || groupStatus.get(s.group_id) === "ativo"))
            .map((s: any) => s.id)
        );

        // Um prazo só pra rodada inteira (a função tem 60s na Vercel) e lojas há
        // mais tempo sem sync primeiro — antes cada loja tinha 50s próprios, a
        // função morria na 2ª e as do fim da lista ficavam horas sem atualizar.
        const deadline = Date.now() + 50_000;
        const queue = (integrations ?? [])
          .filter((i) => activeShopIds.has(i.shop_id))
          .sort((a, b) => (a.last_sync_at ?? "").localeCompare(b.last_sync_at ?? ""));

        let processed = 0;
        let skippedByBudget = 0;
        for (const integ of queue) {
          if (Date.now() > deadline - 5_000) { skippedByBudget++; continue; }
          try {
            // Preferimos o MCP quando a loja tem Store UUID configurado — é o
            // método que sabemos que funciona quando a Open API clássica não
            // está disponível pra essa loja (ver track123-mcp-sync.server.ts).
            // MCP exige X-Api-Key + X-Store-Uuid juntos (mesma checagem do sync manual
            // em track123.functions.ts); só o UUID sem key falharia toda rodada.
            if (integ.mcp_store_uuid && integ.api_key) {
              await runTrack123McpSync(integ.shop_id, integ.api_key, integ.mcp_store_uuid, supabaseAdmin, { deadline });
            } else if (integ.api_key) {
              await runTrack123Sync(integ.shop_id, integ.api_key, supabaseAdmin);
            } else {
              continue;
            }
            processed++;
          } catch (e) {
            console.error("track123 sync fail", integ.shop_id, e);
          }
        }
        if (skippedByBudget) console.error(`sync-track123: orçamento de tempo esgotado, ${skippedByBudget} loja(s) ficam pra próxima rodada.`);
        return new Response(JSON.stringify({ processed, skippedByBudget }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});

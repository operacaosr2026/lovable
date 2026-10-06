import { createFileRoute } from "@tanstack/react-router";
import { listRecentDeliveries } from "@/lib/public-tracking.server";

// "Recent Deliveries" da página Track Your Order da loja (Shopify): entregas
// reais recentes — só { city, region, country, status, at } de cada uma (ver
// listRecentDeliveries). Público, sem login; mesmo CORS do /api/public/track,
// só com GET.
//   GET → { deliveries: [...] }   (vazio quando não há; nunca inventa)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, cache: string) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": cache, ...CORS } });

export const Route = createFileRoute("/api/public/recent-deliveries")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        try {
          const deliveries = await listRecentDeliveries();
          // Cache na borda da Vercel: 3 min (e até 10 min servindo o anterior
          // enquanto atualiza) — o banco só é lido uma vez a cada 3 min, não a
          // cada visitante. O sync do rastreio roda a cada 30 min.
          return json({ deliveries }, "public, max-age=60, s-maxage=180, stale-while-revalidate=600");
        } catch (e) {
          console.error("recent-deliveries", e);
          // Falha: lista vazia (a página da loja não quebra), cache curto.
          return json({ deliveries: [] }, "public, max-age=0, s-maxage=30");
        }
      },
    },
  },
});

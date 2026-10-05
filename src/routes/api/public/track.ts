import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { lookupPublicTracking, lookupPublicOrder } from "@/lib/public-tracking.server";

// Dados do rastreio pra página de rastreio dentro da loja (voultiewear.com/pages/track,
// bloco em shopify/track-page.liquid). Público, sem login — devolve só o que a
// página mostra (já filtrado: nada de China/alfândega, nada pessoal do cliente).
//   GET  ?code=XXXX                      → { tracking }
//   POST { orderNumber, contact }        → { found, orderNumber?, tracking? }
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });

const orderInput = z.object({
  orderNumber: z.string().trim().min(2).max(30),
  contact: z.string().trim().min(3).max(120),
});

export const Route = createFileRoute("/api/public/track")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const code = new URL(request.url).searchParams.get("code") ?? "";
        const r = await lookupPublicTracking(code);
        // Cache curto na borda: o rastreio só muda quando o sync roda.
        return json(r, 200, { "Cache-Control": "public, max-age=0, s-maxage=300" });
      },
      POST: async ({ request }) => {
        const parsed = orderInput.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ found: false }, 400);
        const r = await lookupPublicOrder(parsed.data);
        if (!r.found) return json({ found: false });
        const tracking = r.trackingCode ? (await lookupPublicTracking(r.trackingCode)).tracking : null;
        return json({ found: true, orderNumber: r.orderNumber, tracking });
      },
    },
  },
});

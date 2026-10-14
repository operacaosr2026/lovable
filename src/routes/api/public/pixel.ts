import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isoDateUS } from "@/lib/timezone";

// Recebe os eventos do Custom Pixel da Shopify (código em funnelPixelCode,
// lib/product-funnel-pixel.ts) pro funil por produto: product_viewed na matriz vira
// "session", checkout_started nas sublojas vira "checkout". A loja é achada
// pelo domínio .myshopify.com que o próprio pixel informa. Público e sem
// login — o sandbox do pixel manda Origin null, então o CORS é aberto; o
// corpo vai como text/plain pra não precisar de preflight.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const ok = () => new Response(null, { status: 204, headers: CORS });

const input = z.object({
  shop: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  step: z.enum(["session", "checkout"]),
  client_id: z.string().trim().min(1).max(100),
  products: z.array(z.object({
    id: z.string().max(100).default(""),
    title: z.string().max(255).default(""),
  })).min(1).max(50),
});

export const Route = createFileRoute("/api/public/pixel")({
  server: {
    handlers: {
      OPTIONS: async () => ok(),
      POST: async ({ request }) => {
        // Acesso do Brasil é teste da operação, não cliente — fica fora do funil.
        if (request.headers.get("x-vercel-ip-country") === "BR") return ok();
        let body: unknown;
        try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 400, headers: CORS }); }
        const parsed = input.safeParse(body);
        if (!parsed.success) return new Response(null, { status: 400, headers: CORS });
        const { shop, step, client_id, products } = parsed.data;

        const { data: stores } = await supabaseAdmin.from("shopify_stores").select("id,user_id").eq("shop_domain", shop);
        if (!stores?.length) return ok();

        const day = isoDateUS(new Date());
        const seen = new Map<string, string>();
        for (const p of products) {
          const id = p.id.replace(/^gid:\/\/shopify\/Product\//, "").toLowerCase();
          if (id && !seen.has(id)) seen.set(id, p.title);
        }
        const rows = stores.flatMap((s) => [...seen].map(([id, title]) => ({
          user_id: s.user_id, shopify_store_id: s.id, step, day, client_id, shopify_product_id: id, title,
        })));
        if (rows.length) {
          await (supabaseAdmin as any).from("product_funnel_events")
            .upsert(rows, { onConflict: "shopify_store_id,step,day,client_id,shopify_product_id", ignoreDuplicates: true });
        }
        return ok();
      },
    },
  },
});

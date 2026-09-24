import { createFileRoute } from "@tanstack/react-router";
import crypto from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ingestShopifyOrder } from "@/lib/shopify-order-ingest.server";
import { broadcast } from "@/lib/realtime.server";

// Recebe os webhooks da Shopify (orders/create, orders/updated) de uma loja —
// cadastrados por ensureShopifyWebhooks. Autenticidade pela assinatura HMAC
// (X-Shopify-Hmac-Sha256) com a chave secreta do app da loja; aviso sem
// assinatura válida é recusado. Receber o mesmo evento 2, 5, 10 vezes não
// duplica nada (upsert por pedido).
function validHmac(rawBody: string, secret: string, header: string | null): boolean {
  if (!header) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try { given = Buffer.from(header, "base64"); } catch { return false; }
  return given.length === digest.length && crypto.timingSafeEqual(given, digest);
}

export const Route = createFileRoute("/api/public/hooks/shopify/$storeId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const rawBody = await request.text();
        const { data: store } = await supabaseAdmin.from("shopify_stores")
          .select("id,shop_domain,client_secret")
          .eq("id", params.storeId).maybeSingle();
        if (!store?.client_secret) return new Response("Unknown store", { status: 404 });
        if (!validHmac(rawBody, store.client_secret, request.headers.get("x-shopify-hmac-sha256"))) {
          return new Response("Invalid signature", { status: 401 });
        }
        const shopHeader = request.headers.get("x-shopify-shop-domain");
        if (shopHeader && store.shop_domain && shopHeader !== store.shop_domain) {
          return new Response("Shop mismatch", { status: 401 });
        }

        const topic = request.headers.get("x-shopify-topic") ?? "";
        if (topic !== "orders/create" && topic !== "orders/updated") return Response.json({ ok: true, ignored: topic });

        let order: any;
        try { order = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }

        try {
          const { changedOwners } = await ingestShopifyOrder(store.id, order);
          await Promise.all(changedOwners.map((owner) => broadcast(owner, "orders", { store_id: store.id })));
          return Response.json({ ok: true });
        } catch (e) {
          // 500 = a Shopify tenta de novo mais tarde (e o sync de 10 em 10 min cobre).
          console.error("shopify webhook ingest fail", store.id, topic, e);
          return new Response("Ingest failed", { status: 500 });
        }
      },
    },
  },
});

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Página pública de rastreio (/track/<código>), sem login, uma URL pra todas as
// lojas: a loja sai do próprio pedido. Só lê o que o sync já gravou no banco —
// não chama nenhuma API de rastreio. Devolve só dados do rastreio (nada de
// nome, endereço, e-mail ou valor do cliente).
export type PublicTrackingEvent = { at: string | null; description: string; location: string | null };
export type PublicTracking = {
  storeName: string;
  logoUrl: string | null;
  orderNumber: string | null;
  trackingNumber: string;
  status: string | null;   // mesmas chaves do 17track: InfoReceived, InTransit, OutForDelivery, Delivered…
  events: PublicTrackingEvent[];
};

// "Loja 2 - Voultie Wear" → "Voultie Wear" (o prefixo é organização interna).
const publicStoreName = (name: string | null | undefined) => (name ?? "").replace(/^\s*loja\s*\d+\s*[-–:]\s*/i, "").trim() || "Your order";

// Status do Track123 ("Info received", "InfoReceived", "In transit"…) → chave única.
function normalizeStatus(raw: string | null | undefined, delivered: boolean): string | null {
  if (delivered) return "Delivered";
  const s = (raw ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (!s) return null;
  if (s.includes("undelivered") || s.includes("failed") || s.includes("failure")) return "DeliveryFailure";
  if (s.includes("delivered")) return "Delivered";
  if (s.includes("outfordelivery")) return "OutForDelivery";
  if (s.includes("pickup")) return "AvailableForPickup";
  if (s.includes("exception") || s.includes("problem")) return "Exception";
  if (s.includes("expired")) return "Expired";
  if (s.includes("transit")) return "InTransit";
  if (s.includes("inforeceived") || s.includes("pending")) return "InfoReceived";
  if (s.includes("notfound")) return "NotFound";
  return null;
}

// Timeline gravada nos formatos do MCP (event_time_utc/event_detail) e da Open API
// do Track123 (eventTimeZeroUTC/eventDetail).
function normalizeEvents(timeline: any[] | null | undefined): PublicTrackingEvent[] {
  const events = (timeline ?? []).map((e: any) => ({
    at: e?.event_time_utc ? `${String(e.event_time_utc).replace(" ", "T")}Z` : (e?.eventTimeZeroUTC ?? e?.time_utc ?? null),
    description: String(e?.event_detail ?? e?.eventDetail ?? e?.description ?? "").trim(),
    location: (e?.event_location || e?.address || e?.location || null) as string | null,
  })).filter((e) => e.description);
  return events.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

export const getPublicTracking = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: z.string().trim().min(5).max(50).regex(/^[A-Za-z0-9-]+$/) }).parse(d))
  .handler(async ({ data }): Promise<{ tracking: PublicTracking | null }> => {
    const code = data.code.toUpperCase();
    const { data: tr } = await supabaseAdmin.from("shop_order_tracking")
      .select("order_id,shop_id,tracking_number,tracking_status,timeline")
      .eq("tracking_number", code).order("updated_at", { ascending: false }).limit(1).maybeSingle();

    // Sem linha de rastreio ainda: o código pode já estar no pedido (veio da Shopify).
    const { data: order } = tr
      ? await supabaseAdmin.from("shop_orders").select("id,shop_id,order_number,delivery_status").eq("id", tr.order_id).maybeSingle()
      : await supabaseAdmin.from("shop_orders").select("id,shop_id,order_number,delivery_status")
          .eq("tracking_code", code).order("order_date", { ascending: false }).limit(1).maybeSingle();
    if (!tr && !order) return { tracking: null };

    const shopId = (tr?.shop_id ?? order?.shop_id)!;
    const { data: shop } = await supabaseAdmin.from("shops").select("name,logo_url").eq("id", shopId).maybeSingle();

    return {
      tracking: {
        storeName: publicStoreName(shop?.name),
        logoUrl: shop?.logo_url ?? null,
        orderNumber: order?.order_number ?? null,
        trackingNumber: code,
        status: normalizeStatus(tr?.tracking_status, order?.delivery_status === "delivered"),
        events: normalizeEvents(tr?.timeline as any[]),
      },
    };
  });

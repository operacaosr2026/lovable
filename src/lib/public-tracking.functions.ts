import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeEvents, buildSteps, type DisplayEvent, type DisplayStep } from "@/lib/tracking-display";

// Página pública de rastreio (/track), sem login, uma URL pra todas as lojas e
// sempre com a marca Voultie. Só lê o que o sync já gravou no banco — não chama
// nenhuma API de rastreio. Do cliente, só a cidade/estado de destino (pro mapa);
// nada de nome, endereço, e-mail ou valor.
export type PublicTracking = {
  orderNumber: string | null;
  trackingNumber: string;
  status: string | null;   // mesmas chaves do 17track: InfoReceived, InTransit, OutForDelivery, Delivered…
  steps: DisplayStep[];
  currentStep: number;
  events: DisplayEvent[];
  destination: string | null;
};

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
function rawEvents(timeline: any[] | null | undefined): DisplayEvent[] {
  return (timeline ?? []).map((e: any) => ({
    at: e?.event_time_utc ? `${String(e.event_time_utc).replace(" ", "T")}Z` : (e?.eventTimeZeroUTC ?? e?.time_utc ?? null),
    description: String(e?.event_detail ?? e?.eventDetail ?? e?.description ?? "").trim(),
    location: (e?.event_location || e?.address || e?.location || null) as string | null,
  }));
}

const ORDER_COLS = "id,order_number,order_date,delivered_at,delivery_status,tracking_code,created_at:raw->>created_at,city:raw->shipping_address->>city,province:raw->shipping_address->>province_code,country:raw->shipping_address->>country_code";

function destinationOf(o: any): string | null {
  if (!o || (o.country && o.country !== "US")) return null;
  return [o.city, o.province].filter(Boolean).join(", ") || null;
}

export const getPublicTracking = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: z.string().trim().min(5).max(50).regex(/^[A-Za-z0-9-]+$/) }).parse(d))
  .handler(async ({ data }): Promise<{ tracking: PublicTracking | null }> => {
    const code = data.code.toUpperCase();
    const { data: tr } = await supabaseAdmin.from("shop_order_tracking")
      .select("order_id,tracking_status,timeline")
      .eq("tracking_number", code).order("updated_at", { ascending: false }).limit(1).maybeSingle();

    // Sem linha de rastreio ainda: o código pode já estar no pedido (veio da Shopify).
    const { data: order } = tr
      ? await supabaseAdmin.from("shop_orders").select(ORDER_COLS).eq("id", tr.order_id).maybeSingle()
      : await supabaseAdmin.from("shop_orders").select(ORDER_COLS)
          .eq("tracking_code", code).order("order_date", { ascending: false }).limit(1).maybeSingle();
    if (!tr && !order) return { tracking: null };

    const o: any = order;
    const status = normalizeStatus(tr?.tracking_status, o?.delivery_status === "delivered");
    const all = rawEvents(tr?.timeline as any[]);
    const { steps, current } = buildSteps({
      orderedAt: o?.created_at ?? o?.order_date ?? null,
      deliveredAt: o?.delivered_at ?? null,
      status,
      events: all,
    });
    return {
      tracking: {
        orderNumber: o?.order_number ?? null,
        trackingNumber: code,
        status,
        steps,
        currentStep: current,
        events: sanitizeEvents(all),
        destination: destinationOf(o),
      },
    };
  });

// Busca por número do pedido + e-mail ou telefone (como na página da loja).
// Só confirma o pedido se o contato bater — e devolve só o código de rastreio.
export const findPublicOrder = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({
    orderNumber: z.string().trim().min(2).max(30),
    contact: z.string().trim().min(3).max(120),
  }).parse(d))
  .handler(async ({ data }): Promise<{ found: false } | { found: true; trackingCode: string | null; orderNumber: string }> => {
    const num = data.orderNumber.replace(/^#/, "").toUpperCase();
    const { data: rows } = await supabaseAdmin.from("shop_orders")
      .select("order_number,tracking_code,email:raw->>email,phone:raw->>phone,cemail:raw->customer->>email,sphone:raw->shipping_address->>phone")
      .in("order_number", [`#${num}`, num]).limit(5);
    const contact = data.contact.trim().toLowerCase();
    const digits = contact.replace(/\D/g, "");
    const match = (rows ?? []).find((r: any) => {
      if (contact.includes("@")) return [r.email, r.cemail].some((e) => e && String(e).toLowerCase() === contact);
      if (digits.length < 7) return false;
      return [r.phone, r.sphone].some((p) => p && String(p).replace(/\D/g, "").slice(-10) === digits.slice(-10));
    }) as any;
    if (!match) return { found: false };
    return { found: true, trackingCode: match.tracking_code ?? null, orderNumber: match.order_number };
  });

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeEvents, buildSteps, officialEdd, usPlace, type DisplayEdd, type DisplayEvent, type DisplayStep } from "@/lib/tracking-display";

// Rastreio público (página /track do sistema e página de rastreio da loja
// Voultie via /api/public/track), sem login, uma URL pra todas as lojas e
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
  // Previsão oficial da transportadora (gravada pelo sync do 17track).
  edd: DisplayEdd | null;
};

// Status gravado pelo sync ("Info received", "InfoReceived", "In transit"…) → chave única.
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

// Timeline gravada pelo sync (event_time_utc/event_detail) — e o formato antigo
// do Track123 (eventTimeZeroUTC/eventDetail), que ainda existe em pedidos antigos.
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

export const TRACKING_CODE_RE = /^[A-Za-z0-9-]{5,50}$/;

export async function lookupPublicTracking(rawCode: string): Promise<{ tracking: PublicTracking | null }> {
  const code = rawCode.trim().toUpperCase();
  if (!TRACKING_CODE_RE.test(code)) return { tracking: null };
  const { data: tr } = await supabaseAdmin.from("shop_order_tracking")
    .select("order_id,tracking_status,timeline,edd_from,edd_to,edd_source")
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
      edd: officialEdd(tr ? { source: tr.edd_source, from: tr.edd_from, to: tr.edd_to } : null),
    },
  };
}

// Busca por número do pedido + e-mail ou telefone (como na página da loja).
// Só confirma o pedido se o contato bater — e devolve só o código de rastreio.
export async function lookupPublicOrder(data: { orderNumber: string; contact: string }): Promise<{ found: false } | { found: true; trackingCode: string | null; orderNumber: string }> {
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
}

// ─── Recent deliveries (bloco "Recent Deliveries" da página Track Your Order) ───
// Entregas REAIS recentes, só do que o sync já gravou (nenhuma chamada externa).
// Público: a resposta é montada aqui campo a campo — cidade/estado de destino,
// país, status e hora do evento. Nada de nome, endereço, CEP, pedido, código de
// rastreio ou id (o id do pedido só serve pra não repetir o mesmo envio).
export type RecentDelivery = { city: string; region: string; country: "US"; status: "Delivered" | "Out for Delivery"; at: string };

const RECENT_WINDOW_DAYS = 14;
const RECENT_MAX = 20;
// Cidade como o cliente digitou ("MIAMI", "new york") → "Miami", "New York";
// mista ("McAllen") fica como veio.
const titleCase = (c: string) => (c === c.toUpperCase() || c === c.toLowerCase()
  ? c.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, p, l) => p + l.toUpperCase()) : c);

export async function listRecentDeliveries(): Promise<RecentDelivery[]> {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000).toISOString();
  // Candidatos: status geral do rastreio com "deliver" (Delivered, Out for
  // delivery…), mais recentes primeiro. Folga acima do limite por causa dos que
  // caem no filtro (sem cidade segura, "Undelivered"…).
  const { data: tracks, error } = await supabaseAdmin.from("shop_order_tracking")
    .select("order_id,tracking_status,last_event_at")
    .ilike("tracking_status", "%deliver%")
    .gte("last_event_at", since)
    .order("last_event_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  if (!tracks?.length) return [];

  // Destino de todos de uma vez (sem N+1): só cidade, estado e país do endereço.
  const ids = [...new Set(tracks.map((t) => t.order_id))];
  const { data: orders, error: oErr } = await supabaseAdmin.from("shop_orders")
    .select("id,delivery_status,city:raw->shipping_address->>city,province:raw->shipping_address->>province_code,country:raw->shipping_address->>country_code")
    .in("id", ids);
  if (oErr) throw new Error(oErr.message);
  const orderBy = new Map((orders ?? []).map((o: any) => [o.id as string, o]));

  const seen = new Set<string>();
  const out: RecentDelivery[] = [];
  for (const t of tracks) {
    if (out.length >= RECENT_MAX) break;
    if (seen.has(t.order_id) || !t.last_event_at) continue;
    const o: any = orderBy.get(t.order_id);
    if (!o || o.country !== "US" || !o.city || !o.province) continue;
    // Mesma normalização do /api/public/track.
    const st = normalizeStatus(t.tracking_status, o.delivery_status === "delivered");
    if (st !== "Delivered" && st !== "OutForDelivery") continue;
    // Mesma validação de local da página: só EUA, estado válido, sem texto
    // estranho (não-ASCII, China/alfândega…). Sem cidade segura, fica de fora.
    const place = usPlace(`${o.city}, ${o.province}`).display;
    const cut = place ? place.lastIndexOf(", ") : -1;
    if (!place || cut <= 0) continue;
    seen.add(t.order_id);
    out.push({
      city: titleCase(place.slice(0, cut).trim()),
      region: place.slice(cut + 2).trim(),
      country: "US",
      status: st === "Delivered" ? "Delivered" : "Out for Delivery",
      at: new Date(t.last_event_at).toISOString(),
    });
  }
  return out;
}

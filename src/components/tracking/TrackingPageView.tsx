import { Package, Truck, MapPin, CircleCheck, CircleAlert, Clock } from "lucide-react";
// Página de rastreio do cliente (em inglês — clientes nos EUA): usada na rota
// pública /track/<código> e na prévia da aba Teste.
// Só dados do rastreio: nada de nome, endereço, e-mail ou valor do pedido.
const STEPS = [
  { label: "Order shipped", icon: Package },
  { label: "In transit", icon: Truck },
  { label: "Out for delivery", icon: MapPin },
  { label: "Delivered", icon: CircleCheck },
];

const STATUS_TEXT: Record<string, string> = {
  NotFound: "Waiting for carrier update",
  InfoReceived: "Label created — waiting for pickup",
  InTransit: "In transit",
  AvailableForPickup: "Ready for pickup",
  OutForDelivery: "Out for delivery",
  Delivered: "Delivered",
  DeliveryFailure: "Delivery attempt failed",
  Exception: "Delivery issue",
  Expired: "No recent updates",
};

function stepOf(status: string | null) {
  switch (status) {
    case "Delivered": return 3;
    case "OutForDelivery": case "AvailableForPickup": case "DeliveryFailure": return 2;
    case "InTransit": case "Exception": case "Expired": return 1;
    default: return 0;
  }
}

const fmt = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : iso;
};

type TrackingEvent = { at: string | null; description: string; location: string | null };

export function TrackingPageView({
  storeName, logoUrl, orderNumber, trackingNumber, status, events,
}: { storeName: string; logoUrl?: string | null; orderNumber: string | null; trackingNumber: string; status: string | null; events: TrackingEvent[] }) {
  const step = stepOf(status);
  const problem = status === "Exception" || status === "DeliveryFailure";
  return (
    <div className="rounded-2xl border bg-white text-zinc-900 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0">
          {logoUrl && <img src={logoUrl} alt="" className="h-7 w-auto max-w-[120px] object-contain" />}
          <span className="font-semibold tracking-tight truncate">{storeName}</span>
        </span>
        <span className="text-xs text-zinc-500">Track your order</span>
      </div>
      <div className="px-5 py-6 space-y-6">
        <div>
          {orderNumber && <p className="text-xs text-zinc-500">Order {orderNumber}</p>}
          <p className={`text-xl font-semibold ${problem ? "text-red-600" : ""}`}>{STATUS_TEXT[status ?? ""] ?? "Waiting for carrier update"}</p>
          <p className="text-xs text-zinc-500 mt-1">Tracking number <span className="font-mono">{trackingNumber}</span></p>
        </div>

        <div className="grid grid-cols-4 gap-1">
          {STEPS.map((s, i) => {
            const done = i <= step;
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex flex-col items-center gap-1.5 text-center">
                <div className={`h-1.5 w-full rounded-full ${done ? (problem && i === step ? "bg-red-500" : "bg-emerald-500") : "bg-zinc-200"}`} />
                <Icon className={`size-4 ${done ? "text-zinc-900" : "text-zinc-300"}`} />
                <span className={`text-[11px] leading-tight ${done ? "text-zinc-900 font-medium" : "text-zinc-400"}`}>{s.label}</span>
              </div>
            );
          })}
        </div>

        <div>
          <p className="text-sm font-semibold mb-3">Shipment history</p>
          {events.length === 0 ? (
            <p className="text-sm text-zinc-500 flex items-center gap-2"><Clock className="size-4" /> No updates from the carrier yet.</p>
          ) : (
            <ol className="relative border-l border-zinc-200 ml-1.5 space-y-4">
              {events.map((e, i) => (
                <li key={i} className="pl-4 relative">
                  <span className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full ${i === 0 ? (problem ? "bg-red-500" : "bg-emerald-500") : "bg-zinc-300"}`} />
                  <p className={`text-sm ${i === 0 ? "font-medium" : "text-zinc-700"}`}>{e.description}</p>
                  <p className="text-xs text-zinc-500">{[fmt(e.at), e.location].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
        {problem && (
          <p className="text-xs text-red-600 flex items-center gap-1.5"><CircleAlert className="size-3.5" /> If you need help, reply to your shipping confirmation email.</p>
        )}
      </div>
    </div>
  );
}

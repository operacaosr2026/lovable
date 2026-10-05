import { useState, type ReactNode } from "react";
import { Check, ExternalLink } from "lucide-react";
import { TRACKING_BRAND, type DisplayEvent, type DisplayStep } from "@/lib/tracking-display";

// Página de rastreio do cliente (em inglês — clientes nos EUA), no estilo da
// página de rastreio da loja Voultie. Usada na rota pública /track e na prévia
// da aba Teste.
const STATUS_TEXT: Record<string, string> = {
  NotFound: "Order Ready",
  InfoReceived: "Order Ready",
  InTransit: "In Transit",
  AvailableForPickup: "Ready for Pickup",
  OutForDelivery: "Out for Delivery",
  Delivered: "Delivered",
  DeliveryFailure: "Delivery Attempted",
  Exception: "In Transit",
  Expired: "In Transit",
};

const fmtDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
};
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }).toLowerCase();
  return `${day} ${time}`;
};

export function TrackingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-white text-zinc-900" style={{ fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif" }}>
      <header className="border-b border-zinc-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-10 h-16 sm:h-[75px] flex items-center">
          <img src={TRACKING_BRAND.logo} alt={TRACKING_BRAND.name} className="h-7 sm:h-10 w-auto" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 sm:px-10 py-10 sm:py-14">{children}</main>
    </div>
  );
}

export function TrackingPageView({
  orderNumber, trackingNumber, status, steps, currentStep, events, destination,
}: {
  orderNumber: string | null; trackingNumber: string; status: string | null;
  steps: DisplayStep[]; currentStep: number; events: DisplayEvent[]; destination: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? events : events.slice(0, 3);
  const title = STATUS_TEXT[status ?? ""] ?? steps[currentStep]?.label ?? "Order Ready";

  return (
    <div className="space-y-12">
      <div className="text-center space-y-4">
        <p className="text-lg sm:text-2xl">{orderNumber ? `Order: ${orderNumber}` : `Tracking: ${trackingNumber}`}</p>
        <h1 className="text-3xl sm:text-5xl font-light tracking-tight">{title}</h1>
      </div>

      <div className="flex items-start mx-auto max-w-5xl">
        {steps.map((s, i) => {
          const done = i <= currentStep;
          return (
            <div key={s.label} className="flex-1 flex flex-col items-center relative min-w-0">
              {i > 0 && <div className={`absolute top-[22px] sm:top-6 right-1/2 w-full h-1 sm:h-1.5 -translate-y-1/2 ${i <= currentStep ? "bg-green-600" : "bg-zinc-200"}`} style={{ marginRight: "22px", width: "calc(100% - 44px)" }} />}
              <div className={`relative z-10 size-9 sm:size-12 rounded-full grid place-items-center ${done ? "bg-green-600 text-white" : "bg-zinc-200 text-zinc-400"}`}>
                {done && <Check className="size-4 sm:size-5" strokeWidth={3} />}
              </div>
              <p className="mt-3 text-[11px] sm:text-lg text-center leading-tight">{s.label}</p>
              <p className="text-[10px] sm:text-base text-zinc-500 h-5">{done ? fmtDay(s.at) : ""}</p>
            </div>
          );
        })}
      </div>

      <div className="grid md:grid-cols-[1fr_minmax(0,440px)] gap-12 max-w-6xl mx-auto">
        <section>
          <h2 className="text-xl sm:text-2xl font-light mb-6">Shipping Details</h2>
          {events.length === 0 ? (
            <p className="text-zinc-500">Your order is being prepared. Tracking updates will appear here once the carrier scans your package.</p>
          ) : (
            <>
              <ol className="space-y-6">
                {shown.map((e, i) => (
                  <li key={i} className="flex gap-5">
                    <div className="flex flex-col items-center pt-1.5">
                      <span className={`rounded-full ${i === 0 ? "size-4 bg-green-600" : "size-2.5 bg-zinc-300 mt-1"}`} />
                      {i < shown.length - 1 && <span className="flex-1 border-l-2 border-dashed border-zinc-200 mt-2 -mb-6" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base sm:text-lg">{e.location ? `${e.location}, ` : ""}{e.description}</p>
                      <p className="text-sm sm:text-base text-zinc-500">{fmtDateTime(e.at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {events.length > 3 && (
                <button onClick={() => setShowAll((v) => !v)} className="mt-6 text-base sm:text-lg hover:underline">
                  {showAll ? "Hide History" : "Show History"}
                </button>
              )}
            </>
          )}
        </section>

        <section>
          <h2 className="text-xl sm:text-2xl font-light mb-6">Package Info</h2>
          <p className="text-base sm:text-lg mb-3">Destination</p>
          {destination ? (
            <div className="rounded-xl overflow-hidden border border-zinc-200 aspect-[4/3] relative">
              <iframe
                title="Destination"
                className="absolute inset-0 w-full h-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://maps.google.com/maps?q=${encodeURIComponent(`${destination}, USA`)}&z=11&output=embed`}
              />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${destination}, USA`)}`}
                target="_blank" rel="noreferrer"
                className="absolute top-3 left-3 bg-white text-blue-600 text-sm font-medium px-3 py-1.5 rounded shadow inline-flex items-center gap-1"
              >
                {destination} <ExternalLink className="size-3.5" />
              </a>
            </div>
          ) : (
            <p className="text-zinc-500">United States</p>
          )}
          <p className="mt-4 text-sm text-zinc-500">Tracking number: <span className="font-mono">{trackingNumber}</span></p>
        </section>
      </div>
    </div>
  );
}

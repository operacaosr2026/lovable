import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { getPublicTracking } from "@/lib/public-tracking.functions";
import { TrackingPageView, TrackingShell } from "@/components/tracking/TrackingPageView";

// Página pública de rastreio (sem login) — uma URL pra todas as lojas, sempre
// com a marca Voultie. Liberada no AuthGate (__root.tsx).
export const Route = createFileRoute("/track/$code")({
  head: () => ({ meta: [{ title: "Track Your Order" }, { name: "robots", content: "noindex" }],
    links: [{ rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;700&display=swap" }] }),
  component: TrackPage,
});

function TrackPage() {
  const { code } = Route.useParams();
  const fn = useServerFn(getPublicTracking);
  const { data, isLoading } = useQuery({
    queryKey: ["public-tracking", code],
    queryFn: () => fn({ data: { code } }),
    retry: false,
  });
  const t = data?.tracking;

  return (
    <TrackingShell>
      {isLoading ? (
        <div className="grid place-items-center py-24"><Loader2 className="size-6 animate-spin text-zinc-400" /></div>
      ) : t ? (
        <TrackingPageView
          orderNumber={t.orderNumber} trackingNumber={t.trackingNumber} status={t.status}
          steps={t.steps} currentStep={t.currentStep} events={t.events} destination={t.destination}
        />
      ) : (
        <div className="text-center space-y-4 py-10">
          <h1 className="text-3xl sm:text-4xl font-light">Tracking number not found</h1>
          <p className="text-zinc-500 max-w-md mx-auto">
            We couldn't find <span className="font-mono">{code}</span>. It can take up to 48 hours after your order ships for tracking to become available.
          </p>
          <Link to="/track" className="inline-block mt-2 bg-zinc-900 text-white font-semibold px-8 py-3 rounded-md">Try again</Link>
        </div>
      )}
    </TrackingShell>
  );
}

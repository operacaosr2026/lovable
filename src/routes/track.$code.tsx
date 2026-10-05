import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PackageSearch } from "lucide-react";
import { getPublicTracking } from "@/lib/public-tracking.functions";
import { TrackingPageView } from "@/components/tracking/TrackingPageView";

// Página pública de rastreio (sem login) — uma URL pra todas as lojas; a loja
// vem do próprio pedido. Liberada no AuthGate (__root.tsx).
export const Route = createFileRoute("/track/$code")({
  head: () => ({ meta: [{ title: "Track your order" }, { name: "robots", content: "noindex" }] }),
  component: TrackPage,
});

function TrackPage() {
  const { code } = Route.useParams();
  const fn = useServerFn(getPublicTracking);
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-tracking", code],
    queryFn: () => fn({ data: { code } }),
    retry: false,
  });
  const t = data?.tracking;

  return (
    <div className="min-h-dvh bg-zinc-100 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-xl">
        {isLoading ? (
          <div className="grid place-items-center py-24"><Loader2 className="size-6 animate-spin text-zinc-400" /></div>
        ) : t ? (
          <TrackingPageView
            storeName={t.storeName} logoUrl={t.logoUrl} orderNumber={t.orderNumber}
            trackingNumber={t.trackingNumber} status={t.status} events={t.events}
          />
        ) : (
          <div className="rounded-2xl border bg-white text-zinc-900 p-8 text-center space-y-2">
            <PackageSearch className="size-8 mx-auto text-zinc-400" />
            <p className="font-semibold">Tracking number not found</p>
            <p className="text-sm text-zinc-500">
              {error ? "Please check the tracking number and try again." : `We couldn't find "${code}". It can take up to 48 hours after shipping for tracking to become available.`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

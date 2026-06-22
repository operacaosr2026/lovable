import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { ConnectionsRegistry } from "@/components/shops/ConnectionsRegistry";

export const Route = createFileRoute("/shops/connections")({
  beforeLoad: requireAuth,
  component: ShopsConnectionsPage,
});

function ShopsConnectionsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Banco de Lojas"
        subtitle="Gerencie as lojas Shopify disponíveis para vincular a grupos"
      />
      <div className="p-6 max-w-2xl">
        <ConnectionsRegistry />
      </div>
    </PageShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/PageHeader";
import { CompanyGoals } from "@/components/goals/CompanyGoals";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/metas")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Metas — SRX Growth" }] }),
  component: MetasPage,
});

function MetasPage() {
  return (
    <PageShell fit>
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Metas</h1>
      </div>
      <CompanyGoals />
    </PageShell>
  );
}

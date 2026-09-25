import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { CompanyGoals } from "@/components/goals/CompanyGoals";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/metas")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Metas — SRX Growth" }] }),
  component: MetasPage,
});

function MetasPage() {
  return (
    <PageShell>
      <PageHeader title="Metas" />
      <CompanyGoals />
    </PageShell>
  );
}

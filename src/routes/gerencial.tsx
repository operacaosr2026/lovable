import { createFileRoute } from "@tanstack/react-router";
import { Briefcase } from "lucide-react";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";

// Gerencial: visão de gestão (permissão "gerencial" em Configurações > Membros).
export const Route = createFileRoute("/gerencial")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Gerencial — SRX Growth" }] }),
  component: GerencialPage,
});

function GerencialPage() {
  return (
    <PageShell>
      <PageHeader title="Gerencial" />
      <div className="rounded-2xl border border-dashed border-border bg-card py-16 grid place-items-center text-center">
        <span className="size-12 rounded-2xl grid place-items-center bg-primary/10 text-primary mb-3"><Briefcase className="size-6" /></span>
        <p className="text-sm font-medium">Em construção</p>
      </div>
    </PageShell>
  );
}

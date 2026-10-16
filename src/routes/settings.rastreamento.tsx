import { createFileRoute } from "@tanstack/react-router";
import { Truck } from "lucide-react";

export const Route = createFileRoute("/settings/rastreamento")({
  component: RastreamentoPage,
});

function RastreamentoPage() {
  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Rastreamento</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configurações do rastreio dos pedidos.
        </p>
      </header>

      <section className="premium-card p-10 text-center space-y-2">
        <Truck className="size-6 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">Nenhuma configuração ainda.</p>
      </section>
    </div>
  );
}

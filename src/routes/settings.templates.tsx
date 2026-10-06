import { createFileRoute } from "@tanstack/react-router";
import { ProductionTemplates } from "@/components/shops/ProductionTemplates";

export const Route = createFileRoute("/settings/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          O que se repete na produção de toda loja: informações, etapas com responsáveis e acessos. Aplique pela aba Produção do card no Banco de Lojas.
        </p>
      </header>
      <ProductionTemplates />
    </div>
  );
}

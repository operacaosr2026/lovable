import { createFileRoute } from "@tanstack/react-router";
import { Layers, Package, Store } from "lucide-react";
import { ProductionTemplates } from "@/components/shops/ProductionTemplates";
import { VariantTemplates } from "@/components/products/VariantTemplates";

type Tipo = "lojas" | "produtos" | "variantes";

export const Route = createFileRoute("/settings/templates")({
  validateSearch: (search: Record<string, unknown>) => ({
    tipo: (search.tipo === "produtos" || search.tipo === "variantes" ? search.tipo : "lojas") as Tipo,
  }),
  component: TemplatesPage,
});

const TABS: { id: Tipo; label: string; icon: typeof Store }[] = [
  { id: "lojas", label: "Lojas", icon: Store },
  { id: "produtos", label: "Produtos", icon: Package },
  { id: "variantes", label: "Variantes", icon: Layers },
];

function TemplatesPage() {
  const { tipo } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          O que se repete na produção: informações, etapas com responsáveis, políticas e arquivos. Lojas e produtos têm templates
          separados — aplique pela aba Produção do card da loja (Banco de Lojas) ou do produto (Produtos).
        </p>
      </header>
      <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => navigate({ search: { tipo: id }, replace: true })}
            className={`h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${tipo === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>
      {tipo === "variantes"
        ? <VariantTemplates />
        : <ProductionTemplates key={tipo} kind={tipo === "produtos" ? "product" : "store"} />}
    </div>
  );
}

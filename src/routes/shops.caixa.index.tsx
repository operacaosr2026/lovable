import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Wallet, FlaskConical, ShieldAlert } from "lucide-react";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { listCaixaShops } from "@/lib/lg-cards.functions";
import { LgCashflowView } from "@/components/lojas-grupos/LgCashflowView";
import { CaixaSimulator } from "@/components/caixa/CaixaSimulator";
import { ChargebackSimulator } from "@/components/caixa/ChargebackSimulator";

type Tab = "caixa" | "simulador" | "chargeback";
const VALID_TABS: Tab[] = ["caixa", "simulador", "chargeback"];

export const Route = createFileRoute("/shops/caixa/")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (VALID_TABS.includes(s.tab as Tab) ? s.tab : "caixa") as Tab,
  }),
  component: CaixaIndex,
});

function CaixaIndex() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setTab = (t: Tab) => navigate({ search: (prev: any) => ({ ...prev, tab: t }), replace: true });

  const listShopsFn = useServerFn(listCaixaShops);
  const { data: shops = [], isLoading } = useQuery({
    queryKey: ["caixa-shops"],
    queryFn: () => listShopsFn(),
  }) as { data: any[]; isLoading: boolean };

  const shopIds = shops.map((s) => s.id as string);
  const shopNamesMap = Object.fromEntries(shops.map((s) => [s.id, s.name as string]));

  return (
    <PageShell fit>
      <PageHeader
        title="Caixa Geral"
        subtitle={shops.length > 0 ? `${shops.length} ${shops.length === 1 ? "loja conectada" : "lojas conectadas"}` : undefined}
      />

      {/* shrink-0: no layout de tela cheia (fit), conteúdo alto (Simulador) encolhia esta linha até sumir. */}
      <div className="flex items-center gap-1 mb-4 border-b border-border overflow-x-auto shrink-0">
        <TabBtn active={tab === "caixa"} onClick={() => setTab("caixa")} icon={Wallet}>Caixa</TabBtn>
        <TabBtn active={tab === "simulador"} onClick={() => setTab("simulador")} icon={FlaskConical}>Simulador de Caixa</TabBtn>
        <TabBtn active={tab === "chargeback"} onClick={() => setTab("chargeback")} icon={ShieldAlert}>Simulador Chargeback</TabBtn>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : shopIds.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Wallet className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma loja conectada ainda.</p>
        </div>
      ) : tab === "simulador" ? (
        <CaixaSimulator />
      ) : tab === "chargeback" ? (
        <ChargebackSimulator />
      ) : (
        <LgCashflowView shopIds={shopIds} shopNamesMap={shopNamesMap} simplified standalone fill />
      )}
    </PageShell>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 h-9 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-4" /> {children}
    </button>
  );
}

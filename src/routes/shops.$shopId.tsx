import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/PageHeader";
import { ArrowLeft, Package, KanbanSquare, Store, MapPin, Wallet, ShoppingBag, BookOpen, Target, Plug, MessageCircle, LayoutDashboard } from "lucide-react";
import { getShop } from "@/lib/shops.functions";
import { ProductPipeline } from "@/components/shops/ProductPipeline";
import { ShopTaskKanban } from "@/components/shops/ShopTaskKanban";
import { ShopCashflow } from "@/components/shops/ShopCashflow";
import { ShopWiki } from "@/components/shops/ShopWiki";
import { ShopOrders } from "@/components/shops/ShopOrders";
import { ShopProfitGoal } from "@/components/shops/ShopProfitGoal";
import { ShopIntegrations } from "@/components/shops/ShopIntegrations";
import { ShopSupport } from "@/components/shops/ShopSupport";
import { ShopDashboard } from "@/components/shops/ShopDashboard";

type Tab = "dashboard" | "products" | "tasks" | "cash" | "orders" | "wiki" | "goal" | "integrations" | "support";

const VALID_TABS: Tab[] = ["dashboard", "products", "tasks", "cash", "orders", "wiki", "goal", "integrations", "support"];

export const Route = createFileRoute("/shops/$shopId")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (VALID_TABS.includes(search.tab as Tab) ? search.tab : "dashboard") as Tab,
    meta_connected: search.meta_connected === "1" ? true : undefined as true | undefined,
  }),
  component: ShopDetail,
});

function ShopDetail() {
  const { shopId } = Route.useParams();
  const { tab, meta_connected } = Route.useSearch();
  const navigate = useNavigate({ from: "/shops/$shopId" });
  const get = useServerFn(getShop);

  const setTab = (t: Tab) =>
    navigate({ search: (prev) => ({ ...prev, tab: t }), replace: true });

  const { data, isLoading } = useQuery({
    queryKey: ["shop", shopId],
    queryFn: () => get({ data: { id: shopId } }),
  });
  const s = data?.shop as any;

  if (isLoading) return <PageShell><div className="text-sm text-muted-foreground">Carregando...</div></PageShell>;
  if (!s) return (
    <PageShell>
      <div className="text-sm text-muted-foreground">Loja não encontrada.</div>
      <Link to="/shops" className="text-sm text-primary mt-3 inline-block">← Voltar</Link>
    </PageShell>
  );

  return (
    <PageShell>
      <div className="flex items-center gap-3 mb-3">
        <Link to="/shops" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft className="size-4" /> Lojas
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 text-xs font-semibold">
            {s.name?.[0]?.toUpperCase() ?? <Store className="size-3.5" />}
          </div>
          <h1 className="text-base font-semibold tracking-tight truncate">{s.name}</h1>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <span className="size-1.5 rounded-full bg-primary" /> {s.status}
          </span>
          {s.country && <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0"><MapPin className="size-3" /> {s.country}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-border overflow-x-auto">
        <TabBtn active={tab === "dashboard"} onClick={() => setTab("dashboard")} icon={LayoutDashboard}>Dashboard</TabBtn>
        <TabBtn active={tab === "goal"} onClick={() => setTab("goal")} icon={Target}>Metas</TabBtn>
        <TabBtn active={tab === "cash"} onClick={() => setTab("cash")} icon={Wallet}>Caixa</TabBtn>
        <TabBtn active={tab === "orders"} onClick={() => setTab("orders")} icon={ShoppingBag}>Pedidos</TabBtn>
        <TabBtn active={tab === "tasks"} onClick={() => setTab("tasks")} icon={KanbanSquare}>Tarefas</TabBtn>
        <TabBtn active={tab === "support"} onClick={() => setTab("support")} icon={MessageCircle}>Atendimento</TabBtn>
        <TabBtn active={tab === "products"} onClick={() => setTab("products")} icon={Package}>Produtos</TabBtn>
        <TabBtn active={tab === "wiki"} onClick={() => setTab("wiki")} icon={BookOpen}>Diário</TabBtn>
        <TabBtn active={tab === "integrations"} onClick={() => setTab("integrations")} icon={Plug}>Integrações</TabBtn>
      </div>

      {tab === "dashboard" && <ShopDashboard shopIds={[shopId]} shopName={s.name} />}
      {tab === "products" && <ProductPipeline shopIds={[shopId]} />}
      {tab === "orders" && <ShopOrders shopIds={[shopId]} />}
      {tab === "support" && <ShopSupport shopIds={[shopId]} />}
      {tab === "tasks" && <ShopTaskKanban shopIds={[shopId]} />}
      {tab === "cash" && <ShopCashflow shopIds={[shopId]} />}
      {tab === "goal" && <ShopProfitGoal shopIds={[shopId]} />}
      {tab === "integrations" && <ShopIntegrations shopId={shopId} metaConnected={meta_connected} />}
      {tab === "wiki" && <ShopWiki shopIds={[shopId]} />}
    </PageShell>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 h-9 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className="size-4" /> {children}
    </button>
  );
}

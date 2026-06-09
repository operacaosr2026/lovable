import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/PageHeader";
import { ArrowLeft, LayoutDashboard, Package, KanbanSquare, Store, MapPin, Wallet, ShoppingBag, BookOpen, Target, Plug, MessageCircle } from "lucide-react";
import { getShop } from "@/lib/shops.functions";
import { ShopOverview } from "@/components/shops/ShopOverview";
import { ProductPipeline } from "@/components/shops/ProductPipeline";
import { ShopTaskKanban } from "@/components/shops/ShopTaskKanban";
import { ShopCashflow } from "@/components/shops/ShopCashflow";
import { ShopWiki } from "@/components/shops/ShopWiki";
import { ShopOrders } from "@/components/shops/ShopOrders";
import { ShopProfitGoal } from "@/components/shops/ShopProfitGoal";
import { ShopIntegrations } from "@/components/shops/ShopIntegrations";
import { ShopSupport } from "@/components/shops/ShopSupport";

export const Route = createFileRoute("/shops/$shopId")({
  component: ShopDetail,
});

type Tab = "overview" | "products" | "tasks" | "cash" | "orders" | "wiki" | "goal" | "integrations" | "support";

function ShopDetail() {
  const { shopId } = Route.useParams();
  const get = useServerFn(getShop);
  const [tab, setTab] = useState<Tab>("overview");

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
      <Link to="/shops" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="size-4" /> Lojas
      </Link>

      <div className="rounded-2xl border border-border bg-surface p-5 mb-5">
        <div className="flex items-start gap-4">
          {s.logo_url ? (
            <img src={s.logo_url} alt={s.name} className="size-14 rounded-xl object-cover border border-border" />
          ) : (
            <div className="size-14 rounded-xl bg-primary/10 text-primary grid place-items-center">
              <Store className="size-7" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs text-muted-foreground">
              {s.country && <span className="inline-flex items-center gap-1"><MapPin className="size-3" /> {s.country}</span>}
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-primary" /> {s.status}
              </span>
              <span>· criada em {new Date(s.created_at).toLocaleDateString("pt-BR")}</span>
            </div>
            {s.description && <p className="text-sm text-muted-foreground mt-2">{s.description}</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-border overflow-x-auto">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")} icon={LayoutDashboard}>Visão geral</TabBtn>
        <TabBtn active={tab === "tasks"} onClick={() => setTab("tasks")} icon={KanbanSquare}>Tarefas</TabBtn>
        <TabBtn active={tab === "cash"} onClick={() => setTab("cash")} icon={Wallet}>Caixa</TabBtn>
        <TabBtn active={tab === "orders"} onClick={() => setTab("orders")} icon={ShoppingBag}>Pedidos</TabBtn>
        <TabBtn active={tab === "support"} onClick={() => setTab("support")} icon={MessageCircle}>Atendimento</TabBtn>
        <TabBtn active={tab === "goal"} onClick={() => setTab("goal")} icon={Target}>Meta de Lucro</TabBtn>
        <TabBtn active={tab === "products"} onClick={() => setTab("products")} icon={Package}>Produtos</TabBtn>
        <TabBtn active={tab === "integrations"} onClick={() => setTab("integrations")} icon={Plug}>Integrações</TabBtn>
        <TabBtn active={tab === "wiki"} onClick={() => setTab("wiki")} icon={BookOpen}>Central da Loja</TabBtn>
      </div>

      {tab === "overview" && <ShopOverview shopId={shopId} onGoTab={setTab} />}
      {tab === "products" && <ProductPipeline shopId={shopId} />}
      {tab === "orders" && <ShopOrders shopId={shopId} />}
      {tab === "support" && <ShopSupport shopId={shopId} />}
      {tab === "tasks" && <ShopTaskKanban shopId={shopId} />}
      {tab === "cash" && <ShopCashflow shopId={shopId} />}
      {tab === "goal" && <ShopProfitGoal shopId={shopId} />}
      {tab === "integrations" && <ShopIntegrations shopId={shopId} />}
      {tab === "wiki" && <ShopWiki shopId={shopId} />}
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

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/PageHeader";
import {
  ArrowLeft, Users, MapPin, Store, Layers,
  LayoutDashboard, Target, Wallet, ShoppingBag,
  KanbanSquare, MessageCircle, Package, BookOpen, Plug,
} from "lucide-react";
import { getGroup } from "@/lib/shop-groups.functions";
import { ShopDashboard } from "@/components/shops/ShopDashboard";
import { ShopProfitGoal } from "@/components/shops/ShopProfitGoal";
import { ShopCashflow } from "@/components/shops/ShopCashflow";
import { ShopOrders } from "@/components/shops/ShopOrders";
import { ShopTaskKanban } from "@/components/shops/ShopTaskKanban";
import { ShopSupport } from "@/components/shops/ShopSupport";
import { ProductPipeline } from "@/components/shops/ProductPipeline";
import { ShopWiki } from "@/components/shops/ShopWiki";
import { ShopIntegrations } from "@/components/shops/ShopIntegrations";

type Tab = "dashboard" | "goal" | "cash" | "orders" | "tasks" | "support" | "products" | "wiki" | "integrations";
const VALID_TABS: Tab[] = ["dashboard", "goal", "cash", "orders", "tasks", "support", "products", "wiki", "integrations"];

const COUNTRIES: Record<string, string> = {
  US: "🇺🇸", CA: "🇨🇦", GB: "🇬🇧", BE: "🇧🇪", CH: "🇨🇭", AU: "🇦🇺",
};

export const Route = createFileRoute("/shops/grupos/$groupId")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (VALID_TABS.includes(s.tab as Tab) ? s.tab : "dashboard") as Tab,
    meta_connected: s.meta_connected === "1" ? true : undefined as true | undefined,
  }),
  component: GroupDetail,
});

function GroupDetail() {
  const { groupId } = Route.useParams();
  const { tab, meta_connected } = Route.useSearch();
  const navigate = Route.useNavigate();
  const getFn = useServerFn(getGroup);

  const { data, isLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getFn({ data: { id: groupId } }),
  });

  const group = data?.group as any;
  const shops = (data?.shops ?? []) as any[];

  const [selectedShopId, setSelectedShopId] = useState<string | "consolidado">("consolidado");
  const isConsolidado = selectedShopId === "consolidado";
  const allShopIds = shops.map((s: any) => s.id);
  const activeShopId = isConsolidado ? null : selectedShopId;
  const activeShop = isConsolidado ? null : (shops.find((s: any) => s.id === activeShopId) ?? null);

  const setTab = (t: Tab) =>
    navigate({ search: (prev: any) => ({ ...prev, tab: t }), replace: true });

  if (isLoading) return <PageShell><div className="text-sm text-muted-foreground">Carregando...</div></PageShell>;
  if (!group) return (
    <PageShell>
      <div className="text-sm text-muted-foreground">Grupo não encontrado.</div>
      <Link to="/shops/grupos" className="text-sm text-primary mt-3 inline-block">← Voltar</Link>
    </PageShell>
  );

  const flag = COUNTRIES[group.country] ?? null;

  return (
    <PageShell>
      {/* Breadcrumb + group header */}
      <div className="flex items-center gap-3 mb-3">
        <Link to="/shops/grupos" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft className="size-4" /> Grupos
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          {group.logo_url ? (
            <img src={group.logo_url} alt="logo" className="size-7 rounded-lg object-cover border border-border shrink-0" />
          ) : (
            <div className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 text-xs font-semibold">
              {group.name?.[0]?.toUpperCase() ?? <Users className="size-3.5" />}
            </div>
          )}
          <h1 className="text-base font-semibold tracking-tight truncate">{group.name}</h1>
          {group.tag && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 shrink-0">
              {group.tag}
            </span>
          )}
          {flag && <span className="text-sm shrink-0">{flag}</span>}
          {group.country && !flag && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <MapPin className="size-3" /> {group.country}
            </span>
          )}
        </div>
      </div>

      {/* Store selector */}
      {shops.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 mb-4 text-sm text-muted-foreground">
          Nenhuma loja vinculada a este grupo. Vincule lojas nas configurações do grupo.
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
          {/* Consolidated button */}
          <button
            onClick={() => setSelectedShopId("consolidado")}
            className={`flex items-center gap-2 px-3 h-9 rounded-xl border text-sm whitespace-nowrap transition-colors shrink-0 ${
              isConsolidado
                ? "bg-primary text-primary-foreground border-primary font-medium"
                : "bg-surface border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
            }`}
          >
            <Layers className="size-3.5 shrink-0" />
            Consolidado
          </button>
          {shops.map((s: any) => {
            const active = s.id === activeShopId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedShopId(s.id)}
                className={`flex items-center gap-2 px-3 h-9 rounded-xl border text-sm whitespace-nowrap transition-colors shrink-0 ${
                  active
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "bg-surface border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                }`}
              >
                <Store className="size-3.5 shrink-0" />
                {s.name}
                {s.role === "matriz" && (
                  <span className={`text-[10px] px-1 rounded ${active ? "bg-white/20" : "bg-primary/10 text-primary"}`}>
                    matriz
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Tabs */}
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

      {/* Content */}
      {allShopIds.length === 0 ? null : isConsolidado ? (
        <>
          {tab === "dashboard"    && <ShopDashboard shopIds={allShopIds} shopName={group.name} />}
          {tab === "goal"         && <ShopProfitGoal shopIds={allShopIds} />}
          {tab === "cash"         && <ShopCashflow shopIds={allShopIds} />}
          {tab === "orders"       && <ShopOrders shopIds={allShopIds} />}
          {tab === "tasks"        && <ShopTaskKanban shopIds={allShopIds} />}
          {tab === "support"      && <ShopSupport shopIds={allShopIds} />}
          {tab === "products"     && <ProductPipeline shopIds={allShopIds} />}
          {tab === "wiki"         && <ShopWiki shopIds={allShopIds} />}
          {tab === "integrations" && (
            <div className="flex flex-col gap-6">
              {shops.map((s: any) => (
                <div key={s.id}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{s.name}</p>
                  <ShopIntegrations shopId={s.id} metaConnected={meta_connected} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : activeShop ? (
        <>
          {tab === "dashboard"    && <ShopDashboard shopIds={[activeShop.id]} shopName={activeShop.name} />}
          {tab === "goal"         && <ShopProfitGoal shopIds={[activeShop.id]} />}
          {tab === "cash"         && <ShopCashflow shopIds={[activeShop.id]} />}
          {tab === "orders"       && <ShopOrders shopIds={[activeShop.id]} />}
          {tab === "tasks"        && <ShopTaskKanban shopIds={[activeShop.id]} />}
          {tab === "support"      && <ShopSupport shopIds={[activeShop.id]} />}
          {tab === "products"     && <ProductPipeline shopIds={[activeShop.id]} />}
          {tab === "wiki"         && <ShopWiki shopIds={[activeShop.id]} />}
          {tab === "integrations" && <ShopIntegrations shopId={activeShop.id} metaConnected={meta_connected} />}
        </>
      ) : null}
    </PageShell>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 h-9 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-4" /> {children}
    </button>
  );
}

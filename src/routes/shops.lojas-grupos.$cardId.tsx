import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/PageHeader";
import {
  ArrowLeft, Layers, MapPin, Store, ChevronDown,
  LayoutDashboard, Wallet, ShoppingBag, Plug, StickyNote, Truck,
} from "lucide-react";
import { getLgCard } from "@/lib/lg-cards.functions";
import { useMyAccess } from "@/hooks/useMyAccess";
import type { Section } from "@/lib/members.functions";
import { LgNotesSection }  from "@/components/lojas-grupos/LgNotesSection";
import { LgDashboard }     from "@/components/lojas-grupos/LgDashboard";
import { LgCaixa }         from "@/components/lojas-grupos/LgCaixa";
import { LgOrders }        from "@/components/lojas-grupos/LgOrders";
import { LgIntegrations }  from "@/components/lojas-grupos/LgIntegrations";
import { LgLogistica }     from "@/components/lojas-grupos/LgLogistica";

type Tab = "overview" | "dashboard" | "caixa" | "pedidos" | "logistica" | "integracoes";
const VALID_TABS: Tab[] = ["dashboard", "overview", "caixa", "pedidos", "logistica", "integracoes"];
// Permissão de cada subaba (Configurações > Membros); admin vê todas.
const TAB_SECTION: Record<Tab, Section> = {
  dashboard: "lg_dashboard", overview: "lg_diario", caixa: "lg_caixa",
  pedidos: "lg_pedidos", logistica: "lg_rastreamento", integracoes: "lg_integracoes",
};

const COUNTRIES: Record<string, string> = {
  US: "🇺🇸", CA: "🇨🇦", GB: "🇬🇧", BE: "🇧🇪", CH: "🇨🇭", AU: "🇦🇺",
};

export const Route = createFileRoute("/shops/lojas-grupos/$cardId")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (VALID_TABS.includes(s.tab as Tab) ? s.tab : "dashboard") as Tab,
  }),
  component: LgCardDetail,
});

function LgCardDetail() {
  const { cardId } = Route.useParams();
  const { tab: requestedTab } = Route.useSearch();
  const { canAccessSection, isLoading: accessLoading } = useMyAccess();
  // Subaba pedida sem permissão (ou link antigo) → primeira subaba liberada.
  // Enquanto as permissões carregam, não esconde nada.
  const allowedTabs = accessLoading ? VALID_TABS : VALID_TABS.filter((t) => canAccessSection(TAB_SECTION[t]));
  const tab: Tab | null = allowedTabs.includes(requestedTab) ? requestedTab : (allowedTabs[0] ?? null);
  const navigate   = Route.useNavigate();
  const getCardFn  = useServerFn(getLgCard);

  const { data, isLoading } = useQuery({
    queryKey: ["lg-card", cardId],
    queryFn:  () => getCardFn({ data: { id: cardId } }),
  });

  const card  = data?.card as any;
  const shops = (data?.shops ?? []) as any[];

  // All shop IDs attached to this card
  const allShopIds = shops.map((s: any) => s.shop_id);

  // Shop selector state — default = all shops
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen]           = useState(false);

  // Effective shop IDs after selection
  const effectiveShopIds = selectedShopIds.length > 0 ? selectedShopIds : allShopIds;
  const allSelected      = selectedShopIds.length === 0 || selectedShopIds.length === allShopIds.length;

  // Espaço à direita da linha das abas onde o Dashboard põe seus controles.
  const [tabActionsEl, setTabActionsEl] = useState<HTMLDivElement | null>(null);
  const setTab = (t: Tab) =>
    navigate({ search: (prev: any) => ({ ...prev, tab: t }), replace: true });

  if (isLoading) return <PageShell><div className="text-sm text-muted-foreground">Carregando...</div></PageShell>;
  if (!card) return (
    <PageShell>
      <div className="text-sm text-muted-foreground">Card não encontrado.</div>
      <Link to="/shops/lojas-grupos" className="text-sm text-primary mt-3 inline-block">← Voltar</Link>
    </PageShell>
  );

  const flag = COUNTRIES[card.country] ?? null;
  const shopNamesMap: Record<string, string> = {};
  for (const s of shops) {
    shopNamesMap[s.shop_id] = s.shops?.name ?? s.shop_id;
  }

  const toggleShop = (id: string) => {
    setSelectedShopIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        return next.length === allShopIds.length ? [] : next;
      }
      const next = [...prev, id];
      return next.length === allShopIds.length ? [] : next;
    });
  };

  const selectAll = () => setSelectedShopIds([]);

  return (
    // Na subaba Caixa o quadro da semana ocupa a altura da tela (como na página Caixa).
    <PageShell fit={tab === "caixa"}>
      {/* Breadcrumb + header */}
      {/* flex-wrap: em mobile, "Lojas e Grupos" + seletor de lojas sozinhos já
          ocupam a largura toda, espremendo o nome do card a quase zero
          (ex: "Route" virava "R..."); o texto some e a seleção de lojas quebra
          pra 2ª linha em vez de disputar espaço com o nome. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <Link
          to="/shops/lojas-grupos"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0"
        >
          <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Lojas e Grupos</span>
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          {card.logo_url ? (
            <img src={card.logo_url} alt="logo" className="size-7 rounded-lg object-cover border border-border shrink-0" />
          ) : (
            <div className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 text-xs font-semibold">
              {card.name?.[0]?.toUpperCase() ?? <Layers className="size-3.5" />}
            </div>
          )}
          <h1 className="text-base font-semibold tracking-tight truncate">{card.name}</h1>
          {card.tag && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 shrink-0">
              {card.tag}
            </span>
          )}
          {flag && <span className="text-sm shrink-0">{flag}</span>}
          {card.country && !flag && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <MapPin className="size-3" /> {card.country}
            </span>
          )}
        </div>

        {/* Shop drawer trigger — only if 2+ shops */}
        {allShopIds.length > 1 && (
          <div className="relative ml-auto shrink-0">
            <button
              onClick={() => setDrawerOpen((o) => !o)}
              className={`flex items-center gap-2 px-3 h-8 rounded-xl border text-sm transition-colors ${
                allSelected
                  ? "bg-surface border-border text-muted-foreground hover:text-foreground"
                  : "bg-primary/10 border-primary/40 text-primary"
              }`}
            >
              <Store className="size-3.5" />
              {allSelected ? "Todas as lojas" : `${effectiveShopIds.length} loja${effectiveShopIds.length !== 1 ? "s" : ""}`}
              <ChevronDown className={`size-3 transition-transform ${drawerOpen ? "rotate-180" : ""}`} />
            </button>

            {drawerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDrawerOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-background border border-border rounded-xl shadow-lg p-2 min-w-[200px]">
                  {/* Select all */}
                  <button
                    onClick={() => { selectAll(); setDrawerOpen(false); }}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors hover:bg-muted/50 ${allSelected ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}
                  >
                    <Layers className="size-3.5 shrink-0" />
                    Todas as lojas
                  </button>
                  <div className="border-t border-border my-1" />
                  {shops.map((s: any) => {
                    const active = effectiveShopIds.includes(s.shop_id);
                    return (
                      <button
                        key={s.shop_id}
                        onClick={() => toggleShop(s.shop_id)}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors hover:bg-muted/50 ${active && !allSelected ? "bg-primary/5 text-primary font-medium" : "text-foreground"}`}
                      >
                        <Store className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{shopNamesMap[s.shop_id] ?? s.shop_id}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* No shops warning */}
      {shops.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 mb-4 text-sm text-muted-foreground">
          Nenhuma loja conectada a este card. Edite o card para adicionar lojas.
        </div>
      )}

      {/* Tabs — à direita, os controles da aba ativa (Dashboard: data, sincronizar, período, moeda) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4 border-b border-border">
        <div className="flex items-center gap-1 overflow-x-auto">
          {allowedTabs.includes("dashboard") && <TabBtn active={tab === "dashboard"}   onClick={() => setTab("dashboard")}   icon={LayoutDashboard}>Dashboard</TabBtn>}
          {allowedTabs.includes("overview") && <TabBtn active={tab === "overview"}    onClick={() => setTab("overview")}    icon={StickyNote}>Diário</TabBtn>}
          {allowedTabs.includes("caixa") && <TabBtn active={tab === "caixa"}       onClick={() => setTab("caixa")}       icon={Wallet}>Caixa</TabBtn>}
          {allowedTabs.includes("pedidos") && <TabBtn active={tab === "pedidos"}     onClick={() => setTab("pedidos")}     icon={ShoppingBag}>Pedidos</TabBtn>}
          {allowedTabs.includes("logistica") && <TabBtn active={tab === "logistica"} onClick={() => setTab("logistica")} icon={Truck}>Rastreamento</TabBtn>}
          {allowedTabs.includes("integracoes") && <TabBtn active={tab === "integracoes"} onClick={() => setTab("integracoes")} icon={Plug}>Integrações</TabBtn>}
        </div>
        <div ref={setTabActionsEl} className="ml-auto pb-1.5 empty:hidden" />
      </div>

      {!tab && (
        <div className="bg-card border border-border rounded-2xl p-6 text-center text-sm text-muted-foreground">
          Você não tem acesso a nenhuma subaba deste grupo. Fale com o administrador.
        </div>
      )}

      {/* Content — only render when there are shops or for overview/integrations */}
      {tab === "overview" && (
        // Metas agora são da empresa (menu Metas); aqui fica só o Diário de Operação.
        <LgNotesSection cardId={card.id} shopIds={allShopIds} matrizShopId={card.matriz_shop_id ?? null} />
      )}
      {tab === "dashboard" && allShopIds.length > 0 && (
        <LgDashboard
          cardId={cardId}
          shopIds={effectiveShopIds}
          cardName={card.name}
          shopNamesMap={shopNamesMap}
          isConsolidated={effectiveShopIds.length > 1}
          actionsSlot={tabActionsEl}
        />
      )}
      {tab === "caixa" && allShopIds.length > 0 && (
        <LgCaixa
          cardId={cardId}
          shopIds={effectiveShopIds}
          shops={shops.map((s: any) => ({
            id:           s.shop_id,
            name:         shopNamesMap[s.shop_id] ?? s.shop_id,
            payout_days:  s.payout_days ?? 10,
            payment_days: s.payment_days ?? 7,
          }))}
        />
      )}
      {tab === "pedidos" && allShopIds.length > 0 && (
        <LgOrders
          cardId={cardId}
          shopIds={effectiveShopIds}
          shops={shops.map((s: any) => ({
            id:           s.shop_id,
            name:         shopNamesMap[s.shop_id] ?? s.shop_id,
            payment_days: s.payment_days ?? 7,
          }))}
        />
      )}
      {tab === "logistica" && allShopIds.length > 0 && (
        <LgLogistica
          shopIds={effectiveShopIds}
          shops={shops.map((s: any) => ({
            id:   s.shop_id,
            name: shopNamesMap[s.shop_id] ?? s.shop_id,
          }))}
        />
      )}
      {tab === "integracoes" && (
        <LgIntegrations
          cardId={cardId}
          card={card}
          shops={shops.map((s: any) => ({
            id:   s.shop_id,
            name: shopNamesMap[s.shop_id] ?? s.shop_id,
          }))}
        />
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

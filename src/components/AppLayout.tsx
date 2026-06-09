import { useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, KanbanSquare, Wallet, FolderKanban, Repeat,
  Calendar, Search, LogOut, Sparkles, Store, Package, Workflow, Menu, PenTool, Network, Users, Settings as SettingsIcon, ChevronDown, Heart,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMyAccess } from "@/hooks/useMyAccess";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  children?: { to: string; label: string; icon: typeof LayoutDashboard }[];
};

type NavGroup = {
  key: string;
  label: string;
  collapsible: boolean;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    key: "root",
    label: "",
    collapsible: false,
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    key: "pessoal",
    label: "Pessoal",
    collapsible: true,
    items: [
      { to: "/calendar", label: "Calendário", icon: Calendar },
      { to: "/habits", label: "Hábitos", icon: Repeat },
      { to: "/tasks", label: "Tarefas", icon: KanbanSquare },
      { to: "/whiteboard", label: "Quadro Branco", icon: PenTool },
      { to: "/finance", label: "Financeiro", icon: Wallet },
    ],
  },
  {
    key: "empresa",
    label: "Empresa",
    collapsible: true,
    items: [
      { to: "/projects", label: "Projetos", icon: FolderKanban },
      {
        to: "/shops",
        label: "Ecommerce",
        icon: Store,
        children: [
          { to: "/shops", label: "Lojas", icon: Store },
          { to: "/shops/esteira", label: "Esteira de Lojas", icon: Workflow },
          { to: "/shops/products", label: "Produtos", icon: Package },
          { to: "/shops/sops", label: "SOPs & Processos", icon: Network },
        ],
      },
    ],
  },
];

const adminNav: NavItem[] = [
  { to: "/settings/members", label: "Membros", icon: Users },
  { to: "/settings", label: "Configurações", icon: SettingsIcon },
];

export function AppLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const { role } = useMyAccess();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const displayName =
    (user?.user_metadata?.full_name as string) ||
    (user?.user_metadata?.name as string) ||
    user?.email?.split("@")[0] ||
    "Você";
  const avatar = user?.user_metadata?.avatar_url as string | undefined;

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const navContent = (onNavigate?: () => void) => {
    const renderItem = (item: NavItem) => {
      const isShopsRoot = item.to === "/shops";
      const active =
        item.to === "/"
          ? path === "/"
          : isShopsRoot
          ? path === "/shops" || (path.startsWith("/shops/") && !path.startsWith("/shops/products"))
          : path.startsWith(item.to);
      const Icon = item.icon;
      const sectionOpen = item.children && (active || item.children.some((c) => path.startsWith(c.to)));

      return (
        <div key={item.to}>
          <Link
            to={item.to}
            onClick={onNavigate}
            className={`relative flex items-center gap-2.5 px-3 h-10 md:h-9 rounded-lg text-sm transition-all mb-0.5 ${
              active ? "bg-white/10 text-white font-medium" : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full gradient-primary" />}
            <Icon className="size-4" />
            {item.label}
          </Link>
          {sectionOpen && item.children && (
            <div className="ml-4 pl-3 border-l border-white/10 mb-0.5">
              {item.children.map((child) => {
                const childActive =
                  child.to === "/shops"
                    ? path === "/shops" ||
                      (path.startsWith("/shops/") &&
                        !path.startsWith("/shops/products") &&
                        !path.startsWith("/shops/esteira") &&
                        !path.startsWith("/shops/sops"))
                    : path.startsWith(child.to);
                const ChildIcon = child.icon;
                return (
                  <Link
                    key={child.to}
                    to={child.to}
                    onClick={onNavigate}
                    className={`flex items-center gap-2.5 px-3 h-9 md:h-8 rounded-lg text-[13px] transition-all mb-0.5 ${
                      childActive ? "bg-white/10 text-white font-medium" : "text-white/55 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <ChildIcon className="size-3.5" />
                    {child.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    };

    return (
      <>
        <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center shadow-lg shadow-black/20">
            <Sparkles className="size-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold leading-none text-white">Orbit</div>
            <div className="text-[11px] text-white/50 mt-1">Personal OS</div>
          </div>
        </div>

        <div className="px-3 mt-2">
          <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-white/5 border border-white/10 text-xs text-white/60 hover:bg-white/10 transition-colors">
            <Search className="size-3.5" />
            Buscar
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-white/15 text-white/50">⌘K</span>
          </div>
        </div>

        <nav className="px-2 mt-4 flex-1 overflow-y-auto scrollbar-thin space-y-1">
          {navGroups.map((group, gi) => {
            const isCollapsed = group.collapsible && !!collapsed[group.key];

            return (
              <div key={group.key} className={gi > 0 ? "pt-1" : ""}>
                {group.label ? (
                  <button
                    onClick={() => group.collapsible && toggleGroup(group.key)}
                    className={`w-full flex items-center justify-between px-3 mb-1.5 mt-3 ${
                      group.collapsible ? "cursor-pointer group" : "cursor-default"
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wider text-white/40 font-medium group-hover:text-white/60 transition-colors">
                      {group.label}
                    </span>
                    {group.collapsible && (
                      <ChevronDown
                        className={`size-3 text-white/30 group-hover:text-white/50 transition-all ${
                          isCollapsed ? "-rotate-90" : ""
                        }`}
                      />
                    )}
                  </button>
                ) : null}
                {!isCollapsed && group.items.map(renderItem)}
              </div>
            );
          })}

          {role === "admin" && (
            <div className="pt-1">
              <div className="px-3 text-[10px] uppercase tracking-wider text-white/40 mb-1.5 font-medium mt-3">
                Administração
              </div>
              {adminNav.map((item) => {
                const active = path.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    className={`relative flex items-center gap-2.5 px-3 h-10 md:h-9 rounded-lg text-sm transition-all mb-0.5 ${
                      active ? "bg-white/10 text-white font-medium" : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full gradient-primary" />}
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors">
            {avatar ? (
              <img src={avatar} alt={displayName} className="size-7 rounded-full object-cover ring-2 ring-white/10" />
            ) : (
              <div className="size-7 rounded-full gradient-primary" />
            )}
            <div className="text-xs flex-1 min-w-0">
              <div className="font-medium truncate text-white">{displayName}</div>
              <div className="text-white/50 truncate">{user?.email}</div>
            </div>
            <button
              onClick={() => signOut()}
              title="Sair"
              className="size-7 rounded-md grid place-items-center text-white/50 hover:text-white hover:bg-white/10"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden md:flex w-60 flex-col border-r border-border bg-[var(--sidebar-bg)] sticky top-0 h-screen">
        {navContent()}
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 border-b border-border bg-background/95 backdrop-blur flex items-center justify-between px-4">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button
              aria-label="Abrir menu"
              className="size-9 -ml-2 grid place-items-center rounded-lg hover:bg-surface text-foreground"
            >
              <Menu className="size-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0 flex flex-col bg-[var(--sidebar-bg)]">
            {navContent(() => setMobileOpen(false))}
          </SheetContent>
        </Sheet>
        <Link to="/" className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-primary/15 grid place-items-center">
            <Sparkles className="size-3.5 text-primary" />
          </div>
          <span className="text-sm font-bold">Orbit</span>
        </Link>
        <button
          onClick={() => signOut()}
          aria-label="Sair"
          className="size-9 -mr-2 grid place-items-center rounded-lg hover:bg-surface text-muted-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </div>

      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}

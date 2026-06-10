import { useState, useEffect, useRef } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, KanbanSquare, Wallet, FolderKanban, Repeat,
  Calendar, Search, LogOut, Sparkles, Store, Package, Workflow, Menu, PenTool, Network, Users, Settings as SettingsIcon, ChevronDown, Heart, Loader2, Check, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMyAccess } from "@/hooks/useMyAccess";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  { to: "/settings", label: "Configurações", icon: SettingsIcon },
];

const ALL_PAGES = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendário", icon: Calendar },
  { to: "/habits", label: "Hábitos", icon: Repeat },
  { to: "/tasks", label: "Tarefas", icon: KanbanSquare },
  { to: "/whiteboard", label: "Quadro Branco", icon: PenTool },
  { to: "/finance", label: "Financeiro", icon: Wallet },
  { to: "/gratitude", label: "Gratidão", icon: Heart },
  { to: "/projects", label: "Projetos", icon: FolderKanban },
  { to: "/shops", label: "Ecommerce / Lojas", icon: Store },
  { to: "/shops/esteira", label: "Esteira de Lojas", icon: Workflow },
  { to: "/shops/products", label: "Produtos", icon: Package },
  { to: "/shops/sops", label: "SOPs & Processos", icon: Network },
  { to: "/settings/members", label: "Membros", icon: Users },
  { to: "/settings", label: "Configurações", icon: SettingsIcon },
];

function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState((user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || "");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onSave = async () => {
    if (pwd && pwd.length < 8) return toast.error("Senha deve ter ao menos 8 caracteres");
    if (pwd && pwd !== pwd2) return toast.error("As senhas não coincidem");
    setSaving(true);
    try {
      const authUpdate: { data?: { full_name: string }; password?: string } = {};
      if (name.trim()) authUpdate.data = { full_name: name.trim() };
      if (pwd) authUpdate.password = pwd;
      const { error } = await supabase.auth.updateUser(authUpdate);
      if (error) throw error;
      if (name.trim() && user) {
        supabase.from("profiles").update({ full_name: name.trim() }).eq("id", user.id).then(() => {});
      }
      toast.success("Perfil atualizado");
      setPwd(""); setPwd2("");
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const initials = (name || user?.email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <h2 className="text-base font-bold mb-5">Editar perfil</h2>

          <div className="flex justify-center mb-5">
            <div className="size-16 rounded-full gradient-primary grid place-items-center text-white text-xl font-bold">
              {initials}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Nome</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                className="w-full h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">E-mail</label>
              <input
                type="email"
                value={user?.email || ""}
                disabled
                className="w-full h-10 px-3.5 rounded-xl bg-muted border border-border text-sm text-muted-foreground cursor-not-allowed"
              />
            </div>
            <div className="pt-2 border-t border-border">
              <div className="text-xs font-medium text-muted-foreground mb-2">Alterar senha <span className="font-normal">(deixe em branco para manter)</span></div>
              <div className="space-y-2">
                <input
                  type="password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  placeholder="Nova senha"
                  className="w-full h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
                />
                <input
                  type="password"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  placeholder="Confirmar nova senha"
                  className="w-full h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-5">
            <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm">Cancelar</button>
            <button
              onClick={onSave}
              disabled={saving}
              className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = query.trim()
    ? ALL_PAGES.filter((p) => p.label.toLowerCase().includes(query.toLowerCase()))
    : ALL_PAGES;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4" onClick={onClose}>
      <div className="w-full max-w-md bg-[var(--sidebar-bg)] border border-white/15 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-13 border-b border-white/10">
          <Search className="size-4 text-white/40 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar página..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none py-3.5"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-white/15 text-white/30">ESC</kbd>
        </div>
        <div className="py-1.5 max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-white/30">Nenhum resultado</div>
          )}
          {filtered.map((page) => {
            const Icon = page.icon;
            return (
              <Link
                key={page.to}
                to={page.to}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/8 transition-colors"
              >
                <Icon className="size-4 shrink-0 text-white/40" />
                {page.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AppLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const { role } = useMyAccess();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ pessoal: true, empresa: true, "/shops": true });
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-hidden") === "1";
  });

  useEffect(() => {
    localStorage.setItem("sidebar-hidden", sidebarHidden ? "1" : "0");
  }, [sidebarHidden]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      const sectionOpen = !!item.children && !collapsed[item.to];

      const itemContent = (
        <>
          {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full gradient-primary" />}
          <Icon className="size-4 shrink-0" />
          <span className="truncate flex-1">{item.label}</span>
          {item.children && (
            <ChevronDown className={`size-3 text-white/40 transition-transform shrink-0 ${sectionOpen ? "" : "-rotate-90"}`} />
          )}
        </>
      );

      return (
        <div key={item.to}>
          {item.children ? (
            <button
              onClick={() => toggleGroup(item.to)}
              className={`relative w-full flex items-center gap-2.5 px-3 h-10 md:h-9 rounded-lg text-sm transition-all mb-0.5 ${
                active ? "bg-white/10 text-white font-medium" : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              {itemContent}
            </button>
          ) : (
            <Link
              to={item.to}
              onClick={onNavigate}
              className={`relative flex items-center gap-2.5 px-3 h-10 md:h-9 rounded-lg text-sm transition-all mb-0.5 ${
                active ? "bg-white/10 text-white font-medium" : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              {itemContent}
            </Link>
          )}
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
                    <ChildIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{child.label}</span>
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
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold leading-none text-white">SRX Growth</div>
          </div>
          <button
            onClick={() => setSidebarHidden(true)}
            title="Esconder menu"
            className="hidden md:grid size-7 rounded-md place-items-center text-white/40 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          >
            <PanelLeftClose className="size-4" />
          </button>
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
        </nav>

        {role === "admin" && (
          <div className="px-2 pt-1 pb-1 border-t border-white/10">
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
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors">
            <button onClick={() => setProfileOpen(true)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
              {avatar ? (
                <img src={avatar} alt={displayName} className="size-7 rounded-full object-cover ring-2 ring-white/10 shrink-0" />
              ) : (
                <div className="size-7 rounded-full gradient-primary shrink-0" />
              )}
              <div className="text-xs flex-1 min-w-0">
                <div className="font-medium truncate text-white">{displayName}</div>
                <div className="text-white/50 truncate">{user?.email}</div>
              </div>
            </button>
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
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
      {!sidebarHidden && (
        <aside className="hidden md:flex w-52 flex-col border-r border-border bg-[var(--sidebar-bg)] sticky top-0 h-screen overflow-x-hidden">
          {navContent()}
        </aside>
      )}

      {sidebarHidden && (
        <button
          onClick={() => setSidebarHidden(false)}
          title="Mostrar menu"
          className="hidden md:grid fixed left-3 top-3 z-30 size-9 place-items-center rounded-lg border border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-muted shadow-sm transition-colors"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}

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
          <span className="text-sm font-bold">SRX Growth</span>
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

import { useState, useEffect, useRef } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, FolderKanban,
  Search, LogOut, Package, Menu, Network, Users, Database, Settings as SettingsIcon, Heart, Loader2, Check, PanelLeftClose, PanelLeftOpen, Layers,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMyAccess } from "@/hooks/useMyAccess";
import type { Section } from "@/lib/members.functions";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  section?: Section;
};

const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/shops/products", label: "Produtos", icon: Package, section: "shops" },
  { to: "/shops/banco-de-lojas", label: "Banco de Lojas", icon: Database, section: "shops" },
  { to: "/shops/lojas-grupos", label: "Lojas e Grupos", icon: Layers, section: "shops" },
  { to: "/shops/sops", label: "SOPs & Processos", icon: Network, section: "sops" },
  { to: "/projects", label: "Projetos", icon: FolderKanban, section: "projects" },
];

const adminNav: NavItem[] = [
  { to: "/settings", label: "Configurações", icon: SettingsIcon },
];

const ALL_PAGES = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/gratitude", label: "Gratidão", icon: Heart },
  { to: "/projects", label: "Projetos", icon: FolderKanban },
  { to: "/shops/products", label: "Produtos", icon: Package },
  { to: "/shops/banco-de-lojas", label: "Banco de Lojas", icon: Database },
  { to: "/shops/lojas-grupos", label: "Lojas e Grupos", icon: Layers },
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
      <div className="w-full max-w-md bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-13 border-b border-border">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar página..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none py-3.5"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">ESC</kbd>
        </div>
        <div className="py-1.5 max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum resultado</div>
          )}
          {filtered.map((page) => {
            const Icon = page.icon;
            return (
              <Link
                key={page.to}
                to={page.to}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/80 hover:text-foreground hover:bg-surface-hover transition-colors"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
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
  const { role, canAccessSection } = useMyAccess();

  const visibleNavItems = navItems.filter((item) => !item.section || canAccessSection(item.section));
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const navContent = (onNavigate?: () => void) => {
    const renderItem = (item: NavItem) => {
      const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
      const Icon = item.icon;

      return (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={`relative flex items-center gap-2.5 px-3 h-9 rounded-[10px] text-[13px] font-semibold transition-all mb-0.5 ${
            active ? "bg-sidebar-active-bg text-sidebar-fg" : "text-sidebar-fg-muted hover:text-sidebar-fg hover:bg-sidebar-hover-bg"
          }`}
        >
          <Icon className="size-4 shrink-0" />
          <span className="truncate flex-1">{item.label}</span>
        </Link>
      );
    };

    return (
      <>
        <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
          <img src="/logo.png" alt="SRX" className="h-7 w-auto shrink-0" />
          <div className="flex-1 min-w-0" />
          <button
            onClick={() => setSidebarHidden(true)}
            title="Esconder menu"
            className="hidden md:grid size-7 rounded-md place-items-center text-sidebar-fg-muted hover:text-sidebar-fg hover:bg-sidebar-hover-bg transition-colors shrink-0"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>


        <nav className="px-2 mt-4 flex-1 overflow-y-auto scrollbar-thin space-y-0.5">
          {visibleNavItems.map(renderItem)}
          {role === "admin" && adminNav.map(renderItem)}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-sidebar-hover-bg transition-colors">
            <button onClick={() => setProfileOpen(true)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
              {avatar ? (
                <img src={avatar} alt={displayName} className="size-7 rounded-full object-cover ring-2 ring-sidebar-border shrink-0" />
              ) : (
                <div className="size-7 rounded-full gradient-primary shrink-0" />
              )}
              <div className="text-xs flex-1 min-w-0">
                <div className="font-medium truncate text-sidebar-fg">{displayName}</div>
                <div className="text-sidebar-fg-muted truncate">{user?.email}</div>
              </div>
            </button>
            <button
              onClick={() => signOut()}
              title="Sair"
              className="size-7 rounded-md grid place-items-center text-sidebar-fg-muted hover:text-sidebar-fg hover:bg-sidebar-hover-bg"
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
        <aside className="hidden md:flex w-52 flex-col border-r border-sidebar-border bg-sidebar-bg sticky top-0 h-screen overflow-x-hidden">
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
          <SheetContent side="left" className="w-[280px] p-0 flex flex-col bg-sidebar-bg">
            {navContent(() => setMobileOpen(false))}
          </SheetContent>
        </Sheet>
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="SRX" className="h-6 w-auto" />
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

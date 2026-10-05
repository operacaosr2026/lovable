import { useState, useEffect, useRef } from "react";
import { Link, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, FolderKanban, Target,
  Search, LogOut, Package, Menu, Users, Database, Settings as SettingsIcon, Heart, Loader2, Check, PanelLeftClose, PanelLeftOpen, Layers, Wallet, CheckSquare, Headphones, ShieldAlert,
  Brain, FlaskConical,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMyAccess } from "@/hooks/useMyAccess";
import type { Section } from "@/lib/members.functions";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PullToRefresh } from "@/components/PullToRefresh";
import { NotificationBell } from "@/components/NotificationBell";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getNavBadges } from "@/lib/nav-badges.functions";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  section?: Section;
  activePrefix?: string;   // marca como ativo em todo esse prefixo (ex.: /settings)
};

// Cada aba tem sua permissão (Configurações > Membros); admin vê tudo.
export const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, section: "dashboard" },
  { to: "/shops/caixa", label: "Caixa Geral", icon: Wallet, section: "caixa" },
  { to: "/metas", label: "Metas", icon: Target, section: "metas" },
  { to: "/projects", label: "Projetos", icon: FolderKanban, section: "projects" },
  { to: "/shops/banco-de-lojas", label: "Banco de Lojas", icon: Database, section: "banco_lojas" },
  { to: "/shops/products", label: "Produtos", icon: Package, section: "produtos" },
  { to: "/shops/lojas-grupos", label: "Lojas e Grupos", icon: Layers, section: "lojas_grupos" },
  { to: "/tarefas", label: "Tarefas", icon: CheckSquare, section: "tarefas" },
  { to: "/atendimento", label: "Atendimento", icon: Headphones, section: "atendimento" },
  { to: "/chargebacks", label: "Chargebacks", icon: ShieldAlert, section: "chargebacks" },
  { to: "/inteligencia", label: "Inteligência", icon: Brain, section: "consultor" },
];

// Aba do menu dona do endereço (pra bloquear quem abre o link direto sem permissão).
function navItemForPath(path: string): NavItem | undefined {
  return navItems.find((i) => (i.to === "/" ? path === "/" : path === i.to || path.startsWith(`${i.to}/`)));
}

const adminNav: NavItem[] = [
  { to: "/settings", label: "Configurações", icon: SettingsIcon },
  // Testes de coisas novas antes de mexer no que está em uso.
  { to: "/teste", label: "Teste", icon: FlaskConical },
];
// Configurações pro membro: cada página liberada em Membros > Permissões
// (Membros e Auditoria são só do admin).
const memberSettingsNav: NavItem = { to: "/settings", label: "Configurações", icon: SettingsIcon };
export const MEMBER_SETTINGS_PAGES: { path: string; section: Section }[] = [
  { path: "/settings/notificacoes", section: "notificacoes" },
  { path: "/settings/seguranca", section: "cfg_seguranca" },
  { path: "/settings/integracoes", section: "cfg_integracoes" },
];

const ALL_PAGES = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/shops/caixa", label: "Caixa Geral", icon: Wallet },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/projects", label: "Projetos", icon: FolderKanban },
  { to: "/shops/banco-de-lojas", label: "Banco de Lojas", icon: Database },
  { to: "/shops/products", label: "Produtos", icon: Package },
  { to: "/shops/lojas-grupos", label: "Lojas e Grupos", icon: Layers },
  { to: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { to: "/atendimento", label: "Atendimento", icon: Headphones },
  { to: "/chargebacks", label: "Chargebacks", icon: ShieldAlert },
  { to: "/inteligencia", label: "Inteligência", icon: Brain },
  { to: "/gratitude", label: "Gratidão", icon: Heart },
  { to: "/settings/members", label: "Membros", icon: Users },
  { to: "/settings", label: "Configurações", icon: SettingsIcon },
];

function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState((user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || "");
  const [currentPwd, setCurrentPwd] = useState("");
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
    if (pwd && !currentPwd) return toast.error("Informe a senha atual para trocar a senha");
    setSaving(true);
    try {
      // Trocar a senha exige a senha atual (igual a Configurações > Segurança).
      if (pwd) {
        const check = await supabase.auth.signInWithPassword({ email: user?.email ?? "", password: currentPwd });
        if (check.error) throw new Error("Senha atual incorreta");
      }
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
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  placeholder="Senha atual"
                  autoComplete="current-password"
                  className="w-full h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
                />
                <input
                  type="password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  placeholder="Nova senha"
                  autoComplete="new-password"
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
  const { role, canAccessSection } = useMyAccess();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Só páginas que a pessoa pode abrir.
  const allowed = ALL_PAGES.filter((p) => {
    if (p.to.startsWith("/settings")) return role === "admin";
    const item = navItemForPath(p.to);
    return !item?.section || canAccessSection(item.section);
  });
  const filtered = query.trim()
    ? allowed.filter((p) => p.label.toLowerCase().includes(query.toLowerCase()))
    : allowed;

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
  const { role, canAccessSection, ownerId } = useMyAccess();
  // Tempo real: pedido novo, tarefa, aviso do sino → telas abertas atualizam sozinhas.
  useRealtimeSync(ownerId);

  // Números do menu (tarefas não concluídas, e-mails sem resposta). Atualiza
  // a cada minuto e ao trocar de página (ex.: depois de responder um e-mail).
  const navBadgesFn = useServerFn(getNavBadges);
  const badges = useQuery({
    queryKey: ["nav-badges", ownerId],
    queryFn: () => navBadgesFn(),
    enabled: !!ownerId,
    refetchInterval: 60_000,
  });
  const refetchBadges = badges.refetch;
  useEffect(() => { if (ownerId) refetchBadges(); }, [path, ownerId, refetchBadges]);
  const badgeFor: Record<string, number | null | undefined> = {
    "/tarefas": badges.data?.tarefas,
    "/atendimento": badges.data?.atendimento,
    "/chargebacks": badges.data?.chargebacks,
    "/inteligencia": badges.data?.inteligencia,
  };

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
      const active = item.to === "/" ? path === "/" : path.startsWith(item.activePrefix ?? item.to);
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
          {!!badgeFor[item.to] && (
            <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold tabular-nums grid place-items-center">
              {badgeFor[item.to]! > 99 ? "99+" : badgeFor[item.to]}
            </span>
          )}
        </Link>
      );
    };

    return (
      <>
        <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
          <img src="/logo.png" alt="SRX" className="h-7 w-auto shrink-0" />
          <div className="flex-1 min-w-0" />
          {canAccessSection("notificacoes") && <NotificationBell className="hidden md:grid" />}
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
          {role !== "admin" && (() => {
            // Vai direto pra 1ª página liberada (/settings sozinho leva pra Membros, do admin).
            const first = MEMBER_SETTINGS_PAGES.find((p) => canAccessSection(p.section));
            return first ? renderItem({ ...memberSettingsNav, to: first.path, activePrefix: "/settings" }) : null;
          })()}
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
      <PullToRefresh />
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
      {!sidebarHidden && (
        <aside className="hidden md:flex w-52 flex-col border-r border-sidebar-border bg-sidebar-bg sticky top-0 h-screen overflow-x-hidden">
          {navContent()}
        </aside>
      )}

      {sidebarHidden && (
        <div className="hidden md:flex fixed left-3 top-3 z-30 items-center gap-1.5">
          <button
            onClick={() => setSidebarHidden(false)}
            title="Mostrar menu"
            className="size-9 grid place-items-center rounded-lg border border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-muted shadow-sm transition-colors"
          >
            <PanelLeftOpen className="size-4" />
          </button>
          <div className="rounded-lg border border-border bg-surface shadow-sm">
            {canAccessSection("notificacoes") && <NotificationBell className="size-9" />}
          </div>
        </div>
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
        {canAccessSection("notificacoes") && <NotificationBell className="size-9 -ml-1 mr-auto text-foreground" />}
        <Link to="/" className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
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
        <PageAccessGate path={path} />
      </main>
    </div>
  );
}

// Bloqueia a página quando a pessoa não tem permissão da aba (ex.: abriu o
// link direto). Enquanto as permissões carregam, página com permissão mostra
// "carregando" — antes mostrava a página (ex.: o Dashboard piscava pro membro
// sem acesso a ele antes de ir pra aba liberada).
// Página inicial do membro (Permissões > "Abrir primeiro"): aplicada só uma vez,
// na abertura do sistema — depois, clicar em Dashboard no menu abre normal.
let homeHandled = false;

function PageAccessGate({ path }: { path: string }) {
  const { role, canAccessSection, isLoading, homePath } = useMyAccess();
  // Página que está de fato na tela: durante a troca de página o endereço já é
  // o novo, mas o <Outlet> ainda mostra a anterior até a nova carregar — era
  // assim que o Dashboard piscava depois do redirecionamento pra aba liberada.
  const renderedPath = useRouterState({ select: (s) => s.resolvedLocation?.pathname ?? s.location.pathname });
  // Marca a página inicial como aplicada só depois da 1ª tela com as permissões
  // (no desenho, não — o React pode desenhar 2x e a 2ª achava que já tinha ido).
  useEffect(() => { if (!isLoading) homeHandled = true; }, [isLoading]);
  const gated = path.startsWith("/settings") || !!navItemForPath(path)?.section;
  const spinner = <div className="min-h-[60vh] grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (isLoading) return gated ? spinner : <Outlet />;
  if (renderedPath !== path) {
    const renderedItem = navItemForPath(renderedPath);
    const renderedBlocked = (renderedPath.startsWith("/settings") && role !== "admin"
        && !MEMBER_SETTINGS_PAGES.some((p) => renderedPath.startsWith(p.path) && canAccessSection(p.section)))
      || (renderedItem?.section ? !canAccessSection(renderedItem.section) : false);
    if (renderedBlocked) return spinner;
  }
  if (!homeHandled) {
    const homeItem = homePath ? navItemForPath(homePath) : undefined;
    const homeAllowed = homeItem && (!homeItem.section || canAccessSection(homeItem.section));
    if (path === "/" && role !== "admin" && homePath && homePath !== "/" && homeAllowed) {
      return <Navigate to={homePath} replace />;
    }
  }
  // Configurações é do admin — menos as partes pessoais do membro.
  const personal = MEMBER_SETTINGS_PAGES.some((p) => path.startsWith(p.path) && canAccessSection(p.section));
  const blockedSettings = path.startsWith("/settings") && role !== "admin" && !personal;
  // Membro em página de Configurações que não é dele (ex.: /settings → Membros):
  // leva pra 1ª página de Configurações liberada, em vez de "Sem acesso".
  if (blockedSettings) {
    const firstSettings = MEMBER_SETTINGS_PAGES.find((p) => canAccessSection(p.section));
    if (firstSettings) return <Navigate to={firstSettings.path} replace />;
  }
  const item = navItemForPath(path);
  const blocked = blockedSettings || (item?.section ? !canAccessSection(item.section) : false);
  if (!blocked) return <Outlet />;

  // Dashboard é a página inicial: sem acesso a ele, manda pra primeira aba liberada.
  const first = navItems.find((i) => !i.section || canAccessSection(i.section));
  if (path === "/" && first && first.to !== "/") return <Navigate to={first.to} />;
  return (
    <div className="min-h-[60vh] grid place-items-center p-8 text-center">
      <div>
        <p className="text-lg font-semibold text-foreground">Sem acesso</p>
        <p className="text-sm text-muted-foreground mt-1">Você não tem permissão para esta página. Fale com o administrador.</p>
      </div>
    </div>
  );
}

import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { Settings as SettingsIcon, Users, Shield, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/geral" });
    }
  },
  component: SettingsLayout,
});

const nav = [
  { to: "/settings/geral", label: "Geral", icon: SlidersHorizontal, desc: "Identidade e preferências do aplicativo" },
  { to: "/settings/members", label: "Membros", icon: Users, desc: "Convites, permissões e acessos" },
  { to: "/settings/seguranca", label: "Segurança", icon: Shield, desc: "Senha, sessões e autenticação" },
];

function SettingsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-surface/30 sticky top-0 h-screen">
        <div className="px-5 pt-6 pb-5 flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-primary/10 grid place-items-center">
            <SettingsIcon className="size-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-bold leading-none">Configurações</div>
            <div className="text-[11px] text-muted-foreground mt-1">Centro de gerenciamento</div>
          </div>
        </div>

        <nav className="px-3 mt-2 flex-1">
          {nav.map((item) => {
            const active = path.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`relative flex items-start gap-3 px-3 py-2.5 rounded-lg text-sm transition-all mb-1 ${
                  active
                    ? "bg-primary/10 text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />
                )}
                <Icon className={`size-4 mt-0.5 ${active ? "text-primary" : ""}`} />
                <div className="min-w-0">
                  <div>{item.label}</div>
                  <div className="text-[11px] text-muted-foreground font-normal mt-0.5 leading-tight">
                    {item.desc}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile horizontal nav */}
      <div className="md:hidden fixed top-14 left-0 right-0 z-30 bg-background border-b border-border overflow-x-auto">
        <div className="flex gap-1 px-3 py-2 min-w-max">
          {nav.map((item) => {
            const active = path.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs whitespace-nowrap ${
                  active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <main className="flex-1 min-w-0 pt-12 md:pt-0 anim-fade-in">
        <Outlet />
      </main>
    </div>
  );
}

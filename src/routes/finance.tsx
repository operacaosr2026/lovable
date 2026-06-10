import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { LayoutDashboard, ArrowLeftRight, Wallet, Settings, Upload } from "lucide-react";

export const Route = createFileRoute("/finance")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Financeiro — SRX Growth" }] }),
  component: FinanceLayout,
});

const tabs = [
  { to: "/finance", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/finance/transactions", label: "Lançamentos", icon: ArrowLeftRight },
  { to: "/finance/accounts", label: "Contas", icon: Wallet },
  { to: "/finance/import", label: "Importar", icon: Upload },
  { to: "/finance/settings", label: "Categorias & FX", icon: Settings },
];

function FinanceLayout() {
  const loc = useLocation();
  const path = loc.pathname.replace(/\/+$/, "") || "/finance";
  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground mt-1">Controle pessoal — rápido e limpo</p>
        </div>
        <nav className="flex items-center gap-1 bg-muted rounded-xl p-1">
          {tabs.map((t) => {
            const active = t.exact ? path === "/finance" : path === t.to.replace(/\/+$/, "");
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                  active ? "bg-surface shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" /> {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </PageShell>
  );
}

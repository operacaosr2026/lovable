import type { ReactNode } from "react";

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4 mb-5 sm:mb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// fit: no desktop a página ocupa exatamente a altura da tela (as áreas com
// flex-1 esticam/encolhem); se o conteúdo não couber, a página rola por dentro.
export function PageShell({ children, fit }: { children: ReactNode; fit?: boolean }) {
  return (
    <div className={`p-4 sm:p-6 max-w-[1400px] mx-auto ${fit ? "md:px-8 md:py-6 lg:h-dvh lg:overflow-y-auto lg:flex lg:flex-col" : "md:p-8"}`}>
      {children}
    </div>
  );
}

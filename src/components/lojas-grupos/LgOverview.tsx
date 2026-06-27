import { LayoutDashboard } from "lucide-react";

export function LgOverview({ card }: { card: any }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <LayoutDashboard className="size-10 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm font-medium text-foreground mb-1">Overview</p>
      <p className="text-xs text-muted-foreground">
        Informações importantes da operação de <span className="font-medium">{card?.name}</span> aparecerão aqui em breve.
      </p>
    </div>
  );
}

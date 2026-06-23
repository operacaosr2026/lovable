import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listConnections } from "@/lib/shopify-connections.functions";
import { Loader2, Store, Crown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GroupStoreDraft {
  connection_id: string;
  role: "matrix" | "sub";
}

interface Props {
  value: GroupStoreDraft[];
  onChange: (v: GroupStoreDraft[]) => void;
  onGoToBank?: () => void;
}

export function GroupStoresPicker({ value, onChange, onGoToBank }: Props) {
  const listFn = useServerFn(listConnections);
  const { data, isLoading } = useQuery({
    queryKey: ["shopify-connections"],
    queryFn: () => listFn(),
  });
  const connections = data?.connections ?? [];

  const toggle = (id: string) => {
    const exists = value.find(v => v.connection_id === id);
    if (exists) {
      const next = value.filter(v => v.connection_id !== id);
      // if removing the matrix, promote first remaining to matrix
      if (exists.role === "matrix" && next.length > 0) next[0].role = "matrix";
      onChange(next);
    } else {
      const role: "matrix" | "sub" = value.length === 0 ? "matrix" : "sub";
      onChange([...value, { connection_id: id, role }]);
    }
  };

  const setMatrix = (id: string) => {
    onChange(value.map(v => ({ ...v, role: v.connection_id === id ? "matrix" : "sub" })));
  };

  if (isLoading) return (
    <div className="flex justify-center py-6">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  );

  if (connections.length === 0) return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-2">
      <p className="text-sm text-muted-foreground">Nenhuma loja no banco ainda.</p>
      {onGoToBank && (
        <button
          type="button"
          onClick={onGoToBank}
          className="text-xs text-primary underline underline-offset-2"
        >
          Ir para o Banco de Lojas
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Selecione as lojas e defina qual é a <span className="text-foreground font-medium">Matriz</span> (ícone de coroa).
        A primeira selecionada vira a matriz automaticamente.
      </p>
      <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
        {connections.map(conn => {
          const selected = value.find(v => v.connection_id === conn.id);
          const isMatrix = selected?.role === "matrix";
          return (
            <div
              key={conn.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-all select-none",
                selected
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-primary/30 hover:bg-muted/50"
              )}
              onClick={() => toggle(conn.id)}
            >
              {/* Checkbox */}
              <div className={cn(
                "size-4 rounded border-2 grid place-items-center shrink-0 transition-colors",
                selected ? "bg-primary border-primary" : "border-muted-foreground/40"
              )}>
                {selected && (
                  <svg className="size-2.5 text-white" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>

              {/* Icon */}
              <div className={cn(
                "size-7 rounded-lg grid place-items-center shrink-0 transition-colors",
                selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              )}>
                <Store className="size-3.5" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{conn.name}</p>
                <p className="text-xs text-muted-foreground truncate">{conn.shop_domain}</p>
              </div>

              {/* Matrix toggle — only for selected stores */}
              {selected && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setMatrix(conn.id); }}
                  title={isMatrix ? "Matriz" : "Definir como Matriz"}
                  className={cn(
                    "size-7 rounded-lg grid place-items-center shrink-0 transition-colors",
                    isMatrix
                      ? "bg-warning/15 text-warning"
                      : "bg-muted text-muted-foreground hover:text-warning hover:bg-warning/10"
                  )}
                >
                  <Crown className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {value.length > 0 && (
        <p className="text-[11px] text-muted-foreground px-0.5">
          {value.length} loja{value.length > 1 ? "s" : ""} selecionada{value.length > 1 ? "s" : ""} ·{" "}
          Matriz: <span className="text-foreground font-medium">
            {connections.find(c => c.id === value.find(v => v.role === "matrix")?.connection_id)?.name ?? "—"}
          </span>
        </p>
      )}
    </div>
  );
}

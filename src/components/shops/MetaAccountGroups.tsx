import { useMemo, useState } from "react";
import { Building2, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export type PickableAccount = { id: string; name: string; detail: string; business_name: string | null };

const NO_BM = "Sem BM (conta pessoal)";

// Lista de contas para adicionar, separada pela BM dona de cada uma.
// Contas sem BM ficam no fim; sem informação de BM ainda, "Atualizar lista" traz.
export function MetaAccountGroups({
  accounts, onPick, pending, emptyText,
}: { accounts: PickableAccount[]; onPick: (id: string) => void; pending?: boolean; emptyText: string }) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const by = new Map<string, PickableAccount[]>();
    for (const a of accounts) {
      const bm = a.business_name || NO_BM;
      if (term && !`${a.name} ${a.id} ${bm}`.toLowerCase().includes(term)) continue;
      by.set(bm, [...(by.get(bm) ?? []), a]);
    }
    return [...by.entries()]
      .map(([bm, list]) => [bm, list.sort((x, y) => x.name.localeCompare(y.name))] as const)
      .sort(([a], [b]) => Number(a === NO_BM) - Number(b === NO_BM) || a.localeCompare(b));
  }, [accounts, q]);

  if (!accounts.length) return <p className="text-sm text-muted-foreground text-center py-4">{emptyText}</p>;

  return (
    <div className="space-y-2">
      {accounts.length > 6 && (
        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conta ou BM" className="pl-9" />
        </div>
      )}
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {groups.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nada encontrado.</p>}
        {groups.map(([bm, list]) => (
          <div key={bm} className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium sticky top-0 bg-background py-1">
              <Building2 className="size-3" /> {bm} <span className="normal-case tracking-normal">· {list.length}</span>
            </div>
            {list.map((acc) => (
              <button
                key={acc.id}
                onClick={() => onPick(acc.id)}
                disabled={pending}
                className="w-full flex items-center justify-between rounded-xl border border-border hover:border-primary/40 px-4 py-2.5 text-left transition-all"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{acc.name}</p>
                  <p className="text-xs text-muted-foreground">{acc.detail}</p>
                </div>
                {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

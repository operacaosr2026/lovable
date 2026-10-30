import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleCheck, Factory, Hourglass, Loader2, Search, Timer, X } from "lucide-react";
import { listSupplierRefunds, type SupplierRefund } from "@/lib/supplier-refund.functions";
import { SupplierRefundActions } from "./SupplierRefund";
import { formatMoney, fullTime } from "./utils";

// Atendimento › Reembolso: o que o fornecedor está devendo de reembolso e o que
// ele já devolveu. Serve pra checar se ele está fazendo os reembolsos pedidos —
// a conferência é manual, no sistema do fornecedor.

const DAY = 86_400_000;
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / DAY);
const daysLabel = (n: number) => (n === 0 ? "hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`);
const sum = (rows: SupplierRefund[]) => rows.reduce((s, r) => s + r.amount, 0);

export function SupplierRefundsView({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const listFn = useServerFn(listSupplierRefunds);
  const q = useQuery({ queryKey: ["supplier-refunds"], queryFn: () => listFn(), refetchInterval: 60_000 });
  const [tab, setTab] = useState<"pendente" | "confirmado">("pendente");
  const [search, setSearch] = useState("");

  const rows = q.data ?? [];
  const pending = useMemo(() => rows.filter((r) => r.status === "pendente"), [rows]);
  const done = useMemo(() => rows.filter((r) => r.status === "confirmado")
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? "")), [rows]);
  const oldest = pending.length ? Math.max(...pending.map((r) => daysSince(r.created_at))) : null;
  const avgDays = done.length
    ? done.reduce((s, r) => s + (Date.parse(r.confirmed_at!) - Date.parse(r.created_at)) / DAY, 0) / done.length
    : null;

  const list = (tab === "pendente" ? pending : done).filter((r) => {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return [r.order_number, r.customer_name, r.shopName, r.note].some((v) => (v ?? "").toLowerCase().includes(s));
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi icon={Hourglass} cls="bg-amber-500/10 text-amber-600" label="Fornecedor devendo"
          value={q.data ? formatMoney(sum(pending), "USD") : "…"} sub={q.data ? `${pending.length} pedido${pending.length === 1 ? "" : "s"}` : ""} />
        <Kpi icon={Timer} cls={oldest != null && oldest >= 7 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"} label="Mais antigo esperando"
          value={oldest == null ? "—" : oldest === 0 ? "Hoje" : `${oldest} dia${oldest === 1 ? "" : "s"}`} sub="desde que foi marcado" />
        <Kpi icon={CircleCheck} cls="bg-success/15 text-success" label="Reembolsado (90 dias)"
          value={q.data ? formatMoney(sum(done), "USD") : "…"} sub={q.data ? `${done.length} pedido${done.length === 1 ? "" : "s"}` : ""} />
        <Kpi icon={Factory} cls="bg-violet-500/10 text-violet-600 dark:text-violet-400" label="Tempo médio do fornecedor"
          value={avgDays == null ? "—" : `${avgDays.toFixed(1).replace(".", ",")} dias`} sub="do pedido ao OK" />
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 border-b border-border">
          {([["pendente", "Aguardando fornecedor", pending.length], ["confirmado", "Reembolsados", done.length]] as const).map(([key, label, n]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`h-9 px-1 mr-3 text-xs font-medium border-b-2 -mb-px whitespace-nowrap ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {label} <span className="text-muted-foreground">({n})</span>
            </button>
          ))}
          <div className="relative ml-auto mb-2 w-full sm:w-64">
            <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pedido, cliente, loja…"
              className="w-full h-8 pl-8 pr-7 rounded-xl bg-background border border-border text-xs outline-none focus:border-primary" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Limpar busca">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {q.isLoading ? (
          <div className="py-16 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : q.isError ? (
          <p className="py-16 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</p>
        ) : !list.length ? (
          <div className="py-16 text-center">
            <Factory className="size-6 mx-auto text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground mt-2">
              {search ? "Nada encontrado" : tab === "pendente"
                ? "Nenhum reembolso esperando o fornecedor. Marque ao reembolsar o pedido no Atendimento (Reembolsar › Fornecedor tem que reembolsar)."
                : "Nenhum reembolso do fornecedor confirmado nos últimos 90 dias."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {list.map((r) => {
              const age = daysSince(r.created_at);
              return (
                <div key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-x-2">
                      {r.conversation_id ? (
                        <button onClick={() => onOpenConversation(r.conversation_id!)} className="text-sm font-semibold text-primary hover:underline">
                          {r.order_number ?? "Pedido"}
                        </button>
                      ) : <span className="text-sm font-semibold">{r.order_number ?? "Pedido"}</span>}
                      <span className="text-xs text-muted-foreground">{[r.shopName, r.customer_name].filter(Boolean).join(" · ")}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Marcado por {r.requestedByName ?? "Equipe"} · {fullTime(r.created_at)}
                      {r.status === "confirmado" && r.confirmed_at && <> — OK por {r.confirmedByName ?? "Equipe"} · {fullTime(r.confirmed_at)}</>}
                    </p>
                    {r.note && <p className="text-[11px] text-muted-foreground italic mt-0.5">{r.note}</p>}
                  </div>
                  <div className="text-right shrink-0 min-w-[90px]">
                    <p className="text-sm font-semibold">{formatMoney(r.amount, "USD")}</p>
                    {r.status === "pendente" && (
                      <p className={`text-[11px] ${age >= 7 ? "text-destructive font-medium" : "text-muted-foreground"}`}>{daysLabel(age)}</p>
                    )}
                  </div>
                  <SupplierRefundActions r={r} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, cls, label, value, sub }: { icon: any; cls: string; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3 min-w-0">
      <span className={`size-10 shrink-0 rounded-xl grid place-items-center ${cls}`}><Icon className="size-5" /></span>
      <div className="min-w-0">
        <p className="text-xl font-semibold tracking-tight truncate">{value}</p>
        <p className="text-xs text-muted-foreground truncate">{label}{sub ? ` · ${sub}` : ""}</p>
      </div>
    </div>
  );
}

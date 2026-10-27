import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Loader2, MessageSquare, Repeat, Undo2 } from "lucide-react";
import { listSupportApprovals } from "@/lib/support-approvals.functions";
import { RefundRequestCard, type RefundRequestView } from "./RefundDialog";
import { ExchangeRequestCard, type ExchangeRequestView } from "./ExchangeDialog";
import { useSupportFn } from "./demo";
import { formatDuration, formatMoney } from "./utils";

// Atendimento › Aprovações: todos os reembolsos e trocas esperando o dono, de
// todas as lojas, mais antigos primeiro. Aprovar/recusar usa os mesmos cartões
// do painel do cliente; decidido sai da fila e vai pra "Últimos 7 dias".

type Item =
  | ({ kind: "reembolso" } & RefundRequestView & Meta)
  | ({ kind: "troca" } & ExchangeRequestView & Meta);
type Meta = { order_number: string | null; store: string | null; customer_name: string | null; customer_email: string | null; conversation_id: string | null };

const OPEN = new Set(["pendente", "gerando", "erro"]);
const FILTERS = [["todos", "Tudo"], ["reembolso", "Reembolsos"], ["troca", "Trocas"]] as const;

export function SupportApprovalsView({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const listFn = useSupportFn(listSupportApprovals, "listSupportApprovals");
  const list = useQuery({ queryKey: ["support-approvals"], queryFn: () => listFn(), refetchInterval: 60_000 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("todos");
  const [showDone, setShowDone] = useState(false);

  if (list.isLoading) return <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (list.isError) return <div className="py-20 text-center text-sm text-destructive">{(list.error as any)?.message ?? "Erro"}</div>;

  const canApprove = !!list.data?.canApprove;
  const all = (list.data?.items ?? []) as Item[];
  const shown = all.filter((i) => filter === "todos" || i.kind === filter);
  const open = shown.filter((i) => OPEN.has(i.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const done = shown.filter((i) => !OPEN.has(i.status)).sort((a, b) => (b.decided_at ?? "").localeCompare(a.decided_at ?? ""));
  const countOpen = (k: string) => all.filter((i) => OPEN.has(i.status) && (k === "todos" || i.kind === k)).length;

  // Total em reembolsos na fila, por moeda.
  const totals = new Map<string, number>();
  for (const i of open) if (i.kind === "reembolso" && i.status !== "gerando") totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.amount);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-muted">
          {FILTERS.map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`h-7 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${filter === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {label}{countOpen(key) ? ` (${countOpen(key)})` : ""}
            </button>
          ))}
        </div>
        {totals.size > 0 && (
          <p className="text-xs text-muted-foreground">
            Reembolsos na fila: <span className="font-semibold text-foreground">{[...totals].map(([cur, v]) => formatMoney(v, cur)).join(" + ")}</span>
          </p>
        )}
      </div>

      {open.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-14 grid place-items-center text-center gap-2">
          <CheckCircle2 className="size-8 text-emerald-500" />
          <p className="text-sm font-medium">Nada para aprovar</p>
          <p className="text-xs text-muted-foreground">Reembolsos e trocas pedidos pela equipe aparecem aqui.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 items-start">
          {open.map((i) => <ApprovalItem key={i.id} i={i} canApprove={canApprove} onOpenConversation={onOpenConversation} />)}
        </div>
      )}

      {done.length > 0 && (
        <div>
          <button onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={`size-3.5 transition-transform ${showDone ? "" : "-rotate-90"}`} /> Decididos nos últimos 7 dias ({done.length})
          </button>
          {showDone && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 items-start">
              {done.map((i) => <ApprovalItem key={i.id} i={i} canApprove={canApprove} onOpenConversation={onOpenConversation} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalItem({ i, canApprove, onOpenConversation }: { i: Item; canApprove: boolean; onOpenConversation: (id: string) => void }) {
  const waiting = OPEN.has(i.status) ? formatDuration(Date.now() - new Date(i.created_at).getTime()) : null;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <span className={`size-7 shrink-0 rounded-lg grid place-items-center ${i.kind === "reembolso" ? "bg-rose-500/10 text-rose-600" : "bg-blue-500/10 text-blue-600"}`}>
          {i.kind === "reembolso" ? <Undo2 className="size-3.5" /> : <Repeat className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{i.order_number ?? "Pedido"}{i.store ? <span className="font-normal text-muted-foreground"> · {i.store}</span> : null}</p>
          <p className="text-[11px] text-muted-foreground truncate">{i.customer_name || i.customer_email || "Cliente"}</p>
        </div>
        {waiting && <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="Esperando há">há {waiting}</span>}
      </div>
      {i.kind === "reembolso"
        ? <RefundRequestCard r={i} canApprove={canApprove} />
        : <ExchangeRequestCard r={i} canApprove={canApprove} />}
      {i.conversation_id && (
        <button onClick={() => onOpenConversation(i.conversation_id!)}
          className="mt-2 text-[11px] text-primary hover:underline flex items-center gap-1">
          <MessageSquare className="size-3" /> Abrir conversa
        </button>
      )}
    </div>
  );
}

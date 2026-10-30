import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Factory, Loader2, X } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  confirmSupplierRefund, deleteSupplierRefund, type SupplierRefund,
} from "@/lib/supplier-refund.functions";
import { formatMoney, fullTime } from "./utils";

// Reembolso do fornecedor: a equipe marca ao reembolsar o pedido (RefundDialog) que o fornecedor tem que
// devolver o custo; vai pra aba Reembolso, onde alguém dá o OK depois de
// conferir no sistema do fornecedor.

export function useSupplierRefundInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["supplier-refunds"] });
    qc.invalidateQueries({ queryKey: ["supplier-refunds-orders"] });
  };
}

export function SupplierRefundCard({ r }: { r: SupplierRefund }) {
  const done = r.status === "confirmado";
  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-2.5 space-y-1 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap">
          <Factory className="size-3" /> Reembolso do fornecedor {formatMoney(r.amount, "USD")}
        </p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${done ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
          {done ? "Fornecedor reembolsou" : "Aguardando fornecedor"}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Marcado · {r.requestedByName ?? "Equipe"} · {fullTime(r.created_at)}
        {done && r.confirmed_at && <> — OK por {r.confirmedByName ?? "Equipe"} · {fullTime(r.confirmed_at)}</>}
      </p>
      {r.note && <p className="text-[10px] text-muted-foreground italic">{r.note}</p>}
    </div>
  );
}

// Ações da aba Reembolso: OK num clique (conferido no sistema do fornecedor),
// desfazer o OK e tirar da lista.
export function SupplierRefundActions({ r }: { r: SupplierRefund }) {
  const invalidate = useSupplierRefundInvalidate();
  const confirm = useConfirm();
  const confirmFn = useServerFn(confirmSupplierRefund);
  const deleteFn = useServerFn(deleteSupplierRefund);
  const ok = useMutation({
    mutationFn: (v: { confirmed: boolean }) => confirmFn({ data: { id: r.id, ...v } }),
    onSuccess: (_d, v) => { toast.success(v.confirmed ? "Reembolso do fornecedor confirmado" : "Voltou pra aguardando"); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: r.id } }),
    onSuccess: () => { toast.success("Tirado da lista"); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  if (r.status === "confirmado") {
    return (
      <button onClick={() => ok.mutate({ confirmed: false })} disabled={ok.isPending}
        className="h-7 px-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap">
        Desfazer OK
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => ok.mutate({ confirmed: true })} disabled={ok.isPending} title="Conferi no sistema do fornecedor: ele reembolsou"
        className="h-7 px-2.5 rounded-md bg-emerald-600 text-white text-[11px] font-medium whitespace-nowrap inline-flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-50">
        {ok.isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Fornecedor reembolsou
      </button>
      <button disabled={del.isPending} title="Tirar da lista (marcado por engano)"
        onClick={async () => {
          if (await confirm({ title: `Tirar ${r.order_number ?? "o pedido"} da lista?`, description: "Use quando foi marcado por engano. O fornecedor não fica mais devendo esse reembolso.", confirmText: "Tirar", variant: "destructive" })) del.mutate();
        }}
        className="size-7 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

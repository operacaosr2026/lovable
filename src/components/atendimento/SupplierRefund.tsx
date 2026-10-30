import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Factory, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { supplierOrdersTotal } from "@/lib/shop-orders.functions";
import {
  confirmSupplierRefund, deleteSupplierRefund, requestSupplierRefund, type SupplierRefund,
} from "@/lib/supplier-refund.functions";
import { formatMoney, fullTime } from "./utils";

// Reembolso do fornecedor: a equipe marca no pedido que o fornecedor tem que
// devolver o custo; vai pra aba Reembolso, onde alguém dá o OK depois de
// conferir no sistema do fornecedor.

const parseMoney = (v: string) => Number(v.replace(",", "."));
const toInput = (v: number) => v.toFixed(2).replace(".", ",");

export function useSupplierRefundInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["supplier-refunds"] });
    qc.invalidateQueries({ queryKey: ["supplier-refunds-orders"] });
  };
}

export function SupplierRefundDialog({ orderId, orderNumber, conversationId, onClose }: {
  orderId: string; orderNumber: string | null; conversationId: string | null; onClose: () => void;
}) {
  const invalidate = useSupplierRefundInvalidate();
  const costFn = useServerFn(supplierOrdersTotal);
  const requestFn = useServerFn(requestSupplierRefund);
  // Valor sugerido: custo do fornecedor do pedido (mesma conta do lote no Caixa).
  const cost = useQuery({
    queryKey: ["supplier-cost", orderId],
    queryFn: () => costFn({ data: { order_ids: [orderId] } }),
    staleTime: 60_000, retry: false,
  });
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (cost.data && !value) setValue(toInput(cost.data.total));
  }, [cost.data]);
  const amount = parseMoney(value);
  const ready = value !== "" && Number.isFinite(amount) && amount >= 0;

  const submit = useMutation({
    mutationFn: () => requestFn({ data: { orderId, conversationId, amount, note: note.trim() || null } }),
    onSuccess: () => { toast.success("Marcado — está na aba Reembolso aguardando o fornecedor"); invalidate(); onClose(); },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Reembolso do fornecedor{orderNumber ? ` · ${orderNumber}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            O fornecedor tem que devolver o custo deste pedido. Fica na aba Reembolso até alguém conferir no sistema dele e dar o OK.
          </p>
          <div>
            <p className="text-xs font-semibold mb-1">Valor que o fornecedor deve</p>
            <div className="flex items-center gap-2 h-9 rounded-lg border border-border bg-background px-3 focus-within:border-primary">
              <span className="text-xs text-muted-foreground">USD</span>
              <input autoFocus inputMode="decimal" value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder={cost.isLoading ? "Calculando…" : "0,00"} className="flex-1 bg-transparent text-sm outline-none" />
              {cost.isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </div>
            {cost.data && (
              <p className="text-[11px] text-muted-foreground mt-1">Custo do produto no fornecedor: {formatMoney(cost.data.total, "USD")}.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold mb-1">Observação (opcional)</p>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
              placeholder="Ex.: mandou tamanho errado, cliente mandou foto"
              className="w-full resize-none rounded-lg border border-border bg-background p-2 text-xs outline-none focus:border-primary" />
          </div>
          <button onClick={() => submit.mutate()} disabled={!ready || submit.isPending}
            className="h-9 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {submit.isPending && <Loader2 className="size-4 animate-spin" />}
            Marcar pro fornecedor reembolsar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
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

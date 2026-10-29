import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Truck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { changeTrackingCode } from "@/lib/lg-logistics.functions";
import { useSupportFn } from "./demo";

// Trocar o código de rastreio (reenvio): troca aqui e no envio da Shopify, sem
// avisar o cliente. O código antigo fica no histórico do pedido.
export function TrackingCodeDialog({ order, open, onClose }: {
  order: { id: string; number: string | null; tracking: string | null }; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const changeFn = useSupportFn(changeTrackingCode, "changeTrackingCode");
  const [code, setCode] = useState("");
  const next = code.trim().toUpperCase();
  const valid = /^[A-Z0-9-]{5,50}$/.test(next) && next !== String(order.tracking ?? "").toUpperCase();

  const submit = useMutation({
    mutationFn: () => changeFn({ data: { order_id: order.id, tracking_code: next } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["support-customer"] });
      qc.invalidateQueries({ queryKey: ["lg-logistics"] });
      if (r?.shopify?.ok) toast.success("Código trocado aqui e na Shopify");
      else toast.warning(`Código trocado aqui, mas a Shopify não atualizou: ${r?.shopify?.reason ?? "erro"}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const label = order.number ? (String(order.number).startsWith("#") ? order.number : `#${order.number}`) : "pedido";
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="size-4" /> Trocar rastreio — {label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Código atual</p>
            <p className="font-mono text-sm line-through text-muted-foreground">{order.tracking ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Código novo</p>
            <input autoFocus value={code} onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && valid && !submit.isPending) submit.mutate(); }}
              placeholder="Ex: TRF0116720019018"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm uppercase outline-none focus:border-primary" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Troca aqui e no envio da Shopify, sem avisar o cliente. O pedido volta pra pendente envio até o pacote novo andar,
            sai do KPI, e o código antigo fica guardado.
          </p>
          <button onClick={() => submit.mutate()} disabled={!valid || submit.isPending}
            className="h-9 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {submit.isPending && <Loader2 className="size-4 animate-spin" />}
            Trocar código
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

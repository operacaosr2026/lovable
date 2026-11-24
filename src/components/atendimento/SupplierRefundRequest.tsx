import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  lookupSupplierRefundOrders, requestSupplierRefunds, type SupplierRefundLookup,
} from "@/lib/supplier-refund.functions";
import { useSupplierRefundInvalidate } from "./SupplierRefund";
import { formatMoney } from "./utils";

// Aba Reembolso › Pedir reembolso: cola um ou vários números de pedido, escreve
// o motivo e marca todos pro fornecedor reembolsar. Valor sugerido = custo do
// fornecedor do pedido (mesma conta do lote), editável. Custo $0 (reenvio,
// troca) não tem valor sugerido: tem que informar.

type Row = SupplierRefundLookup & { amount: string; on: boolean };

const parseMoney = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const moneyText = (n: number) => n.toFixed(2).replace(".", ",");

export function SupplierRefundRequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invalidate = useSupplierRefundInvalidate();
  const lookupFn = useServerFn(lookupSupplierRefundOrders);
  const requestFn = useServerFn(requestSupplierRefunds);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);

  const reset = () => { setText(""); setNote(""); setRows(null); };
  const close = () => { reset(); onClose(); };

  const lookup = useMutation({
    mutationFn: (numbers: string[]) => lookupFn({ data: { numbers } }),
    onSuccess: (res) => setRows(res.map((r) => {
      const ok = !!r.orderId && !r.already;
      return { ...r, amount: r.cost ? moneyText(r.cost) : "", on: ok };
    })),
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const numbers = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const chosen = (rows ?? []).filter((r) => r.on && r.orderId && !r.already);
  const invalid = chosen.filter((r) => !(parseMoney(r.amount) > 0));
  const total = chosen.reduce((s, r) => s + (parseMoney(r.amount) || 0), 0);

  const submit = useMutation({
    mutationFn: () => requestFn({ data: {
      items: chosen.map((r) => ({ orderId: r.orderId!, amount: parseMoney(r.amount) })),
      note: note.trim() || null,
    } }),
    onSuccess: (res) => {
      toast.success(`${res.inserted} pedido${res.inserted === 1 ? "" : "s"} aguardando o fornecedor reembolsar`);
      invalidate();
      close();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Pedir reembolso ao fornecedor</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Pedidos</label>
            <textarea value={text} onChange={(e) => { setText(e.target.value); setRows(null); }} rows={4}
              placeholder={"#L6-1142\n#L6-1140\n(um por linha, ou separados por vírgula/espaço)"}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary font-mono" />
          </div>
          <div>
            <label className="text-xs font-medium">Motivo</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Ex.: Parado na alfândega"
              className="mt-1 w-full h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary" />
          </div>

          {!rows && (
            <button onClick={() => lookup.mutate(numbers)} disabled={!numbers.length || lookup.isPending}
              className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
              {lookup.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              Buscar {numbers.length ? `${numbers.length} pedido${numbers.length === 1 ? "" : "s"}` : "pedidos"}
            </button>
          )}

          {rows && (
            <>
              <div className="rounded-lg border border-border divide-y divide-border">
                {rows.map((r, i) => {
                  const blocked = !r.orderId || !!r.already;
                  const needsValue = r.on && !blocked && !(parseMoney(r.amount) > 0);
                  return (
                    <div key={r.input} className={`px-3 py-2 flex items-center gap-3 ${blocked ? "opacity-60" : ""}`}>
                      <input type="checkbox" checked={r.on} disabled={blocked} onChange={(e) => setRow(i, { on: e.target.checked })} className="size-3.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{r.order_number ?? r.input}
                          <span className="ml-2 font-normal text-muted-foreground">{[r.shopName, r.customer_name].filter(Boolean).join(" · ")}</span>
                        </p>
                        {!r.orderId ? <p className="text-[11px] text-destructive">Pedido não encontrado</p>
                          : r.already ? <p className="text-[11px] text-muted-foreground">Já marcado ({r.already === "pendente" ? "aguardando fornecedor" : "fornecedor já reembolsou"})</p>
                          : r.cost === 0 ? <p className="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle className="size-3" /> Custo $0 (reenvio/troca) — informe o valor</p>
                          : null}
                      </div>
                      {!blocked && (
                        <div className={`flex items-center gap-1 h-8 w-28 rounded-md border px-2 ${needsValue ? "border-destructive" : "border-border"}`}>
                          <span className="text-[11px] text-muted-foreground">US$</span>
                          <input value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} inputMode="decimal" placeholder="0,00"
                            className="w-full bg-transparent text-xs text-right outline-none" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button onClick={() => setRows(null)} className="text-xs text-muted-foreground hover:text-foreground">Editar lista</button>
                <button onClick={() => submit.mutate()} disabled={!chosen.length || invalid.length > 0 || submit.isPending}
                  className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
                  {submit.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Marcar {chosen.length} pedido{chosen.length === 1 ? "" : "s"} · {formatMoney(total, "USD")}
                </button>
              </div>
              {invalid.length > 0 && (
                <p className="text-[11px] text-destructive">Informe o valor de {invalid.map((r) => r.order_number).join(", ")}.</p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  decideRefund, getRefundSetup, previewRefund, requestRefund,
  type RefundLine, type RefundMode,
} from "@/lib/support-refund.functions";
import { REFUND_REASONS, refundReasonLabel, type RefundReason } from "@/lib/refund-reasons";
import { supplierOrdersTotal } from "@/lib/shop-orders.functions";
import { listSupplierRefundsForOrders, requestSupplierRefund } from "@/lib/supplier-refund.functions";
import { useIsDemo, useSupportFn } from "./demo";
import { formatMoney, fullTime } from "./utils";

// Reembolsar: pedido inteiro, itens (com ou sem frete) ou um valor. Vai pra
// aprovação do dono; ele mesmo pedindo, reembolsa na hora (com confirmação).

const MODES: { key: RefundMode; label: string }[] = [
  { key: "total", label: "Pedido inteiro" },
  { key: "itens", label: "Itens" },
  { key: "valor", label: "Valor" },
];

export function RefundDialog({ orderId, conversationId, open, onClose }: {
  orderId: string; conversationId: string | null; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const setupFn = useSupportFn(getRefundSetup, "getRefundSetup");
  const previewFn = useSupportFn(previewRefund, "previewRefund");
  const requestFn = useSupportFn(requestRefund, "requestRefund");
  const setup = useQuery({
    queryKey: ["refund-setup", orderId],
    queryFn: () => setupFn({ data: { orderId } }),
    enabled: open, staleTime: 30_000, retry: false,
  });
  const s = setup.data;

  const [mode, setMode] = useState<RefundMode>("total");
  const [qty, setQty] = useState<Record<string, number>>({});   // line id → quantidade (0 = fora)
  const [shipping, setShipping] = useState(false);
  const [value, setValue] = useState("");
  const [notify, setNotify] = useState(true);
  const [charge, setCharge] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<RefundReason | null>(null);

  // Reembolso do fornecedor junto: marca na aba Reembolso (valor sugerido =
  // custo do fornecedor do pedido, editável). Some se o pedido já está marcado.
  const demo = useIsDemo();
  const supplierListFn = useServerFn(listSupplierRefundsForOrders);
  const supplierCostFn = useServerFn(supplierOrdersTotal);
  const supplierRequestFn = useServerFn(requestSupplierRefund);
  const supplierExisting = useQuery({
    queryKey: ["supplier-refunds-orders", [orderId]],
    queryFn: () => supplierListFn({ data: { orderIds: [orderId] } }),
    enabled: open && !demo, staleTime: 30_000,
  });
  const canSupplier = !demo && supplierExisting.isSuccess && supplierExisting.data.length === 0;
  const [supplier, setSupplier] = useState(false);
  const [supplierValue, setSupplierValue] = useState("");
  const supplierCost = useQuery({
    queryKey: ["supplier-cost", orderId],
    queryFn: () => supplierCostFn({ data: { order_ids: [orderId] } }),
    enabled: open && canSupplier && supplier, staleTime: 60_000, retry: false,
  });
  useEffect(() => {
    if (supplierCost.data && !supplierValue) setSupplierValue(supplierCost.data.total.toFixed(2).replace(".", ","));
  }, [supplierCost.data]);
  const supplierAmount = Number(supplierValue.replace(",", "."));
  const supplierReady = !supplier || (supplierValue !== "" && Number.isFinite(supplierAmount) && supplierAmount >= 0);

  const lines: RefundLine[] = useMemo(() => (s?.lines ?? [])
    .filter((l) => (qty[l.id] ?? 0) > 0)
    .map((l) => ({ line_item_id: l.id, title: l.title, variant_title: l.variantTitle, quantity: qty[l.id] })), [s, qty]);

  // Valor exato dos itens vem da Shopify (desconto/imposto rateados).
  const preview = useQuery({
    queryKey: ["refund-preview", orderId, lines, shipping],
    queryFn: () => previewFn({ data: { orderId, lines, includeShipping: shipping } }),
    enabled: open && mode === "itens" && (lines.length > 0 || shipping), staleTime: 60_000,
  });

  const typed = Math.round(Number(value.replace(",", ".")) * 100) / 100;
  const amount = !s ? 0
    : mode === "total" ? s.maxRefundable
    : mode === "valor" ? (Number.isFinite(typed) ? typed : 0)
    : (lines.length || shipping) ? (preview.data?.amount ?? 0) : 0;
  const overMax = !!s && amount > s.maxRefundable + 0.001;
  const ready = !!s && amount > 0 && !overMax && !!reason && supplierReady && !(mode === "itens" && preview.isFetching);
  const canApprove = !!s?.canApprove;

  const submit = useMutation({
    mutationFn: async () => {
      if (canApprove && !(await confirm({
        title: `Reembolsar ${formatMoney(amount, s!.currency)}?`,
        description: `O dinheiro volta pro cliente pelo mesmo meio de pagamento do pedido ${s!.orderNumber ?? ""}. Não dá pra desfazer.`,
        confirmText: "Reembolsar", variant: "destructive",
      }))) return null;
      const res = await requestFn({ data: {
        orderId, conversationId, mode, reason, lines: mode === "itens" ? lines : [], includeShipping: mode === "itens" && shipping,
        amount: mode === "valor" ? amount : null, notifyCustomer: notify, chargeOnDelivery: mode === "total" && charge, note: note.trim() || null,
      } });
      if (canSupplier && supplier) {
        // O reembolso do cliente já foi; se marcar o fornecedor falhar, só avisa.
        try {
          await supplierRequestFn({ data: { orderId, conversationId, amount: Math.round(supplierAmount * 100) / 100, note: note.trim() || null } });
        } catch (e: any) {
          toast.error("Não marcou o reembolso do fornecedor", { description: e.message });
        }
      }
      return res;
    },
    onSuccess: (res: any) => {
      if (!res) return;
      if (res.status === "aprovado") toast.success(`Reembolso de ${formatMoney(res.amount, res.currency)} feito`);
      else toast.success("Reembolso enviado pra aprovação", { description: "Quem aprova recebe o aviso no sino." });
      qc.invalidateQueries({ queryKey: ["refund-requests"] });
      qc.invalidateQueries({ queryKey: ["support-customer"] });
      qc.invalidateQueries({ queryKey: ["support-approvals"] });
      qc.invalidateQueries({ queryKey: ["supplier-refunds"] });
      qc.invalidateQueries({ queryKey: ["supplier-refunds-orders"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao pedir o reembolso"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="size-4" /> Reembolsar{s?.orderNumber ? ` — ${s.orderNumber}` : ""}
          </DialogTitle>
          {s?.store && <p className="text-xs text-muted-foreground">{s.store}</p>}
        </DialogHeader>

        {setup.isLoading ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : setup.error ? (
          <p className="text-sm text-destructive py-6 text-center">{(setup.error as Error).message}</p>
        ) : s && (
          s.maxRefundable <= 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nada a reembolsar — o pedido já foi reembolsado por inteiro.</p>
          ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-px rounded-xl border border-border bg-border overflow-hidden text-center">
              <Stat label="Pago" value={formatMoney(s.received, s.currency)} />
              <Stat label="Já reembolsado" value={formatMoney(s.refunded, s.currency)} />
              <Stat label="Disponível" value={formatMoney(s.maxRefundable, s.currency)} />
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted">
              {MODES.map((m) => (
                <button key={m.key} onClick={() => setMode(m.key)}
                  className={`h-8 rounded-md text-xs font-medium ${mode === m.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {m.label}
                </button>
              ))}
            </div>

            {mode === "total" && (
              <p className="text-xs text-muted-foreground">Devolve tudo o que ainda está disponível, incluindo o frete.</p>
            )}

            {mode === "itens" && (
              <div className="space-y-2">
                {s.lines.map((l) => {
                  const q = qty[l.id] ?? 0;
                  return (
                    <div key={l.id} className={`flex items-center gap-2 rounded-xl border p-2.5 ${q > 0 ? "border-primary/50" : "border-border"}`}>
                      <input type="checkbox" checked={q > 0} onChange={(e) => setQty({ ...qty, [l.id]: e.target.checked ? l.refundable : 0 })} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{l.title}</p>
                        <p className="text-[11px] text-muted-foreground">{l.variantTitle ? `${l.variantTitle} · ` : ""}{formatMoney(l.unitPrice, s.currency)} cada</p>
                      </div>
                      {l.refundable > 1 && q > 0 && (
                        <select value={q} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })}
                          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs">
                          {Array.from({ length: l.refundable }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}×</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
                {s.shippingRefundable > 0 && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={shipping} onChange={(e) => setShipping(e.target.checked)} />
                    Incluir frete ({formatMoney(s.shippingRefundable, s.currency)})
                  </label>
                )}
              </div>
            )}

            {mode === "valor" && (
              <div>
                <div className="flex items-center gap-2 h-9 rounded-lg border border-border bg-background px-3 focus-within:border-primary">
                  <span className="text-xs text-muted-foreground">{s.currency}</span>
                  <input autoFocus inputMode="decimal" value={value}
                    onChange={(e) => {
                      // Acima do disponível trava no máximo (a Shopify recusaria).
                      const v = e.target.value.replace(/[^\d.,]/g, "");
                      setValue(Number(v.replace(",", ".")) > s.maxRefundable ? s.maxRefundable.toFixed(2).replace(".", ",") : v);
                    }}
                    placeholder="0,00" className="flex-1 bg-transparent text-sm outline-none" />
                  <button onClick={() => setValue(s.maxRefundable.toFixed(2).replace(".", ","))}
                    className="text-[11px] text-primary hover:underline shrink-0">Máximo</button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Até {formatMoney(s.maxRefundable, s.currency)}. Ex.: compensação pelo atraso. Não mexe nos itens do pedido.
                </p>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold mb-1.5">Motivo</p>
              <div className="flex flex-wrap gap-1.5">
                {REFUND_REASONS.map((r) => (
                  <button key={r.key} type="button" onClick={() => setReason(r.key)}
                    className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium transition-colors ${reason === r.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold mb-1">Observação (opcional)</p>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
                placeholder="Ex.: produto chegou com defeito, cliente mandou foto"
                className="w-full resize-none rounded-lg border border-border bg-background p-2 text-xs outline-none focus:border-primary" />
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Shopify avisa o cliente por e-mail
            </label>

            {/* Só reembolso total entra em Chargebacks > Alertas (rede "Reembolso"). */}
            {mode === "total" && (
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} className="mt-0.5" />
                <span>
                  Cobrar o cliente quando o produto for entregue
                  <span className="block text-[11px] text-muted-foreground">Entra em Chargebacks › Alertas. Desmarcado, não é cobrado.</span>
                </span>
              </label>
            )}

            {canSupplier && (
              <div>
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={supplier} onChange={(e) => setSupplier(e.target.checked)} className="mt-0.5" />
                  <span>
                    Fornecedor tem que reembolsar
                    <span className="block text-[11px] text-muted-foreground">Entra em Atendimento › Reembolso até alguém conferir no sistema dele.</span>
                  </span>
                </label>
                {supplier && (
                  <div className="ml-5 mt-1.5">
                    <div className="flex items-center gap-2 h-8 rounded-lg border border-border bg-background px-3 focus-within:border-primary">
                      <span className="text-xs text-muted-foreground">USD</span>
                      <input inputMode="decimal" value={supplierValue}
                        onChange={(e) => setSupplierValue(e.target.value.replace(/[^\d.,]/g, ""))}
                        placeholder={supplierCost.isLoading ? "Calculando…" : "0,00"} className="flex-1 bg-transparent text-xs outline-none" />
                      {supplierCost.isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Valor que o fornecedor deve{supplierCost.data ? ` — custo do produto: ${formatMoney(supplierCost.data.total, "USD")}` : ""}.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">Vai devolver</span>
              <span className={`text-sm font-semibold ${overMax ? "text-destructive" : ""}`}>
                {mode === "itens" && preview.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : formatMoney(amount, s.currency)}
              </span>
            </div>
            {overMax && <p className="text-[11px] text-destructive -mt-2">Maior que o disponível ({formatMoney(s.maxRefundable, s.currency)}).</p>}
            {preview.error && <p className="text-[11px] text-destructive -mt-2">{(preview.error as Error).message}</p>}

            {!reason && <p className="text-[11px] text-muted-foreground">Escolha o motivo pra continuar.</p>}
            {!canApprove && <p className="text-[11px] text-muted-foreground">Só é feito depois que for aprovado.</p>}
            <button onClick={() => submit.mutate()} disabled={!ready || submit.isPending}
              className={`h-9 w-full rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 ${canApprove ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
              {submit.isPending && <Loader2 className="size-4 animate-spin" />}
              {canApprove ? `Reembolsar ${formatMoney(amount, s.currency)}` : "Enviar pra aprovação"}
            </button>
          </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-2 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold">{value}</p>
    </div>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Aguardando aprovação", cls: "bg-amber-500/10 text-amber-600" },
  gerando: { label: "Reembolsando…", cls: "bg-blue-500/10 text-blue-600" },
  aprovado: { label: "Concluído", cls: "bg-emerald-500/10 text-emerald-600" },
  recusado: { label: "Recusado", cls: "bg-rose-500/10 text-rose-600" },
  erro: { label: "Erro ao reembolsar", cls: "bg-rose-500/10 text-rose-600" },
};

export type RefundRequestView = {
  id: string; order_id: string; mode: RefundMode; reason: string | null; line_items: RefundLine[]; include_shipping: boolean;
  amount: number; currency: string; notify_customer: boolean; charge_on_delivery: boolean; note: string | null; status: string;
  requestedByName: string | null; decidedByName: string | null; decided_at: string | null; reject_reason: string | null;
  refunded_amount: number | null; error: string | null; created_at: string;
};

// "Solicitado · Lidianne ......... 23/10/2026, 13:23" numa linha só (nome corta, data não).
function WhoWhen({ label, name, at }: { label: string; name: string; at: string }) {
  return (
    // Cartão estreito (painel do pedido): nome e data quebram linha em vez de cortar.
    <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
      <span className="min-w-0 break-words">{label} · {name}</span>
      <span className="ml-auto whitespace-nowrap">{fullTime(at)}</span>
    </div>
  );
}

// Cartão do reembolso embaixo do pedido. O dono aprova/recusa daqui.
export function RefundRequestCard({ r, canApprove }: { r: RefundRequestView; canApprove: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const decideFn = useSupportFn(decideRefund, "decideRefund");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      if (approve && !(await confirm({
        title: `Reembolsar ${formatMoney(r.amount, r.currency)}?`,
        description: "O dinheiro volta pro cliente pelo mesmo meio de pagamento do pedido. Não dá pra desfazer.",
        confirmText: "Reembolsar", variant: "destructive",
      }))) return null;
      return decideFn({ data: { id: r.id, approve, reason: approve ? null : reason.trim() || null } });
    },
    onSuccess: (res: any) => {
      if (!res) return;
      toast.success(res.status === "aprovado" ? `Reembolso de ${formatMoney(res.amount, r.currency)} feito` : "Reembolso recusado");
      setRejecting(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["refund-requests"] });
      qc.invalidateQueries({ queryKey: ["support-customer"] });
      qc.invalidateQueries({ queryKey: ["support-approvals"] });
    },
  });
  const st = STATUS[r.status] ?? STATUS.pendente;
  const open = r.status === "pendente" || r.status === "erro";
  const what = r.mode === "total" ? "Pedido inteiro"
    : r.mode === "valor" ? "Valor avulso"
    : r.line_items.map((l) => `${l.quantity}× ${l.title}${l.variant_title ? ` (${l.variant_title})` : ""}`).join(", ") + (r.include_shipping ? " + frete" : "");
  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-2.5 space-y-1.5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap">
          <Undo2 className="size-3" /> Reembolso {formatMoney(r.status === "aprovado" && r.refunded_amount != null ? r.refunded_amount : r.amount, r.currency)}
        </p>
        {/* Feito não precisa de etiqueta: a linha "Aprovado por" já diz. */}
        {r.status !== "aprovado" && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${st.cls}`}>{st.label}</span>}
      </div>
      <p className="text-[11px]">{what}{r.charge_on_delivery ? " · cobrar quando entregar" : ""}</p>
      {r.reason && <p className="text-[11px] text-muted-foreground">Motivo: {refundReasonLabel(r.reason)}</p>}
      <WhoWhen label="Solicitado" name={r.requestedByName ?? "Equipe"} at={r.created_at} />
      {r.status === "aprovado" && r.decided_at && (
        <WhoWhen label="Aprovado" name={r.decidedByName ?? r.requestedByName ?? "Equipe"} at={r.decided_at} />
      )}
      {r.note && <p className="text-[10px] text-muted-foreground italic">{r.note}</p>}
      {r.status === "recusado" && (
        <p className="text-[11px] text-rose-600">Recusado por {r.decidedByName ?? "—"}{r.reject_reason ? `: ${r.reject_reason}` : ""}</p>
      )}
      {r.status === "erro" && r.error && <p className="text-[11px] text-destructive">{r.error}</p>}
      {canApprove && open && (
        rejecting ? (
          <div className="space-y-1.5 pt-1">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" maxLength={500}
              className="w-full h-7 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-primary" />
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => decide.mutate(false)} disabled={decide.isPending}
                className="flex-1 min-w-[9rem] h-7 px-2 rounded-md bg-destructive text-destructive-foreground text-[11px] font-medium whitespace-nowrap disabled:opacity-50">Recusar reembolso</button>
              <button onClick={() => setRejecting(false)} className="h-7 px-2 rounded-md border border-border text-[11px]">Voltar</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button onClick={() => decide.mutate(true)} disabled={decide.isPending}
              className="flex-[2] min-w-[9rem] h-7 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium whitespace-nowrap disabled:opacity-50 flex items-center justify-center gap-1">
              {decide.isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              {r.status === "erro" ? "Tentar de novo" : "Aprovar e reembolsar"}
            </button>
            <button onClick={() => setRejecting(true)} disabled={decide.isPending}
              className="flex-1 h-7 px-2.5 rounded-md border border-border text-[11px] whitespace-nowrap hover:border-destructive hover:text-destructive">Recusar</button>
          </div>
        )
      )}
    </div>
  );
}

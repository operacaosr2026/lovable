import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Repeat, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  decideExchange, getExchangeSetup, requestExchange, searchExchangeProducts,
  EXCHANGE_TAG, type ExchangeFault, type ExchangeItem, type ExchangeProduct,
} from "@/lib/support-exchange.functions";
import { useSupportFn } from "./demo";
import { fullTime } from "./utils";

// Gerar troca: escolher o tamanho novo (ou outro modelo) de cada item e de quem
// foi o erro. Vai pra aprovação do dono; ele mesmo pedindo, já gera o pedido.

type Row = {
  key: string;
  include: boolean;
  original: string;                 // "Tênis X (10)" — o que está sendo trocado
  product: ExchangeProduct | null;
  variantId: string;
  quantity: number;
  searching: boolean;
};

const FAULTS: { key: ExchangeFault; label: string }[] = [
  { key: "empresa", label: "Erro da empresa" },
  { key: "fornecedor", label: "Erro do fornecedor" },
];

export function ExchangeDialog({ orderId, conversationId, open, onClose }: {
  orderId: string; conversationId: string | null; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const setupFn = useSupportFn(getExchangeSetup, "getExchangeSetup");
  const requestFn = useSupportFn(requestExchange, "requestExchange");
  const setup = useQuery({
    queryKey: ["exchange-setup", orderId],
    queryFn: () => setupFn({ data: { orderId } }),
    enabled: open, staleTime: 60_000, retry: false,
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [fault, setFault] = useState<ExchangeFault | null>(null);
  const [note, setNote] = useState("");
  // Monta os itens uma vez (a consulta pode atualizar sozinha e não pode
  // apagar o que já foi escolhido).
  useEffect(() => {
    if (!setup.data || rows.length) return;
    const lines = setup.data.lines;
    setRows(lines.map((l, i) => ({
      key: String(i),
      include: lines.length === 1,
      original: `${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""}`,
      product: l.product,
      variantId: "",
      quantity: l.quantity,
      searching: !l.product,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.data]);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const chosen = rows.filter((r) => r.include);
  const ready = !!fault && chosen.length > 0 && chosen.every((r) => r.product && r.variantId);
  const canApprove = !!setup.data?.canApprove;

  const submit = useMutation({
    mutationFn: () => {
      const items: ExchangeItem[] = chosen.map((r) => {
        const v = r.product!.variants.find((x) => x.id === r.variantId)!;
        return {
          variant_id: v.id, product_title: r.product!.title,
          variant_title: v.title === "Default Title" ? null : v.title, sku: v.sku,
          quantity: r.quantity, replaces: r.original,
        };
      });
      return requestFn({ data: { orderId, conversationId, fault: fault!, items, note: note.trim() || null } });
    },
    onSuccess: (res: any) => {
      if (res.status === "aprovado") toast.success(`Pedido ${res.orderName} gerado`);
      else toast.success("Troca enviada pra aprovação", { description: "Quem aprova recebe o aviso no sino." });
      qc.invalidateQueries({ queryKey: ["exchange-requests"] });
      qc.invalidateQueries({ queryKey: ["support-customer"] });
      qc.invalidateQueries({ queryKey: ["support-approvals"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao pedir a troca"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="size-4" /> Gerar troca{setup.data?.orderNumber ? ` — ${setup.data.orderNumber}` : ""}
          </DialogTitle>
          {setup.data?.store && <p className="text-xs text-muted-foreground">{setup.data.store}</p>}
        </DialogHeader>

        {setup.isLoading ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : setup.error ? (
          <p className="text-sm text-destructive py-6 text-center">{(setup.error as Error).message}</p>
        ) : setup.data && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold">Itens</p>
              {rows.map((r) => (
                <div key={r.key} className={`rounded-xl border p-3 space-y-2 ${r.include ? "border-primary/50" : "border-border"}`}>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} className="mt-0.5" />
                    <span className="text-xs">
                      <span className="text-muted-foreground">Pedido: </span>
                      <span className="font-medium">{r.original}</span>
                    </span>
                  </label>
                  {r.include && (
                    <div className="pl-5 space-y-2">
                      {r.product && !r.searching && (
                        <div className="flex items-center gap-2">
                          {r.product.image && <img src={r.product.image} alt="" className="size-10 rounded-md object-cover border border-border" />}
                          <p className="text-xs font-medium flex-1 min-w-0 truncate">{r.product.title}</p>
                        </div>
                      )}
                      {r.searching ? (
                        <ProductSearch orderId={orderId}
                          onPick={(p) => patch(r.key, { product: p, variantId: "", searching: false })}
                          onCancel={r.product ? () => patch(r.key, { searching: false }) : undefined} />
                      ) : r.product && (
                        <div className="flex gap-2">
                          <select value={r.variantId} onChange={(e) => patch(r.key, { variantId: e.target.value })}
                            className={`flex-1 h-8 rounded-lg border border-border bg-background px-2 text-xs ${r.variantId ? "" : "text-muted-foreground"}`}>
                            <option value="">Tamanho / variante nova…</option>
                            {r.product.variants.map((v) => (
                              <option key={v.id} value={v.id}>{v.title === "Default Title" ? "Único" : v.title}{v.available ? "" : " (sem estoque)"}</option>
                            ))}
                          </select>
                          <input type="number" min={1} max={20} value={r.quantity}
                            onChange={(e) => patch(r.key, { quantity: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                            className="w-14 h-8 rounded-lg border border-border bg-background px-2 text-xs" aria-label="Quantidade" />
                        </div>
                      )}
                      {!r.searching && (
                        <button onClick={() => patch(r.key, { searching: true })} className="text-[11px] text-primary hover:underline">
                          Trocar por outro modelo
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-semibold mb-2">De quem foi o erro?</p>
              <div className="grid grid-cols-2 gap-2">
                {FAULTS.map((f) => (
                  <button key={f.key} onClick={() => setFault(f.key)}
                    className={`h-9 rounded-lg border text-xs font-medium ${fault === f.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/50"}`}>
                    {f.label}
                  </button>
                ))}
              </div>
              {fault && <p className="text-[11px] text-muted-foreground mt-1.5">Tag do pedido: <span className="font-mono">{EXCHANGE_TAG[fault]}</span></p>}
            </div>

            <div>
              <p className="text-xs font-semibold mb-1">Observação (opcional)</p>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
                placeholder="Ex.: cliente mandou foto, tênis veio grande"
                className="w-full resize-none rounded-lg border border-border bg-background p-2 text-xs outline-none focus:border-primary" />
            </div>

            {setup.data.address.length > 0 && (
              <div className="rounded-lg bg-muted/50 p-2.5 text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground mb-0.5">Envio para (mesmo endereço do pedido)</p>
                {setup.data.address.map((l, i) => <p key={i}>{l}</p>)}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Sai de graça (100% de desconto, sem frete) e entra como pago na Shopify.
              {canApprove ? "" : " Só é gerado depois que for aprovado."}
            </p>

            <button onClick={() => submit.mutate()} disabled={!ready || submit.isPending}
              className="h-9 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
              {submit.isPending && <Loader2 className="size-4 animate-spin" />}
              {canApprove ? "Gerar pedido de troca" : "Enviar pra aprovação"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProductSearch({ orderId, onPick, onCancel }: { orderId: string; onPick: (p: ExchangeProduct) => void; onCancel?: () => void }) {
  const searchFn = useSupportFn(searchExchangeProducts, "searchExchangeProducts");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  const res = useQuery({
    queryKey: ["exchange-search", orderId, term],
    queryFn: () => searchFn({ data: { orderId, q: term } }),
    enabled: term.length >= 2, staleTime: 60_000,
  });
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="flex-1 flex items-center gap-1.5 h-8 rounded-lg border border-border bg-background px-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto da loja…"
            className="flex-1 bg-transparent text-xs outline-none" />
          {res.isFetching && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        {onCancel && (
          <button onClick={onCancel} className="size-8 grid place-items-center rounded-lg hover:bg-muted" aria-label="Cancelar busca">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {(res.data ?? []).length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {(res.data as ExchangeProduct[]).map((p) => (
            <button key={p.id} onClick={() => onPick(p)} className="w-full flex items-center gap-2 p-1.5 text-left hover:bg-muted">
              {p.image ? <img src={p.image} alt="" className="size-8 rounded object-cover" /> : <div className="size-8 rounded bg-muted" />}
              <span className="text-xs truncate">{p.title}</span>
            </button>
          ))}
        </div>
      )}
      {term.length >= 2 && res.isSuccess && !res.data?.length && <p className="text-[11px] text-muted-foreground">Nenhum produto encontrado</p>}
      {res.error && <p className="text-[11px] text-destructive">{(res.error as Error).message}</p>}
    </div>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Aguardando aprovação", cls: "bg-amber-500/10 text-amber-600" },
  gerando: { label: "Gerando pedido…", cls: "bg-blue-500/10 text-blue-600" },
  aprovado: { label: "Aprovada", cls: "bg-emerald-500/10 text-emerald-600" },
  recusado: { label: "Recusada", cls: "bg-rose-500/10 text-rose-600" },
  erro: { label: "Erro ao gerar", cls: "bg-rose-500/10 text-rose-600" },
};

export type ExchangeRequestView = {
  id: string; order_id: string; fault: ExchangeFault; items: ExchangeItem[]; note: string | null; status: string;
  requestedByName: string | null; decidedByName: string | null; decided_at: string | null; reject_reason: string | null;
  new_order_name: string | null; error: string | null; created_at: string;
};

// Cartão da troca embaixo do pedido. O dono aprova/recusa daqui.
export function ExchangeRequestCard({ r, canApprove }: { r: ExchangeRequestView; canApprove: boolean }) {
  const qc = useQueryClient();
  const decideFn = useSupportFn(decideExchange, "decideExchange");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const decide = useMutation({
    mutationFn: (approve: boolean) => decideFn({ data: { id: r.id, approve, reason: approve ? null : reason.trim() || null } }),
    onSuccess: (res: any) => {
      toast.success(res.status === "aprovado" ? `Pedido ${res.orderName} gerado` : "Troca recusada");
      setRejecting(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["exchange-requests"] });
      qc.invalidateQueries({ queryKey: ["support-customer"] });
      qc.invalidateQueries({ queryKey: ["support-approvals"] });
    },
  });
  const st = STATUS[r.status] ?? STATUS.pendente;
  const open = r.status === "pendente" || r.status === "erro";
  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold flex items-center gap-1"><Repeat className="size-3" /> Troca</p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${st.cls}`}>
          {st.label}{r.status === "aprovado" && r.new_order_name ? ` · ${r.new_order_name}` : ""}
        </span>
      </div>
      {r.items.map((i, k) => (
        <p key={k} className="text-[11px]">
          {i.quantity}× {i.product_title}{i.variant_title ? <span className="font-semibold"> ({i.variant_title})</span> : ""}
          {i.replaces && <span className="text-muted-foreground"> — no lugar de {i.replaces}</span>}
        </p>
      ))}
      <p className="text-[10px] text-muted-foreground">
        Erro {r.fault === "empresa" ? "da empresa" : "do fornecedor"} · {r.requestedByName ?? "Equipe"} · {fullTime(r.created_at)}
      </p>
      {r.note && <p className="text-[11px] text-muted-foreground italic">{r.note}</p>}
      {r.status === "recusado" && (
        <p className="text-[11px] text-rose-600">Recusada por {r.decidedByName ?? "—"}{r.reject_reason ? `: ${r.reject_reason}` : ""}</p>
      )}
      {r.status === "erro" && r.error && <p className="text-[11px] text-destructive">{r.error}</p>}
      {canApprove && open && (
        rejecting ? (
          <div className="space-y-1.5 pt-1">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" maxLength={500}
              className="w-full h-7 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-primary" />
            <div className="flex gap-1.5">
              <button onClick={() => decide.mutate(false)} disabled={decide.isPending}
                className="flex-1 h-7 rounded-md bg-destructive text-destructive-foreground text-[11px] font-medium disabled:opacity-50">Recusar troca</button>
              <button onClick={() => setRejecting(false)} className="h-7 px-2 rounded-md border border-border text-[11px]">Voltar</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1.5 pt-1">
            <button onClick={() => decide.mutate(true)} disabled={decide.isPending}
              className="flex-1 h-7 rounded-md bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-50 flex items-center justify-center gap-1">
              {decide.isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              {r.status === "erro" ? "Tentar de novo" : "Aprovar e gerar"}
            </button>
            <button onClick={() => setRejecting(true)} disabled={decide.isPending}
              className="h-7 px-2.5 rounded-md border border-border text-[11px] hover:border-destructive hover:text-destructive">Recusar</button>
          </div>
        )
      )}
    </div>
  );
}

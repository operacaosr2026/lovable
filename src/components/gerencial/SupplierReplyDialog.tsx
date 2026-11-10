import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Loader2, MessageSquareReply, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseSupplierReply, saveSupplierReply, type ReplyOrder } from "@/lib/supplier-replies.functions";
import { SUPPLIER_REPLY_KINDS, type SupplierReplyKind } from "@/lib/supplier-replies";

// Gerencial › Alertas › "Resposta do fornecedor": cola o que o fornecedor
// respondeu, confere os pedidos achados, escolhe o tipo e grava. Vira um alerta
// próprio; os pedidos saem dos outros alertas até o pacote andar.

const ddmm = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/New_York", day: "2-digit", month: "2-digit" });

export function SupplierReplyDialog({ month, onClose }: { month: string; onClose: () => void }) {
  const qc = useQueryClient();
  const parseFn = useServerFn(parseSupplierReply);
  const saveFn = useServerFn(saveSupplierReply);
  const [text, setText] = useState("");
  const [found, setFound] = useState<{ orders: ReplyOrder[]; notFound: string[] } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<SupplierReplyKind>("sem_estoque");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const parse = useMutation({
    mutationFn: () => parseFn({ data: { text } }),
    onSuccess: (r) => {
      setFound({ orders: r.orders, notFound: r.notFound });
      setSel(new Set(r.orders.map((o) => o.id)));
      if (!note.trim()) setNote(r.suggestedNote);
      // "falta de estoque" na mensagem já escolhe o tipo.
      if (/estoque|stock/i.test(text)) setKind("sem_estoque");
      else if (/post|envi|despach|ship/i.test(text)) setKind("vai_postar");
      if (!r.orders.length) toast.error("Não achei nenhum pedido nessa mensagem");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () => saveFn({ data: { orderIds: [...sel], kind, title: kind === "outro" ? title.trim() : null, note: note.trim() || null } }),
    onSuccess: (r) => {
      toast.success(`Resposta registrada em ${r.saved} pedido${r.saved === 1 ? "" : "s"} — já está nos alertas`);
      qc.invalidateQueries({ queryKey: ["gerencial", month] });
      qc.invalidateQueries({ queryKey: ["alert-orders"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ready = sel.size > 0 && (kind !== "outro" || title.trim().length > 0);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageSquareReply className="size-4" /> Resposta do fornecedor</DialogTitle>
          <p className="text-xs text-muted-foreground">Cole a mensagem como ele mandou. Os pedidos achados saem dos outros alertas e vão pra um alerta próprio até o pacote andar no rastreio.</p>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <textarea value={text} onChange={(e) => { setText(e.target.value); setFound(null); }} rows={6} autoFocus
              placeholder={"#L3-1133 - JCZ1029038085DH\n#L2-1297 - YTTGJ8000181780LU\nEstes pedidos não podem ser enviados no momento devido à falta de estoque."}
              className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-primary" />
            <button onClick={() => parse.mutate()} disabled={!text.trim() || parse.isPending}
              className="mt-2 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
              {parse.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Encontrar pedidos
            </button>
          </div>

          {found && (
            <>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Pedidos achados · {found.orders.length}</p>
                <div className="space-y-1.5">
                  {found.orders.map((o) => (
                    <label key={o.id} className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer ${sel.has(o.id) ? "border-primary/40 bg-primary/[0.03]" : "border-border"}`}>
                      <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{o.number} <span className="font-normal text-[11px] text-muted-foreground">· {o.shop} · pedido {o.orderDate.slice(8, 10)}/{o.orderDate.slice(5, 7)}{o.code ? ` · ${o.code}` : ""}</span></p>
                        {o.current && <p className="text-[11px] text-amber-700 dark:text-amber-400">Já tem resposta: {o.current.title} ({ddmm(o.current.at)}) — vai ser substituída</p>}
                      </div>
                    </label>
                  ))}
                </div>
                {found.notFound.length > 0 && (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1">
                    <AlertTriangle className="size-3.5 shrink-0 mt-px" /> Não achei no sistema: {found.notFound.join(", ")}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold mb-1.5">O que o fornecedor disse</p>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted">
                  {SUPPLIER_REPLY_KINDS.map((k) => (
                    <button key={k.key} onClick={() => setKind(k.key)} title={k.hint}
                      className={`h-8 rounded-md text-xs font-medium ${kind === k.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                      {k.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{SUPPLIER_REPLY_KINDS.find((k) => k.key === kind)?.hint}{kind === "sem_estoque" ? " — alerta crítico." : ""}</p>
                {kind === "outro" && (
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Título do alerta (ex.: Fornecedor trocando o modelo)"
                    className="mt-2 w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
                )}
              </div>

              <div>
                <p className="text-xs font-semibold mb-1">Observação (aparece no alerta)</p>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
                  className="w-full resize-none rounded-lg border border-border bg-background p-2 text-xs outline-none focus:border-primary" />
              </div>

              <button onClick={() => save.mutate()} disabled={!ready || save.isPending}
                className="h-10 w-full rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
                {save.isPending && <Loader2 className="size-4 animate-spin" />} Registrar em {sel.size} pedido{sel.size === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

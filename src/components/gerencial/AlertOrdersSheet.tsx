import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellRing, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, EyeOff, ExternalLink, Loader2, Mail, MessageCircle, RotateCcw, Undo2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { getAlertOrders, resolveAlertOrder, type AlertOrder } from "@/lib/gerencial-alert-orders.functions";
import { listNoticeTemplates, queueOrderNotices } from "@/lib/order-notices.functions";
import { buildAlertSupplierMessage } from "@/lib/order-message";

// Gerencial › Alertas › "Ver rastreio": gaveta com os pedidos do alerta
// (entrega / lote parado / alfândega), o resumo do que foi analisado e a ação
// de avisar os clientes por e-mail (mesmas mensagens de Notificações).

const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const ddmmhm = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/New_York", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export function AlertOrdersSheet({ alert, month, onClose, onDismiss }: {
  alert: { key: string; title: string; detail: string }; month: string; onClose: () => void;
  onDismiss?: () => void;   // "Desconsiderar" sem sair da gaveta (some pra equipe no mês)
}) {
  const qc = useQueryClient();
  const fn = useServerFn(getAlertOrders);
  const q = useQuery({ queryKey: ["alert-orders", alert.key, month], queryFn: () => fn({ data: { key: alert.key, month } }) });
  const orders = q.data?.orders ?? [];
  const resolved = q.data?.resolved ?? [];
  const canResolve = !!q.data?.canResolve;

  // Resolvido (um pedido por vez): sai do alerta e da contagem pra equipe.
  const resolveFn = useServerFn(resolveAlertOrder);
  const [showResolved, setShowResolved] = useState(false);
  const resolve = useMutation({
    mutationFn: (v: { orderId: string; undo?: boolean }) => resolveFn({ data: { key: alert.key, ...v } }),
    onSuccess: (_r, v) => {
      setSel((s) => { const n = new Set(s); n.delete(v.orderId); return n; });
      qc.invalidateQueries({ queryKey: ["alert-orders", alert.key, month] });
      qc.invalidateQueries({ queryKey: ["gerencial", month] });
      toast.success(v.undo ? "Pedido voltou pro alerta" : "Marcado como resolvido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Seleção: começa com quem ainda não foi avisado.
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { if (q.data) setSel(new Set(q.data.orders.filter((o) => !o.notifiedAt).map((o) => o.id))); }, [q.data]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = orders.length > 0 && orders.every((o) => sel.has(o.id));

  const tplFn = useServerFn(listNoticeTemplates);
  const tpls = useQuery({ queryKey: ["notice-templates"], queryFn: () => tplFn(), retry: false });
  const [tplId, setTplId] = useState("");
  useEffect(() => {
    if (tplId || !tpls.data?.length) return;
    // Padrão: "Desculpas pelo atraso" se existir.
    setTplId((tpls.data.find((t) => /atraso/i.test(t.title)) ?? tpls.data[0]).id);
  }, [tpls.data, tplId]);

  const queueFn = useServerFn(queueOrderNotices);
  const send = useMutation({
    mutationFn: () => queueFn({ data: { templateId: tplId, orderIds: orders.filter((o) => sel.has(o.id)).map((o) => o.id) } }),
    onSuccess: (r) => {
      toast.success(`${r.queued} aviso${r.queued === 1 ? "" : "s"} na fila de envio${r.skipped.length ? ` · ${r.skipped.length} pulado${r.skipped.length === 1 ? "" : "s"} (${[...new Set(r.skipped.map((s) => s.motivo))].join(", ")})` : ""}`);
      qc.invalidateQueries({ queryKey: ["alert-orders", alert.key, month] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Mensagem pro fornecedor (WhatsApp): os selecionados; nenhum selecionado = todos.
  const [showMsg, setShowMsg] = useState(false);
  const msgOrders = sel.size ? orders.filter((o) => sel.has(o.id)) : orders;
  const supplierMsg = useMemo(() => buildAlertSupplierMessage(alert.key, msgOrders), [alert.key, msgOrders]);
  const copyMsg = async () => {
    try { await navigator.clipboard.writeText(supplierMsg); toast.success("Mensagem copiada — é só colar no WhatsApp do fornecedor"); }
    catch { toast.error("Não foi possível copiar"); }
  };

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0">
        <div className="p-5 sm:p-6 space-y-5">
          <div className="pr-6 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">{alert.title}</SheetTitle>
              <SheetDescription className="text-xs mt-1">{alert.detail}</SheetDescription>
            </div>
            {onDismiss && (
              <button onClick={onDismiss} title="Desconsiderar este alerta neste mês (some pra toda a equipe; dá pra voltar lá embaixo)"
                className="shrink-0 h-8 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5">
                <EyeOff className="size-3.5" /> Descartar
              </button>
            )}
          </div>

          {q.isLoading ? <div className="py-16 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            : q.isError ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
            : !orders.length ? <p className="text-sm text-muted-foreground py-8 text-center">Nenhum pedido nesse alerta agora{resolved.length ? " — todos marcados como resolvidos." : "."}</p>
            : (
              <>
                {/* O que foi analisado */}
                <div className="rounded-2xl border border-border bg-muted/30 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">O que foi analisado · {orders.length} pedido{orders.length > 1 ? "s" : ""}</p>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    {q.data!.analysis.map((a) => (
                      <div key={a.label} className="min-w-0">
                        <dt className="text-[11px] text-muted-foreground">{a.label}</dt>
                        <dd className="text-sm font-medium break-words">{a.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {/* Decisão: avisar os clientes */}
                <div className="rounded-2xl border border-border p-4 space-y-3">
                  <p className="text-sm font-semibold flex items-center gap-2"><BellRing className="size-4 text-primary" /> Avisar os clientes</p>
                  {tpls.isError ? <p className="text-xs text-muted-foreground">{(tpls.error as Error).message}</p> : (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select value={tplId} onChange={(e) => setTplId(e.target.value)} disabled={!tpls.data?.length}
                        className="flex-1 h-9 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary">
                        {(tpls.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                      <button onClick={() => send.mutate()} disabled={!tplId || !sel.size || send.isPending}
                        className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                        {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                        Enviar pra {sel.size} selecionado{sel.size === 1 ? "" : "s"}
                      </button>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">Já vem marcado quem ainda não foi avisado. Vai pela fila de Notificações (e-mail da loja, com o link de rastreio).</p>
                </div>

                {/* Cobrar o fornecedor (WhatsApp) */}
                <div className="rounded-2xl border border-border p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold flex items-center gap-2 mr-auto"><MessageCircle className="size-4 text-emerald-600" /> Cobrar o fornecedor</p>
                    <button onClick={() => setShowMsg((v) => !v)} className="h-9 px-3 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground">
                      {showMsg ? "Esconder" : "Ver mensagem"}
                    </button>
                    <button onClick={copyMsg} disabled={!supplierMsg}
                      className="h-9 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                      <Copy className="size-4" /> Copiar mensagem
                    </button>
                  </div>
                  {showMsg && <pre className="whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-xs font-sans">{supplierMsg}</pre>}
                  <p className="text-[11px] text-muted-foreground">
                    {sel.size ? `Com os ${msgOrders.length} pedido${msgOrders.length === 1 ? "" : "s"} selecionado${msgOrders.length === 1 ? "" : "s"}.` : `Com todos os ${orders.length} pedidos (nenhum selecionado).`} Cada pedido vai com o código e o que está acontecendo.
                  </p>
                </div>

                {/* Pedidos */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pedidos</p>
                    <button onClick={() => setSel(allOn ? new Set() : new Set(orders.map((o) => o.id)))} className="text-xs text-primary font-medium">
                      {allOn ? "Desmarcar todos" : "Marcar todos"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {orders.map((o) => (
                      <OrderRow key={o.id} o={o} on={sel.has(o.id)} onToggle={() => toggle(o.id)}
                        onResolve={canResolve ? () => resolve.mutate({ orderId: o.id }) : undefined}
                        busy={resolve.isPending && resolve.variables?.orderId === o.id} />
                    ))}
                  </div>
                </div>
              </>
            )}

          {/* Resolvidos (dá pra desfazer) */}
          {!q.isLoading && resolved.length > 0 && (
            <div>
              <button onClick={() => setShowResolved((v) => !v)} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                <ChevronRight className={`size-3.5 transition-transform ${showResolved ? "rotate-90" : ""}`} /> Resolvidos ({resolved.length})
              </button>
              {showResolved && (
                <div className="mt-2 space-y-2">
                  {resolved.map((o) => (
                    <div key={o.id} className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold">{o.number}</span>
                          <span className="text-[11px] text-muted-foreground">{o.shop} · {o.carrier}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Resolvido em {o.resolvedAt ? ddmmhm(o.resolvedAt) : "—"} · {o.reason}</p>
                      </div>
                      <button onClick={() => resolve.mutate({ orderId: o.id, undo: true })} disabled={resolve.isPending}
                        title="Voltar este pedido pro alerta"
                        className="shrink-0 h-8 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5 disabled:opacity-50">
                        <Undo2 className="size-3.5" /> Desfazer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OrderRow({ o, on, onToggle, onResolve, busy }: { o: AlertOrder; on: boolean; onToggle: () => void; onResolve?: () => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const tone = useMemo(() => ((o.daysStopped ?? 0) >= 10 ? "text-rose-600" : (o.daysStopped ?? 0) >= 5 ? "text-amber-600" : "text-muted-foreground"), [o.daysStopped]);
  return (
    <div className={`rounded-xl border ${on ? "border-primary/40 bg-primary/[0.03]" : "border-border"} p-3`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={on} onChange={onToggle} className="mt-1 size-4 accent-[var(--color-primary)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold">{o.number}</span>
            <span className="text-[11px] text-muted-foreground">{o.shop} · pedido {ddmm(o.orderDate)} · {o.carrier}</span>
            {o.resent && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold"><RotateCcw className="size-3" />reenviado</span>}
            {o.notifiedAt && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold"><CheckCircle2 className="size-3" />avisado {ddmm(o.notifiedAt)}</span>}
          </div>
          <p className={`text-xs font-medium mt-1 ${tone}`}>{o.reason}{o.phase !== "—" ? ` · ${o.phase}` : ""}</p>
          {o.lastEvent && <p className="text-xs text-muted-foreground mt-0.5 break-words">Último: {o.lastEvent}{o.lastEventAt ? ` (${ddmm(o.lastEventAt)})` : ""}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onResolve && (
            <button onClick={onResolve} disabled={busy} title="Marcar como resolvido — sai deste alerta pra toda a equipe (enquanto o código de rastreio for o mesmo)"
              className="h-8 px-2.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-emerald-700 hover:border-emerald-500/50 hover:bg-emerald-500/5 inline-flex items-center gap-1 disabled:opacity-50">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Resolvido
            </button>
          )}
          {o.trackingLink && (
            <a href={o.trackingLink} target="_blank" rel="noreferrer" title="Abrir a página de rastreio"
              className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted"><ExternalLink className="size-4" /></a>
          )}
          {o.events.length > 0 && (
            <button onClick={() => setOpen((v) => !v)} title="Últimos eventos"
              className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
              <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <ol className="mt-3 ml-7 border-l border-border pl-3 space-y-1.5">
          {o.events.map((e, i) => (
            <li key={i} className="text-xs">
              <span className="text-muted-foreground tabular-nums mr-2">{ddmmhm(e.at)}</span>
              <span className="break-words">{e.text}</span>
            </li>
          ))}
          {o.code && <li className="text-[11px] text-muted-foreground pt-1">Código: {o.code}</li>}
        </ol>
      )}
    </div>
  );
}

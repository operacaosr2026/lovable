import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Factory, Loader2, Package, Pencil, Repeat, Sparkles, Truck, Undo2, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  getSupportConversation, getSupportCustomer, listSupportShops, updateSupportConversations,
} from "@/lib/atendimento.functions";
import { listExchangeRequests } from "@/lib/support-exchange.functions";
import { ExchangeDialog, ExchangeRequestCard, type ExchangeRequestView } from "./ExchangeDialog";
import { listRefundRequests } from "@/lib/support-refund.functions";
import { RefundDialog, RefundRequestCard, type RefundRequestView } from "./RefundDialog";
import { TrackingCodeDialog } from "./TrackingCodeDialog";
import { listSupplierRefundsForOrders, type SupplierRefund } from "@/lib/supplier-refund.functions";
import { SupplierRefundCard } from "./SupplierRefund";
import { useIsDemo } from "./demo";
import { Avatar, displayName, formatMoney, fullTime } from "./utils";
import { useSupportFn } from "./demo";
import { formatDateUS } from "@/lib/timezone";
import { useSupportTags } from "./useSupportTags";

// Tags da lista fixa (Configurações > Tags): cor pela posição, uma diferente
// pra cada. Tag fora da lista: cor pelo nome.
const TAG_TONES = [
  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  "bg-red-500/10 text-red-700 dark:text-red-300",
  "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  "bg-lime-500/15 text-lime-700 dark:text-lime-300",
];
export function tagTone(tag: string, fixed: string[] = []) {
  const i = fixed.findIndex((f) => f.toLowerCase() === tag.toLowerCase());
  if (i >= 0) return TAG_TONES[i % TAG_TONES.length];
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
}

export function TagEditor({ tags, aiTags = [], suggestions, onChange }: { tags: string[]; aiTags?: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState("");
  const { ensure, fixed } = useSupportTags();
  const add = (t: string) => {
    const typed = t.trim();
    // Mesma tag com outra caixa ("troca" → "Troca") usa a que já existe.
    const tag = suggestions.find((s) => s.toLowerCase() === typed.toLowerCase()) ?? typed;
    if (!tag || tags.some((x) => x.toLowerCase() === tag.toLowerCase())) return setValue("");
    onChange([...tags, tag]);
    ensure([tag]).catch(() => {});
    setValue("");
  };
  const rest = suggestions.filter((s) => !tags.includes(s) && s.toLowerCase().includes(value.toLowerCase())).slice(0, 12);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md text-[11px] font-medium ${tagTone(t, fixed)}`}
            title={aiTags.includes(t) ? "Posta automaticamente pela IA" : undefined}>
            {aiTags.includes(t) && <Sparkles className="size-3" />}
            {t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))} className="size-4 rounded grid place-items-center hover:bg-black/10" aria-label={`Remover ${t}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(value); } }}
        placeholder="Nova tag + Enter"
        maxLength={40}
        className="w-full h-8 px-2.5 rounded-lg bg-background border border-border text-xs outline-none focus:border-primary"
      />
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rest.map((s) => (
            <button key={s} onClick={() => add(s)} className="h-6 px-2 rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-primary">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type PanelTab = "cliente" | "pedidos" | "notas";

export function CustomerPanel({ conversationId, allTags, onChanged }: {
  conversationId: string | null;
  allTags: string[];
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>("pedidos");
  const qc = useQueryClient();
  const getFn = useSupportFn(getSupportConversation, "getSupportConversation");
  const customerFn = useSupportFn(getSupportCustomer, "getSupportCustomer");
  const updateFn = useSupportFn(updateSupportConversations, "updateSupportConversations");

  const conv = useQuery({
    queryKey: ["support-conv", conversationId],
    queryFn: () => getFn({ data: { id: conversationId! } }),
    enabled: !!conversationId, staleTime: 30_000,
  });
  const c = conv.data?.conversation;
  const customer = useQuery({
    queryKey: ["support-customer", c?.customer_email, c?.id],
    queryFn: () => customerFn({ data: { email: c!.customer_email, conversationId: c!.id } }),
    enabled: !!c, staleTime: 5 * 60_000,
  });
  const exchangesFn = useSupportFn(listExchangeRequests, "listExchangeRequests");
  const orderIds = (customer.data?.orders ?? []).map((o) => o.id);
  const exchanges = useQuery({
    queryKey: ["exchange-requests", orderIds],
    queryFn: () => exchangesFn({ data: { orderIds } }),
    enabled: orderIds.length > 0, staleTime: 30_000,
  });
  const [exchangeOrder, setExchangeOrder] = useState<string | null>(null);
  const refundsFn = useSupportFn(listRefundRequests, "listRefundRequests");
  const refunds = useQuery({
    queryKey: ["refund-requests", orderIds],
    queryFn: () => refundsFn({ data: { orderIds } }),
    enabled: orderIds.length > 0, staleTime: 30_000,
  });
  const [refundOrder, setRefundOrder] = useState<string | null>(null);
  // Reembolso que o fornecedor deve pelo pedido (aba Reembolso). Sem dados no modo de exemplo.
  const demo = useIsDemo();
  const supplierFn = useServerFn(listSupplierRefundsForOrders);
  const supplierRefunds = useQuery({
    queryKey: ["supplier-refunds-orders", orderIds],
    queryFn: () => supplierFn({ data: { orderIds } }),
    enabled: orderIds.length > 0 && !demo, staleTime: 30_000,
  });
  const [trackingOrder, setTrackingOrder] = useState<{ id: string; number: string | null; tracking: string | null } | null>(null);

  const update = useMutation({
    mutationFn: (patch: { tags?: string[]; note?: string | null; shop_id?: string | null }) => updateFn({ data: { ids: [conversationId!], patch } }),
    onMutate: (patch) => qc.setQueryData(["support-conv", conversationId], (old: any) =>
      old ? { ...old, conversation: { ...old.conversation, ...patch } } : old),
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
    onSettled: onChanged,
  });

  const [note, setNote] = useState("");
  useEffect(() => { setNote(c?.note ?? ""); }, [c?.id, c?.note]);

  const TABS: { key: PanelTab; label: string }[] = [
    { key: "pedidos", label: "Pedidos" }, { key: "cliente", label: "Cliente" }, { key: "notas", label: "Notas" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 px-3 border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`h-11 px-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
            {t.key === "pedidos" && customer.data && customer.data.orders.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">({customer.data.orders.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4">
        {!conversationId ? (
          <p className="text-xs text-muted-foreground text-center py-10">Selecione uma conversa</p>
        ) : !c ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
        ) : tab === "cliente" ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={c.customer_name ?? customer.data?.name} email={c.customer_email} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{displayName(c.customer_name ?? customer.data?.name, c.customer_email)}</p>
                <button onClick={() => { navigator.clipboard.writeText(c.customer_email); toast.success("E-mail copiado"); }}
                  className="text-xs text-muted-foreground truncate max-w-full flex items-center gap-1 hover:text-foreground">
                  <span className="truncate">{c.customer_email}</span><Copy className="size-3 shrink-0" />
                </button>
                {customer.data?.phone && <p className="text-xs text-muted-foreground">{customer.data.phone}</p>}
              </div>
            </div>

            {customer.isLoading ? (
              <div className="h-24 rounded-xl bg-muted animate-pulse" />
            ) : customer.data && (
              <div className="grid grid-cols-2 gap-px rounded-xl border border-border bg-border overflow-hidden">
                <Stat label="Total de pedidos" value={String(customer.data.ordersCount)} />
                <Stat label="Primeiro pedido" value={customer.data.firstOrderAt ? formatDateUS(customer.data.firstOrderAt) : "—"} />
                <Stat label="Valor total" value={
                  Object.keys(customer.data.totals).length
                    ? Object.entries(customer.data.totals).map(([cur, v]) => <span key={cur} className="block">{formatMoney(v, cur)}</span>)
                    : "—"
                } />
                <div className="bg-card px-3 py-2.5 min-w-0">
                  <p className="text-[10px] text-muted-foreground">Loja do atendimento</p>
                  <StoreSelect value={c.shop_id} onChange={(shop_id) => update.mutate({ shop_id })} />
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold mb-2">Tags</p>
              <TagEditor tags={c.tags} aiTags={c.ai_tags} suggestions={allTags} onChange={(tags) => update.mutate({ tags })} />
            </div>

            <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1 border-t border-border">
              <p className="pt-3">{c.message_count} e-mail{c.message_count === 1 ? "" : "s"} na conversa</p>
              {c.last_inbound_at && <p>Última mensagem do cliente: {fullTime(c.last_inbound_at)}</p>}
              {c.last_outbound_at && <p>Nossa última resposta: {fullTime(c.last_outbound_at)}</p>}
            </div>
          </div>
        ) : tab === "pedidos" ? (
          customer.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
          ) : !customer.data?.orders.length ? (
            <div className="text-center py-10">
              <Package className="size-6 mx-auto text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground mt-2">Nenhum pedido com este e-mail</p>
            </div>
          ) : (
            <div className="space-y-2">
              {customer.data.orders.map((o) => (
                <div key={o.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    {/* Status do pagamento ao lado do número; etiquetas embaixo só pro que pede atenção. */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-semibold whitespace-nowrap">{o.number ? (String(o.number).startsWith("#") ? o.number : `#${o.number}`) : "Pedido"}</p>
                      {o.financial && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${FINANCIAL[o.financial]?.cls ?? "bg-muted text-muted-foreground"}`}>
                          {FINANCIAL[o.financial]?.label ?? o.financial}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold whitespace-nowrap">{formatMoney(o.revenue, o.currency)}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{formatDateUS(o.date)}{o.store ? ` · ${o.store}` : ""}</p>
                  {(o.cancelled || (o.delivery && !o.tracking) || o.dispute) && <div className="flex flex-wrap gap-1 mt-2">
                    {o.cancelled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">Cancelado</span>}
                    {o.delivery && !o.tracking && <DeliveryBadge status={o.delivery} />}
                    {o.dispute && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${o.dispute.status === "won" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}>
                        {o.dispute.type === "inquiry" ? "Inquiry" : "Chargeback"} · {DISPUTE[o.dispute.status ?? ""] ?? o.dispute.status}
                      </span>
                    )}
                  </div>}
                  {o.tracking && (
                    <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                      <Truck className="size-3 text-muted-foreground shrink-0" />
                      {o.trackingUrl
                        ? <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline truncate">{o.tracking}</a>
                        : <span className="font-mono truncate">{o.tracking}</span>}
                      {o.delivery && <DeliveryBadge status={o.delivery} />}
                      {!o.cancelled && (
                        <button onClick={() => setTrackingOrder(o)} title="Trocar código de rastreio (reenvio)"
                          className="ml-auto shrink-0 size-6 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                          <Pencil className="size-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {o.trackingHistory?.map((h) => (
                    <div key={h.code + h.until} className="flex items-center gap-1.5 mt-1 pl-[18px] text-[11px] text-muted-foreground">
                      <span>antes:</span>
                      <span className="font-mono line-through truncate">{h.code}</span>
                      <span className="shrink-0">(até {formatDateUS(h.until, { day: "2-digit", month: "2-digit" })})</span>
                    </div>
                  ))}
                  {((exchanges.data?.requests ?? []) as ExchangeRequestView[]).filter((r) => r.order_id === o.id).map((r) => (
                    <ExchangeRequestCard key={r.id} r={r} canApprove={!!exchanges.data?.canApprove} />
                  ))}
                  {((refunds.data?.requests ?? []) as RefundRequestView[]).filter((r) => r.order_id === o.id).map((r) => (
                    <RefundRequestCard key={r.id} r={r} canApprove={!!refunds.data?.canApprove} />
                  ))}
                  {((supplierRefunds.data ?? []) as SupplierRefund[]).filter((r) => r.order_id === o.id).map((r) => (
                    <SupplierRefundCard key={r.id} r={r} />
                  ))}
                  {(() => {
                    // Reembolsado por inteiro (na Shopify ou por um pedido aqui ainda não sincronizado): sem troca nem novo reembolso.
                    const canAct = !o.cancelled && o.financial !== "refunded"
                      && !((refunds.data?.requests ?? []) as RefundRequestView[]).some((r) => r.order_id === o.id && r.mode === "total" && r.status !== "recusado" && r.status !== "erro");
                    if (!canAct) return null;
                    return (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <button onClick={() => setExchangeOrder(o.id)}
                          className="h-7 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary inline-flex items-center gap-1">
                          <Repeat className="size-3" /> Gerar troca
                        </button>
                        {o.revenue > 0 && (
                          <button onClick={() => setRefundOrder(o.id)}
                            className="h-7 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary inline-flex items-center gap-1">
                            <Undo2 className="size-3" /> Reembolsar
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
              {exchangeOrder && (
                <ExchangeDialog orderId={exchangeOrder} conversationId={conversationId} open onClose={() => setExchangeOrder(null)} />
              )}
              {trackingOrder && (
                <TrackingCodeDialog order={trackingOrder} open onClose={() => setTrackingOrder(null)} />
              )}
              {refundOrder && (
                <RefundDialog orderId={refundOrder} conversationId={conversationId} open onClose={() => setRefundOrder(null)} />
              )}
            </div>
          )
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Nota interna — só a equipe vê, não vai pro cliente.</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={10}
              maxLength={5000}
              placeholder="Ex.: cliente pediu reembolso parcial, aguardando fornecedor…"
              className="w-full resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={() => update.mutate({ note: note.trim() || null }, { onSuccess: () => toast.success("Nota salva") })}
              disabled={(c.note ?? "") === note.trim() || update.isPending}
              className="h-9 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              Salvar nota
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Status de entrega (mesmos nomes da aba Rastreamento).
const DELIVERY: Record<string, { label: string; cls: string }> = {
  pending_shipment: { label: "Pendente envio", cls: "bg-amber-500/10 text-amber-600" },
  shipped: { label: "Enviado", cls: "bg-blue-500/10 text-blue-600" },
  in_transit: { label: "Em trânsito", cls: "bg-blue-500/10 text-blue-600" },
  delivered: { label: "Entregue", cls: "bg-emerald-500/10 text-emerald-600" },
  returned: { label: "Devolvido", cls: "bg-rose-500/10 text-rose-600" },
  problem: { label: "Problema", cls: "bg-rose-500/10 text-rose-600" },
  waiting_customer: { label: "Esperando cliente", cls: "bg-violet-500/10 text-violet-600" },
};
const FINANCIAL: Record<string, { label: string; cls: string }> = {
  paid: { label: "Pago", cls: "bg-emerald-500/10 text-emerald-600" },
  pending: { label: "Pendente", cls: "bg-amber-500/10 text-amber-600" },
  authorized: { label: "Autorizado", cls: "bg-amber-500/10 text-amber-600" },
  partially_paid: { label: "Pago parcial", cls: "bg-amber-500/10 text-amber-600" },
  partially_refunded: { label: "Reembolso parcial", cls: "bg-amber-500/10 text-amber-600" },
  refunded: { label: "Reembolsado", cls: "bg-rose-500/10 text-rose-600" },
  voided: { label: "Anulado", cls: "bg-rose-500/10 text-rose-600" },
};
const DISPUTE: Record<string, string> = {
  needs_response: "aguardando resposta", under_review: "em análise", won: "ganho", lost: "perdido",
  warning_needs_response: "aguardando resposta", warning_under_review: "em análise", accepted: "aceito", charge_refunded: "reembolsado",
};

function DeliveryBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${DELIVERY[status]?.cls ?? "bg-info/10 text-info"}`}>
      {DELIVERY[status]?.label ?? status}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2.5 min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="text-xs font-semibold mt-0.5">{value}</div>
    </div>
  );
}

// Loja da conversa (usada nos KPIs por loja). Vem sozinha pelos pedidos do
// cliente ou pelo nº do pedido no assunto; aqui dá pra escolher/corrigir.
function StoreSelect({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const shopsFn = useSupportFn(listSupportShops, "listSupportShops");
  const { data: shops = [] } = useQuery({ queryKey: ["support-shops"], queryFn: () => shopsFn(), staleTime: 10 * 60_000 });
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`w-full mt-0.5 bg-transparent text-xs font-semibold outline-none cursor-pointer truncate ${value ? "" : "text-destructive"}`}
    >
      <option value="">Escolher loja…</option>
      {shops.map((s: { id: string; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, Package, Truck, X } from "lucide-react";
import {
  getSupportConversation, getSupportCustomer, updateSupportConversations,
} from "@/lib/atendimento.functions";
import { Avatar, displayName, formatMoney, fullTime } from "./utils";
import { useSupportFn } from "./demo";
import { useSupportTags } from "./useSupportTags";

export function customerType(orders: number) {
  if (orders >= 2) return { label: "Cliente recorrente", cls: "bg-success/15 text-success" };
  if (orders === 1) return { label: "Cliente novo", cls: "bg-info/10 text-info" };
  return { label: "Sem pedidos", cls: "bg-muted text-muted-foreground" };
}

const TAG_TONES = [
  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "bg-pink-500/10 text-pink-700 dark:text-pink-300",
];
export function tagTone(tag: string) {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
}

export function TagEditor({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState("");
  const { ensure } = useSupportTags();
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
          <span key={t} className={`inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md text-[11px] font-medium ${tagTone(t)}`}>
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
  const [tab, setTab] = useState<PanelTab>("cliente");
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
    queryKey: ["support-customer", c?.customer_email],
    queryFn: () => customerFn({ data: { email: c!.customer_email } }),
    enabled: !!c, staleTime: 5 * 60_000,
  });

  const update = useMutation({
    mutationFn: (patch: { tags?: string[]; note?: string | null }) => updateFn({ data: { ids: [conversationId!], patch } }),
    onMutate: (patch) => qc.setQueryData(["support-conv", conversationId], (old: any) =>
      old ? { ...old, conversation: { ...old.conversation, ...patch } } : old),
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
    onSettled: onChanged,
  });

  const [note, setNote] = useState("");
  useEffect(() => { setNote(c?.note ?? ""); }, [c?.id, c?.note]);

  const TABS: { key: PanelTab; label: string }[] = [
    { key: "cliente", label: "Cliente" }, { key: "pedidos", label: "Pedidos" }, { key: "notas", label: "Notas" },
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
                <Stat label="Tipo de cliente" value={<span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${customerType(customer.data.ordersCount).cls}`}>{customerType(customer.data.ordersCount).label}</span>} />
                <Stat label="Total de pedidos" value={String(customer.data.ordersCount)} />
                <Stat label="Primeiro pedido" value={customer.data.firstOrderAt ? new Date(customer.data.firstOrderAt).toLocaleDateString("pt-BR") : "—"} />
                <Stat label="Valor total" value={
                  Object.keys(customer.data.totals).length
                    ? Object.entries(customer.data.totals).map(([cur, v]) => <span key={cur} className="block">{formatMoney(v, cur)}</span>)
                    : "—"
                } />
                {customer.data.stores.length > 0 && (
                  <div className="col-span-2 bg-card px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground">Loja{customer.data.stores.length > 1 ? "s" : ""}</p>
                    <p className="text-xs font-medium">{customer.data.stores.join(", ")}</p>
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold mb-2">Tags</p>
              <TagEditor tags={c.tags} suggestions={allTags} onChange={(tags) => update.mutate({ tags })} />
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
                    <p className="text-sm font-semibold">{o.number ? (String(o.number).startsWith("#") ? o.number : `#${o.number}`) : "Pedido"}</p>
                    <p className="text-sm font-semibold">{formatMoney(o.revenue, o.currency)}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{new Date(o.date).toLocaleDateString("pt-BR")}{o.store ? ` · ${o.store}` : ""}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {o.cancelled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">Cancelado</span>}
                    {o.financial && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{FINANCIAL[o.financial] ?? o.financial}</span>}
                    {o.delivery && <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/10 text-info">{o.delivery}</span>}
                  </div>
                  {o.tracking && (
                    <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                      <Truck className="size-3 text-muted-foreground shrink-0" />
                      {o.trackingUrl
                        ? <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline truncate">{o.tracking}</a>
                        : <span className="font-mono truncate">{o.tracking}</span>}
                      <button onClick={() => { navigator.clipboard.writeText(o.tracking!); toast.success("Rastreio copiado"); }} className="text-muted-foreground hover:text-foreground" aria-label="Copiar rastreio">
                        <Copy className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
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

const FINANCIAL: Record<string, string> = {
  paid: "Pago", pending: "Pendente", refunded: "Reembolsado", partially_refunded: "Reembolso parcial",
  voided: "Anulado", authorized: "Autorizado", partially_paid: "Pago parcial",
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2.5 min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="text-xs font-semibold mt-0.5">{value}</div>
    </div>
  );
}

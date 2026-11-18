import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Loader2, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listSupportShops } from "@/lib/atendimento.functions";
import {
  createSupportOrder, listNewOrderProducts, type NewOrderAddress, type NewOrderProduct,
} from "@/lib/support-new-order.functions";
import { formatMoney } from "./utils";

// Gerar pedido: cliente sem pedido (ou que não conseguiu fechar a compra) —
// monta o carrinho com os dados dela e sai um link de pagamento da loja, que
// vai direto pra caixa de resposta.

type Line = { product: NewOrderProduct; variantId: string; quantity: number };

export type NewOrderCustomer = { email: string; name: string | null; phone: string | null };

// "Número de telefone: 6012628909" / "Phone Number: …" no corpo do formulário de contato.
export function phoneFromMessages(messages: { direction: string; content_html?: string | null; summary?: string | null }[]): string | null {
  for (const m of [...messages].reverse()) {
    if (m.direction !== "in") continue;
    const text = (m.content_html ?? m.summary ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    const hit = text.match(/(?:phone(?:\s*number)?|telefone)\s*:?\s*(\+?[\d][\d\s().-]{6,20}\d)/i)?.[1];
    if (hit) return hit.replace(/\s+/g, " ").trim();
  }
  return null;
}

export function NewOrderDialog({ customer, shopId: initialShop, conversationId, open, onClose, onLink }: {
  customer: NewOrderCustomer; shopId: string | null; conversationId: string | null;
  open: boolean; onClose: () => void; onLink: (text: string) => void;
}) {
  const shopsFn = useServerFn(listSupportShops);
  const { data: shops = [] } = useQuery({ queryKey: ["support-shops"], queryFn: () => shopsFn(), staleTime: 10 * 60_000, enabled: open });
  const [shopId, setShopId] = useState(initialShop ?? "");
  const [first, ...rest] = (customer.name ?? "").trim().split(/\s+/);
  const [firstName, setFirstName] = useState(first ?? "");
  const [lastName, setLastName] = useState(rest.join(" "));
  const [email, setEmail] = useState(customer.email);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [shipping, setShipping] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [note, setNote] = useState("");
  const [addr, setAddr] = useState<NewOrderAddress | null>(null);
  const [done, setDone] = useState<{ draftName: string; invoiceUrl: string; total: number; currency: string } | null>(null);

  // Trocou de loja: os produtos são de outra loja.
  useEffect(() => { setLines([]); }, [shopId]);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + (l.product.variants.find((v) => v.id === l.variantId)?.price ?? 0) * l.quantity, 0), [lines]);
  const ship = Math.max(0, Number(shipping.replace(",", ".")) || 0);
  const disc = Math.min(100, Math.max(0, Number(discount.replace(",", ".")) || 0));
  const total = subtotal * (1 - disc / 100) + ship;
  const addrOk = !addr || (!!addr.address1.trim() && !!addr.city.trim() && !!addr.zip.trim() && addr.country_code.trim().length === 2);
  const ready = !!shopId && /\S+@\S+\.\S+/.test(email.trim()) && lines.length > 0 && lines.every((l) => l.variantId) && addrOk;

  const createFn = useServerFn(createSupportOrder);
  const create = useMutation({
    mutationFn: () => createFn({ data: {
      shopId, conversationId, email: email.trim(), firstName: firstName.trim() || null, lastName: lastName.trim() || null,
      phone: phone.trim() || null, items: lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })),
      shipping: ship, discountPercent: disc, address: addr, note: note.trim() || null,
    } }),
    onSuccess: (r) => {
      setDone(r);
      onLink(r.invoiceUrl);
      toast.success(`Pedido ${r.draftName} criado`, { description: "O link de pagamento foi pra caixa de resposta." });
    },
    onError: (e: Error) => toast.error(e.message ?? "Erro ao gerar o pedido"),
  });

  const patch = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingCart className="size-4" /> Gerar pedido</DialogTitle>
          <p className="text-xs text-muted-foreground">A cliente recebe um link de pagamento da loja. Pagou, vira pedido normal na Shopify.</p>
        </DialogHeader>

        {done ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3 space-y-1">
              <p className="text-sm font-semibold flex items-center gap-1.5"><Check className="size-4 text-emerald-600" /> Rascunho {done.draftName} criado</p>
              <p className="text-xs text-muted-foreground">Total do link: {formatMoney(done.total, done.currency)}</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-border p-2">
              <a href={done.invoiceUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-xs font-mono text-primary hover:underline">{done.invoiceUrl}</a>
              <button onClick={() => { navigator.clipboard.writeText(done.invoiceUrl); toast.success("Link copiado"); }} title="Copiar"
                className="size-7 grid place-items-center rounded-md hover:bg-muted"><Copy className="size-3.5" /></button>
              <a href={done.invoiceUrl} target="_blank" rel="noreferrer" title="Abrir" className="size-7 grid place-items-center rounded-md hover:bg-muted">
                <ExternalLink className="size-3.5" />
              </a>
            </div>
            <p className="text-[11px] text-muted-foreground">O link já está na caixa de resposta — é só escrever a mensagem e enviar.</p>
            <button onClick={onClose} className="h-9 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium">Fechar</button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="block text-xs font-semibold mb-1">Loja</span>
              <select value={shopId} onChange={(e) => setShopId(e.target.value)}
                className={`w-full h-9 rounded-lg border border-border bg-background px-2 text-sm ${shopId ? "" : "text-muted-foreground"}`}>
                <option value="">Escolher loja…</option>
                {shops.map((s: { id: string; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>

            <div>
              <p className="text-xs font-semibold mb-1.5">Cliente</p>
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Nome" value={firstName} onChange={setFirstName} />
                <Field label="Sobrenome" value={lastName} onChange={setLastName} />
                <Field label="E-mail" value={email} onChange={setEmail} wide />
                <Field label="Telefone" value={phone} onChange={setPhone} wide />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold">Itens</p>
              {lines.map((l, i) => {
                const v = l.product.variants.find((x) => x.id === l.variantId);
                return (
                  <div key={i} className="rounded-xl border border-border p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      {l.product.image ? <img src={l.product.image} alt="" className="size-10 rounded-md object-cover border border-border" /> : <div className="size-10 rounded-md bg-muted" />}
                      <p className="text-xs font-medium flex-1 min-w-0 truncate">{l.product.title}</p>
                      <button onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label="Tirar item"
                        className="size-7 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-muted"><Trash2 className="size-3.5" /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={l.variantId} onChange={(e) => patch(i, { variantId: e.target.value })}
                        className={`flex-1 min-w-0 h-8 rounded-lg border border-border bg-background px-2 text-xs ${l.variantId ? "" : "text-muted-foreground"}`}>
                        <option value="">Tamanho / variante…</option>
                        {l.product.variants.map((x) => (
                          <option key={x.id} value={x.id}>{x.title === "Default Title" ? "Único" : x.title} — {x.price.toFixed(2)}{x.available ? "" : " (sem estoque)"}</option>
                        ))}
                      </select>
                      <div className="flex items-center rounded-lg border border-border h-8">
                        <button onClick={() => patch(i, { quantity: Math.max(1, l.quantity - 1) })} className="size-8 grid place-items-center hover:bg-muted rounded-l-lg" aria-label="Menos"><Minus className="size-3" /></button>
                        <span className="w-6 text-center text-xs tabular-nums">{l.quantity}</span>
                        <button onClick={() => patch(i, { quantity: Math.min(20, l.quantity + 1) })} className="size-8 grid place-items-center hover:bg-muted rounded-r-lg" aria-label="Mais"><Plus className="size-3" /></button>
                      </div>
                    </div>
                    {v && <p className="text-[11px] text-muted-foreground text-right">{l.quantity} × {v.price.toFixed(2)} = <span className="font-semibold text-foreground">{(v.price * l.quantity).toFixed(2)}</span></p>}
                  </div>
                );
              })}
              {shopId
                ? <ProductSearch shopId={shopId} onPick={(p) => setLines((ls) => [...ls, { product: p, variantId: p.variants.length === 1 ? p.variants[0].id : "", quantity: 1 }])} />
                : <p className="text-[11px] text-muted-foreground">Escolha a loja pra buscar os produtos.</p>}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Frete (0 = grátis)" value={shipping} onChange={setShipping} inputMode="decimal" />
              <Field label="Desconto (%)" value={discount} onChange={setDiscount} inputMode="decimal" />
            </div>

            {addr ? (
              <div className="rounded-lg border border-primary/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">Endereço de entrega</p>
                  <button type="button" onClick={() => setAddr(null)} className="text-[11px] text-primary hover:underline">Cliente preenche no checkout</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Field label="Endereço" value={addr.address1} onChange={(v) => setAddr({ ...addr, address1: v })} wide />
                  <Field label="Complemento (apto, suíte…)" value={addr.address2 ?? ""} onChange={(v) => setAddr({ ...addr, address2: v || null })} wide />
                  <Field label="Cidade" value={addr.city} onChange={(v) => setAddr({ ...addr, city: v })} />
                  <Field label="Estado (ex.: CO)" value={addr.province_code ?? ""} onChange={(v) => setAddr({ ...addr, province_code: v.toUpperCase() || null })} />
                  <Field label="CEP / ZIP" value={addr.zip} onChange={(v) => setAddr({ ...addr, zip: v })} />
                  <Field label="País (ex.: US)" value={addr.country_code} onChange={(v) => setAddr({ ...addr, country_code: v.toUpperCase().slice(0, 2) })} />
                </div>
                {!addrOk && <p className="text-[11px] text-destructive">Preencha endereço, cidade, CEP e país (2 letras).</p>}
              </div>
            ) : (
              <div className="rounded-lg bg-muted/50 p-2.5 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                <span>Endereço: a cliente preenche no checkout.</span>
                <button type="button" onClick={() => setAddr({ address1: "", address2: null, city: "", province_code: null, zip: "", country_code: "US" })}
                  className="text-primary hover:underline shrink-0">Preencher agora</button>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold mb-1">Observação (opcional, vai na nota do pedido)</p>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
                placeholder="Ex.: carrinho do site não deixava tirar o 2º par"
                className="w-full resize-none rounded-lg border border-border bg-background p-2 text-xs outline-none focus:border-primary" />
            </div>

            {lines.length > 0 && (
              <div className="rounded-lg border border-border p-2.5 text-xs space-y-0.5">
                <Row label="Produtos" value={subtotal.toFixed(2)} />
                {disc > 0 && <Row label={`Desconto (${disc}%)`} value={`− ${(subtotal * disc / 100).toFixed(2)}`} />}
                <Row label="Frete" value={ship > 0 ? ship.toFixed(2) : "grátis"} />
                <Row label="Total (sem imposto)" value={total.toFixed(2)} bold />
              </div>
            )}

            <button onClick={() => create.mutate()} disabled={!ready || create.isPending}
              className="h-9 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              Gerar link de pagamento
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Catálogo da loja com foto, mais vendidos primeiro; o campo só filtra (por
// qualquer pedaço do nome, SKU ou variante — "ring" acha "Ringstone…").
function ProductSearch({ shopId, onPick }: { shopId: string; onPick: (p: NewOrderProduct) => void }) {
  const listFn = useServerFn(listNewOrderProducts);
  const [q, setQ] = useState("");
  const res = useQuery({
    queryKey: ["new-order-products", shopId],
    queryFn: () => listFn({ data: { shopId } }),
    staleTime: 5 * 60_000,
  });
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (res.data ?? []).filter((p) => {
    if (!words.length) return true;
    const hay = `${p.title} ${p.variants.map((v) => `${v.sku ?? ""} ${v.title}`).join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 h-8 rounded-lg border border-border bg-background px-2">
        <Search className="size-3.5 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar produtos da loja…" className="flex-1 bg-transparent text-xs outline-none" />
        {res.isFetching && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>
      {res.isLoading ? (
        <div className="grid grid-cols-3 gap-1.5">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-square rounded-lg bg-muted animate-pulse" />)}</div>
      ) : shown.length > 0 ? (
        <div className="max-h-72 overflow-y-auto grid grid-cols-3 gap-1.5 pr-0.5">
          {shown.map((p) => (
            <button key={p.id} onClick={() => { onPick(p); setQ(""); }} title={p.title}
              className="rounded-lg border border-border p-1 text-left hover:border-primary hover:bg-muted/50 min-w-0">
              {p.image ? <img src={p.image} alt="" loading="lazy" className="w-full aspect-square rounded-md object-cover" /> : <div className="w-full aspect-square rounded-md bg-muted" />}
              <p className="text-[10px] leading-tight mt-1 line-clamp-2">{p.title}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 flex justify-between gap-1">
                <span>{p.variants[0]?.price.toFixed(2)}</span>
                {!!p.sold && <span title="Vendidos nos últimos 60 dias">{p.sold} vend.</span>}
              </p>
            </button>
          ))}
        </div>
      ) : res.isSuccess ? (
        <p className="text-[11px] text-muted-foreground">{words.length ? "Nenhum produto com esse nome" : "Loja sem produtos ativos"}</p>
      ) : null}
      {res.error && <p className="text-[11px] text-destructive">{(res.error as Error).message}</p>}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold pt-1 border-t border-border mt-1" : "text-muted-foreground"}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
}

function Field({ label, value, onChange, wide, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; wide?: boolean; inputMode?: "decimal";
}) {
  return (
    <label className={wide ? "col-span-2" : ""}>
      <span className="block text-[10px] text-muted-foreground mb-0.5">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} inputMode={inputMode}
        className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary" />
    </label>
  );
}

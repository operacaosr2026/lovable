import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search, Loader2, ExternalLink, Truck, Package, ShieldAlert, ShieldCheck, Headphones, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Copy, MapPin, Mail, Phone, User, Factory, RotateCcw, Box, Check, CircleCheck, AlertTriangle, RefreshCw, Plane, CreditCard,
  CalendarDays, Eye, MoreHorizontal, X, Store, Clock, StickyNote, Send,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listAllOrders, getOrderDetail, updateOrderNote, updateLocalTrackingNumber, type OrderListRow, type OrderFilter, type OrderCounts } from "@/lib/all-orders.functions";

// Aba Pedidos: todos os pedidos de todas as lojas, com busca (nº, cliente,
// e-mail, rastreio), contadores por situação e o detalhe completo num painel
// lateral. "A enviar", "Em trânsito", "Com problema" e a atenção usam o status
// efetivo do Rastreamento (etiqueta criada sem postagem ainda é "a enviar").

export const Route = createFileRoute("/pedidos")({
  beforeLoad: requireAuth,
  // ?q=… abre já buscando (ex.: link vindo de outra tela).
  validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === "string" && s.q ? { q: s.q } : {}),
  head: () => ({ meta: [{ title: "Pedidos — SRX Growth" }] }),
  component: PedidosPage,
});

const CARD = "rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(16,24,40,0.04)]";

// Abas/cards: ícone + cor de cada situação.
const TABS: { key: OrderFilter; label: string; icon: typeof Box; tone: string }[] = [
  { key: "todos",       label: "Todos",        icon: Box,           tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  { key: "a_enviar",    label: "A enviar",     icon: Truck,         tone: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { key: "em_transito", label: "Em trânsito",  icon: Plane,         tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  { key: "entregue",    label: "Entregues",    icon: Check,         tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { key: "problema",    label: "Com problema", icon: AlertTriangle, tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  { key: "reembolsado", label: "Reemb. cliente", icon: RefreshCw,   tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  { key: "reemb_fornecedor", label: "Reemb. fornecedor", icon: Factory, tone: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  { key: "chargeback",  label: "Chargeback",   icon: ShieldAlert,   tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
];

const money = (n: number, cur = "USD") => n.toLocaleString("en-US", { style: "currency", currency: cur || "USD" });
const fmtDate = (iso: string | null | undefined) => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "—";
};
// Data e hora em Nova York (timestamps do banco vêm em UTC).
const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDate(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/New_York", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const orderLabel = (n: string) => (n.startsWith("#") ? n : `#${n}`);
const addDays = (k: string, n: number) => { const d = new Date(`${k}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

// Status → rótulo, cor e ícone.
type PillDef = [string, string, typeof Box?];
const OK = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
const WARN = "bg-orange-500/10 text-orange-700 dark:text-orange-400";
const BAD = "bg-rose-500/10 text-rose-700 dark:text-rose-400";
const INFO = "bg-sky-500/10 text-sky-700 dark:text-sky-400";
const DELIVERY: Record<string, PillDef> = {
  pending_shipment: ["A enviar", WARN, Box],
  waiting_customer: ["Aguardando cliente", WARN, Clock],
  shipped: ["Em trânsito", INFO, Truck],
  delivered: ["Entregue", OK, CircleCheck],
  problem: ["Com problema", BAD, AlertTriangle],
  shipment_cancelled: ["Envio cancelado", "bg-muted text-muted-foreground", X],
};
const FINANCIAL: Record<string, PillDef> = {
  paid: ["Pago", OK, CircleCheck],
  refunded: ["Reembolsado", BAD, RefreshCw],
  partially_refunded: ["Reemb. parcial", BAD, RefreshCw],
  pending: ["Pendente", WARN, Clock],
};
const SUPPLIER: Record<string, PillDef> = {
  // A coluna já diz "Fornecedor": o selo fica curto.
  paid: ["Pago", OK, CreditCard],
  pending: ["A pagar", WARN, CreditCard],
  shipped: ["A pagar", WARN, CreditCard],
  // Fornecedor devolveu o valor (Atendimento › Reembolso, confirmado).
  refunded: ["Reembolsado", "bg-violet-500/10 text-violet-700 dark:text-violet-400", RotateCcw],
};
const DISPUTE_STATUS: Record<string, string> = {
  needs_response: "Aguardando resposta", under_review: "Em disputa", won: "Ganho", lost: "Perdido",
  accepted: "Aceito", charge_refunded: "Reembolsado",
};
const ALERT_STATUS: Record<string, string> = {
  a_contatar: "A contatar", contatado: "Contatado", recuperado: "Recuperado", sem_retorno: "Sem retorno",
};

function Pill({ map, value, prefix }: { map: Record<string, PillDef>; value: string | null; prefix?: string }) {
  if (!value) return null;
  const [base, cls, Icon] = map[value] ?? [value, "bg-muted text-muted-foreground"];
  const label = prefix ? `${prefix} ${base.toLowerCase()}` : base;
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] font-medium whitespace-nowrap ${cls}`}>
      {Icon && <Icon className="size-3.5" />}{label}
    </span>
  );
}

// Prazo de postagem: Hoje / Amanhã / dd/mm, ou atrasado.
function Deadline({ date, today }: { date: string | null; today: string }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const diff = dayDiff(date, today);
  const label = diff < 0 ? `Atrasado ${-diff}d` : diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : fmtDate(date).slice(0, 5);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${diff < 0 ? "text-rose-600 font-semibold" : diff === 0 ? "font-semibold" : ""}`}>
      <CalendarDays className="size-3.5 text-muted-foreground" />{label}
    </span>
  );
}

const copy = (text: string, msg = "Copiado") => { navigator.clipboard?.writeText(text).then(() => toast.success(msg)).catch(() => {}); };

function PedidosPage() {
  const initialQ = Route.useSearch().q ?? "";
  const [input, setInput] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [filter, setFilter] = useState<OrderFilter>("todos");
  const [attention, setAttention] = useState(false);
  const [shopId, setShopId] = useState<string>("");
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Busca enquanto digita (espera 350ms parado).
  useEffect(() => { const t = setTimeout(() => setQ(input.trim()), 350); return () => clearTimeout(t); }, [input]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [q, filter, attention, shopId, sort, pageSize]);

  const listFn = useServerFn(listAllOrders);
  const list = useQuery({
    queryKey: ["all-orders", q, filter, attention, shopId, sort, page, pageSize],
    queryFn: () => listFn({ data: { q: q.length >= 2 ? q : undefined, filter, attention, shopId: shopId || null, sort, page, pageSize } }),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const counts = list.data?.counts;
  const today = list.data?.today ?? new Date().toISOString().slice(0, 10);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = filter !== "todos" || attention || !!shopId || !!input;
  const clearFilters = () => { setFilter("todos"); setAttention(false); setShopId(""); setInput(""); };

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedRows = rows.filter((r) => selected.has(r.id));

  return (
    <PageShell>
      {/* ── Cabeçalho ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Pedidos</h1>
        <div className="flex items-center gap-2 flex-wrap md:flex-nowrap md:w-auto">
          <div className="relative flex-1 min-w-[180px] md:w-72">
            <Search className="size-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Nº do pedido, cliente, e-mail ou rastreio"
              className="w-full h-10 pl-10 pr-8 rounded-xl border border-border bg-card text-sm outline-none focus:border-primary" />
            {input && <button onClick={() => setInput("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
          </div>
          <div className="relative shrink-0">
            <Store className="size-4 text-primary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select value={shopId} onChange={(e) => setShopId(e.target.value)}
              className="h-10 pl-9 pr-8 rounded-xl border border-border bg-card text-sm outline-none focus:border-primary appearance-none cursor-pointer max-w-[150px] md:max-w-none">
              <option value="">Todas as lojas</option>
              {(list.data?.shops ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <ChevronDown className="size-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <label className="h-10 px-3 rounded-xl border border-border bg-card inline-flex items-center gap-2 cursor-pointer text-[13px] shrink-0 whitespace-nowrap">
            <Switch checked={attention} onCheckedChange={setAttention} />
            <AlertTriangle className="size-4 text-orange-500" />
            <span className="hidden sm:inline">Apenas com atenção</span>
            {counts ? <span className="text-muted-foreground">({counts.atencao})</span> : null}
          </label>
          {hasFilters && (
            <button onClick={clearFilters} title="Limpar filtros"
              className="h-10 px-3 rounded-xl text-[13px] text-primary inline-flex items-center gap-1 hover:bg-primary/10 shrink-0 whitespace-nowrap">
              <X className="size-4" /><span className="hidden sm:inline">Limpar filtros</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Contadores ── */}
      <div className="flex md:grid md:grid-cols-4 xl:grid-cols-8 gap-2.5 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1 mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`${CARD} shrink-0 min-w-[150px] md:min-w-0 p-3 flex items-center gap-3 text-left transition-colors ${filter === t.key ? "ring-2 ring-primary/30 border-primary/50" : "hover:border-primary/30"}`}>
            <span className={`size-11 rounded-xl grid place-items-center shrink-0 ${t.tone}`}><t.icon className="size-5" /></span>
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground truncate">{t.key === "todos" ? "Total de pedidos" : t.label}</span>
              <span className={`block text-xl font-bold tabular-nums leading-tight ${t.key === "entregue" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                {counts ? (counts[t.key] ?? 0).toLocaleString("pt-BR") : "—"}
              </span>
            </span>
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-2 px-3 py-2 rounded-xl bg-primary/10 text-sm">
          <span className="font-medium">{selected.size} selecionado{selected.size === 1 ? "" : "s"}</span>
          <button onClick={() => copy(selectedRows.map((r) => orderLabel(r.orderNumber)).join("\n"), "Números copiados")} className="inline-flex items-center gap-1 text-primary hover:underline"><Copy className="size-3.5" />Copiar números</button>
          {selectedRows.some((r) => r.trackingCode) && (
            <button onClick={() => copy(selectedRows.filter((r) => r.trackingCode).map((r) => `${orderLabel(r.orderNumber)}\t${r.trackingCode}`).join("\n"), "Rastreios copiados")} className="inline-flex items-center gap-1 text-primary hover:underline"><Truck className="size-3.5" />Copiar rastreios</button>
          )}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
      )}

      {/* ── Tabela ── */}
      <div className={`${CARD} overflow-hidden`}>
        {list.isLoading ? (
          <div className="py-20 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : list.isError ? (
          <p className="text-sm text-destructive py-10 text-center">{(list.error as any)?.message ?? "Erro ao carregar"}</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground py-12 text-center">Nenhum pedido encontrado.</p>
        ) : (
          <>
            <div className={`hidden md:block overflow-x-auto transition-opacity ${list.isFetching ? "opacity-60" : ""}`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-foreground/80 bg-primary/[0.06]">
                    <th className="w-10 py-3 pl-4"><Checkbox checked={allOnPage} onCheckedChange={toggleAll} /></th>
                    <th className="text-left font-semibold py-3 px-3">
                      <button onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))} className="inline-flex items-center gap-1 uppercase" title="Ordenar pela data do pedido">
                        Pedido {sort === "desc" ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                      </button>
                    </th>
                    <th className="text-center font-semibold py-3 px-3">Valor</th>
                    <th className="text-center font-semibold py-3 px-3">Pagamento</th>
                    <th className="text-center font-semibold py-3 px-3">Fornecedor</th>
                    <th className="text-center font-semibold py-3 px-3">Envio</th>
                    <th className="text-left font-semibold py-3 px-3">Última movimentação</th>
                    <th className="text-left font-semibold py-3 px-3">Nota</th>
                    <th className="text-center font-semibold py-3 pr-4 pl-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={`border-t border-border/60 hover:bg-muted/30 align-middle ${selected.has(r.id) ? "bg-primary/[0.04]" : ""}`}>
                      <td className="py-2.5 pl-4"><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} /></td>
                      <td className="py-2.5 px-3 cursor-pointer" onClick={() => setOpenId(r.id)}>
                        <p className="font-bold flex items-center gap-1.5">
                          {orderLabel(r.orderNumber)}
                          {r.attention && <span title={r.attentionWhy ?? "Precisa de atenção"}><AlertTriangle className="size-3.5 text-orange-500" /></span>}
                          {r.dispute && <span title={`${r.dispute.type === "inquiry" ? "Inquiry" : "Chargeback"}${r.dispute.status ? ` · ${DISPUTE_STATUS[r.dispute.status] ?? r.dispute.status}` : ""}`}>
                            {r.dispute.status === "won" ? <ShieldCheck className="size-3.5 text-emerald-600" /> : <ShieldAlert className="size-3.5 text-rose-600" />}
                          </span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{fmtDate(r.orderDate)}</p>
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap" title={r.product ?? undefined}>
                        <p className="tabular-nums font-bold">{money(r.revenue, r.currency ?? "USD")}</p>
                        <p className="text-[11px] text-muted-foreground">{r.itemsQty} {r.itemsQty === 1 ? "item" : "itens"}</p>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Pill map={FINANCIAL} value={r.financialStatus} />
                        {r.disputifier && <p className="text-[10px] font-semibold text-violet-700 dark:text-violet-400 mt-0.5" title={`Reembolsado pelo Disputifier (alerta ${r.disputifier})`}><ShieldAlert className="size-3 inline -mt-0.5 mr-0.5" />Disputifier · {r.disputifier}</p>}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {r.supplierRefund?.status === "confirmado" ? <>
                          <Pill map={SUPPLIER} value="refunded" />
                          <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(r.supplierRefund.date)}</p>
                        </> : <>
                          <Pill map={SUPPLIER} value={r.supplierStatus} />
                          {r.supplierPaidAt && <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(r.supplierPaidAt)}</p>}
                          {r.supplierRefund?.status === "pendente" && <p className="text-[10px] text-orange-600 dark:text-orange-400 font-medium">Reembolso pendente</p>}
                        </>}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Pill map={DELIVERY} value={r.deliveryStatus} />
                        {r.trackingCode && (
                          <div className="flex items-center justify-center gap-1 mt-0.5 text-[11px] font-mono text-muted-foreground">
                            {r.trackingUrl
                              ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{r.trackingCode}</a>
                              : <span>{r.trackingCode}</span>}
                            <button onClick={() => copy(r.trackingCode!, "Rastreio copiado")} title="Copiar rastreio" className="hover:text-foreground"><Copy className="size-3" /></button>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 w-[220px] max-w-[240px]">
                        {r.lastEvent ? <>
                          <p className="text-xs line-clamp-2" title={r.lastEvent}>{r.lastEvent}</p>
                          {r.lastEventAt && <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDateTime(r.lastEventAt)}</p>}
                        </> : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2.5 px-3 w-[200px] max-w-[220px]"><NoteCell id={r.id} note={r.note} /></td>
                      <td className="py-2.5 pr-4 pl-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => setOpenId(r.id)} title="Ver pedido"
                            className="size-8 rounded-lg border border-border grid place-items-center text-primary hover:bg-primary/10"><Eye className="size-4" /></button>
                          <RowMenu r={r} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Celular: lista. */}
            <div className="md:hidden divide-y divide-border/60">
              {rows.map((r) => <MobileRow key={r.id} r={r} today={today} onOpen={() => setOpenId(r.id)} />)}
            </div>
          </>
        )}
      </div>

      {/* ── Rodapé: contagem, itens por página e páginas ── */}
      {total > 0 && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mt-3 text-sm">
          <span className="text-muted-foreground text-xs">
            Mostrando {(page * pageSize + 1).toLocaleString("pt-BR")}–{Math.min(total, (page + 1) * pageSize).toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")} pedidos
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Itens por página
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-9 px-2.5 rounded-lg border border-border bg-card text-sm text-foreground outline-none">
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <Pager page={page} pages={pages} onPage={setPage} disabled={list.isFetching} />
          </div>
        </div>
      )}

      <OrderSheet id={openId} onClose={() => setOpenId(null)} />
    </PageShell>
  );
}

// Páginas: 1 2 3 4 5 … 265, com a atual no meio quando passa da 4ª.
function Pager({ page, pages, onPage, disabled }: { page: number; pages: number; onPage: (p: number) => void; disabled: boolean }) {
  const items = useMemo(() => {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
    const out: (number | "…")[] = [0];
    const from = Math.max(1, Math.min(page - 1, pages - 5));
    const to = Math.min(pages - 2, Math.max(page + 1, 4));
    if (from > 1) out.push("…");
    for (let i = from; i <= to; i++) out.push(i);
    if (to < pages - 2) out.push("…");
    out.push(pages - 1);
    return out;
  }, [page, pages]);
  const btn = "h-9 min-w-9 px-2 rounded-lg border border-border bg-card text-sm grid place-items-center disabled:opacity-40";
  return (
    <div className="flex items-center gap-1">
      <button className={btn} disabled={page === 0 || disabled} onClick={() => onPage(page - 1)} aria-label="Anterior"><ChevronLeft className="size-4" /></button>
      {items.map((it, i) => it === "…"
        ? <span key={`e${i}`} className="px-1 text-muted-foreground">…</span>
        : <button key={it} disabled={disabled} onClick={() => onPage(it)}
            className={`${btn} ${it === page ? "bg-primary text-primary-foreground border-primary font-semibold" : "hover:bg-muted"}`}>{it + 1}</button>)}
      <button className={btn} disabled={page + 1 >= pages || disabled} onClick={() => onPage(page + 1)} aria-label="Próxima"><ChevronRight className="size-4" /></button>
    </div>
  );
}

// Nota da equipe: botão nas Ações (amarelo quando tem nota) que abre um campo pra escrever.
function useSaveNote() {
  const qc = useQueryClient();
  const fn = useServerFn(updateOrderNote);
  return useMutation({
    mutationFn: (v: { id: string; note: string }) => fn({ data: v }),
    onSuccess: () => { toast.success("Nota salva"); qc.invalidateQueries({ queryKey: ["all-orders"] }); qc.invalidateQueries({ queryKey: ["order-detail"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar a nota"),
  });
}

function NoteEditor({ id, note, onDone }: { id: string; note: string | null; onDone?: () => void }) {
  const [text, setText] = useState(note ?? "");
  useEffect(() => setText(note ?? ""), [note]);
  const save = useSaveNote();
  const dirty = text.trim() !== (note ?? "").trim();
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} autoFocus
        placeholder="Ex.: cliente pediu troca de tamanho, aguardando resposta…"
        className="w-full rounded-lg border border-border bg-background text-sm p-2.5 outline-none focus:border-primary resize-y" />
      <div className="flex items-center justify-end gap-2">
        {note && <button onClick={() => save.mutate({ id, note: "" }, { onSuccess: () => onDone?.() })} disabled={save.isPending}
          className="h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-destructive mr-auto">Apagar</button>}
        <button onClick={() => save.mutate({ id, note: text }, { onSuccess: () => onDone?.() })} disabled={!dirty || save.isPending}
          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
          {save.isPending && <Loader2 className="size-3.5 animate-spin" />}Salvar
        </button>
      </div>
    </div>
  );
}

function NoteCell({ id, note }: { id: string; note: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {note
          ? <button title={note} className="w-full text-left text-xs text-amber-800 dark:text-amber-300 bg-amber-500/10 rounded-lg px-2 py-1 line-clamp-2 hover:bg-amber-500/15">{note}</button>
          : <button className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><StickyNote className="size-3.5" />Adicionar</button>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-semibold mb-2">Nota do pedido</p>
        {open && <NoteEditor id={id} note={note} onDone={() => setOpen(false)} />}
        <p className="text-[10px] text-muted-foreground mt-2">A mesma nota do Rastreamento e da aba Notificações.</p>
      </PopoverContent>
    </Popover>
  );
}

function RowMenu({ r }: { r: OrderListRow }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button title="Mais ações" className="size-8 rounded-lg border border-border grid place-items-center text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {/* Atendimento › Nova mensagem já com o pedido e o e-mail do cliente (igual ao "Escrever e-mail" de Pedidos). */}
        <DropdownMenuItem asChild><a href={`/atendimento?novo=${encodeURIComponent(orderLabel(r.orderNumber))}`} target="_blank" rel="noreferrer"><Send className="size-4" />Enviar e-mail</a></DropdownMenuItem>
        <DropdownMenuItem onClick={() => copy(orderLabel(r.orderNumber))}><Copy className="size-4" />Copiar nº do pedido</DropdownMenuItem>
        {r.trackingCode && <DropdownMenuItem onClick={() => copy(r.trackingCode!)}><Copy className="size-4" />Copiar rastreio</DropdownMenuItem>}
        {r.customerEmail && <DropdownMenuItem onClick={() => copy(r.customerEmail!)}><Mail className="size-4" />Copiar e-mail do cliente</DropdownMenuItem>}
        {r.trackingUrl && <DropdownMenuItem asChild><a href={r.trackingUrl} target="_blank" rel="noreferrer"><Truck className="size-4" />Abrir rastreio</a></DropdownMenuItem>}
        {r.adminUrl && <DropdownMenuItem asChild><a href={r.adminUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Abrir na Shopify</a></DropdownMenuItem>}
        {r.conversationId && <DropdownMenuItem asChild><a href={`/atendimento?c=${r.conversationId}`} target="_blank" rel="noreferrer"><Headphones className="size-4" />Abrir conversa ({r.conversations})</a></DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileRow({ r, today, onOpen }: { r: OrderListRow; today: string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left px-4 py-3 active:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-sm flex items-center gap-1.5">{orderLabel(r.orderNumber)}
            {r.attention && <AlertTriangle className="size-3.5 text-orange-500" />}
            {r.dispute && <ShieldAlert className="size-3.5 text-rose-600" />}
          </p>
          <p className="text-xs text-muted-foreground truncate">{r.shopName} · {fmtDate(r.orderDate)} · {r.itemsQty} {r.itemsQty === 1 ? "item" : "itens"}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold tabular-nums">{money(r.revenue, r.currency ?? "USD")}</p>
        </div>
      </div>
      {r.attention && r.attentionWhy && <p className="text-[11px] text-orange-600 dark:text-orange-400 font-medium mt-1">{r.attentionWhy}</p>}
      {r.trackingCode && <p className="text-[11px] font-mono text-muted-foreground mt-1">{r.trackingCode}</p>}
      {r.lastEvent && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{r.lastEvent}{r.lastEventAt ? ` · ${fmtDateTime(r.lastEventAt)}` : ""}</p>}
      {r.note && <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1"><StickyNote className="size-3 inline -mt-0.5 mr-1" />{r.note}</p>}
      <div className="flex flex-wrap gap-1 mt-2">
        <Pill map={FINANCIAL} value={r.financialStatus} />
        {r.disputifier && <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] font-medium bg-violet-500/10 text-violet-700 dark:text-violet-400"><ShieldAlert className="size-3.5" />Disputifier · {r.disputifier}</span>}
        <Pill map={DELIVERY} value={r.deliveryStatus} />
        <Pill map={SUPPLIER} value={r.supplierRefund?.status === "confirmado" ? "refunded" : r.supplierStatus} prefix="Fornecedor" />
      </div>
    </button>
  );
}

// ─── Detalhe ────────────────────────────────────────────────────────────────

function Section({ icon: Icon, title, children, right }: { icon: typeof Truck; title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><Icon className="size-3.5" /></span>
        <p className="text-sm font-semibold flex-1">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs py-0.5">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

// Código local no painel: mostra (com link) e deixa colar/editar à mão.
function LocalCodeRow({ orderId, label, number, url, editable }: { orderId: string; label: string; number: string | null; url: string | null; editable: boolean }) {
  const qc = useQueryClient();
  const fn = useServerFn(updateLocalTrackingNumber);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(number ?? "");
  useEffect(() => setValue(number ?? ""), [number]);
  const save = useMutation({
    mutationFn: () => fn({ data: { id: orderId, number: value } }),
    onSuccess: () => { toast.success("Código local salvo"); setEditing(false); qc.invalidateQueries({ queryKey: ["order-detail", orderId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });
  if (editing) return (
    <div className="flex items-center gap-1.5 py-1">
      <span className="text-xs text-muted-foreground shrink-0">Código local</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder="Ex.: GFUS01081039613699"
        onKeyDown={(e) => { if (e.key === "Enter") save.mutate(); if (e.key === "Escape") setEditing(false); }}
        className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-background text-xs font-mono outline-none focus:border-primary" />
      <button onClick={() => save.mutate()} disabled={save.isPending} className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
        {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar"}
      </button>
      <button onClick={() => { setEditing(false); setValue(number ?? ""); }} className="h-7 px-1.5 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
    </div>
  );
  return (
    <Row label={`Código local (${label})`}>
      <span className="inline-flex items-center gap-1.5 font-mono">
        {number ? (url ? <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{number}</a> : number) : <span className="font-sans text-muted-foreground">ainda sem número</span>}
        {number && <button onClick={() => copy(number)} title="Copiar" className="text-muted-foreground hover:text-foreground"><Copy className="size-3" /></button>}
        {editable && <button onClick={() => setEditing(true)} title={number ? "Editar código local" : "Adicionar código local"} className="font-sans text-[11px] text-primary hover:underline">{number ? "editar" : "adicionar"}</button>}
      </span>
    </Row>
  );
}

// Eventos do rastreio: mais recente em cima, só os 3 últimos até expandir.
function Timeline({ events }: { events: { at: string | null; description: string; location: string | null }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 3);
  return (
    <div className="mt-2.5 border-t border-border pt-2">
      <ol className="space-y-1.5">
        {shown.map((e, i) => (
          <li key={i} className="text-xs flex gap-2">
            <span className={`size-1.5 rounded-full mt-1.5 shrink-0 ${i === 0 ? "bg-primary" : "bg-muted-foreground/40"}`} />
            <div className="min-w-0">
              <p className={i === 0 ? "font-medium" : "text-muted-foreground"}>{e.description}</p>
              <p className="text-[10px] text-muted-foreground">{fmtDateTime(e.at)}{e.location ? ` · ${e.location}` : ""}</p>
            </div>
          </li>
        ))}
      </ol>
      {events.length > 3 && (
        <button onClick={() => setAll((v) => !v)} className="mt-2 text-xs text-primary hover:underline inline-flex items-center gap-1">
          {all ? <><ChevronUp className="size-3.5" />Mostrar menos</> : <><ChevronDown className="size-3.5" />Ver todos os {events.length} eventos</>}
        </button>
      )}
    </div>
  );
}

function OrderSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const fn = useServerFn(getOrderDetail);
  const q = useQuery({ queryKey: ["order-detail", id], queryFn: () => fn({ data: { id: id! } }), enabled: !!id });
  const d = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="flex items-baseline gap-2 flex-wrap">
            {d ? orderLabel(d.orderNumber) : "Pedido"}
            {d && <span className="text-xs font-normal text-muted-foreground">Feito em {fmtDateTime(d.createdAt)} (NY)</span>}
          </SheetTitle>
          {/* Descrição só pra acessibilidade (a data já está ao lado do número). */}
          <SheetDescription className="sr-only">{d ? `Pedido ${orderLabel(d.orderNumber)}` : "Pedido"}</SheetDescription>
          {d && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Pill map={FINANCIAL} value={d.money.financialStatus} />
              <Pill map={DELIVERY} value={d.shipping.deliveryStatus} />
              <Pill map={SUPPLIER} value={d.supplier.refunds.some((x) => x.status === "confirmado") ? "refunded" : d.supplier.status} prefix="Fornecedor" />
              {d.adminUrl && (
                <a href={d.adminUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-border hover:bg-muted">
                  Abrir na Shopify <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {q.isLoading ? <div className="py-16 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
            : q.isError ? <p className="text-sm text-destructive">{(q.error as any)?.message ?? "Erro ao carregar"}</p>
            : d && <>
            {/* Nota da equipe */}
            <Section icon={StickyNote} title="Nota">
              <NoteEditor id={d.id} note={d.teamNote} />
            </Section>

            {/* Cliente */}
            <Section icon={User} title="Cliente">
              <p className="text-sm font-medium">{d.customer.name ?? "—"}</p>
              {d.customer.email && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1"><Mail className="size-3" />{d.customer.email}
                  <button onClick={() => copy(d.customer.email!)} className="hover:text-foreground"><Copy className="size-3" /></button></p>
              )}
              {d.customer.phone && <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1"><Phone className="size-3" />{d.customer.phone}</p>}
              {d.customer.address && <p className="text-xs text-muted-foreground flex items-start gap-1.5 mt-1"><MapPin className="size-3 mt-0.5 shrink-0" /><span>{d.customer.shipName && d.customer.shipName !== d.customer.name ? `${d.customer.shipName} — ` : ""}{d.customer.address}</span></p>}
            </Section>

            {/* Produtos e valores */}
            <Section icon={Package} title="Produtos">
              <div className="space-y-1.5">
                {d.items.map((it, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium">{it.title}</p>
                      <p className="text-muted-foreground">{[it.variant, it.sku].filter(Boolean).join(" · ")}{it.refundedQty > 0 && <span className="text-rose-600"> · {it.refundedQty} reembolsado{it.refundedQty === 1 ? "" : "s"}</span>}</p>
                    </div>
                    <p className="tabular-nums shrink-0">{it.qty} × {money(it.price, d.money.currency)}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* Envio e rastreio */}
            <Section icon={Truck} title="Envio e rastreio" right={d.shipping.trackingUrl && (
              <a href={d.shipping.trackingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">Rastrear <ExternalLink className="size-3" /></a>
            )}>
              <Row label="Código">{d.shipping.trackingCode
                ? <span className="inline-flex items-center gap-1 font-mono">{d.shipping.trackingCode}<button onClick={() => copy(d.shipping.trackingCode!)} className="text-muted-foreground hover:text-foreground"><Copy className="size-3" /></button></span>
                : "Sem rastreio"}</Row>
              {d.shipping.carrier && <Row label="Transportadora">{d.shipping.carrier}</Row>}
              {(d.shipping.local || d.shipping.localEditable) && (
                <LocalCodeRow orderId={d.id} label={d.shipping.local?.label ?? "Transportadora local"}
                  number={d.shipping.local?.number ?? d.shipping.localStored} url={d.shipping.local?.url ?? null} editable={d.shipping.localEditable} />
              )}
              {d.shipping.history.length > 0 && <Row label="Códigos antigos">{d.shipping.history.map((h) => h.code).join(", ")}</Row>}
              {d.shipping.resentAt ? <>
                <Row label="Postado (envio original)">{fmtDateTime(d.shipping.shippedAt)}</Row>
                <Row label="Reenviado em">{fmtDateTime(d.shipping.resentAt)}</Row>
                <Row label="Reenvio postado">{d.shipping.resentPostedAt ? fmtDate(d.shipping.resentPostedAt) : <span className="text-muted-foreground">aguardando postagem</span>}</Row>
              </> : <Row label="Postado">{fmtDateTime(d.shipping.shippedAt)}</Row>}
              <Row label="Entregue">{fmtDateTime(d.shipping.deliveredAt)}</Row>
              {d.shipping.problemAt && <Row label="Problema"><span className="text-rose-600">{fmtDateTime(d.shipping.problemAt)}</span></Row>}
              {(d.shipping.eddFrom || d.shipping.eddTo) && !d.shipping.deliveredAt && <Row label="Previsão">{fmtDate(d.shipping.eddFrom)}{d.shipping.eddTo && d.shipping.eddTo !== d.shipping.eddFrom ? ` a ${fmtDate(d.shipping.eddTo)}` : ""}</Row>}
              {d.shipping.customerNotifiedAt && <Row label="Cliente avisado">{fmtDateTime(d.shipping.customerNotifiedAt)}</Row>}
              {d.shipping.note && <p className="text-xs text-muted-foreground mt-1.5">Nota: {d.shipping.note}</p>}
              {d.shipping.timeline.length > 0 && <Timeline events={d.shipping.timeline} />}
            </Section>

            {/* Fornecedor e custo */}
            <Section icon={Factory} title="Fornecedor e custo">
              <Row label="Custo do pedido">{d.supplier.cost > 0 ? money(d.supplier.cost) : "$0 (sem custo)"}</Row>
              <Row label="Situação"><Pill map={SUPPLIER} value={d.supplier.status} /></Row>
              {/* Data do pagamento: a do lote (a que se ajusta em "Alterar data de pagamento"); sem lote, quando foi marcado pago. */}
              {(d.supplier.batch || d.supplier.paidAt) && <Row label="Pago em">{d.supplier.batch ? fmtDate(d.supplier.batch.date) : fmtDate(d.supplier.paidAt)}</Row>}
              {d.supplier.refunds.map((x, i) => (
                <div key={i} className="mt-2 pt-2 border-t border-border">
                  <Row label="Reembolso do fornecedor">
                    <span className={x.status === "confirmado" ? "text-violet-700 dark:text-violet-400 font-semibold" : "text-orange-600 dark:text-orange-400 font-semibold"}>
                      {x.status === "confirmado" ? "Reembolsado" : "Pendente"} · {money(x.amount)}
                    </span>
                  </Row>
                  <Row label="Pedido em">{fmtDateTime(x.requestedAt)}{x.requestedBy ? ` · ${x.requestedBy}` : ""}</Row>
                  {x.confirmedAt && <Row label="Reembolsado em">{fmtDateTime(x.confirmedAt)}{x.confirmedBy ? ` · ${x.confirmedBy}` : ""}</Row>}
                  {x.note && <Row label="Obs.">{x.note}</Row>}
                </div>
              ))}
            </Section>

            {/* Reembolso, chargeback e alerta */}
            {(d.money.refunded > 0 || d.disputes.length > 0 || d.alert) && (
              <Section icon={RotateCcw} title="Reembolso e chargeback">
                {d.money.refunded > 0 && <Row label="Reembolsado">{money(d.money.refunded, d.money.currency)}</Row>}
                {d.money.refunded > 0 && d.money.refundedAt && <Row label="Reembolsado em">{fmtDateTime(d.money.refundedAt)}</Row>}
                {d.disputifier && <Row label="Reembolsado por"><span className="font-semibold text-violet-700 dark:text-violet-400">Disputifier · alerta {d.disputifier}</span></Row>}
                {d.disputes.map((x, i) => (
                  <div key={i} className="text-xs border-t border-border first:border-0 pt-1.5 mt-1.5 first:mt-0 first:pt-0">
                    <Row label={x.type === "inquiry" ? "Inquiry" : "Chargeback"}><b>{DISPUTE_STATUS[x.status ?? ""] ?? x.status ?? "—"}</b> · {money(x.amount)}</Row>
                    {x.reason && <Row label="Motivo">{x.reason}</Row>}
                    <Row label="Aberto em">{fmtDate(x.initiatedAt)}{x.dueBy && !x.finalizedOn ? ` · prazo ${fmtDate(x.dueBy)}` : ""}{x.finalizedOn ? ` · encerrado ${fmtDate(x.finalizedOn)}` : ""}</Row>
                  </div>
                ))}
                {d.alert && (
                  <div className="text-xs border-t border-border pt-1.5 mt-1.5">
                    <Row label="Alerta (cobrança)"><b>{ALERT_STATUS[d.alert.status] ?? d.alert.status}</b>{d.alert.excluded ? " · excluído" : ""}</Row>
                    {d.alert.step > 0 && <Row label="E-mails enviados">{d.alert.step}{d.alert.lastAt ? ` · último ${fmtDate(d.alert.lastAt)}` : ""}{d.alert.stopReason === "respondeu" ? " · cliente respondeu" : ""}</Row>}
                    {d.alert.recoveredAmount != null && d.alert.status === "recuperado" && <Row label="Recuperado">{money(Number(d.alert.recoveredAmount))}{d.alert.recoveryOrder ? ` · ${d.alert.recoveryOrder}` : ""}</Row>}
                  </div>
                )}
              </Section>
            )}

            {/* Atendimento */}
            <Section icon={Headphones} title="Atendimento">
              {!d.conversations.length ? <p className="text-xs text-muted-foreground">Nenhuma conversa com esse cliente.</p> : (
                <div className="space-y-1.5">
                  {d.conversations.map((c) => (
                    <a key={c.id} href={`/atendimento?c=${c.id}`} target="_blank" rel="noreferrer"
                      className="flex items-center justify-between gap-3 text-xs rounded-lg px-2 py-1.5 -mx-2 hover:bg-muted">
                      <span className="min-w-0 truncate">{c.subject || "(sem assunto)"}</span>
                      <span className="shrink-0 text-muted-foreground">{fmtDate(c.lastAt)} · {c.messages} msg <ExternalLink className="size-3 inline" /></span>
                    </a>
                  ))}
                </div>
              )}
            </Section>
          </>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

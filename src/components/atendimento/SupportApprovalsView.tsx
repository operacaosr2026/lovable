import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, LayoutGrid, List, Loader2,
  MessageSquare, MoreHorizontal, Package, Repeat, Search, Undo2, X,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getSupportApprovalDetail, listSupportApprovals } from "@/lib/support-approvals.functions";
import { decideRefund, setRefundReason, type RefundLine, type RefundMode } from "@/lib/support-refund.functions";
import { REFUND_REASONS, refundReasonLabel } from "@/lib/refund-reasons";
import { decideExchange, type ExchangeFault, type ExchangeItem } from "@/lib/support-exchange.functions";
import { useSupportFn } from "./demo";
import { formatDuration, formatMoney, fullTime } from "./utils";

// Atendimento › Aprovações (gestor): todas as trocas e reembolsos pedidos pela
// equipe, de todas as lojas. Tabela com filtros e seleção (aprovar/recusar em
// lote) + painel lateral do pedido aberto (detalhes, conversa, produto,
// histórico). Quem vê e quem aprova: Configurações › Membros › Atendimento.

type Base = {
  id: string; status: string; created_at: string; decided_at: string | null; note: string | null; error: string | null;
  order_id: string; order_number: string | null; store: string | null; customer_name: string | null; customer_email: string | null;
  conversation_id: string | null; requestedByName: string | null; decidedByName: string | null; reject_reason: string | null;
  product: { title: string; variant: string | null; image: string | null } | null;
};
type RefundItem = Base & {
  kind: "reembolso"; mode: RefundMode; reason: string | null; line_items: RefundLine[]; include_shipping: boolean; amount: number; currency: string;
  notify_customer: boolean; charge_on_delivery: boolean; refunded_amount: number | null;
};
type ExchangeReq = Base & { kind: "troca"; fault: ExchangeFault; items: ExchangeItem[]; new_order_name: string | null };
type Item = RefundItem | ExchangeReq;

const OPEN = new Set(["pendente", "gerando", "erro"]);
const DECIDABLE = new Set(["pendente", "erro"]);
const WEEK = 7 * 86_400_000;

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Aguardando", cls: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  gerando: { label: "Processando", cls: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  erro: { label: "Erro", cls: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
  aprovado: { label: "Aprovado", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  recusado: { label: "Recusado", cls: "bg-muted text-muted-foreground border-border" },
};
const STATUS_FILTERS = [["abertos", "Em aberto"], ["aprovado", "Aprovados (14 dias)"], ["recusado", "Recusados (14 dias)"], ["todos", "Todos os status"]] as const;
const SORTS = [["recentes", "Mais recentes"], ["antigos", "Mais antigos"], ["valor", "Maior valor"]] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number][0];
type Sort = (typeof SORTS)[number][0];

const subtitle = (i: Item) => i.kind === "troca" ? "Troca de produto"
  : i.mode === "total" ? "Pedido inteiro" : i.mode === "valor" ? "Valor avulso" : "Itens do pedido";
const ago = (iso: string) => formatDuration(Date.now() - new Date(iso).getTime());
const day = (iso: string) => fullTime(iso).slice(0, 10);
const refundWhat = (r: RefundItem) => r.mode === "total" ? "Pedido inteiro" : r.mode === "valor" ? "Valor avulso"
  : r.line_items.map((l) => `${l.quantity}× ${l.title}${l.variant_title ? ` (${l.variant_title})` : ""}`).join(", ") + (r.include_shipping ? " + frete" : "");

export function SupportApprovalsView({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const listFn = useSupportFn(listSupportApprovals, "listSupportApprovals");
  const list = useQuery({ queryKey: ["support-approvals"], queryFn: () => listFn(), refetchInterval: 60_000 });
  const [kind, setKind] = useState<"todos" | "reembolso" | "troca">("todos");
  const [store, setStore] = useState<string>("");
  const [status, setStatus] = useState<StatusFilter>("abertos");
  const [sort, setSort] = useState<Sort>("recentes");
  const [layout, setLayout] = useState<"lista" | "grade">("lista");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const actions = useApprovalActions();

  const all = (list.data?.items ?? []) as Item[];
  const canApprove = !!list.data?.canApprove;
  const stores = useMemo(() => [...new Set(all.map((i) => i.store).filter(Boolean))].sort() as string[], [all]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^#/, "");
    const out = all.filter((i) =>
      (kind === "todos" || i.kind === kind)
      && (!store || i.store === store)
      && (status === "todos" || (status === "abertos" ? OPEN.has(i.status) : i.status === status))
      && (!term || [i.order_number, i.customer_name, i.customer_email, i.store].some((v) => v?.toLowerCase().replace(/^#/, "").includes(term))));
    const value = (i: Item) => (i.kind === "reembolso" ? i.amount : 0);
    return out.sort((a, b) => sort === "valor" ? value(b) - value(a)
      : sort === "antigos" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
  }, [all, kind, store, status, sort, q]);
  useEffect(() => { setPage(0); }, [kind, store, status, sort, q, perPage]);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const shown = rows.slice(page * perPage, page * perPage + perPage);
  const openItem = all.find((i) => i.id === openId) ?? null;

  // Seleção só do que dá pra decidir; some quando a linha sai da lista.
  useEffect(() => {
    setSelected((s) => {
      const ok = new Set(all.filter((i) => DECIDABLE.has(i.status)).map((i) => i.id));
      const next = new Set([...s].filter((id) => ok.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [all]);
  const selectable = shown.filter((i) => canApprove && DECIDABLE.has(i.status));
  const allChecked = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const picked = all.filter((i) => selected.has(i.id));

  if (list.isLoading) return <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (list.isError) return <div className="py-20 text-center text-sm text-destructive">{(list.error as any)?.message ?? "Erro"}</div>;

  const openCount = (k: string) => all.filter((i) => OPEN.has(i.status) && (k === "todos" || i.kind === k)).length;

  // Painel aberto: tabela enxuta (loja embaixo do cliente, sem a coluna Tipo,
  // Recusar no menu) pra caber ao lado sem cortar.
  const compact = !!openItem;
  const headers = compact ? ["Pedido", "Cliente", "Valor", "Solicitado em", "Status"] : ["Pedido", "Cliente", "Loja", "Tipo", "Valor", "Solicitado em", "Status"];

  return (
    <div className="space-y-4 pb-6">
        <Kpis all={all} />

        {/* ── Filtros ── */}
        <div className="flex flex-wrap items-center gap-2">
          {([["todos", "Todos"], ["reembolso", "Reembolsos"], ["troca", "Trocas"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`h-9 px-4 rounded-xl text-xs font-semibold border transition-colors ${kind === k ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/40"}`}>
              {label} ({openCount(k)})
            </button>
          ))}
          <div className="flex-1" />
          <div className="relative w-full sm:w-56">
            <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pedido, cliente ou loja…"
              className="w-full h-9 pl-8 pr-3 rounded-xl bg-card border border-border text-xs outline-none focus:border-primary" />
          </div>
          <Select value={store} onChange={setStore} options={[["", "Todas as lojas"], ...stores.map((s) => [s, s] as [string, string])]} />
          <Select value={status} onChange={(v) => setStatus(v as StatusFilter)} options={STATUS_FILTERS} />
          <Select value={sort} onChange={(v) => setSort(v as Sort)} options={SORTS} />
          <div className="flex items-center rounded-xl border border-border bg-card p-0.5">
            {([["lista", List], ["grade", LayoutGrid]] as const).map(([k, Icon]) => (
              <button key={k} onClick={() => setLayout(k)} title={k === "lista" ? "Lista" : "Grade"}
                className={`size-8 rounded-lg grid place-items-center ${layout === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>

        {/* ── Ações em lote ── */}
        {canApprove && picked.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-xs font-medium">{picked.length} selecionada{picked.length > 1 ? "s" : ""}</p>
            <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Limpar</button>
            <div className="flex-1" />
            <button onClick={() => actions.approve(picked)} disabled={actions.busy}
              className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-50">
              {actions.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Aprovar selecionadas
            </button>
            <button onClick={() => actions.askReject(picked)} disabled={actions.busy}
              className="h-8 px-3 rounded-lg border border-border bg-card text-xs font-medium hover:border-destructive hover:text-destructive disabled:opacity-50">
              Recusar selecionadas
            </button>
          </div>
        )}

      <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16 grid place-items-center text-center gap-2">
            <CheckCircle2 className="size-8 text-emerald-500" />
            <p className="text-sm font-medium">{status === "abertos" && !q && !store ? "Nada para aprovar" : "Nenhuma solicitação com esses filtros"}</p>
            <p className="text-xs text-muted-foreground">Trocas e reembolsos pedidos pela equipe no Atendimento aparecem aqui.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {layout === "lista" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-muted-foreground">
                      <th className="w-10 pl-4 py-3 text-left">
                        {canApprove && (
                          <input type="checkbox" checked={allChecked} disabled={!selectable.length} aria-label="Selecionar página"
                            onChange={() => setSelected((s) => {
                              const n = new Set(s);
                              selectable.forEach((i) => (allChecked ? n.delete(i.id) : n.add(i.id)));
                              return n;
                            })} className="size-3.5 accent-primary" />
                        )}
                      </th>
                      {headers.map((h) => (
                        <th key={h} className="px-3 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-3 py-3 text-left font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((i) => (
                      <tr key={i.id} onClick={() => setOpenId(i.id)}
                        className={`border-b border-border last:border-0 cursor-pointer transition-colors ${openId === i.id ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                        <td className="pl-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {canApprove && DECIDABLE.has(i.status) && (
                            <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label="Selecionar" className="size-3.5 accent-primary" />
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5 min-w-[150px]">
                            <Thumb src={i.product?.image ?? null} />
                            <div className="min-w-0">
                              <p className="font-semibold whitespace-nowrap">{i.order_number ?? "Pedido"}</p>
                              <p className="text-[11px] text-muted-foreground whitespace-nowrap">{subtitle(i)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 max-w-[160px]" title={i.customer_email ?? ""}>
                          <p className="truncate">{i.customer_name || i.customer_email || "—"}</p>
                          {compact && <p className="text-[11px] text-muted-foreground truncate">{i.store ?? "—"}</p>}
                        </td>
                        {!compact && <td className="px-3 py-2.5 whitespace-nowrap max-w-[140px] truncate">{i.store ?? "—"}</td>}
                        {!compact && <td className="px-3 py-2.5"><KindBadge kind={i.kind} /></td>}
                        <td className="px-3 py-2.5 font-semibold whitespace-nowrap">{i.kind === "reembolso" ? formatMoney(i.amount, i.currency) : "—"}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <p>{day(i.created_at)}</p>
                          <p className="text-[11px] text-muted-foreground">há {ago(i.created_at)}</p>
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge status={i.status} /></td>
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <RowActions i={i} canApprove={canApprove} actions={actions} compact={compact} onOpen={() => setOpenId(i.id)} onOpenConversation={onOpenConversation} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={`p-3 grid gap-3 sm:grid-cols-2 ${compact ? "" : "2xl:grid-cols-3"}`}>
                {shown.map((i) => (
                  <div key={i.id} onClick={() => setOpenId(i.id)}
                    className={`rounded-xl border p-3 cursor-pointer transition-colors ${openId === i.id ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"}`}>
                    <div className="flex items-start gap-2.5">
                      {canApprove && DECIDABLE.has(i.status) && (
                        <input type="checkbox" checked={selected.has(i.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(i.id)} className="mt-1 size-3.5 accent-primary" />
                      )}
                      <Thumb src={i.product?.image ?? null} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{i.order_number ?? "Pedido"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{i.customer_name || i.customer_email || "—"} · {i.store ?? "—"}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <KindBadge kind={i.kind} /><StatusBadge status={i.status} />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{i.kind === "reembolso" ? formatMoney(i.amount, i.currency) : "—"}</p>
                        <p className="text-[10px] text-muted-foreground">há {ago(i.created_at)}</p>
                      </div>
                    </div>
                    {i.note && <p className="mt-2 text-[11px] text-muted-foreground line-clamp-2 italic">{i.note}</p>}
                    <div className="mt-2.5 flex justify-end" onClick={(e) => e.stopPropagation()}>
                      <RowActions i={i} canApprove={canApprove} actions={actions} onOpen={() => setOpenId(i.id)} onOpenConversation={onOpenConversation} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Paginação ── */}
            <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <p>Mostrando {page * perPage + 1}–{Math.min(rows.length, (page + 1) * perPage)} de {rows.length} solicitaç{rows.length === 1 ? "ão" : "ões"}</p>
              <div className="flex-1 flex justify-center items-center gap-1">
                <PageBtn disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="size-3.5" /></PageBtn>
                {Array.from({ length: pages }, (_, n) => n).filter((n) => pages <= 7 || Math.abs(n - page) <= 2 || n === 0 || n === pages - 1).map((n, k, arr) => (
                  <span key={n} className="flex items-center gap-1">
                    {k > 0 && n - arr[k - 1] > 1 && <span className="px-1">…</span>}
                    <PageBtn active={n === page} onClick={() => setPage(n)}>{n + 1}</PageBtn>
                  </span>
                ))}
                <PageBtn disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight className="size-3.5" /></PageBtn>
              </div>
              <label className="flex items-center gap-2">Itens por página
                <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}
                  className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground outline-none">
                  {[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
      {openItem && (
        <DetailPanel i={openItem} canApprove={canApprove} actions={actions} onClose={() => setOpenId(null)} onOpenConversation={onOpenConversation} />
      )}
      </div>
      <RejectDialog actions={actions} />
    </div>
  );
}

// ─── Cartões do topo ──────────────────────────────────────────────────────────

function Kpis({ all }: { all: Item[] }) {
  const waiting = all.filter((i) => OPEN.has(i.status));
  const refunds = waiting.filter((i): i is RefundItem => i.kind === "reembolso");
  const exchanges = waiting.filter((i) => i.kind === "troca");
  const sum = (list: RefundItem[]) => {
    const by = new Map<string, number>();
    for (const r of list) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount);
    return by.size ? [...by].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, "USD");
  };
  // Tempo do pedido até a decisão: últimos 7 dias × os 7 de antes.
  const now = Date.now();
  const avg = (from: number, to: number) => {
    const d = all.filter((i) => i.decided_at && !OPEN.has(i.status))
      .map((i) => ({ at: new Date(i.decided_at!).getTime(), ms: new Date(i.decided_at!).getTime() - new Date(i.created_at).getTime() }))
      .filter((x) => x.at >= from && x.at < to);
    return d.length ? d.reduce((s, x) => s + x.ms, 0) / d.length : null;
  };
  const cur = avg(now - WEEK, now + 1), prev = avg(now - 2 * WEEK, now - WEEK);
  const delta = cur != null && prev ? Math.round(((cur - prev) / prev) * 100) : null;
  const items = exchanges.reduce((s, i) => s + (i.kind === "troca" ? i.items.reduce((n, x) => n + x.quantity, 0) : 0), 0);

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      <Kpi icon={Clock} tone="amber" label="Aguardando aprovação" value={String(waiting.length)}
        sub={<>{sum(refunds)} <span className="text-muted-foreground font-normal">em reembolsos</span></>} />
      <Kpi icon={Undo2} tone="rose" label="Reembolsos" value={String(refunds.length)} sub={sum(refunds)} />
      <Kpi icon={Repeat} tone="blue" label="Trocas" value={String(exchanges.length)}
        sub={<span className="font-normal text-muted-foreground">{items} {items === 1 ? "item" : "itens"} pra reenviar</span>} />
      <Kpi icon={Clock} tone="emerald" label="Tempo médio de análise" value={cur == null ? "—" : formatDuration(cur)}
        sub={delta == null ? <span className="font-normal text-muted-foreground">últimos 7 dias</span> : (
          <span className={`flex items-center gap-1 ${delta <= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {delta <= 0 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}{Math.abs(delta)}%
            <span className="font-normal text-muted-foreground">vs. semana anterior</span>
          </span>
        )} />
    </div>
  );
}

const TONES = {
  amber: "from-amber-500/10 text-amber-600 bg-amber-500/15",
  rose: "from-rose-500/10 text-rose-600 bg-rose-500/15",
  blue: "from-blue-500/10 text-blue-600 bg-blue-500/15",
  emerald: "from-emerald-500/10 text-emerald-600 bg-emerald-500/15",
} as const;

function Kpi({ icon: Icon, tone, label, value, sub }: { icon: any; tone: keyof typeof TONES; label: string; value: string; sub: React.ReactNode }) {
  const [grad, text, bg] = TONES[tone].split(" ");
  return (
    <div className={`rounded-2xl border border-border bg-gradient-to-br ${grad} to-card p-4 flex items-start gap-3`}>
      <span className={`size-10 shrink-0 rounded-full grid place-items-center ${bg} ${text}`}><Icon className="size-5" /></span>
      <div className="min-w-0">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-2xl font-semibold tracking-tight leading-tight">{value}</p>
        <div className="text-xs font-semibold truncate">{sub}</div>
      </div>
    </div>
  );
}

// ─── Peças ────────────────────────────────────────────────────────────────────

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-xl border border-border bg-card px-3 text-xs outline-none focus:border-primary max-w-[180px]">
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

function PageBtn({ children, active, disabled, onClick }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`min-w-8 h-8 px-2 rounded-lg border text-xs font-medium disabled:opacity-40 ${active ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card text-foreground hover:border-primary/40"}`}>
      {children}
    </button>
  );
}

function Thumb({ src, size = "md" }: { src: string | null; size?: "md" | "lg" | "xl" }) {
  const cls = size === "xl" ? "size-16 rounded-xl" : size === "lg" ? "size-11 rounded-lg" : "size-9 rounded-lg";
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={`${cls} shrink-0 object-cover border border-border bg-muted`} />
    : <span className={`${cls} shrink-0 grid place-items-center bg-muted text-muted-foreground border border-border`}><Package className="size-4" /></span>;
}

function KindBadge({ kind }: { kind: Item["kind"] }) {
  return kind === "reembolso"
    ? <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-600 whitespace-nowrap"><Undo2 className="size-3" />Reembolso</span>
    : <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 whitespace-nowrap"><Repeat className="size-3" />Troca</span>;
}

function StatusBadge({ status, long }: { status: string; long?: boolean }) {
  const st = STATUS[status] ?? STATUS.pendente;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${st.cls}`}>
      {status === "gerando" ? <Loader2 className="size-3 animate-spin" /> : <Clock className="size-3" />}
      {long && status === "pendente" ? "Aguardando aprovação" : st.label}
    </span>
  );
}

function RowActions({ i, canApprove, actions, compact, onOpen, onOpenConversation }: {
  i: Item; canApprove: boolean; actions: Actions; compact?: boolean; onOpen: () => void; onOpenConversation: (id: string) => void;
}) {
  const decidable = canApprove && DECIDABLE.has(i.status);
  const busy = actions.busyIds.has(i.id);
  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="size-8 rounded-lg border border-border grid place-items-center text-muted-foreground hover:text-foreground" aria-label="Mais ações">
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onOpen}>Ver detalhes</DropdownMenuItem>
          {i.conversation_id && <DropdownMenuItem onClick={() => onOpenConversation(i.conversation_id!)}>Abrir conversa</DropdownMenuItem>}
          {i.order_number && (
            <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(i.order_number!); toast.success("Número do pedido copiado"); }}>Copiar nº do pedido</DropdownMenuItem>
          )}
          {compact && decidable && <DropdownMenuItem onClick={() => actions.askReject([i])} className="text-destructive">Recusar</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {decidable && (
        <>
          <button onClick={() => actions.approve([i])} disabled={busy}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1 disabled:opacity-50 whitespace-nowrap">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {i.status === "erro" ? "Tentar de novo" : "Aprovar"}
          </button>
          {!compact && (
            <button onClick={() => actions.askReject([i])} disabled={busy}
              className="h-8 px-3 rounded-lg border border-border text-xs font-medium hover:border-destructive hover:text-destructive disabled:opacity-50">
              Recusar
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Aprovar / recusar (uma ou várias) ────────────────────────────────────────

type Actions = ReturnType<typeof useApprovalActions>;

function useApprovalActions() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refundFn = useSupportFn(decideRefund, "decideRefund");
  const exchangeFn = useSupportFn(decideExchange, "decideExchange");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<Item[] | null>(null);

  const run = useMutation({
    mutationFn: async ({ list, approve, reason }: { list: Item[]; approve: boolean; reason: string | null }) => {
      setBusyIds(new Set(list.map((i) => i.id)));
      const fails: string[] = [];
      for (const i of list) {
        try {
          const fn = i.kind === "reembolso" ? refundFn : exchangeFn;
          await fn({ data: { id: i.id, approve, reason: approve ? null : reason } });
        } catch (e: any) {
          fails.push(`${i.order_number ?? "Pedido"}: ${e?.message ?? "erro"}`);
        }
      }
      return { ok: list.length - fails.length, fails, approve };
    },
    onSuccess: ({ ok, fails, approve }) => {
      if (ok) toast.success(`${ok} ${approve ? "aprovada" : "recusada"}${ok > 1 ? "s" : ""}`);
      for (const f of fails) toast.error(f);
      setRejecting(null);
    },
    onSettled: () => {
      setBusyIds(new Set());
      qc.invalidateQueries({ queryKey: ["support-approvals"] });
      qc.invalidateQueries({ queryKey: ["refund-requests"] });
      qc.invalidateQueries({ queryKey: ["exchange-requests"] });
    },
  });

  const approve = async (list: Item[]) => {
    const refunds = list.filter((i): i is RefundItem => i.kind === "reembolso");
    const exchanges = list.length - refunds.length;
    const money = new Map<string, number>();
    for (const r of refunds) money.set(r.currency, (money.get(r.currency) ?? 0) + r.amount);
    const parts = [
      refunds.length ? `${refunds.length === 1 ? "reembolsa" : `${refunds.length} reembolsos:`} ${[...money].map(([c, v]) => formatMoney(v, c)).join(" + ")} (volta pelo mesmo meio de pagamento)` : null,
      exchanges ? `${exchanges === 1 ? "gera o pedido de troca" : `gera ${exchanges} pedidos de troca`} na Shopify (sai de graça)` : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: list.length === 1 ? `Aprovar ${list[0].order_number ?? "pedido"}?` : `Aprovar ${list.length} solicitações?`,
      description: `Isso ${parts.join(" e ")}. Não dá pra desfazer.`,
      confirmText: "Aprovar", variant: refunds.length ? "destructive" : undefined,
    });
    if (ok) run.mutate({ list, approve: true, reason: null });
  };

  return {
    approve,
    askReject: (list: Item[]) => setRejecting(list),
    reject: (reason: string | null) => rejecting && run.mutate({ list: rejecting, approve: false, reason }),
    cancelReject: () => setRejecting(null),
    rejecting,
    busy: run.isPending,
    busyIds,
  };
}

function RejectDialog({ actions }: { actions: Actions }) {
  const [reason, setReason] = useState("");
  const list = actions.rejecting;
  useEffect(() => { if (list) setReason(""); }, [list]);
  return (
    <Dialog open={!!list} onOpenChange={(o) => { if (!o) actions.cancelReject(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{list?.length === 1 ? `Recusar ${list[0].order_number ?? "pedido"}?` : `Recusar ${list?.length ?? 0} solicitações?`}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Quem pediu recebe o aviso com o motivo.</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} autoFocus placeholder="Motivo (opcional)"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
        <div className="flex justify-end gap-2">
          <button onClick={actions.cancelReject} className="h-9 px-4 rounded-xl border border-border text-sm">Voltar</button>
          <button onClick={() => actions.reject(reason.trim() || null)} disabled={actions.busy}
            className="h-9 px-4 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
            {actions.busy && <Loader2 className="size-4 animate-spin" />} Recusar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Painel lateral ───────────────────────────────────────────────────────────

type DetailTab = "detalhes" | "conversa" | "produto" | "historico";

function DetailPanel({ i, canApprove, actions, onClose, onOpenConversation }: {
  i: Item; canApprove: boolean; actions: Actions; onClose: () => void; onOpenConversation: (id: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>("detalhes");
  const detailFn = useSupportFn(getSupportApprovalDetail, "getSupportApprovalDetail");
  const detail = useQuery({
    queryKey: ["support-approval-detail", i.order_id, i.conversation_id],
    queryFn: () => detailFn({ data: { orderId: i.order_id, conversationId: i.conversation_id } }),
    staleTime: 5 * 60_000,
  });
  const d = detail.data as Awaited<ReturnType<typeof getSupportApprovalDetail>> | undefined;
  const busy = actions.busyIds.has(i.id);

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full sm:w-[400px] bg-card border-l border-border shadow-2xl overflow-y-auto
      xl:static xl:z-auto xl:w-[380px] xl:shrink-0 xl:rounded-2xl xl:border xl:shadow-none xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      <div className="p-4 pb-0">
        <div className="flex items-start gap-3">
          <Thumb src={i.product?.image ?? null} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-lg font-semibold truncate">{i.order_number ?? "Pedido"}</p>
              {i.order_number && (
                <button onClick={() => { navigator.clipboard.writeText(i.order_number!); toast.success("Número do pedido copiado"); }}
                  className="text-muted-foreground hover:text-foreground" title="Copiar"><Copy className="size-3.5" /></button>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{i.store ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{subtitle(i)}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fechar"><X className="size-4" /></button>
            <StatusBadge status={i.status} long />
          </div>
        </div>
        <div className="mt-4 flex border-b border-border">
          {([["detalhes", "Detalhes"], ["conversa", "Conversa"], ["produto", "Produto"], ["historico", "Histórico"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 h-9 text-xs font-medium border-b-2 -mb-px ${tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {tab === "detalhes" && (
          <>
            <Box title="Informações gerais">
              <Info label="Cliente" value={i.customer_name || "—"} />
              <Info label="E-mail" value={i.customer_email ? <a href={`mailto:${i.customer_email}`} className="text-primary hover:underline break-all">{i.customer_email}</a> : "—"} />
              <Info label="Loja" value={i.store ?? "—"} />
              <Info label="Solicitado em" value={`${fullTime(i.created_at)} (há ${ago(i.created_at)})`} />
              <Info label="Solicitado por" value={i.requestedByName ?? "Equipe"} />
              <Info label="Tipo" value={<KindBadge kind={i.kind} />} />
              {i.kind === "reembolso" ? (
                <>
                  <Info label="Valor" value={<span className="font-semibold">{formatMoney(i.amount, i.currency)}</span>} />
                  <Info label="Motivo" value={<ReasonEdit i={i} canEdit={canApprove} />} />
                  <Info label="Devolve" value={refundWhat(i)} />
                  <Info label="Avisa o cliente" value={i.notify_customer ? "Sim (e-mail da Shopify)" : "Não"} />
                  {i.charge_on_delivery && <Info label="Cobrança" value="Cobrar quando entregar" />}
                </>
              ) : (
                <>
                  <Info label="Erro de" value={i.fault === "empresa" ? "Empresa" : "Fornecedor"} />
                  <Info label="Vai enviar" value={i.items.map((x) => `${x.quantity}× ${x.product_title}${x.variant_title ? ` (${x.variant_title})` : ""}`).join(", ")} />
                </>
              )}
              <Info label="Status" value={<StatusBadge status={i.status} long />} />
            </Box>
            {i.status === "erro" && i.error && <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{i.error}</p>}
            <Box title="Motivo / observação">
              <p className="text-xs italic text-muted-foreground whitespace-pre-wrap">{i.note || "Sem observação."}</p>
            </Box>
            <Box title="Imagens enviadas">
              {detail.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
                : d?.images.length ? (
                  <div className="grid grid-cols-4 gap-2">
                    {d.images.map((img) => (
                      <a key={img.id} href={img.large ?? "#"} target="_blank" rel="noreferrer" className="aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                        {img.thumb && <img src={img.thumb} alt="" loading="lazy" className="size-full object-cover hover:scale-105 transition-transform" />}
                      </a>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">O cliente não mandou foto nesta conversa.</p>}
            </Box>
          </>
        )}

        {tab === "conversa" && (
          <Box title="Últimas mensagens">
            {detail.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
              : d?.messages.length ? (
                <div className="space-y-2">
                  {d.messages.map((m) => (
                    <div key={m.id} className={`rounded-xl p-2.5 text-xs ${m.inbound ? "bg-muted mr-6" : "bg-primary/10 ml-6"}`}>
                      <p className="text-[10px] text-muted-foreground mb-0.5">{m.inbound ? m.from || "Cliente" : "Equipe"} · {fullTime(m.sentAt)}</p>
                      <p className="whitespace-pre-wrap line-clamp-6">{m.summary || m.subject || "(sem texto)"}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">Sem conversa ligada a este pedido.</p>}
          </Box>
        )}

        {tab === "produto" && (
          <Box title="Itens do pedido">
            {detail.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
              <div className="space-y-2.5">
                {(d?.lines ?? []).map((l, k) => (
                  <div key={k} className="flex items-center gap-2.5">
                    <Thumb src={l.image} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{l.title}</p>
                      <p className="text-[11px] text-muted-foreground">{l.variant ?? "—"} · {l.quantity}×</p>
                    </div>
                    <p className="text-xs font-semibold">{formatMoney(l.price, d?.currency ?? "USD")}</p>
                  </div>
                ))}
                {i.kind === "troca" && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-[11px] font-semibold mb-1">Troca pedida</p>
                    {i.items.map((x, k) => (
                      <p key={k} className="text-xs">
                        {x.quantity}× {x.product_title}{x.variant_title ? <span className="font-semibold"> ({x.variant_title})</span> : ""}
                        {x.replaces && <span className="text-muted-foreground"> — no lugar de {x.replaces}</span>}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Box>
        )}

        {tab === "historico" && (
          <Box title="Histórico">
            <ol className="space-y-3 border-l border-border pl-4">
              <Step at={i.created_at} title={`Pedido por ${i.requestedByName ?? "Equipe"}`} text={i.kind === "reembolso" ? `${refundWhat(i)} · ${formatMoney(i.amount, i.currency)}` : "Troca"} />
              {i.status === "gerando" && <Step title={i.kind === "reembolso" ? "Reembolsando na Shopify…" : "Gerando pedido na Shopify…"} />}
              {i.status === "erro" && <Step at={i.decided_at} title="Deu erro na Shopify" text={i.error ?? undefined} danger />}
              {i.status === "aprovado" && (
                <Step at={i.decided_at} title={`Aprovado por ${i.decidedByName ?? "—"}`}
                  text={i.kind === "reembolso" ? `${formatMoney(i.refunded_amount ?? i.amount, i.currency)} devolvido` : i.new_order_name ? `Pedido ${i.new_order_name} gerado` : undefined} />
              )}
              {i.status === "recusado" && <Step at={i.decided_at} title={`Recusado por ${i.decidedByName ?? "—"}`} text={i.reject_reason ?? undefined} danger />}
            </ol>
          </Box>
        )}

        {canApprove && DECIDABLE.has(i.status) && (
          <Box title="Ações">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button onClick={() => actions.approve([i])} disabled={busy}
                className="h-10 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {i.status === "erro" ? "Tentar de novo" : i.kind === "reembolso" ? "Aprovar e reembolsar" : "Aprovar e gerar troca"}
              </button>
              <button onClick={() => actions.askReject([i])} disabled={busy}
                className="h-10 px-5 rounded-xl border border-border text-xs font-semibold hover:border-destructive hover:text-destructive disabled:opacity-50">
                Recusar
              </button>
            </div>
          </Box>
        )}
        {i.conversation_id && (
          <button onClick={() => onOpenConversation(i.conversation_id!)}
            className="w-full h-10 rounded-xl border border-primary/40 text-primary text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-primary/5">
            <MessageSquare className="size-4" /> Abrir conversa com o cliente
          </button>
        )}
      </div>
    </aside>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-3.5">
      <p className="text-sm font-semibold mb-2.5">{title}</p>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{value}</span>
    </div>
  );
}

function Step({ at, title, text, danger }: { at?: string | null; title: string; text?: string; danger?: boolean }) {
  return (
    <li className="relative">
      <span className={`absolute -left-[21px] top-1 size-2.5 rounded-full ${danger ? "bg-destructive" : "bg-primary"}`} />
      <p className="text-xs font-medium">{title}</p>
      {at && <p className="text-[10px] text-muted-foreground">{fullTime(at)}</p>}
      {text && <p className="text-[11px] text-muted-foreground mt-0.5">{text}</p>}
    </li>
  );
}

// Motivo do reembolso no painel; quem aprova pode corrigir.
function ReasonEdit({ i, canEdit }: { i: RefundItem; canEdit: boolean }) {
  const qc = useQueryClient();
  const fn = useSupportFn(setRefundReason, "setRefundReason");
  const save = useMutation({
    mutationFn: (reason: string) => fn({ data: { id: i.id, reason } }),
    onSuccess: () => { toast.success("Motivo atualizado"); qc.invalidateQueries({ queryKey: ["support-approvals"] }); qc.invalidateQueries({ queryKey: ["refund-analytics"] }); },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });
  if (!canEdit) return <>{refundReasonLabel(i.reason)}</>;
  return (
    <select value={i.reason ?? ""} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value)}
      className="h-7 max-w-full rounded-md border border-border bg-background px-1.5 text-xs outline-none focus:border-primary">
      {!i.reason && <option value="">Sem motivo</option>}
      {REFUND_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
    </select>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, AreaChart, Area } from "recharts";
import {
  ShieldAlert, ShieldCheck, Hourglass, CircleX, CircleCheck, Trophy, Scale, ExternalLink, X, Loader2, Truck, Package,
  ChevronDown, ChevronRight, ArrowUp, ArrowDown, CalendarDays, MessagesSquare, Search, SlidersHorizontal, Download,
  AlertTriangle, Headphones, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { getChargebacks, type ChargebackRow } from "@/lib/chargebacks.functions";

export const Route = createFileRoute("/chargebacks")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Chargebacks — SRX Growth" }] }),
  component: ChargebacksPage,
});

// ─── Rótulos ─────────────────────────────────────────────────────────────────

// Motivo que o banco informou (Shopify: dispute.reason).
const REASON: Record<string, string> = {
  product_not_received: "Produto não recebido",
  product_unacceptable: "Produto não conforme",
  fraudulent: "Fraude",
  unrecognized: "Não reconhecida",
  duplicate: "Cobrança duplicada",
  credit_not_processed: "Reembolso não processado",
  subscription_canceled: "Assinatura cancelada",
  customer_initiated: "Iniciada pelo cliente",
  bank_cannot_process: "Banco não processou",
  debit_not_authorized: "Débito não autorizado",
  incorrect_account_details: "Dados da conta incorretos",
  insufficient_funds: "Saldo insuficiente",
  general: "Geral",
};
const reasonLabel = (r: string | null) => (r ? REASON[r] ?? r : "Sem motivo");

// Status da disputa: ícone + cor + nome sempre juntos.
const STATUS: Record<string, { label: string; cls: string; icon: typeof Hourglass }> = {
  needs_response:  { label: "Aguardando resposta", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: Hourglass },
  under_review:    { label: "Em análise",          cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400",       icon: Scale },
  won:             { label: "Ganho",               cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: Trophy },
  lost:            { label: "Perdido",             cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400",   icon: CircleX },
  prevented:       { label: "Evitado",             cls: "bg-muted text-muted-foreground",                    icon: ShieldCheck },
  accepted:        { label: "Aceito",              cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400",   icon: CircleX },
  charge_refunded: { label: "Reembolsado",         cls: "bg-muted text-muted-foreground",                    icon: CircleCheck },
};
const statusMeta = (s: string | null) => STATUS[s ?? ""] ?? { label: s ?? "—", cls: "bg-muted text-muted-foreground", icon: Hourglass };

const DELIVERY: Record<string, string> = {
  pending_shipment: "Aguardando envio", shipped: "Em trânsito", in_transit: "Em trânsito", delivered: "Entregue",
  returned: "Devolvido", problem: "Problema no rastreio", waiting_customer: "Esperando cliente",
};
// Pedido sem dados: antigo demais pra Shopify liberar (falta read_all_orders) ou sem pedido.
const noOrderLabel = (r: ChargebackRow) => (r.orderSource === "sem_acesso" ? "Pedido antigo (sem acesso)" : "Sem dados do pedido");
const deliveryLabel = (r: ChargebackRow) =>
  !r.orderNumber ? noOrderLabel(r) : r.deliveryStatus ? DELIVERY[r.deliveryStatus] ?? r.deliveryStatus : "Sem rastreio";
// Entrega comparada com o dia em que o cliente abriu a disputa: entregue ANTES
// = cliente já tinha recebido (dá pra contestar com a prova de entrega).
const atDisputeLabel = (r: ChargebackRow) => {
  if (!r.orderNumber) return noOrderLabel(r);
  if (r.deliveryStatus === "delivered") {
    if (!r.deliveredAt) return "Entregue (sem data)";
    return r.deliveredAt.slice(0, 10) <= r.initiatedAt.slice(0, 10) ? "Entregue antes da disputa" : "Entregue depois da disputa";
  }
  return r.deliveryStatus === "pending_shipment" ? "Nunca foi despachado" : deliveryLabel(r);
};
const deliveryTone = (label: string) =>
  label === "Entregue antes da disputa" ? { cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CircleCheck }
  : label === "Entregue depois da disputa" || label === "Entregue (sem data)" ? { cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400", icon: CircleCheck }
  : label === "Nunca foi despachado" ? { cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400", icon: Package }
  : label === "Entregue" ? { cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CircleCheck }
  : label === "Em trânsito" ? { cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400", icon: Truck }
  : label === "Aguardando envio" ? { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: Package }
  : label === "Problema no rastreio" || label === "Devolvido" ? { cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400", icon: AlertTriangle }
  : { cls: "bg-muted text-muted-foreground", icon: Package };
// Dias desde a compra: até a entrega (entregue) ou até hoje (ainda não chegou).
const deliveryDays = (r: ChargebackRow) => {
  const start = r.orderDate ?? r.shippedAt;
  if (!start || !r.orderNumber) return null;
  const end = r.deliveryStatus === "delivered" ? r.deliveredAt : new Date().toISOString();
  if (!end) return null;
  const d = Math.round((new Date(end).getTime() - new Date(`${start.slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000);
  return d >= 0 ? d : null;
};
const daysBucket = (r: ChargebackRow) =>
  r.daysToDispute == null ? "Sem data do pedido" : r.daysToDispute < 15 ? "Até 14 dias" : r.daysToDispute < 30 ? "15 a 29 dias" : r.daysToDispute < 45 ? "30 a 44 dias" : "45 dias ou mais";
const supportLabel = (r: ChargebackRow) => (!r.orderNumber ? noOrderLabel(r) : r.conversationId ? "Sim" : "Não");
// "Por produto" agrupa pelo produto do cadastro (variações do mesmo produto somam juntas).
const productLabel = (r: ChargebackRow) => r.productGroup ?? r.product ?? noOrderLabel(r);

type Dim = "status" | "reason" | "shop" | "product" | "delivery" | "atDispute" | "days" | "support";
const DIM_OF: Record<Dim, (r: ChargebackRow) => string> = {
  status: (r) => statusMeta(r.status).label,
  reason: (r) => reasonLabel(r.reason),
  shop: (r) => r.shopName,
  product: productLabel,
  delivery: deliveryLabel,
  atDispute: atDisputeLabel,
  days: daysBucket,
  support: supportLabel,
};
const DIM_NAME: Record<Dim, string> = {
  status: "Status", reason: "Motivo", shop: "Loja", product: "Produto", delivery: "Entrega", atDispute: "Entrega × disputa", days: "Dias até a disputa", support: "Falou com o suporte",
};

const PERIODS = [["tudo", "Tudo"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["ano", "Este ano"]] as const;
const TYPES = [["chargeback", "Chargebacks"], ["inquiry", "Inquiries"], ["todos", "Todos"]] as const;
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const AXIS = { fill: "var(--color-muted-foreground)", fontSize: 11 };

const money = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const daysLeft = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
// Segunda-feira da semana (UTC) → "aaaa-mm-dd".
const weekKey = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
const CARD = "rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(16,24,40,0.04)]";

// ─── Página ──────────────────────────────────────────────────────────────────

function ChargebacksPage() {
  const fn = useServerFn(getChargebacks);
  const [scope, setScope] = useState<"ativas" | "todas">("ativas");
  const [type, setType] = useState<(typeof TYPES)[number][0]>("chargeback");
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("tudo");
  const [filter, setFilter] = useState<{ dim: Dim; value: string } | null>(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<ChargebackRow | null>(null);
  const q = useQuery({ queryKey: ["chargebacks", scope], queryFn: () => fn({ data: { scope } }) });

  // Tipo + período (cards e gráficos); clique/seleção e busca valem só pra lista.
  const typed = useMemo(() => (q.data?.rows ?? []).filter((r) => type === "todos" || r.type === type), [q.data, type]);
  const base = useMemo(() => {
    const now = new Date();
    const from = period === "30" ? new Date(now.getTime() - 30 * 86_400_000)
      : period === "90" ? new Date(now.getTime() - 90 * 86_400_000)
      : period === "ano" ? new Date(now.getFullYear(), 0, 1) : null;
    return typed.filter((r) => !from || new Date(r.initiatedAt) >= from);
  }, [typed, period]);
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return base.filter((r) => (!filter || DIM_OF[filter.dim](r) === filter.value) &&
      (!s || [r.orderNumber, r.orderExternalId, r.customerName, r.customerEmail, r.product, r.trackingCode].some((v) => v?.toLowerCase().includes(s))));
  }, [base, filter, search]);

  const sum = (rows: ChargebackRow[]) => rows.reduce((t, r) => t + r.amount, 0);
  const isLost = (r: ChargebackRow) => r.status === "lost" || r.status === "accepted";
  const waiting = base.filter((r) => r.status === "needs_response");
  const lost = base.filter(isLost);
  const won = base.filter((r) => r.status === "won");
  const prevented = base.filter((r) => r.status === "prevented");
  const nextDue = waiting.map((r) => r.evidenceDueBy).filter(Boolean).sort()[0] ?? null;
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;

  // Meses da 1ª disputa até hoje (os sem disputa em zero): gráfico e minigráficos dos cards.
  const months = useMemo(() => {
    if (!typed.length) return [] as string[];
    const first = typed.map((r) => monthKey(r.initiatedAt)).sort()[0];
    const last = monthKey(new Date().toISOString());
    const out: string[] = [];
    let [y, m] = first.split("-").map(Number);
    const [ly, lm] = last.split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }, [typed]);
  const seriesOf = (pred: (r: ChargebackRow) => boolean) => months.map((k) => ({ k, v: typed.filter((r) => pred(r) && r.initiatedAt.startsWith(k)).length }));
  // Variação: mês atual × mês anterior.
  const mom = (pred: (r: ChargebackRow) => boolean) => {
    const s = seriesOf(pred);
    if (s.length < 2) return null;
    const cur = s[s.length - 1].v, prev = s[s.length - 2].v;
    return prev ? Math.round(((cur - prev) / prev) * 100) : null;
  };

  const toggle = (dim: Dim, value: string) => setFilter(filter?.dim === dim && filter.value === value ? null : { dim, value });
  const setDim = (dim: Dim, value: string) => setFilter(value ? { dim, value } : null);

  const exportCsv = () => {
    const head = ["Pedido", "Loja", "Cliente", "E-mail", "Produto", "Motivo", "Valor", "Status", "Aberto em", "Prazo", "Entrega", "Rastreio", "Falou com o suporte"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = list.map((r) => [r.orderNumber ?? r.orderExternalId, r.shopName, r.customerName, r.customerEmail, r.product, reasonLabel(r.reason),
      r.amount.toFixed(2).replace(".", ","), statusMeta(r.status).label, fmtDate(r.initiatedAt), fmtDate(r.evidenceDueBy), deliveryLabel(r), r.trackingCode, supportLabel(r)].map(esc).join(";"));
    const blob = new Blob(["﻿" + [head.map(esc).join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chargebacks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <PageShell wide>
      {/* ── Cabeçalho ── */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Chargebacks</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Seg value={scope} options={[["ativas", "Lojas ativas"], ["todas", "Todas as lojas"]] as const} onChange={(v) => { setScope(v); setFilter(null); }} />
          <Seg value={type} options={TYPES} onChange={(v) => { setType(v); setFilter(null); }} />
          <Select value={period} onChange={(v) => { setPeriod(v as any); setFilter(null); }} options={PERIODS.map(([k, l]) => [k, l] as const)} className="w-44" />
        </div>
      </div>

      {q.isLoading ? (
        <div className="py-24 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : q.isError ? (
        <p className="text-sm text-destructive py-10 text-center">{(q.error as any)?.message ?? "Erro ao carregar"}</p>
      ) : (
        <div className="space-y-4">
          {/* ── Cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <Stat icon={ShieldAlert} tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
              label={type === "inquiry" ? "Inquiries" : type === "todos" ? "Disputas" : "Chargebacks"}
              value={String(base.length)} sub={money(sum(base))} delta={mom(() => true)} badIfUp
              spark={seriesOf(() => true)} sparkKind="bars" />
            <Stat icon={Hourglass} tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" label="Aguardando resposta"
              value={String(waiting.length)} sub={nextDue ? `Próximo prazo: ${fmtDate(nextDue)}` : "Nenhum prazo correndo"}
              spark={seriesOf((r) => r.status === "needs_response")} sparkColor="#f59e0b"
              onClick={() => toggle("status", STATUS.needs_response.label)} active={filter?.dim === "status" && filter.value === STATUS.needs_response.label} />
            <Stat icon={CircleX} tone="bg-rose-500/10 text-rose-600 dark:text-rose-400" label="Perdidos"
              value={String(lost.length)} sub={money(sum(lost))} delta={mom(isLost)} badIfUp
              spark={seriesOf(isLost)} sparkColor="#f43f5e"
              onClick={() => toggle("status", STATUS.lost.label)} active={filter?.dim === "status" && filter.value === STATUS.lost.label} />
            <Stat icon={Trophy} tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" label="Taxa de vitória"
              value={winRate == null ? "—" : `${winRate}%`} sub={`${won.length} ganhos de ${won.length + lost.length} decididos`}
              spark={seriesOf((r) => r.status === "won")} sparkColor="#10b981"
              onClick={() => toggle("status", STATUS.won.label)} active={filter?.dim === "status" && filter.value === STATUS.won.label} />
            <Stat icon={ShieldCheck} tone="bg-slate-500/10 text-slate-600 dark:text-slate-300" label="Evitados"
              value={String(prevented.length)} sub={money(sum(prevented))}
              spark={seriesOf((r) => r.status === "prevented")} sparkColor="#94a3b8"
              onClick={() => toggle("status", STATUS.prevented.label)} active={filter?.dim === "status" && filter.value === STATUS.prevented.label} />
          </div>

          {/* ── Evolução | Motivos | Lojas ── */}
          <div className="grid xl:grid-cols-3 gap-4">
            <Evolution rows={base} months={months} />
            <BarListCard title="Motivos dos chargebacks" rows={base} dim="reason" filter={filter} onPick={toggle}
              right={<Select value={filter?.dim === "reason" ? filter.value : ""} onChange={(v) => setDim("reason", v)}
                options={[["", "Todos os motivos"] as const, ...uniq(base.map((r) => reasonLabel(r.reason))).map((x) => [x, x] as const)]} className="w-40 sm:w-44" />} />
            <BarListCard title="Chargebacks por loja" rows={base} dim="shop" filter={filter} onPick={toggle} big
              right={<Select value={filter?.dim === "shop" ? filter.value : ""} onChange={(v) => setDim("shop", v)}
                options={[["", "Todas as lojas"] as const, ...uniq(base.map((r) => r.shopName)).map((x) => [x, x] as const)]} className="w-40 sm:w-44" />} />
          </div>

          {/* ── Produto | Entrega | Dias | Suporte ── */}
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            <BarListCard title="Por produto" rows={base} dim="product" filter={filter} onPick={toggle} limit={5} withIcons
              iconFor={(label) => {
                const img = base.find((r) => productLabel(r) === label)?.productImage;
                return img ? <img src={img} alt="" className="size-full object-cover" /> : <Package className="size-4" />;
              }} />
            <BarListCard title="Entrega × data da disputa" rows={base} dim="atDispute" filter={filter} onPick={toggle} withIcons
              order={["Entregue antes da disputa", "Entregue depois da disputa", "Entregue (sem data)", "Em trânsito", "Nunca foi despachado"]}
              iconFor={(label) => { const T = deliveryTone(label).icon; return <T className="size-4" />; }} />
            <BarListCard title="Dias da compra até a disputa" rows={base} dim="days" filter={filter} onPick={toggle} withIcons
              order={["Até 14 dias", "15 a 29 dias", "30 a 44 dias", "45 dias ou mais", "Sem data do pedido"]}
              iconFor={() => <CalendarDays className="size-4" />} />
            <BarListCard title="Falou com o suporte antes?" rows={base} dim="support" filter={filter} onPick={toggle} withIcons
              order={["Sim", "Não"]}
              iconFor={(label) => label === "Sim" ? <CircleCheck className="size-4 text-emerald-600" /> : label === "Não" ? <CircleX className="size-4 text-rose-500" /> : <MessagesSquare className="size-4" />} />
          </div>

          {/* ── Lista ── */}
          <div className={`${CARD} p-5`}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <h2 className="text-lg font-semibold">Lista de chargebacks</h2>
                <span className="text-xs text-muted-foreground">{list.length} encontrado{list.length === 1 ? "" : "s"} · {money(sum(list))}</span>
                {filter && (
                  <button onClick={() => setFilter(null)} className="h-6 pl-2 pr-1 rounded-md bg-primary/10 text-primary text-[11px] font-medium flex items-center gap-1">
                    {DIM_NAME[filter.dim]}: {filter.value} <X className="size-3" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-auto sm:flex-1 lg:flex-none lg:w-72">
                  <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pedido, cliente ou produto…"
                    className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary" />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className={`h-10 px-3.5 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 flex-1 sm:flex-none ${filter ? "border-primary/50 text-primary" : "border-border hover:bg-muted"}`}>
                      <SlidersHorizontal className="size-4" /> Filtros
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 space-y-2.5">
                    {(["status", "reason", "shop", "delivery", "support"] as Dim[]).map((dim) => (
                      <div key={dim}>
                        <p className="text-[11px] font-semibold text-muted-foreground mb-1">{DIM_NAME[dim]}</p>
                        <Select value={filter?.dim === dim ? filter.value : ""} onChange={(v) => setDim(dim, v)}
                          options={[["", "Todos"] as const, ...uniq(base.map(DIM_OF[dim])).map((x) => [x, x] as const)]} className="w-full" />
                      </div>
                    ))}
                    {filter && <button onClick={() => setFilter(null)} className="text-xs text-primary hover:underline">Limpar filtro</button>}
                  </PopoverContent>
                </Popover>
                <button onClick={exportCsv} disabled={!list.length}
                  className="h-10 px-3.5 rounded-xl border border-border text-sm font-medium flex items-center justify-center gap-2 flex-1 sm:flex-none hover:bg-muted disabled:opacity-50">
                  <Download className="size-4" /> Exportar
                </button>
              </div>
            </div>

            {!list.length ? <Empty text="Nenhum chargeback nesse filtro" /> : (<>
              {/* Celular: um cartão por chargeback (a tabela tem 1100px). */}
              <div className="md:hidden space-y-2.5">
                {list.map((r) => <MobileItem key={r.id} r={r} onOpen={() => setDetail(r)} />)}
              </div>
              <div className="hidden md:block overflow-x-auto -mx-2">
                <table className="w-full text-sm min-w-[1100px]">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border text-left">
                      <th className="font-medium py-2.5 px-2">Pedido</th>
                      <th className="font-medium py-2.5 px-2">Produto</th>
                      <th className="font-medium py-2.5 px-2">Motivo</th>
                      <th className="font-medium py-2.5 px-2 text-right">Valor</th>
                      <th className="font-medium py-2.5 px-2">Status</th>
                      <th className="font-medium py-2.5 px-2">Aberto em</th>
                      <th className="font-medium py-2.5 px-2">Prazo</th>
                      <th className="font-medium py-2.5 px-2">Entrega</th>
                      <th className="font-medium py-2.5 px-2">Suporte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const st = statusMeta(r.status);
                      const left = r.status === "needs_response" ? daysLeft(r.evidenceDueBy) : null;
                      const dl = deliveryLabel(r);
                      const dt = deliveryTone(dl);
                      return (
                        <tr key={r.id} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) setDetail(r); }}
                          title="Ver detalhes" className="border-b border-border/60 last:border-0 hover:bg-muted/30 cursor-pointer">
                          <td className="py-3 px-2 whitespace-nowrap">
                            {r.adminUrl
                              ? <a href={r.adminUrl} target="_blank" rel="noreferrer" className="font-semibold hover:text-primary inline-flex items-center gap-1.5">{r.orderNumber ?? `#${r.orderExternalId ?? "—"}`}<ExternalLink className="size-3.5 text-muted-foreground" /></a>
                              : <span className="font-semibold">{r.orderNumber ?? "—"}</span>}
                            <div className="text-xs text-muted-foreground">{r.shopName.replace(/^Loja \d+ - /, "")}{r.type === "inquiry" ? " · inquiry" : ""}</div>
                          </td>
                          <td className="py-3 px-2 max-w-[260px]">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Thumb src={r.productImage} />
                              <div className="min-w-0">
                                <div className="truncate font-medium" title={r.product ?? undefined}>{r.product ?? <span className="text-muted-foreground font-normal">{noOrderLabel(r)}</span>}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-2">{reasonLabel(r.reason)}</td>
                          <td className="py-3 px-2 text-right tabular-nums font-semibold whitespace-nowrap">{money(r.amount)}</td>
                          <td className="py-3 px-2">
                            {/* "Aguardando resposta" em duas linhas, pra coluna não ficar larga. */}
                            {r.status === "needs_response" ? (
                              <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg font-medium leading-tight ${st.cls}`}>
                                <st.icon className="size-3 shrink-0" /><span>Aguardando<br />resposta</span>
                              </span>
                            ) : <Pill cls={st.cls} icon={st.icon}>{st.label}</Pill>}
                          </td>
                          <td className="py-3 px-2 whitespace-nowrap">
                            {fmtDate(r.initiatedAt)}
                            {r.daysToDispute != null && <div className="text-xs text-muted-foreground">{r.daysToDispute}d após a compra</div>}
                          </td>
                          <td className="py-3 px-2 whitespace-nowrap">
                            {left == null ? <span className="text-muted-foreground">—</span> : (
                              <span className={`font-medium ${left <= 2 ? "text-rose-600" : left <= 5 ? "text-amber-600" : ""}`}>
                                {fmtDate(r.evidenceDueBy)} · {left < 0 ? "vencido" : left === 0 ? "hoje" : `${left}d`}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <Pill cls={dt.cls} icon={dt.icon}>{dl}{deliveryDays(r) != null && <span className="opacity-70">· {deliveryDays(r)}d</span>}</Pill>
                            {r.trackingCode && (
                              <div className="mt-1">
                                {r.trackingUrl
                                  ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-primary hover:underline inline-flex items-center gap-1">{r.trackingCode}<ExternalLink className="size-3" /></a>
                                  : <span className="text-[11px] font-mono text-muted-foreground select-all">{r.trackingCode}</span>}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            {r.conversationId
                              ? <Link to="/atendimento" title="Tem conversa no Atendimento"><Pill cls="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Sim</Pill></Link>
                              : r.orderNumber ? <Pill cls="bg-rose-500/10 text-rose-700 dark:text-rose-400">Não</Pill>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>)}
          </div>
          {base.some((r) => r.orderSource === "sem_acesso") && (
            <p className="text-[11px] text-muted-foreground px-1">
              "Pedido antigo (sem acesso)": a Shopify só libera pedidos de mais de 60 dias com a permissão <code className="px-1 rounded bg-muted">read_all_orders</code> no app da loja.
            </p>
          )}
        </div>
      )}

      <DetailSheet row={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
}

// ─── Peças ───────────────────────────────────────────────────────────────────

// Cartão da lista no celular: toca pra abrir os detalhes.
function MobileItem({ r, onOpen }: { r: ChargebackRow; onOpen: () => void }) {
  const st = statusMeta(r.status);
  const left = r.status === "needs_response" ? daysLeft(r.evidenceDueBy) : null;
  const dl = deliveryLabel(r);
  const dt = deliveryTone(dl);
  const days = deliveryDays(r);
  return (
    <div role="button" tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) onOpen(); }}
      className="rounded-xl border border-border p-3 space-y-2.5 active:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {r.adminUrl
            ? <a href={r.adminUrl} target="_blank" rel="noreferrer" className="font-semibold inline-flex items-center gap-1.5">{r.orderNumber ?? `#${r.orderExternalId ?? "—"}`}<ExternalLink className="size-3.5 text-muted-foreground" /></a>
            : <span className="font-semibold">{r.orderNumber ?? "—"}</span>}
          <div className="text-xs text-muted-foreground">{r.shopName.replace(/^Loja \d+ - /, "")} · {fmtDate(r.initiatedAt)}</div>
        </div>
        <Pill cls={st.cls} icon={st.icon}>{st.label}</Pill>
      </div>
      <div className="flex items-center gap-2.5">
        <Thumb src={r.productImage} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{r.product ?? noOrderLabel(r)}</div>
          <div className="text-xs text-muted-foreground truncate">{reasonLabel(r.reason)}</div>
        </div>
        <div className="text-sm font-semibold tabular-nums shrink-0">{money(r.amount)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Pill cls={dt.cls} icon={dt.icon}>{dl}{days != null && <span className="opacity-70">· {days}d</span>}</Pill>
        {r.trackingCode && (r.trackingUrl
          ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-primary inline-flex items-center gap-1">{r.trackingCode}<ExternalLink className="size-3" /></a>
          : <span className="text-[11px] font-mono text-muted-foreground">{r.trackingCode}</span>)}
      </div>
      {(left != null || r.orderNumber) && (
        <div className="flex items-center justify-between text-xs">
          {left != null
            ? <span className={`font-medium ${left <= 2 ? "text-rose-600" : left <= 5 ? "text-amber-600" : ""}`}>Prazo: {fmtDate(r.evidenceDueBy)} · {left < 0 ? "vencido" : left === 0 ? "hoje" : `${left}d`}</span>
            : <span />}
          {r.orderNumber && <span className="text-muted-foreground">Suporte: <span className={r.conversationId ? "text-emerald-600 font-medium" : "text-rose-600 font-medium"}>{r.conversationId ? "Sim" : "Não"}</span></span>}
        </div>
      )}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center rounded-xl border border-border bg-card p-1 h-10 shrink-0">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`h-full px-3.5 rounded-lg text-sm font-medium transition-colors ${value === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Select({ value, onChange, options, className = "" }: { value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[]; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 pl-3 pr-8 rounded-xl border border-border bg-card text-sm outline-none focus:border-primary appearance-none cursor-pointer truncate">
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <ChevronDown className="size-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

function Pill({ cls, icon: Icon, children }: { cls: string; icon?: typeof Hourglass; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {Icon && <Icon className="size-3" />}{children}
    </span>
  );
}

function Thumb({ src }: { src: string | null }) {
  return (
    <div className="size-10 rounded-lg border border-border bg-muted/40 grid place-items-center overflow-hidden shrink-0 text-muted-foreground">
      {src ? <img src={src} alt="" className="size-full object-cover" /> : <Package className="size-4" />}
    </div>
  );
}

function Empty({ text = "Sem chargebacks no período" }: { text?: string }) {
  return <p className="text-sm text-muted-foreground text-center py-10">{text}</p>;
}

function Stat({ icon: Icon, tone, label, value, sub, delta, badIfUp, spark, sparkKind = "area", sparkColor = "var(--color-primary)", onClick, active }: {
  icon: typeof ShieldAlert; tone: string; label: string; value: string; sub: string;
  delta?: number | null; badIfUp?: boolean; spark: { k: string; v: number }[]; sparkKind?: "area" | "bars"; sparkColor?: string;
  onClick?: () => void; active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  const bad = delta != null && delta !== 0 && (badIfUp ? delta > 0 : delta < 0);
  const id = `sp-${label.replace(/\W/g, "")}`;
  return (
    <Tag onClick={onClick} title={onClick ? (active ? "Clique para tirar o filtro" : `Mostrar na lista: ${label}`) : undefined}
      className={`${CARD} relative overflow-hidden p-5 flex items-start gap-3.5 min-w-0 text-left transition-colors ${active ? "ring-2 ring-primary/30 border-primary/50" : ""} ${onClick ? "hover:border-primary/40 cursor-pointer" : ""}`}>
      <div className={`size-12 rounded-2xl grid place-items-center shrink-0 ${tone}`}><Icon className="size-6" /></div>
      <div className="min-w-0 relative z-10">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 truncate">{label}</p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <p className="text-3xl font-bold tracking-tight leading-none">{value}</p>
          {delta != null && delta !== 0 && (
            <span className={`inline-flex items-center text-xs font-semibold ${bad ? "text-rose-600" : "text-emerald-600"}`} title="vs mês anterior">
              {delta > 0 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}{Math.abs(delta)}%
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 truncate">{sub}</p>
      </div>
      {/* Minigráfico decorativo (mês a mês), no canto. */}
      {spark.length > 1 && (
        <div className="absolute right-0 bottom-0 w-28 h-16 opacity-80 pointer-events-none" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            {sparkKind === "bars" ? (
              <BarChart data={spark} margin={{ top: 4, right: 10, left: 0, bottom: 8 }}>
                <Bar dataKey="v" radius={[3, 3, 0, 0]} maxBarSize={8} isAnimationActive={false}>
                  {spark.map((_, i) => <Cell key={i} fill="var(--color-primary)" fillOpacity={0.25 + (0.6 * (i + 1)) / spark.length} />)}
                </Bar>
              </BarChart>
            ) : (
              <AreaChart data={spark} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={sparkColor} strokeOpacity={0.5} strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Tag>
  );
}

function CardShell({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className={`${CARD} p-5 min-w-0`}>
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// Evolução: barras por mês (ou semana); a mais recente mais forte.
function Evolution({ rows, months }: { rows: ChargebackRow[]; months: string[] }) {
  const [mode, setMode] = useState<"mes" | "semana">("mes");
  const data = useMemo(() => {
    if (!rows.length) return [];
    if (mode === "mes") {
      const firstUsed = rows.map((r) => monthKey(r.initiatedAt)).sort()[0];
      return months.filter((k) => k >= firstUsed).map((k) => ({ label: monthLabel(k), count: rows.filter((r) => r.initiatedAt.startsWith(k)).length }));
    }
    const first = rows.map((r) => weekKey(r.initiatedAt)).sort()[0];
    const last = weekKey(new Date().toISOString());
    const out: { label: string; count: number }[] = [];
    for (const d = new Date(`${first}T12:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 7)) {
      const k = d.toISOString().slice(0, 10);
      out.push({ label: `${k.slice(8, 10)}/${k.slice(5, 7)}`, count: rows.filter((r) => weekKey(r.initiatedAt) === k).length });
    }
    return out;
  }, [rows, months, mode]);

  return (
    <CardShell title="Evolução de chargebacks"
      right={<Select value={mode} onChange={(v) => setMode(v as "mes" | "semana")} options={[["mes", "Por mês"], ["semana", "Por semana"]] as const} className="w-32" />}>
      {!data.length ? <Empty /> : (
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} content={({ active, payload }) => active && payload?.length ? (
                <div className="rounded-lg bg-foreground text-background px-3 py-1.5 text-xs shadow-lg">
                  <p className="font-semibold">{String(payload[0].value)} chargeback{payload[0].value === 1 ? "" : "s"}</p>
                  <p className="opacity-70">{(payload[0].payload as { label: string }).label}</p>
                </div>
              ) : null} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {data.map((_, i) => <Cell key={i} fill="var(--color-primary)" fillOpacity={i === data.length - 1 ? 1 : 0.35 + (0.4 * (i + 1)) / data.length} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </CardShell>
  );
}

// Barras horizontais (quantidade por categoria, uma cor só); clicar filtra a lista.
function BarListCard({ title, rows, dim, filter, onPick, limit, order, right, withIcons, iconFor, big }: {
  title: string; rows: ChargebackRow[]; dim: Dim; filter: { dim: Dim; value: string } | null;
  onPick: (dim: Dim, value: string) => void; limit?: number; order?: string[]; right?: ReactNode;
  withIcons?: boolean; iconFor?: (label: string) => ReactNode; big?: boolean;
}) {
  const counts = new Map<string, { n: number; amount: number }>();
  for (const r of rows) {
    const k = DIM_OF[dim](r);
    const c = counts.get(k) ?? { n: 0, amount: 0 };
    counts.set(k, { n: c.n + 1, amount: c.amount + r.amount });
  }
  let items = [...counts.entries()].map(([label, c]) => ({ label, ...c }));
  const rank = (l: string) => (order?.includes(l) ? order.indexOf(l) : 99);
  items = order ? items.sort((a, b) => rank(a.label) - rank(b.label) || b.n - a.n) : items.sort((a, b) => b.n - a.n);
  const hidden = limit && items.length > limit ? items.slice(limit) : [];
  if (hidden.length) items = [...items.slice(0, limit), { label: "Outros", n: hidden.reduce((s, x) => s + x.n, 0), amount: hidden.reduce((s, x) => s + x.amount, 0) }];
  const total = rows.length || 1;

  return (
    <CardShell title={title} right={right}>
      {!items.length ? <Empty /> : (
        <div className={big ? "space-y-4" : "space-y-2.5"}>
          {items.map((i) => {
            const active = filter?.dim === dim && filter.value === i.label;
            const clickable = i.label !== "Outros";
            return (
              <button key={i.label} disabled={!clickable} onClick={() => clickable && onPick(dim, i.label)}
                title={`${i.label}: ${i.n} (${pct(i.n, total)}%) · ${money(i.amount)}`}
                className={`w-full text-left rounded-xl flex items-center gap-3 ${withIcons ? "p-1.5" : "px-1.5 py-1"} transition-colors ${active ? "bg-primary/10" : clickable ? "hover:bg-muted/60" : ""}`}>
                {withIcons && (
                  <div className="size-10 rounded-xl bg-primary/5 text-primary/80 border border-border/60 grid place-items-center overflow-hidden shrink-0">
                    {iconFor?.(i.label)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className={`text-sm truncate ${active ? "text-primary font-semibold" : "font-medium"}`}>{i.label}</span>
                    <span className="text-sm tabular-nums shrink-0 flex items-baseline gap-2">
                      <span className="font-semibold">{i.n}</span>
                      <span className="text-xs text-muted-foreground w-9 text-right">{pct(i.n, total)}%</span>
                    </span>
                  </div>
                  <div className={`${big ? "h-2.5" : "h-2"} rounded-full bg-muted overflow-hidden`}>
                    <div className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary" style={{ width: `${pct(i.n, total)}%` }} />
                  </div>
                </div>
                {withIcons && clickable && <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}

// Detalhes de um chargeback (botão "Ver").
function DetailSheet({ row: r, onClose }: { row: ChargebackRow | null; onClose: () => void }) {
  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => toast.success("Copiado")).catch(() => {}); };
  const st = r ? statusMeta(r.status) : null;
  const left = r?.status === "needs_response" ? daysLeft(r.evidenceDueBy) : null;
  const line = (k: string, v: ReactNode) => (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0 text-sm">
      <span className="text-muted-foreground shrink-0">{k}</span><span className="text-right min-w-0 break-words">{v}</span>
    </div>
  );
  return (
    <Sheet open={!!r} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {r && st && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 flex-wrap">{r.orderNumber ?? `#${r.orderExternalId ?? "—"}`} <Pill cls={st.cls} icon={st.icon}>{st.label}</Pill></SheetTitle>
              <SheetDescription>{r.shopName} · {r.type === "inquiry" ? "Inquiry" : "Chargeback"} de {money(r.amount)}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5 px-4 pb-6">
              <div className="flex items-center gap-3">
                <Thumb src={r.productImage} />
                <div className="min-w-0">
                  <p className="font-medium text-sm">{r.product ?? noOrderLabel(r)}</p>
                  <p className="text-xs text-muted-foreground">{r.customerName ?? "—"}{r.customerEmail ? ` · ${r.customerEmail}` : ""}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Disputa</p>
                {line("Motivo", reasonLabel(r.reason))}
                {line("Aberta em", `${fmtDate(r.initiatedAt)}${r.daysToDispute != null ? ` (${r.daysToDispute}d após a compra)` : ""}`)}
                {line("Prazo para responder", left == null ? "—" : <span className={left <= 2 ? "text-rose-600 font-medium" : ""}>{fmtDate(r.evidenceDueBy)} · {left < 0 ? "vencido" : left === 0 ? "hoje" : `${left}d`}</span>)}
                {line("Finalizada em", fmtDate(r.finalizedOn))}
                {r.alerts.length > 0 && line("Alertas", r.alerts.join(", "))}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Pedido e entrega</p>
                {line("Data do pedido", fmtDate(r.orderDate))}
                {line("Entrega", deliveryLabel(r))}
                {line("Código de rastreio", r.trackingCode ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                    {r.trackingUrl ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{r.trackingCode}</a> : r.trackingCode}
                    <button onClick={() => copy(r.trackingCode!)} className="text-muted-foreground hover:text-foreground" title="Copiar"><Copy className="size-3.5" /></button>
                  </span>
                ) : "—")}
                {line("Último evento", r.lastEvent ? `${r.lastEvent}${r.lastEventAt ? ` · ${fmtDate(r.lastEventAt)}` : ""}` : "—")}
                {line("Falou com o suporte", supportLabel(r))}
              </div>
              <div className="flex flex-wrap gap-2">
                {r.adminUrl && (
                  <a href={r.adminUrl} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5">
                    Abrir na Shopify <ExternalLink className="size-3.5" />
                  </a>
                )}
                {r.trackingUrl && (
                  <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-muted">
                    <Truck className="size-3.5" /> Rastreio
                  </a>
                )}
                {r.conversationId && (
                  <Link to="/atendimento" className="h-9 px-3 rounded-lg border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-muted">
                    <Headphones className="size-3.5" /> Atendimento
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import {
  ShieldAlert, Hourglass, CircleX, Trophy, ShieldCheck, ExternalLink, Headphones, X, Loader2, Truck, ChevronDown,
} from "lucide-react";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { getChargebacks, type ChargebackRow } from "@/lib/chargebacks.functions";

export const Route = createFileRoute("/chargebacks")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Chargebacks — SRX Growth" }] }),
  component: ChargebacksPage,
});

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

// Status da disputa: cor + nome sempre juntos.
const STATUS: Record<string, { label: string; cls: string }> = {
  needs_response: { label: "Aguardando resposta", cls: "bg-warning/15 text-warning" },
  under_review:   { label: "Em análise",          cls: "bg-info/10 text-info" },
  won:            { label: "Ganho",               cls: "bg-success/15 text-success" },
  lost:           { label: "Perdido",             cls: "bg-destructive/10 text-destructive" },
  prevented:      { label: "Evitado",             cls: "bg-muted text-muted-foreground" },
  accepted:       { label: "Aceito",              cls: "bg-destructive/10 text-destructive" },
  charge_refunded:{ label: "Reembolsado",         cls: "bg-muted text-muted-foreground" },
};
const statusMeta = (s: string | null) => STATUS[s ?? ""] ?? { label: s ?? "—", cls: "bg-muted text-muted-foreground" };

const DELIVERY: Record<string, string> = {
  pending_shipment: "Aguardando envio", shipped: "Em trânsito", in_transit: "Em trânsito", delivered: "Entregue",
  returned: "Devolvido", problem: "Problema no rastreio", waiting_customer: "Esperando cliente",
};
// Pedido sem dados: antigo demais pra Shopify liberar (falta read_all_orders) ou sem pedido.
const noOrderLabel = (r: ChargebackRow) => (r.orderSource === "sem_acesso" ? "Pedido antigo (sem acesso)" : "Sem dados do pedido");
const deliveryLabel = (r: ChargebackRow) =>
  !r.orderNumber ? noOrderLabel(r) : r.deliveryStatus ? DELIVERY[r.deliveryStatus] ?? r.deliveryStatus : "Sem rastreio";
const daysBucket = (r: ChargebackRow) =>
  r.daysToDispute == null ? "Sem data do pedido" : r.daysToDispute < 15 ? "Até 14 dias" : r.daysToDispute < 30 ? "15 a 29 dias" : r.daysToDispute < 45 ? "30 a 44 dias" : "45 dias ou mais";
const supportLabel = (r: ChargebackRow) => (!r.orderNumber ? noOrderLabel(r) : r.conversationId ? "Sim" : "Não");
const productLabel = (r: ChargebackRow) => r.product ?? noOrderLabel(r);

type Dim = "status" | "reason" | "shop" | "product" | "delivery" | "days" | "support";
const DIM_OF: Record<Dim, (r: ChargebackRow) => string> = {
  status: (r) => statusMeta(r.status).label,
  reason: (r) => reasonLabel(r.reason),
  shop: (r) => r.shopName,
  product: productLabel,
  delivery: deliveryLabel,
  days: daysBucket,
  support: supportLabel,
};
const DIM_NAME: Record<Dim, string> = {
  status: "Status", reason: "Motivo", shop: "Loja", product: "Produto", delivery: "Entrega", days: "Dias até a disputa", support: "Falou com o suporte",
};

const PERIODS = [["tudo", "Tudo"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["ano", "Este ano"]] as const;
const TYPES = [["chargeback", "Chargebacks"], ["inquiry", "Inquiries"], ["todos", "Todos"]] as const;
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const AXIS = { fill: "var(--color-muted-foreground)", fontSize: 11 };

const money = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const daysLeft = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

function ChargebacksPage() {
  const fn = useServerFn(getChargebacks);
  const [scope, setScope] = useState<"ativas" | "todas">("ativas");
  const [type, setType] = useState<(typeof TYPES)[number][0]>("chargeback");
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("tudo");
  const [filter, setFilter] = useState<{ dim: Dim; value: string } | null>(null);
  const q = useQuery({ queryKey: ["chargebacks", scope], queryFn: () => fn({ data: { scope } }) });

  // Tipo + período (os gráficos e cards usam isso); o filtro de clique vale só pra lista.
  const base = useMemo(() => {
    const rows = q.data?.rows ?? [];
    const now = new Date();
    const from = period === "30" ? new Date(now.getTime() - 30 * 86_400_000)
      : period === "90" ? new Date(now.getTime() - 90 * 86_400_000)
      : period === "ano" ? new Date(now.getFullYear(), 0, 1) : null;
    return rows.filter((r) => (type === "todos" || r.type === type) && (!from || new Date(r.initiatedAt) >= from));
  }, [q.data, type, period]);
  const list = filter ? base.filter((r) => DIM_OF[filter.dim](r) === filter.value) : base;

  const sum = (rows: ChargebackRow[]) => rows.reduce((s, r) => s + r.amount, 0);
  const waiting = base.filter((r) => r.status === "needs_response");
  const lost = base.filter((r) => r.status === "lost" || r.status === "accepted");
  const won = base.filter((r) => r.status === "won");
  const prevented = base.filter((r) => r.status === "prevented");
  const nextDue = waiting.map((r) => r.evidenceDueBy).filter(Boolean).sort()[0] ?? null;
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;

  // Evolução por mês (da 1ª disputa até hoje, meses sem disputa em zero).
  const monthly = useMemo(() => {
    if (!base.length) return [];
    const keys = base.map((r) => r.initiatedAt.slice(0, 7)).sort();
    const out: { key: string; label: string; count: number }[] = [];
    let [y, m] = keys[0].split("-").map(Number);
    const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      out.push({ key, label: `${MONTHS[m - 1]}/${String(y).slice(2)}`, count: base.filter((r) => r.initiatedAt.startsWith(key)).length });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }, [base]);

  const toggle = (dim: Dim, value: string) => setFilter(filter?.dim === dim && filter.value === value ? null : { dim, value });
  const Seg = <T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) => (
    <div className="flex items-center rounded-xl border border-border bg-card p-1 h-9 shrink-0">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`h-full px-2.5 rounded-lg text-xs font-medium transition-colors ${value === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <PageShell wide>
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Chargebacks</h1>
          {q.data && <span className="text-sm text-muted-foreground">{base.length} no filtro · {money(sum(base))}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg value={scope} options={[["ativas", "Lojas ativas"], ["todas", "Todas as lojas"]] as const} onChange={(v) => { setScope(v); setFilter(null); }} />
          <Seg value={type} options={TYPES} onChange={(v) => { setType(v); setFilter(null); }} />
          <div className="relative">
            <select value={period} onChange={(e) => { setPeriod(e.target.value as any); setFilter(null); }}
              className="h-9 pl-3 pr-8 rounded-xl border border-border bg-card text-xs font-medium outline-none focus:border-primary appearance-none cursor-pointer">
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <ChevronDown className="size-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {q.isLoading ? (
        <div className="py-24 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : q.isError ? (
        <p className="text-sm text-destructive py-10 text-center">{(q.error as any)?.message ?? "Erro ao carregar"}</p>
      ) : (
        <div className="space-y-3">
          {/* ── Cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat icon={ShieldAlert} tone="bg-primary/10 text-primary" label={type === "inquiry" ? "Inquiries" : type === "todos" ? "Disputas" : "Chargebacks"}
              value={String(base.length)} sub={money(sum(base))} />
            <Stat icon={Hourglass} tone="bg-warning/15 text-warning" label="Aguardando resposta" value={String(waiting.length)}
              sub={nextDue ? `Próximo prazo: ${fmtDate(nextDue)}` : "Nenhum prazo correndo"}
              onClick={() => toggle("status", STATUS.needs_response.label)} active={filter?.dim === "status" && filter.value === STATUS.needs_response.label} />
            <Stat icon={CircleX} tone="bg-destructive/10 text-destructive" label="Perdidos" value={String(lost.length)} sub={money(sum(lost))}
              onClick={() => toggle("status", STATUS.lost.label)} active={filter?.dim === "status" && filter.value === STATUS.lost.label} />
            <Stat icon={Trophy} tone="bg-success/15 text-success" label="Taxa de vitória" value={winRate == null ? "—" : `${winRate}%`}
              sub={`${won.length} ganhos de ${won.length + lost.length} decididos`}
              onClick={() => toggle("status", STATUS.won.label)} active={filter?.dim === "status" && filter.value === STATUS.won.label} />
            <Stat icon={ShieldCheck} tone="bg-muted text-muted-foreground" label="Evitados" value={String(prevented.length)} sub={money(sum(prevented))}
              onClick={() => toggle("status", STATUS.prevented.label)} active={filter?.dim === "status" && filter.value === STATUS.prevented.label} />
          </div>

          {/* ── Evolução | Motivo | Loja ── */}
          <div className="grid xl:grid-cols-3 gap-3">
            <Card title="Por mês">
              {!monthly.length ? <Empty /> : (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthly} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
                        contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 10, fontSize: 12 }}
                        formatter={(v: number) => [v, "Disputas"]} />
                      <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <BarListCard title="Por motivo" rows={base} dim="reason" filter={filter} onPick={toggle} />
            <BarListCard title="Por loja" rows={base} dim="shop" filter={filter} onPick={toggle} />
          </div>

          {/* ── Produto | Entrega | Dias | Suporte ── */}
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
            <BarListCard title="Por produto" rows={base} dim="product" filter={filter} onPick={toggle} limit={6} />
            <BarListCard title="Entrega na hora da disputa" rows={base} dim="delivery" filter={filter} onPick={toggle} />
            <BarListCard title="Dias da compra até a disputa" rows={base} dim="days" filter={filter} onPick={toggle}
              order={["Até 14 dias", "15 a 29 dias", "30 a 44 dias", "45 dias ou mais", "Sem data do pedido"]} />
            <BarListCard title="Falou com o suporte antes?" rows={base} dim="support" filter={filter} onPick={toggle} />
          </div>

          {/* ── Lista ── */}
          <Card title="Lista" right={filter && (
            <button onClick={() => setFilter(null)} className="h-7 pl-2.5 pr-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium flex items-center gap-1">
              {DIM_NAME[filter.dim]}: {filter.value} <X className="size-3.5" />
            </button>
          )}>
            {!list.length ? <Empty text="Nenhuma disputa nesse filtro" /> : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[980px]">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground border-b border-border text-left">
                      <th className="font-medium py-2 px-1.5">Pedido</th>
                      <th className="font-medium py-2 px-1.5">Cliente / produto</th>
                      <th className="font-medium py-2 px-1.5">Motivo</th>
                      <th className="font-medium py-2 px-1.5 text-right">Valor</th>
                      <th className="font-medium py-2 px-1.5">Status</th>
                      <th className="font-medium py-2 px-1.5">Aberto em</th>
                      <th className="font-medium py-2 px-1.5">Prazo</th>
                      <th className="font-medium py-2 px-1.5">Entrega</th>
                      <th className="font-medium py-2 px-1.5 text-center">Suporte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const st = statusMeta(r.status);
                      const left = r.status === "needs_response" ? daysLeft(r.evidenceDueBy) : null;
                      return (
                        <tr key={r.id} className="border-b border-border/60 last:border-0 align-top">
                          <td className="py-2 px-1.5">
                            <div className="font-semibold flex items-center gap-1">
                              {r.adminUrl
                                ? <a href={r.adminUrl} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{r.orderNumber ?? `#${r.orderExternalId ?? "—"}`}<ExternalLink className="size-3" /></a>
                                : (r.orderNumber ?? "—")}
                            </div>
                            <div className="text-[11px] text-muted-foreground">{r.shopName.replace(/^Loja \d+ - /, "")}{r.type === "inquiry" ? " · inquiry" : ""}</div>
                            {r.alerts.length > 0 && (
                              <div className="flex gap-1 mt-0.5">{r.alerts.map((a) => <span key={a} className="text-[9px] px-1 rounded bg-muted text-muted-foreground font-medium">{a}</span>)}</div>
                            )}
                          </td>
                          <td className="py-2 px-1.5 max-w-[240px]">
                            <div className="truncate">{r.customerName ?? r.customerEmail ?? <span className="text-muted-foreground">{noOrderLabel(r)}</span>}</div>
                            {r.product && <div className="text-[11px] text-muted-foreground truncate" title={r.product}>{r.product}</div>}
                          </td>
                          <td className="py-2 px-1.5">{reasonLabel(r.reason)}</td>
                          <td className="py-2 px-1.5 text-right tabular-nums font-medium">{money(r.amount)}</td>
                          <td className="py-2 px-1.5"><span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium whitespace-nowrap ${st.cls}`}>{st.label}</span></td>
                          <td className="py-2 px-1.5 whitespace-nowrap">
                            {fmtDate(r.initiatedAt)}
                            {r.daysToDispute != null && <div className="text-[11px] text-muted-foreground">{r.daysToDispute}d após a compra</div>}
                          </td>
                          <td className="py-2 px-1.5 whitespace-nowrap">
                            {left == null ? <span className="text-muted-foreground">—</span> : (
                              <span className={`font-medium ${left <= 2 ? "text-destructive" : left <= 5 ? "text-warning" : ""}`}>
                                {fmtDate(r.evidenceDueBy)} · {left < 0 ? "vencido" : left === 0 ? "hoje" : `${left}d`}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-1.5 max-w-[220px]">
                            <div className="flex items-center gap-1">
                              <Truck className="size-3 text-muted-foreground shrink-0" />{deliveryLabel(r)}
                            </div>
                            {r.trackingCode && (
                              r.trackingUrl
                                ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-primary hover:underline inline-flex items-center gap-1">{r.trackingCode}<ExternalLink className="size-3" /></a>
                                : <div className="text-[11px] font-mono text-muted-foreground select-all">{r.trackingCode}</div>
                            )}
                            {r.lastEvent && <div className="text-[11px] text-muted-foreground truncate" title={r.lastEvent}>{r.lastEvent}{r.lastEventAt ? ` · ${fmtDate(r.lastEventAt)}` : ""}</div>}
                          </td>
                          <td className="py-2 px-1.5 text-center">
                            {r.conversationId
                              ? <Link to="/atendimento" className="inline-grid place-items-center size-7 rounded-lg text-primary hover:bg-primary/10" title="Tem conversa no Atendimento"><Headphones className="size-4" /></Link>
                              : <span className="text-muted-foreground" title="Nunca falou com o suporte">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {base.some((r) => r.orderSource === "sem_acesso") && (
            <p className="text-[11px] text-muted-foreground px-1">
              "Pedido antigo (sem acesso)": a Shopify só libera pedidos de mais de 60 dias com a permissão <code className="px-1 rounded bg-muted">read_all_orders</code> no app da loja.
              Liberando (e reautorizando a loja), os dados aparecem sozinhos.
            </p>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3 min-h-7">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ text = "Sem disputas no período" }: { text?: string }) {
  return <p className="text-xs text-muted-foreground text-center py-10">{text}</p>;
}

function Stat({ icon: Icon, tone, label, value, sub, onClick, active }: {
  icon: typeof ShieldAlert; tone: string; label: string; value: string; sub: string; onClick?: () => void; active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} title={onClick ? (active ? "Clique para tirar o filtro" : `Mostrar na lista: ${label}`) : undefined}
      className={`rounded-2xl border bg-card p-4 flex items-center gap-3 min-w-0 text-left transition-colors ${active ? "border-primary ring-2 ring-primary/20" : "border-border"} ${onClick ? "hover:border-primary/50 cursor-pointer" : ""}`}>
      <div className={`size-10 rounded-xl grid place-items-center shrink-0 ${tone}`}><Icon className="size-[18px]" /></div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{label}</p>
        <p className="text-2xl font-bold tracking-tight leading-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
      </div>
    </Tag>
  );
}

// Barras horizontais (quantidade por categoria, uma cor só); clicar filtra a lista.
function BarListCard({ title, rows, dim, filter, onPick, limit, order }: {
  title: string; rows: ChargebackRow[]; dim: Dim; filter: { dim: Dim; value: string } | null;
  onPick: (dim: Dim, value: string) => void; limit?: number; order?: string[];
}) {
  const counts = new Map<string, { n: number; amount: number }>();
  for (const r of rows) {
    const k = DIM_OF[dim](r);
    const c = counts.get(k) ?? { n: 0, amount: 0 };
    counts.set(k, { n: c.n + 1, amount: c.amount + r.amount });
  }
  let items = [...counts.entries()].map(([label, c]) => ({ label, ...c }));
  items = order ? items.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)) : items.sort((a, b) => b.n - a.n);
  const hidden = limit && items.length > limit ? items.slice(limit) : [];
  if (hidden.length) items = [...items.slice(0, limit), { label: "Outros", n: hidden.reduce((s, x) => s + x.n, 0), amount: hidden.reduce((s, x) => s + x.amount, 0) }];
  const max = Math.max(1, ...items.map((i) => i.n));
  const total = rows.length || 1;
  return (
    <Card title={title}>
      {!items.length ? <Empty /> : (
        <div className="space-y-1">
          {items.map((i) => {
            const active = filter?.dim === dim && filter.value === i.label;
            const clickable = i.label !== "Outros";
            return (
              <button key={i.label} disabled={!clickable} onClick={() => clickable && onPick(dim, i.label)}
                title={`${i.label}: ${i.n} (${Math.round((i.n / total) * 100)}%) · ${money(i.amount)}`}
                className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${active ? "bg-primary/10" : clickable ? "hover:bg-muted" : ""}`}>
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className={`truncate ${active ? "text-primary font-medium" : ""}`}>{i.label}</span>
                  <span className="tabular-nums shrink-0"><span className="font-semibold">{i.n}</span> <span className="text-muted-foreground">· {Math.round((i.n / total) * 100)}%</span></span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(i.n / max) * 100}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

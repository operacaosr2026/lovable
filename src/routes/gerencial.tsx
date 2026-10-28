import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle, ArrowDown, ArrowUp, CalendarDays, Loader2, Package,
} from "lucide-react";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { isoTodayUS } from "@/lib/timezone";
import { getGerencial } from "@/lib/gerencial.functions";

// Gerencial: a operação do mês numa tela (contas em gerencial.functions.ts).
export const Route = createFileRoute("/gerencial")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Gerencial — SRX Growth" }] }),
  component: GerencialPage,
});

type Data = Awaited<ReturnType<typeof getGerencial>>;

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const usd = (v: number | null | undefined) => (v == null ? "—" : `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));
const mins = (m: number | null | undefined) => (m == null ? "—" : m < 60 ? `${m} min` : `${(m / 60).toFixed(1).replace(".", ",")} h`);

function lastMonths(n: number) {
  const today = isoTodayUS();
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); }
  return out;
}

const TABS = [
  ["resultado", "Resultado"], ["perdas", "Perdas"], ["entrega", "Entrega"], ["equipe", "Equipe"], ["alertas", "Alertas"],
] as const;
type Tab = (typeof TABS)[number][0];

function GerencialPage() {
  const months = useMemo(() => lastMonths(6), []);
  const [month, setMonth] = useState(months[0]);
  const [tab, setTab] = useState<Tab>("resultado");
  const fn = useServerFn(getGerencial);
  const q = useQuery({ queryKey: ["gerencial", month], queryFn: () => fn({ data: { month } }), staleTime: 5 * 60_000 });
  const d = q.data as Data | undefined;

  return (
    <PageShell>
      <PageHeader title="Gerencial" actions={
        <label className="relative">
          <CalendarDays className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select value={month} onChange={(e) => setMonth(e.target.value)}
            className="h-10 pl-8 pr-3 rounded-xl border border-border bg-card text-sm font-medium outline-none focus:border-primary capitalize">
            {months.map((m, i) => <option key={m} value={m}>{i === 0 ? `Este mês (${monthName(m)})` : monthName(m)}</option>)}
          </select>
        </label>
      } />
      {q.isLoading ? <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError || !d ? <div className="py-20 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>
        : (
          <div className="space-y-4 pb-8">
            <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-muted w-fit max-w-full overflow-x-auto">
              {TABS.map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`h-7 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${tab === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {label}
                  {k === "alertas" && d.alerts.length > 0 && (
                    <span className={`min-w-4 h-4 px-1 rounded-full text-[10px] grid place-items-center text-white ${d.alerts.some((a) => a.level === "critico") ? "bg-rose-500" : "bg-amber-500"}`}>{d.alerts.length}</span>
                  )}
                </button>
              ))}
            </div>
            {tab === "resultado" && <Resultado d={d} />}
            {tab === "perdas" && <Perdas d={d} />}
            {tab === "entrega" && <Entrega d={d} />}
            {tab === "equipe" && <Equipe d={d} />}
            {tab === "alertas" && <Alerts d={d} />}
          </div>
        )}
    </PageShell>
  );
}

// ─── Peças ────────────────────────────────────────────────────────────────────

function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-4 min-w-0 ${className}`}>
      {title && <p className="text-sm font-semibold mb-3">{title}</p>}
      {children}
    </div>
  );
}

// Subiu/caiu vs. o mês anterior. lowerIsBetter: reembolso, chargeback, tempo.
function Delta({ cur, prev, lowerIsBetter, current }: { cur: number | null | undefined; prev: number | null | undefined; lowerIsBetter?: boolean; current?: boolean }) {
  if (cur == null || !prev) return null;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (!Number.isFinite(p)) return null;
  const good = lowerIsBetter ? p <= 0 : p >= 0;
  return (
    <span title={current ? "Mês em andamento contra o mês anterior inteiro" : "Contra o mês anterior"}
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? "text-emerald-600" : "text-rose-600"}`}>
      {p <= 0 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}{Math.abs(p)}%
    </span>
  );
}

function Stat({ label, value, sub, delta, tone }: { label: string; value: string; sub?: React.ReactNode; delta?: React.ReactNode; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 min-w-0">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className={`text-xl font-semibold tracking-tight whitespace-nowrap ${tone === "bad" ? "text-rose-600" : tone === "good" ? "text-emerald-600" : ""}`}>{value}</p>
        {delta}
      </div>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full bg-primary" style={{ width: `${max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0}%` }} />
    </div>
  );
}

const th = "text-[11px] text-muted-foreground font-medium pb-2";
const Empty = ({ text = "Nada no período." }: { text?: string }) => <p className="text-xs text-muted-foreground py-3 text-center">{text}</p>;

// ─── Alertas ─────────────────────────────────────────────────────────────────

function Alerts({ d }: { d: Data }) {
  if (!d.alerts.length) {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
        Nada pedindo decisão agora.
      </div>
    );
  }
  return (
    <section>
      <div className="grid gap-2 md:grid-cols-2">
        {d.alerts.map((a, i) => (
          <Link key={i} to={a.link as any}
            className={`rounded-2xl border p-3 flex gap-3 hover:shadow-sm transition ${a.level === "critico" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
            <AlertTriangle className={`size-4 mt-0.5 shrink-0 ${a.level === "critico" ? "text-rose-600" : "text-amber-500"}`} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{a.title}</p>
              <p className="text-xs text-muted-foreground">{a.detail}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ─── Resultado do mês ────────────────────────────────────────────────────────

function Resultado({ d }: { d: Data }) {
  const a = d.resultado.atual, p = d.resultado.anterior, m = d.resultado.meta;
  const prevLabel = monthName(d.prevMonth);
  const steps = a ? [
    ["Vendas", a.faturamento, false], ["Reembolsos", a.reembolsos, true], ["Chargebacks", a.chargebacks, true],
    ["Custo dos produtos", a.custo, true], ["Anúncios", a.anuncios, true], ["Taxas Shopify", a.taxas, true],
  ] as const : [];
  return (
    <section>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        <Stat label="Vendas" value={usd(a?.faturamento)} delta={<Delta cur={a?.faturamento} prev={p?.faturamento} current={d.current} />}
          sub={<>{num(a?.pedidos)} pedidos · {prevLabel}: {usd(p?.faturamento)}</>} />
        <Stat label="Lucro" value={usd(a?.lucro)} tone={a && a.lucro < 0 ? "bad" : undefined} delta={<Delta cur={a?.lucro} prev={p?.lucro} current={d.current} />}
          sub={<>{prevLabel}: {usd(p?.lucro)}</>} />
        <Stat label="Margem" value={pct(a?.margem)} sub={<>lucro ÷ vendas · {prevLabel}: {pct(p?.margem)}</>} />
        <Stat label="Meta" value={m ? pct(m.realizado != null && m.meta ? m.realizado / m.meta : null, 0) : "Sem meta"}
          tone={m?.status === "batida" ? "good" : m?.status === "nao_batida" ? "bad" : undefined}
          sub={m ? <>{usd(m.realizado)} de {usd(m.meta)}{m.projecao != null && <> · projeção {usd(m.projecao)}</>}</> : <Link to="/metas" className="text-primary">definir em Metas</Link>} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Conta do lucro">
          {!a ? <Empty /> : (
            <div className="space-y-1.5 text-xs">
              {steps.map(([label, v, minus]) => (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{minus ? "− " : ""}{label}</span>
                  <span className="font-medium whitespace-nowrap">{usd(v)}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-border pt-1.5 text-sm">
                <span className="font-semibold">= Lucro</span>
                <span className={`font-semibold ${a.lucro < 0 ? "text-rose-600" : ""}`}>{usd(a.lucro)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">Anúncio por pedido: {usd(a.cpa)}. Mesma conta de Metas e Dashboard (reembolso pela data em que foi feito).</p>
            </div>
          )}
        </Card>
        <Card title="Por grupo">
          {!d.resultado.byGroup.length ? <Empty text="Nenhum grupo ativo." /> : (
            <table className="w-full text-xs">
              <thead><tr><th className={`${th} text-left`}>Grupo</th><th className={`${th} text-right`}>Vendas</th><th className={`${th} text-right`}>Lucro</th><th className={`${th} text-right`}>Margem</th></tr></thead>
              <tbody>
                {d.resultado.byGroup.map((g) => (
                  <tr key={g.id} className="border-t border-border">
                    <td className="py-2 pr-2">
                      <Link to="/shops/lojas-grupos/$cardId" params={{ cardId: g.id }} search={{ tab: "dashboard" as const }} className="font-medium hover:text-primary">{g.name}</Link>
                      <p className="text-[11px] text-muted-foreground">{g.shops} loja{g.shops === 1 ? "" : "s"} · {num(g.pedidos)} pedidos</p>
                    </td>
                    <td className="text-right whitespace-nowrap">{usd(g.faturamento)}</td>
                    <td className={`text-right whitespace-nowrap font-semibold ${g.lucro < 0 ? "text-rose-600" : ""}`}>{usd(g.lucro)}</td>
                    <td className="text-right">{pct(g.margem)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </section>
  );
}

// ─── Quanto se perde depois da venda ─────────────────────────────────────────

function Perdas({ d }: { d: Data }) {
  const x = d.perdas;
  const prevLabel = monthName(d.prevMonth);
  const maxReason = Math.max(0, ...x.topMotivos.map((r) => r.amount));
  return (
    <section>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        <Stat label="Total perdido" value={usd(x.total)} delta={<Delta cur={x.total} prev={x.totalPrev} lowerIsBetter current={d.current} />}
          sub={<>{pct(x.faturamento ? x.total / x.faturamento : null)} das vendas · reembolsos + chargebacks perdidos + taxas</>} />
        <Stat label="Reembolsos" value={usd(x.reembolsos.valor)} delta={<Delta cur={x.reembolsos.taxa} prev={x.reembolsosPrev.taxa} lowerIsBetter current={d.current} />}
          sub={<>{x.reembolsos.pedidos} pedidos · {pct(x.reembolsos.taxa)} dos vendidos · {prevLabel}: {pct(x.reembolsosPrev.taxa)}</>} />
        <Stat label="Chargebacks abertos no mês" value={num(x.chargebacks.abertos)} delta={<Delta cur={x.chargebacks.abertos} prev={x.chargebacksPrev.abertos} lowerIsBetter current={d.current} />}
          sub={<>{x.chargebacks.perdidos} perdidos ({usd(x.chargebacks.valorPerdido)}) · {x.chargebacks.ganhos} ganhos · {x.chargebacks.emAndamento} em andamento</>} />
        <Stat label="Evitados" value={num(x.chargebacks.evitados + x.disputifier.count)}
          sub={<>{x.disputifier.count} pelo Disputifier ({usd(x.disputifier.valor)} devolvidos) · taxas Shopify {usd(x.taxas)}</>} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Motivos que mais custam">
          {!x.topMotivos.length ? <Empty /> : x.topMotivos.map((r) => (
            <div key={r.key} className="py-1.5 text-xs">
              <div className="flex items-center gap-3 mb-1">
                <span className="truncate flex-1 min-w-0">{r.label}</span>
                <span className="font-semibold whitespace-nowrap">{usd(r.amount)}</span>
                <span className="w-8 text-right text-muted-foreground">{r.count}</span>
              </div>
              <Bar value={r.amount} max={maxReason} />
            </div>
          ))}
        </Card>
        <Card title="Produtos que mais custam">
          {!x.topProdutos.length ? <Empty /> : (
            <table className="w-full text-xs">
              <thead><tr><th className={`${th} text-left`}>Produto</th><th className={`${th} text-right`}>Reembolsado</th><th className={`${th} text-right`}>Unid.</th><th className={`${th} text-right`}>Taxa</th></tr></thead>
              <tbody>
                {x.topProdutos.map((p) => (
                  <tr key={p.name} className="border-t border-border">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {p.image ? <img src={p.image} alt="" className="size-7 rounded-md object-cover shrink-0" /> : <span className="size-7 rounded-md bg-muted grid place-items-center shrink-0"><Package className="size-3.5 text-muted-foreground" /></span>}
                        <span className="truncate max-w-[200px]" title={p.name}>{p.name}</span>
                      </div>
                    </td>
                    <td className="text-right whitespace-nowrap font-semibold">{usd(p.amount)}</td>
                    <td className="text-right whitespace-nowrap">{p.units}/{p.sold}</td>
                    <td className="text-right">{pct(p.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">Reembolsos pela data do pedido (pedidos vendidos no mês e todos os reembolsos deles), igual à Análise de reembolsos. Chargebacks pela data em que abriram.</p>
    </section>
  );
}

// ─── Fornecedor e entrega ────────────────────────────────────────────────────

function Entrega({ d }: { d: Data }) {
  const e = d.entrega;
  return (
    <section>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Da compra à entrega" value={e.diasMedios == null ? "—" : `${e.diasMedios.toFixed(0)} dias`} sub={<>média dos entregues · {pct(e.ate20dias, 0)} em até 20 dias</>} />
        <Stat label="Entregues" value={`${num(e.entregues)} de ${num(e.pedidos)}`} sub={<>{num(e.emTransito)} a caminho · {num(e.semEnvio)} sem envio</>} />
        <Stat label="Precisando de atenção" value={num(e.atencao)} tone={e.atencao ? "bad" : undefined} sub={<>parados, atrasados ou com problema</>} />
        <Stat label="Com problema" value={num(e.problema)} sub={<>problema na entrega ou devolvido</>} />
      </div>
    </section>
  );
}

// ─── Equipe ──────────────────────────────────────────────────────────────────

function Equipe({ d }: { d: Data }) {
  const at = d.equipe.atendimento;
  return (
    <section>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat label="Conversas no Atendimento" value={num(at?.conversas)} delta={<Delta cur={at?.conversas} prev={at?.conversasPrev} lowerIsBetter />}
          sub={<>{at?.contatosPor100 != null ? `${String(at.contatosPor100).replace(".", ",")} por 100 pedidos · ` : ""}{num(at?.emAberto)} em aberto</>} />
        <Stat label="1ª resposta" value={mins(at?.primeiraRespostaMin)} delta={<Delta cur={at?.primeiraRespostaMin} prev={at?.primeiraRespostaPrevMin} lowerIsBetter />}
          tone={at && at.primeiraRespostaMin != null && at.primeiraRespostaMin > at.metaPrimeiraRespostaMin ? "bad" : undefined}
          sub={<>meta {mins(at?.metaPrimeiraRespostaMin)} · horário comercial</>} />
        <Stat label="Resolução" value={mins(at?.resolucaoMin)} tone={at && at.resolucaoMin != null && at.resolucaoMin > at.metaResolucaoMin ? "bad" : undefined}
          sub={<>meta {mins(at?.metaResolucaoMin)} · {pct(at?.taxaResolucao == null ? null : at.taxaResolucao / 100, 0)} resolvidas</>} />
        <Stat label="Aprovação de reembolso" value={d.equipe.aprovacaoHoras == null ? "—" : `${d.equipe.aprovacaoHoras.toFixed(1).replace(".", ",")} h`} sub={<>do pedido à decisão, em média</>} />
      </div>
    </section>
  );
}

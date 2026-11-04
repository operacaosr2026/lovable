import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { AlertTriangle, ArrowDown, ArrowUp, Boxes, CalendarDays, Clock, Info, Loader2, RefreshCw, TrendingUp, Truck } from "lucide-react";
import { getCarrierStats, type CarrierRow, type CarrierTotals } from "@/lib/carriers.functions";

// Gerencial › Transportadoras: prazo e alfândega de cada transportadora (conta
// em carriers.functions.ts). Período pela data do pedido — o filtro fica no
// canto do Gerencial, como o mês das outras abas. Cards do topo comparam com o
// período anterior do mesmo tamanho (em "Tudo" não tem comparação).

export const CARRIER_PERIODS: [string, string, number | null][] = [
  ["30", "Últimos 30 dias", 30], ["90", "Últimos 90 dias", 90], ["180", "Últimos 180 dias", 180], ["all", "Tudo", null],
];
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const monthShort = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const dec = (v: number) => v.toFixed(1).replace(".", ",").replace(/,0$/, "");
const dias = (v: number | null) => (v == null ? "–" : `${dec(v)} dias`);
const int = (n: number) => n.toLocaleString("pt-BR");
const rateOf = (a: number, b: number) => (b ? a / b : null);
const pct = (v: number | null) => (v == null ? "–" : `${dec(v * 100)}%`);
const AXIS = { fill: "var(--color-muted-foreground)", fontSize: 11 };

// Cor de cada transportadora (selo da tabela e linha do gráfico).
const CARRIER_COLOR: Record<string, { hex: string; badge: string; short: string }> = {
  ZS: { hex: "#10b981", badge: "bg-emerald-500/10 text-emerald-600", short: "ZS" },
  TRF: { hex: "#3b82f6", badge: "bg-blue-500/10 text-blue-600", short: "TRF" },
  JCZ: { hex: "#8b5cf6", badge: "bg-violet-500/10 text-violet-600", short: "JC" },
  JXCZ: { hex: "#f97316", badge: "bg-orange-500/10 text-orange-600", short: "SH" },
  LZ: { hex: "#d946ef", badge: "bg-fuchsia-500/10 text-fuchsia-600", short: "LZ" },
  YTTG: { hex: "#0ea5e9", badge: "bg-sky-500/10 text-sky-600", short: "YT" },
  OUTRAS: { hex: "#94a3b8", badge: "bg-muted text-muted-foreground", short: "?" },
};
const colorOf = (key: string) => CARRIER_COLOR[key] ?? CARRIER_COLOR.OUTRAS;

function alfTone(rate: number | null) {
  if (rate == null) return { text: "text-muted-foreground", bar: "bg-muted-foreground/40" };
  return rate >= 0.05 ? { text: "text-rose-600", bar: "bg-rose-500" }
    : rate >= 0.02 ? { text: "text-amber-600", bar: "bg-amber-500" }
    : { text: "text-emerald-600", bar: "bg-emerald-500" };
}

// Seta do card: % (contagens e dias) ou p.p. (alfândega). lowerIsBetter: prazo/problema.
function Delta({ cur, prev, lowerIsBetter, pp }: { cur: number | null; prev: number | null | undefined; lowerIsBetter?: boolean; pp?: boolean }) {
  if (cur == null || prev == null) return null;
  const diff = pp ? (cur - prev) * 100 : prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
  if (diff == null || !Number.isFinite(diff)) return null;
  const good = lowerIsBetter ? diff <= 0 : diff >= 0;
  const txt = pp ? `${dec(Math.abs(diff))} p.p.` : `${Math.round(Math.abs(diff))}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? "text-emerald-600" : "text-rose-600"}`}>
      {diff <= 0 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}{txt}
    </span>
  );
}

function Kpi({ icon: Icon, tone, label, value, delta }: { icon: any; tone: string; label: string; value: string; delta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 sm:p-4 flex items-center gap-3 min-w-0">
      <span className={`size-10 sm:size-11 shrink-0 rounded-xl grid place-items-center ${tone}`}><Icon className="size-5" /></span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground truncate">{label}</p>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-lg sm:text-xl font-bold tabular-nums whitespace-nowrap">{value}</span>
          {delta}
        </div>
      </div>
    </div>
  );
}

function Kpis({ t, p }: { t: CarrierTotals; p: CarrierTotals | null }) {
  const alf = rateOf(t.alfProblema, t.alfPassou), alfPrev = p ? rateOf(p.alfProblema, p.alfPassou) : null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <Kpi icon={Truck} tone="bg-violet-500/10 text-violet-600" label="Pedidos" value={int(t.pedidos)} delta={<Delta cur={t.pedidos} prev={p?.pedidos} />} />
      <Kpi icon={Boxes} tone="bg-blue-500/10 text-blue-600" label="Entregues" value={int(t.entregues)} delta={<Delta cur={t.entregues} prev={p?.entregues} />} />
      <Kpi icon={RefreshCw} tone="bg-rose-500/10 text-rose-600" label="Em trânsito" value={int(t.emTransito)} delta={<Delta cur={t.emTransito} prev={p?.emTransito} lowerIsBetter />} />
      <Kpi icon={Clock} tone="bg-violet-500/10 text-violet-600" label="Postagem → EUA" value={dias(t.postagemEua)} delta={<Delta cur={t.postagemEua} prev={p?.postagemEua} lowerIsBetter />} />
      <Kpi icon={Truck} tone="bg-violet-500/10 text-violet-600" label="Postagem → entrega" value={dias(t.postagemEntrega)} delta={<Delta cur={t.postagemEntrega} prev={p?.postagemEntrega} lowerIsBetter />} />
      <Kpi icon={AlertTriangle} tone="bg-rose-500/10 text-rose-600" label="Problema na alfândega" value={pct(alf)} delta={<Delta cur={alf} prev={alfPrev} lowerIsBetter pp />} />
    </div>
  );
}

function CarrierName({ r, tags }: { r: CarrierRow; tags: { label: string; cls: string }[] }) {
  const c = colorOf(r.key);
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className={`size-8 shrink-0 rounded-lg grid place-items-center text-[10px] font-bold ${c.badge}`}>{c.short}</span>
      <span className="font-medium whitespace-nowrap">{r.label}</span>
      {tags.map((t) => <span key={t.label} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${t.cls}`}>{t.label}</span>)}
    </div>
  );
}

const Sub = ({ children, tone = "text-muted-foreground" }: { children: React.ReactNode; tone?: string }) => <span className={`block text-[10px] font-normal ${tone}`}>{children}</span>;

function LineTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-popover border border-border px-3 py-2 shadow-lg text-xs space-y-0.5">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.filter((x: any) => x.value != null).map((x: any) => (
        <p key={x.dataKey} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: x.color }} />{x.name}: <b>{dec(x.value)} dias</b>
        </p>
      ))}
    </div>
  );
}

export function CarriersView({ period }: { period: string }) {
  const days = CARRIER_PERIODS.find(([k]) => k === period)?.[2] ?? null;
  const fn = useServerFn(getCarrierStats);
  const q = useQuery({ queryKey: ["carrier-stats-v3", days], queryFn: () => fn({ data: { days } }), staleTime: 60_000 });
  const d = q.data;

  // Tags: só entre as com amostra (10+ entregues / 10+ que passaram pela
  // alfândega). Empate em problemas: fica a com mais pacotes.
  const tags = new Map<string, { label: string; cls: string }[]>();
  const tag = (key: string | undefined, label: string, cls: string) => {
    if (!key) return;
    tags.set(key, [...(tags.get(key) ?? []), { label, cls }]);
  };
  const GOOD = "bg-emerald-500/10 text-emerald-600", BAD = "bg-rose-500/10 text-rose-600";
  const bySpeed = (d?.rows ?? []).filter((r) => r.nEntrega >= 10 && r.postagemEntrega != null)
    .sort((a, b) => (a.postagemEntrega ?? 0) - (b.postagemEntrega ?? 0));
  if (bySpeed.length >= 2) {
    tag(bySpeed[0].key, "Mais rápida", GOOD);
    tag(bySpeed[bySpeed.length - 1].key, "Mais lenta", BAD);
  }
  const rate = (r: CarrierRow) => r.alfProblema / r.alfPassou;
  const byCustoms = (d?.rows ?? []).filter((r) => r.alfPassou >= 10);
  if (byCustoms.length >= 2) {
    const most = [...byCustoms].sort((a, b) => rate(b) - rate(a) || b.alfPassou - a.alfPassou)[0];
    const least = [...byCustoms].sort((a, b) => rate(a) - rate(b) || b.alfPassou - a.alfPassou)[0];
    if (rate(most) > rate(least)) {
      tag(most.key, "Mais problemas", BAD);
      tag(least.key, "Menos problemas", GOOD);
    }
  }
  const semRastreio = d?.rows.reduce((s, r) => s + (r.pedidos - r.comRastreio), 0) ?? 0;
  const withDeliveries = (d?.rows ?? []).filter((r) => r.nEntrega > 0);
  const chartData = (d?.months ?? []).map((m, i) => ({
    label: monthShort(m),
    ...Object.fromEntries(withDeliveries.map((r) => [r.key, r.porMes[i]?.dias ?? null])),
  }));

  if (q.isLoading) return <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !d) return <div className="py-20 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>;

  return (
    <div className="space-y-4">
      {d.semRegra > 0 && (
        <Link to="/settings/rastreamento" search={{ tab: "textos", filtro: "sem_regra" }}
          className="flex items-center gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm hover:bg-rose-500/10 transition-colors">
          <AlertTriangle className="size-4 text-rose-600 shrink-0" />
          <span className="min-w-0"><b>{d.semRegra} texto{d.semRegra > 1 ? "s" : ""} do rastreio sem fase.</b> Nenhuma regra reconhece — os números podem sair errados até você escolher a fase.</span>
          <span className="ml-auto shrink-0 text-xs font-semibold text-rose-600 whitespace-nowrap">Classificar →</span>
        </Link>
      )}
      {d.totals && <Kpis t={d.totals} p={d.prevTotals} />}

      <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-5 min-w-0">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="size-8 rounded-xl grid place-items-center bg-primary/10 text-primary"><Truck className="size-4" /></span>
          <p className="text-base font-semibold">Transportadoras</p>
        </div>
        {!d.rows.length ? <p className="text-xs text-muted-foreground py-3 text-center">Nenhum pedido com rastreio no período.</p> : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-[11px] text-muted-foreground bg-muted/60">
                  <th className="py-2.5 px-3 font-medium text-left rounded-l-xl">Transportadora</th>
                  <th className="py-2.5 px-3 font-medium text-center">Pedidos</th>
                  <th className="py-2.5 px-3 font-medium text-center">Entregues</th>
                  <th className="py-2.5 px-3 font-medium text-center">Em trânsito</th>
                  <th className="py-2.5 px-3 font-medium text-center">Postagem → EUA</th>
                  <th className="py-2.5 px-3 font-medium text-center">Postagem → entrega</th>
                  <th className="py-2.5 px-3 font-medium text-left rounded-r-xl w-48">Problema na alfândega</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => {
                  const alf = rateOf(r.alfProblema, r.alfPassou), tone = alfTone(alf);
                  return (
                    <tr key={r.key} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 px-3"><CarrierName r={r} tags={tags.get(r.key) ?? []} /></td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold">
                        {int(r.pedidos)}
                        {r.pedidos > r.comRastreio && <Sub>{r.pedidos - r.comRastreio} sem rastreio</Sub>}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold">{int(r.entregues)}</td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold">
                        {int(r.emTransito)}
                        {r.atrasados > 0 && <Sub tone="text-rose-600">{r.atrasados} atrasado{r.atrasados > 1 ? "s" : ""}</Sub>}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold whitespace-nowrap" title={`${r.nEua} pedidos com o evento de chegada`}>
                        {dias(r.postagemEua)}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold whitespace-nowrap" title={r.medianaEntrega != null ? `Mediana: ${dias(r.medianaEntrega)} · ${r.nEntrega} entregues` : undefined}>
                        {dias(r.postagemEntrega)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">
                        {r.alfPassou ? (
                          <>
                            <span className={`font-semibold ${tone.text}`}>{pct(alf)}</span>
                            <span className="ml-1 text-[11px] text-muted-foreground">({r.alfProblema} de {r.alfPassou})</span>
                            {r.alfParado > 0 && <span className="ml-1.5 text-[10px] font-semibold text-rose-600">{r.alfParado} parado{r.alfParado > 1 ? "s" : ""} agora</span>}
                            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${alf ? Math.max(4, Math.min(100, alf * 200)) : 4}%` }} />
                            </div>
                          </>
                        ) : <span className="text-muted-foreground">–</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {d.months.length > 0 && withDeliveries.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-5 min-w-0">
            <div className="flex items-start gap-2.5 mb-4">
              <span className="size-8 shrink-0 rounded-xl grid place-items-center bg-primary/10 text-primary"><TrendingUp className="size-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Postagem → entrega <span className="font-normal text-muted-foreground">(média de dias)</span></p>
                <p className="text-[11px] text-muted-foreground">Evolução do tempo médio de entrega por transportadora</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="h-56 flex-1 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} domain={["dataMin - 2", "dataMax + 2"]} />
                    <Tooltip content={<LineTip />} cursor={{ stroke: "var(--color-border)" }} />
                    {withDeliveries.map((r) => (
                      <Line key={r.key} type="monotone" dataKey={r.key} name={r.label} stroke={colorOf(r.key).hex} strokeWidth={2.5}
                        dot={{ r: 3.5, strokeWidth: 2, fill: "var(--color-card)" }} activeDot={{ r: 5 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex sm:flex-col flex-wrap gap-x-4 gap-y-2 sm:justify-center sm:w-32 shrink-0">
                {withDeliveries.map((r) => (
                  <span key={r.key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                    <span className="size-2.5 rounded-full" style={{ background: colorOf(r.key).hex }} />{r.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-5 min-w-0">
            <div className="flex items-start gap-2.5 mb-4">
              <span className="size-8 shrink-0 rounded-xl grid place-items-center bg-primary/10 text-primary"><CalendarDays className="size-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Postagem → entrega por mês do pedido</p>
                <p className="text-[11px] text-muted-foreground">Média em dias dos entregues. O mês mais recente ainda tem poucos entregues.</p>
              </div>
            </div>
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="w-full text-sm" style={{ minWidth: 180 + d.months.length * 90 }}>
                <thead>
                  <tr className="text-[11px] text-muted-foreground bg-muted/60">
                    <th className="py-2.5 px-3 font-medium text-left rounded-l-xl">Transportadora</th>
                    {d.months.map((m, i) => <th key={m} className={`py-2.5 px-3 font-medium text-right ${i === d.months.length - 1 ? "rounded-r-xl" : ""}`}>{monthShort(m)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {withDeliveries.map((r) => (
                    <tr key={r.key} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <span className={`size-7 shrink-0 rounded-lg grid place-items-center text-[9px] font-bold ${colorOf(r.key).badge}`}>{colorOf(r.key).short}</span>
                          <span className="font-medium whitespace-nowrap">{r.label}</span>
                        </div>
                      </td>
                      {r.porMes.map((p) => (
                        <td key={p.month} className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          {p.dias == null ? <span className="text-muted-foreground">–</span>
                            : <><span className="font-semibold">{p.dias.toFixed(1).replace(".", ",")}</span><Sub>{p.n} entregue{p.n > 1 ? "s" : ""}</Sub></>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 text-[11px] text-muted-foreground">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        <p>
          Pedidos das lojas da coluna Ativas do Banco de Lojas, pela data do pedido{days ? "; as setas comparam com o período anterior do mesmo tamanho" : ""}. Postagem = 1º evento físico do rastreio (aviso de informação não conta). Chegada nos EUA = 1º evento de chegada no aeroporto/hub de destino ou na alfândega dos EUA (agência de entrega não conta).
          Problema na alfândega = ficou mais de 5 dias na alfândega dos EUA (entrada até a liberação ou o 1º movimento depois dela), sobre os que entraram nela; continua contando depois que o pacote anda. "Parado agora" = entrou há mais de 5 dias e ainda não saiu.
          {semRastreio > 0 && <> {semRastreio} pedido{semRastreio > 1 ? "s" : ""} com código mas sem eventos no rastreio não entram nos prazos.</>}
          {d.semCodigo > 0 && <> {d.semCodigo} pedido{d.semCodigo > 1 ? "s" : ""} sem código de rastreio ficam de fora.</>}
        </p>
      </div>
    </div>
  );
}

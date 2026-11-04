import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Info, Loader2, Truck } from "lucide-react";
import { getCarrierStats, type CarrierRow } from "@/lib/carriers.functions";

// Gerencial › Transportadoras: prazo e alfândega de cada transportadora (conta
// em carriers.functions.ts). Período pela data do pedido.

const PERIODS: [string, string, number | null][] = [
  ["30", "Últimos 30 dias", 30], ["90", "Últimos 90 dias", 90], ["180", "Últimos 180 dias", 180], ["all", "Tudo", null],
];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthShort = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const dias = (v: number | null) => (v == null ? "–" : `${v.toFixed(1).replace(".", ",").replace(",0", "")} dias`);
const pctOf = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace(".", ",").replace(",0", "")}%` : "–");

function alfTone(r: CarrierRow) {
  if (!r.alfPassou) return "text-muted-foreground";
  const p = r.alfProblema / r.alfPassou;
  return p >= 0.05 ? "text-rose-600 font-semibold" : p >= 0.02 ? "text-amber-600 font-semibold" : "text-emerald-600";
}

export function CarriersView() {
  const [period, setPeriod] = useState("all");
  const days = PERIODS.find(([k]) => k === period)?.[2] ?? null;
  const fn = useServerFn(getCarrierStats);
  const q = useQuery({ queryKey: ["carrier-stats", days], queryFn: () => fn({ data: { days } }), staleTime: 10 * 60_000 });
  const d = q.data;

  // Mais rápida até a entrega (com pelo menos 10 entregas) fica em destaque.
  const fastest = d?.rows.filter((r) => r.nEntrega >= 10 && r.postagemEntrega != null)
    .sort((a, b) => (a.postagemEntrega ?? 0) - (b.postagemEntrega ?? 0))[0]?.key;
  const semRastreio = d?.rows.reduce((s, r) => s + (r.pedidos - r.comRastreio), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative w-full sm:w-auto">
          <CalendarDays className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="w-full sm:w-auto h-9 sm:h-10 pl-8 pr-3 rounded-xl border border-border bg-card text-sm font-medium outline-none focus:border-primary">
            {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <p className="text-[11px] text-muted-foreground">Pedidos das lojas ativas, pela data do pedido.</p>
      </div>

      {q.isLoading ? <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError || !d ? <div className="py-20 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>
        : (
          <>
            <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-5 min-w-0">
              <div className="flex items-center gap-2.5 mb-4">
                <span className="size-8 rounded-xl grid place-items-center bg-primary/10 text-primary"><Truck className="size-4" /></span>
                <p className="text-sm font-semibold">Transportadoras</p>
              </div>
              {!d.rows.length ? <p className="text-xs text-muted-foreground py-3 text-center">Nenhum pedido com rastreio no período.</p> : (
                <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="text-[11px] text-muted-foreground text-left border-b border-border">
                        <th className="py-2 pr-3 font-medium">Transportadora</th>
                        <th className="py-2 pr-3 font-medium text-right">Pedidos</th>
                        <th className="py-2 pr-3 font-medium text-right">Entregues</th>
                        <th className="py-2 pr-3 font-medium text-right">Em trânsito</th>
                        <th className="py-2 pr-3 font-medium text-right">Postagem → EUA</th>
                        <th className="py-2 pr-3 font-medium text-right">Postagem → entrega</th>
                        <th className="py-2 font-medium text-right">Problema na alfândega</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.key} className="border-b border-border/60 last:border-0">
                          <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
                            {r.label}
                            {r.key === fastest && <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">mais rápida</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums" title={r.pedidos > r.comRastreio ? `${r.pedidos - r.comRastreio} sem eventos no rastreio` : undefined}>
                            {r.pedidos.toLocaleString("pt-BR")}
                            {r.pedidos > r.comRastreio && <span className="block text-[10px] text-muted-foreground">{r.pedidos - r.comRastreio} sem rastreio</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{r.entregues.toLocaleString("pt-BR")}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {r.emTransito.toLocaleString("pt-BR")}
                            {r.atrasados > 0 && <span className="block text-[10px] text-rose-600" title="25+ dias desde o pedido sem entregar">{r.atrasados} atrasado{r.atrasados > 1 ? "s" : ""}</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap" title={`${r.nEua} pedidos com o evento de chegada`}>
                            {dias(r.postagemEua)}
                            {r.nEua > 0 && r.nEua < 10 && <span className="block text-[10px] text-muted-foreground">só {r.nEua}</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap" title={r.medianaEntrega != null ? `Mediana: ${dias(r.medianaEntrega)} · ${r.nEntrega} entregues` : undefined}>
                            {dias(r.postagemEntrega)}
                            {r.nEntrega > 0 && r.nEntrega < 10 && <span className="block text-[10px] text-muted-foreground">só {r.nEntrega}</span>}
                          </td>
                          <td className={`py-2.5 text-right tabular-nums whitespace-nowrap ${alfTone(r)}`}>
                            {r.alfPassou ? <>{pctOf(r.alfProblema, r.alfPassou)} <span className="text-[11px] font-normal text-muted-foreground">({r.alfProblema} de {r.alfPassou})</span></> : "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {d.months.length > 0 && (
              <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-5 min-w-0">
                <p className="text-sm font-semibold mb-1">Postagem → entrega por mês do pedido</p>
                <p className="text-[11px] text-muted-foreground mb-4">Média em dias dos entregues. O mês mais recente ainda tem poucos entregues (os mais rápidos).</p>
                <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                  <table className="w-full text-sm" style={{ minWidth: 160 + d.months.length * 90 }}>
                    <thead>
                      <tr className="text-[11px] text-muted-foreground text-left border-b border-border">
                        <th className="py-2 pr-3 font-medium">Transportadora</th>
                        {d.months.map((m) => <th key={m} className="py-2 pr-3 font-medium text-right capitalize">{monthShort(m)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.filter((r) => r.nEntrega > 0).map((r) => (
                        <tr key={r.key} className="border-b border-border/60 last:border-0">
                          <td className="py-2.5 pr-3 font-medium whitespace-nowrap">{r.label}</td>
                          {r.porMes.map((p) => (
                            <td key={p.month} className="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap">
                              {p.dias == null ? <span className="text-muted-foreground">–</span> : <>{p.dias.toFixed(1).replace(".", ",")}<span className="block text-[10px] text-muted-foreground">{p.n} entregue{p.n > 1 ? "s" : ""}</span></>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex gap-2 text-[11px] text-muted-foreground">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <p>
                Postagem = 1º evento real do rastreio (sem o "informação recebida"). Chegada nos EUA = 1º evento de chegada no destino.
                Problema na alfândega = mais de 3 dias entre entrar e sair da alfândega (ou parado lá há mais de 3 dias sem entregar), sobre os que passaram por ela.
                {semRastreio > 0 && <> {semRastreio} pedido{semRastreio > 1 ? "s" : ""} com código mas sem eventos no rastreio não entram nos prazos.</>}
                {d.semCodigo > 0 && <> {d.semCodigo} pedido{d.semCodigo > 1 ? "s" : ""} sem código de rastreio ficam de fora.</>}
              </p>
            </div>
          </>
        )}
    </div>
  );
}

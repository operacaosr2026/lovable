import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, MapPin, Search, X } from "lucide-react";
import { getLocalTracking } from "@/lib/carriers.functions";
import { localCarrierLabel, localNumberDisplay } from "@/lib/local-carriers";
import { formatDateTimeUS } from "@/lib/timezone";
import { colorOf } from "./carrier-colors";

// Gerencial › Transportadoras › Rastreamento local: quem faz a última milha nos
// EUA (regras em local-carriers.ts) e o código dela quando o 17track manda
// (USPS; YunTu repassa pra Transfly) ou do site da GOFO. Resumo por transportadora local + lista
// dos pedidos (clicar numa linha filtra a lista).

const dec = (v: number) => v.toFixed(1).replace(".", ",").replace(/,0$/, "");
const dias = (v: number | null) => (v == null ? "–" : `${dec(v)} dias`);
const int = (n: number) => n.toLocaleString("pt-BR");
const pct = (v: number) => `${dec(v * 100)}%`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const nyDateTime = (iso: string) => formatDateTimeUS(iso, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const Sub = ({ children, tone = "text-muted-foreground" }: { children: React.ReactNode; tone?: string }) => <span className={`block text-[10px] font-normal ${tone}`}>{children}</span>;

const LOCAL_TONE: Record<string, string> = {
  USPS: "bg-blue-500/10 text-blue-600", GOFO: "bg-emerald-500/10 text-emerald-600",
  SEM_NOME: "bg-amber-500/10 text-amber-600", NAO_RECONHECIDA: "bg-rose-500/10 text-rose-600", AGUARDANDO: "bg-muted text-muted-foreground",
};
const STATUS_TABS = [["aberto", "Em aberto"], ["parado", "Parados"], ["entregue", "Entregues"], ["todos", "Todos"]] as const;
type StatusTab = (typeof STATUS_TABS)[number][0];
const PAGE = 50;
// "Dias no local" conta desde que entrou na transportadora; o parado conta do
// último evento (#L3-1116: 12 dias na USPS, parado há 7).
const stoppedText = (lastAt: string | null) => {
  if (!lastAt) return "parado";
  const d = Math.floor((Date.now() - Date.parse(lastAt)) / 86_400_000);
  return `parado há ${d} dia${d === 1 ? "" : "s"}`;
};

function LocalBadge({ k }: { k: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${LOCAL_TONE[k] ?? LOCAL_TONE.AGUARDANDO}`}>{localCarrierLabel(k)}</span>;
}
function OriginBadge({ k, label }: { k: string; label: string }) {
  const c = colorOf(k);
  return <span className={`inline-grid place-items-center size-6 rounded-md text-[9px] font-bold shrink-0 ${c.badge}`} title={label}>{c.short}</span>;
}

export function LocalTrackingCard({ days }: { days: number | null }) {
  const fn = useServerFn(getLocalTracking);
  const q = useQuery({ queryKey: ["local-tracking-v8", days], queryFn: () => fn({ data: { days } }), staleTime: 60_000 });
  const [local, setLocal] = useState<string | null>(null);
  const [tab, setTab] = useState<StatusTab>("aberto");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const d = q.data;

  const inTab = (status: string, t: StatusTab) => t === "todos" || (t === "aberto" ? status !== "entregue" : status === t);
  const list = useMemo(() => {
    const s = search.trim().toUpperCase();
    return (d?.orders ?? []).filter((o) => (!local || o.local === local) && inTab(o.status, tab)
      && (!s || o.order_number.toUpperCase().includes(s) || o.tracking_code.includes(s) || (o.local_number ?? "").includes(s)));
  }, [d, local, tab, search]);
  const count = (t: StatusTab) => (d?.orders ?? []).filter((o) => (!local || o.local === local) && inTab(o.status, t)).length;
  const copy = (v: string) => { navigator.clipboard.writeText(v); toast.success("Código copiado"); };

  return (
    <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-4 sm:p-5 min-w-0">
      <div className="flex items-start gap-2.5 mb-4">
        <span className="size-8 shrink-0 rounded-xl grid place-items-center bg-primary/10 text-primary"><MapPin className="size-4" /></span>
        <div className="min-w-0">
          <p className="text-base font-semibold">Rastreamento local</p>
          <p className="text-[11px] text-muted-foreground">Quem entrega nos EUA depois da alfândega, reconhecido pelos eventos do rastreio. Clique numa linha pra ver os pedidos dela.</p>
        </div>
      </div>
      {q.isLoading ? <div className="py-10 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError || !d ? <p className="py-6 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</p>
        : !d.rows.length ? <p className="text-xs text-muted-foreground py-3 text-center">Nenhum pacote chegou à transportadora local no período.</p> : (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-[11px] text-muted-foreground bg-muted/60">
                  <th className="py-2.5 px-3 font-medium text-left rounded-l-xl">Transportadora local</th>
                  <th className="py-2.5 px-3 font-medium text-center">Pacotes</th>
                  <th className="py-2.5 px-3 font-medium text-center">Entregues</th>
                  <th className="py-2.5 px-3 font-medium text-center">Em andamento</th>
                  <th className="py-2.5 px-3 font-medium text-center" title="Sem evento novo há 4+ dias">Parados</th>
                  <th className="py-2.5 px-3 font-medium text-center" title="Do repasse (ou do 1º evento dela) até a entrega, nos entregues">Repasse → entrega</th>
                  <th className="py-2.5 px-3 font-medium text-center" title="Pacotes com o código da transportadora local">Código local</th>
                  <th className="py-2.5 px-3 font-medium text-left rounded-r-xl">Vem de</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => {
                  const on = local === r.key;
                  return (
                    <tr key={r.key} onClick={() => { setLocal(on ? null : r.key); setLimit(PAGE); }}
                      className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${on ? "bg-primary/5" : "hover:bg-muted/40"}`}>
                      <td className="py-2.5 px-3">
                        <LocalBadge k={r.key} />
                        {r.hint && <Sub>{r.hint}</Sub>}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold">{int(r.pacotes)}</td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold">
                        {r.key === "AGUARDANDO" ? <span className="text-muted-foreground">–</span> : <>{int(r.entregues)}<Sub>{pct(r.entregues / r.pacotes)}</Sub></>}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold">{int(r.andamento)}</td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold">
                        {r.parados ? <span className="text-rose-600">{int(r.parados)}</span> : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular-nums font-semibold whitespace-nowrap" title={r.diasMediana != null ? `Mediana: ${dias(r.diasMediana)}` : undefined}>{dias(r.diasMedia)}</td>
                      <td className="py-2.5 px-3 text-center tabular-nums">
                        {r.comCodigo ? <span className="font-semibold">{int(r.comCodigo)}</span> : <span className="text-muted-foreground">–</span>}
                        {r.comCodigo > 0 && r.comCodigo < r.pacotes && <Sub>de {int(r.pacotes)}</Sub>}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1.5">
                          {r.origem.map((o) => (
                            <span key={o.key} className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"><OriginBadge k={o.key} label={o.label} />{o.n}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {STATUS_TABS.map(([k, label]) => (
              <button key={k} onClick={() => { setTab(k); setLimit(PAGE); }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${tab === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                {label} <span className="tabular-nums opacity-70">{count(k)}</span>
              </button>
            ))}
            {local && (
              <button onClick={() => setLocal(null)} className="inline-flex items-center gap-1 rounded-full border border-border pl-1 pr-2 py-0.5 text-xs hover:bg-muted" title="Tirar filtro">
                <LocalBadge k={local} /><X className="size-3" />
              </button>
            )}
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }} placeholder="Pedido ou código"
                className="w-full h-8 rounded-lg border border-border bg-background pl-8 pr-2 text-xs outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>

          <div className="mt-3 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            {!list.length ? <p className="text-xs text-muted-foreground py-6 text-center">Nenhum pedido.</p> : (
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="text-[11px] text-muted-foreground bg-muted/60">
                    <th className="py-2 px-3 font-medium text-left rounded-l-xl">Pedido</th>
                    <th className="py-2 px-3 font-medium text-left">Rastreio</th>
                    <th className="py-2 px-3 font-medium text-left">Transportadora local</th>
                    <th className="py-2 px-3 font-medium text-left">Código local</th>
                    <th className="py-2 px-3 font-medium text-left">Último evento</th>
                    <th className="py-2 px-3 font-medium text-right rounded-r-xl" title="Desde o repasse; nos entregues, até a entrega; em Aguardando, desde a liberação/repasse, a troca do código (reenvio) ou o pedido">Dias no local</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, limit).map((o) => (
                    <tr key={o.id} className="border-b border-border/60 last:border-0 align-top">
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="font-medium">{o.order_number}</span>
                        <Sub>{ddmm(o.order_date)}</Sub>
                        {o.reenvio && <Sub tone="text-amber-600">reenviado {ddmm(o.reenvio)}</Sub>}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <OriginBadge k={o.carrier} label={o.carrier_label} />
                          {o.tracking_url
                            ? <a href={o.tracking_url} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline">{o.tracking_code}</a>
                            : <span className="font-mono text-xs">{o.tracking_code}</span>}
                        </div>
                      </td>
                      <td className="py-2 px-3"><LocalBadge k={o.local} />{o.etapa && <Sub>{o.etapa}</Sub>}</td>
                      <td className="py-2 px-3">
                        {o.local_number ? (
                          <span className="inline-flex items-center gap-1.5">
                            {o.local_url
                              ? <a href={o.local_url} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1">{localNumberDisplay(o.local_number)}<ExternalLink className="size-3" /></a>
                              : <span className="font-mono text-xs">{o.local_number}</span>}
                            {o.local_number !== "0" && <button onClick={() => copy(localNumberDisplay(o.local_number!))} className="text-muted-foreground hover:text-foreground" title="Copiar"><Copy className="size-3" /></button>}
                          </span>
                        ) : <span className="text-[11px] text-muted-foreground">não informado</span>}
                      </td>
                      <td className="py-2 px-3 max-w-[280px]">
                        <span className="block text-xs truncate" title={o.last_label ?? undefined}>{o.last_label ?? "–"}</span>
                        {o.last_at && <Sub>{nyDateTime(o.last_at)}</Sub>}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                        <span className={`font-semibold ${o.status === "parado" ? "text-rose-600" : ""}`}>{dec(o.dias)}</span>
                        <Sub tone={o.status === "parado" ? "text-rose-600" : o.status === "entregue" ? "text-emerald-600" : "text-muted-foreground"}>
                          {o.status === "parado" ? stoppedText(o.last_at) : o.status === "entregue" ? "entregue" : "em andamento"}
                        </Sub>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {list.length > limit && (
              <button onClick={() => setLimit((l) => l + PAGE)} className="mt-3 w-full rounded-xl border border-border py-2 text-xs text-muted-foreground hover:bg-muted/40">
                Mostrar mais ({int(list.length - limit)} restantes)
              </button>
            )}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Código local: USPS e o repasse do YunTu pra Transfly vêm pelo 17track; o da GOFO (GFUS…) vem do site dela. “Sem nome” não aparece no rastreio (nem o nome nem o código) — só o fornecedor sabe.
          </p>
        </>
      )}
    </div>
  );
}

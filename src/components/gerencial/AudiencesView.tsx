import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Mail, Phone, ShieldAlert, Store, Users, CalendarDays, Info } from "lucide-react";
import { getCampaignAudience, type AudienceRow, type AudienceSegment } from "@/lib/audiences.functions";

// Gerencial › Públicos: lista de clientes pra subir na Meta (público
// personalizado / semelhante) ou usar no e-mail. O CSV sai com as colunas
// que a Meta reconhece sozinha (email, phone, fn, ln, ct, st, zip, country, value).

const SEGMENTS: [AudienceSegment, string, string][] = [
  ["compradores", "Todos os compradores", "Quem comprou pelo menos uma vez. Base de semelhante e pra excluir de campanha de aquisição."],
  ["recompra", "Compraram 2+ vezes", "Clientes que voltaram. Melhor base de semelhante."],
  ["top", "Top 20% em valor", "Os que mais gastaram. Base pro semelhante por valor."],
  ["problema", "Reembolso / chargeback", "Lista de exclusão: tire esse público dos anúncios e do semelhante."],
];
const PERIODS: [number | null, string][] = [[null, "Desde o começo"], [30, "Últimos 30 dias"], [90, "Últimos 90 dias"], [180, "Últimos 180 dias"], [365, "Últimos 12 meses"]];

const usd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PREVIEW = 100;

function toCsv(rows: AudienceRow[]) {
  const cols = ["email", "phone", "fn", "ln", "ct", "st", "zip", "country", "value"] as const;
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function AudiencesView() {
  const [segment, setSegment] = useState<AudienceSegment>("compradores");
  const [shopId, setShopId] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [excludeProblems, setExcludeProblems] = useState(true);
  const fn = useServerFn(getCampaignAudience);
  const q = useQuery({
    queryKey: ["campaign-audience", segment, shopId, days, excludeProblems],
    queryFn: () => fn({ data: { segment, shopId, days, excludeProblems } }),
    staleTime: 5 * 60_000,
  });
  const d = q.data;
  const shopLabel = shopId ? d?.shops.find((s) => s.id === shopId)?.name ?? "loja" : "todas-lojas";

  const download = () => {
    if (!d?.rows.length) return;
    const blob = new Blob([toCsv(d.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `publico-${segment}-${shopLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const select = "h-8 pl-8 pr-3 rounded-xl border border-border bg-card text-xs font-medium outline-none focus:border-primary w-full sm:w-auto";

  return (
    <div className="space-y-4">
      {/* Segmento */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {SEGMENTS.map(([k, label, hint]) => (
          <button key={k} onClick={() => setSegment(k)}
            className={`text-left rounded-2xl border p-4 transition-colors ${segment === k ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}>
            <p className="text-sm font-semibold flex items-center gap-2">
              {k === "problema" ? <ShieldAlert className="size-4 text-rose-500" /> : <Users className="size-4 text-primary" />}{label}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-auto">
          <Store className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select value={shopId ?? ""} onChange={(e) => setShopId(e.target.value || null)} className={select}>
            <option value="">Todas as lojas</option>
            {(d?.shops ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="relative w-full sm:w-auto">
          <CalendarDays className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)} className={select}>
            {PERIODS.map(([v, l]) => <option key={l} value={v ?? ""}>{l}</option>)}
          </select>
        </label>
        {segment !== "problema" && (
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={excludeProblems} onChange={(e) => setExcludeProblems(e.target.checked)} className="accent-primary" />
            Tirar quem teve reembolso ou chargeback
          </label>
        )}
        <button onClick={download} disabled={!d?.rows.length}
          className="sm:ml-auto w-full sm:w-auto h-9 px-4 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
          <Download className="size-4" /> Exportar CSV pra Meta
        </button>
      </div>

      {q.isLoading ? <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : q.isError || !d ? <div className="py-20 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>
        : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {[
                ["Pessoas no público", d.stats.people.toLocaleString("pt-BR"), `de ${d.stats.totalCustomers.toLocaleString("pt-BR")} clientes no período`],
                ["Valor comprado", usd(d.stats.value), "pedidos sem reembolso/chargeback"],
                ["Com e-mail", d.stats.withEmail.toLocaleString("pt-BR"), <span className="inline-flex items-center gap-1"><Mail className="size-3" /> casa melhor na Meta</span>],
                ["Com telefone", d.stats.withPhone.toLocaleString("pt-BR"), <span className="inline-flex items-center gap-1"><Phone className="size-3" /> aumenta a correspondência</span>],
              ].map(([l, v, s], i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-4 min-w-0">
                  <p className="text-[11px] text-muted-foreground truncate">{l}</p>
                  <p className="text-xl font-semibold whitespace-nowrap">{v}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{s}</p>
                </div>
              ))}
            </div>

            {d.stats.people > 0 && d.stats.people < 100 && segment !== "problema" && (
              <p className="text-xs rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2">
                A Meta pede pelo menos 100 pessoas encontradas pra criar o público semelhante. Aumente o período ou junte as lojas.
              </p>
            )}

            <div className="rounded-2xl sm:rounded-3xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground bg-muted/40">
                    <tr className="text-left">
                      <th className="px-4 py-2.5 font-medium">Cliente</th>
                      <th className="px-4 py-2.5 font-medium max-md:hidden">Telefone</th>
                      <th className="px-4 py-2.5 font-medium max-md:hidden">Local</th>
                      <th className="px-4 py-2.5 font-medium max-lg:hidden">Lojas</th>
                      <th className="px-4 py-2.5 font-medium text-right">Pedidos</th>
                      <th className="px-4 py-2.5 font-medium text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.slice(0, PREVIEW).map((r, i) => (
                      <tr key={r.email ?? r.phone ?? i} className="border-t border-border/60">
                        <td className="px-4 py-2.5 min-w-0">
                          <p className="font-medium truncate max-w-[240px]">{[r.fn, r.ln].filter(Boolean).join(" ") || "—"}</p>
                          <p className="text-muted-foreground truncate max-w-[240px]">{r.email ?? "sem e-mail"}</p>
                          {(r.refund || r.chargeback) && (
                            <span className="inline-block mt-0.5 rounded-full px-1.5 text-[10px] font-semibold bg-rose-500/10 text-rose-600">
                              {[r.refund && "Reembolso", r.chargeback && "Chargeback"].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap max-md:hidden">{r.phone ? `+${r.phone}` : "—"}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap max-md:hidden">{[r.ct, r.st, r.country].filter(Boolean).join(", ") || "—"}</td>
                        <td className="px-4 py-2.5 max-lg:hidden"><span className="truncate block max-w-[200px]">{r.shops.join(", ")}</span></td>
                        <td className="px-4 py-2.5 text-right">{r.orders}</td>
                        <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">{usd(r.value)}</td>
                      </tr>
                    ))}
                    {!d.rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Ninguém nesse filtro.</td></tr>}
                  </tbody>
                </table>
              </div>
              {d.rows.length > PREVIEW && (
                <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border/60">
                  Mostrando {PREVIEW} de {d.rows.length.toLocaleString("pt-BR")} — o CSV leva todos.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5">
              <p className="font-semibold text-foreground flex items-center gap-1.5"><Info className="size-3.5" /> Como subir na Meta</p>
              <p>1. Gerenciador de Anúncios › Públicos › Criar público › Público personalizado › Lista de clientes.</p>
              <p>2. Envie o CSV. As colunas já vêm no nome que a Meta reconhece; marque <b>value</b> como valor do cliente se quiser o semelhante por valor.</p>
              <p>3. Com o público pronto: Criar público › Público semelhante, usando ele como origem (1% = mais parecido).</p>
              <p>4. A lista de <b>Reembolso / chargeback</b> entra como exclusão no conjunto de anúncios.</p>
              {d.stats.noContact > 0 && <p className="pt-1">{d.stats.noContact.toLocaleString("pt-BR")} pedidos sem e-mail nem telefone ficaram de fora.</p>}
            </div>
          </>
        )}
    </div>
  );
}

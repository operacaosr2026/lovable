import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays, Crown, Download, Loader2, Mail, Phone, Repeat, Search, ShieldAlert, Store, Users, Wallet,
} from "lucide-react";
import { getCampaignAudience, type AudienceRow, type AudienceSegment } from "@/lib/audiences.functions";

// Gerencial › Públicos: lista de clientes pra subir na Meta (público
// personalizado / semelhante) ou usar no e-mail. O CSV sai com as colunas
// que a Meta reconhece sozinha (email, phone, fn, ln, ct, st, zip, country, value).

type Seg = { key: AudienceSegment; label: string; hint: string; use: string; icon: any; tone: string; ring: string };
const SEGMENTS: Seg[] = [
  { key: "compradores", label: "Compradores", hint: "Compraram pelo menos uma vez", use: "Base de semelhante e exclusão em campanha de aquisição",
    icon: Users, tone: "bg-primary/10 text-primary", ring: "ring-primary" },
  { key: "recompra", label: "Recompra", hint: "Compraram 2 ou mais vezes", use: "A melhor base pro público semelhante",
    icon: Repeat, tone: "bg-sky-500/10 text-sky-600", ring: "ring-sky-500" },
  { key: "top", label: "Top 20%", hint: "Os que mais gastaram", use: "Base pro semelhante por valor",
    icon: Crown, tone: "bg-amber-500/10 text-amber-600", ring: "ring-amber-500" },
  { key: "problema", label: "Exclusão", hint: "Tiveram reembolso ou chargeback", use: "Tire esse público dos anúncios e do semelhante",
    icon: ShieldAlert, tone: "bg-rose-500/10 text-rose-600", ring: "ring-rose-500" },
];
const PERIODS: [number | null, string][] = [[null, "Desde o começo"], [30, "Últimos 30 dias"], [90, "Últimos 90 dias"], [180, "Últimos 180 dias"], [365, "Últimos 12 meses"]];

const usd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (v: number) => v.toLocaleString("pt-BR");
const PREVIEW = 100;
const AVATAR = ["bg-emerald-500/15 text-emerald-700", "bg-sky-500/15 text-sky-700", "bg-violet-500/15 text-violet-700", "bg-amber-500/15 text-amber-700", "bg-rose-500/15 text-rose-700"];

function toCsv(rows: AudienceRow[]) {
  const cols = ["email", "phone", "fn", "ln", "ct", "st", "zip", "country", "value"] as const;
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function Coverage({ icon: Icon, label, value, total }: { icon: any; label: string; value: number; total: number }) {
  const p = total ? value / total : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 truncate"><Icon className="size-3.5" /> {label}</span>
        <span className="font-semibold text-foreground tabular-nums">{Math.round(p * 100)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${p * 100}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">{int(value)} de {int(total)}</p>
    </div>
  );
}

export function AudiencesView() {
  const [segment, setSegment] = useState<AudienceSegment>("compradores");
  const [shopId, setShopId] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [excludeProblems, setExcludeProblems] = useState(true);
  const [search, setSearch] = useState("");
  const fn = useServerFn(getCampaignAudience);
  const q = useQuery({
    queryKey: ["campaign-audience", segment, shopId, days, excludeProblems],
    queryFn: () => fn({ data: { segment, shopId, days, excludeProblems } }),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const seg = SEGMENTS.find((s) => s.key === segment)!;
  const shopLabel = shopId ? d?.shops.find((s) => s.id === shopId)?.name ?? "loja" : "todas-lojas";

  const visible = useMemo(() => {
    const rows = d?.rows ?? [];
    const t = search.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.fn, r.ln, r.email, r.phone, r.ct, r.st].some((v) => v?.toLowerCase().includes(t)));
  }, [d, search]);

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

  if (q.isLoading) return <div className="py-20 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !d) return <div className="py-20 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>;

  const s = d.stats;
  const selectCls = "h-9 pl-9 pr-3 rounded-xl border border-border bg-background text-xs font-medium outline-none focus:border-primary w-full";

  return (
    <div className="space-y-4">
      {/* Destaque: o público escolhido, quanto vale e o botão de exportar */}
      <div className="rounded-2xl sm:rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5 lg:gap-8">
          <div className="min-w-0 lg:flex-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <seg.icon className="size-3.5" /> Público · {seg.label}
              {q.isFetching && <Loader2 className="size-3 animate-spin" />}
            </p>
            <div className="flex items-baseline gap-2 mt-1 flex-wrap">
              <p className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums">{int(s.people)}</p>
              <p className="text-sm text-muted-foreground">pessoas</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{seg.use}.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 lg:min-w-[440px] pt-4 lg:pt-0 border-t lg:border-0 border-border/60">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Wallet className="size-3.5" /> Valor comprado</p>
              <p className="text-lg font-semibold tabular-nums whitespace-nowrap">{usd(s.value)}</p>
              <p className="text-[10px] text-muted-foreground">{s.people ? `${usd(s.value / s.people)} por pessoa` : "—"}</p>
            </div>
            <Coverage icon={Mail} label="Com e-mail" value={s.withEmail} total={s.people} />
            <Coverage icon={Phone} label="Com telefone" value={s.withPhone} total={s.people} />
          </div>
          <button onClick={download} disabled={!d.rows.length}
            className="lg:self-stretch shrink-0 h-11 lg:h-auto px-5 rounded-2xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex lg:flex-col items-center justify-center gap-1.5 lg:gap-1 shadow-sm">
            <Download className="size-5" />
            <span>Exportar CSV</span>
            <span className="text-[10px] font-normal opacity-80 max-lg:hidden">formato da Meta</span>
          </button>
        </div>
        {s.people > 0 && s.people < 100 && segment !== "problema" && (
          <p className="mt-4 text-xs rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2">
            A Meta pede pelo menos 100 pessoas encontradas pra criar o semelhante. Aumente o período ou junte as lojas.
          </p>
        )}
      </div>

      {/* Segmentos, com quantas pessoas cada um tem nos filtros atuais */}
      <div className="grid gap-2 sm:gap-3 grid-cols-2 xl:grid-cols-4">
        {SEGMENTS.map((x) => {
          const active = x.key === segment;
          return (
            <button key={x.key} onClick={() => setSegment(x.key)}
              className={`text-left rounded-2xl border bg-card p-3 sm:p-4 transition-all ${active ? `border-transparent ring-2 ${x.ring} shadow-sm` : "border-border hover:border-primary/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className={`size-9 rounded-xl grid place-items-center shrink-0 ${x.tone}`}><x.icon className="size-4" /></span>
                <span className="text-lg sm:text-xl font-semibold tabular-nums">{int(d.counts[x.key])}</span>
              </div>
              <p className="text-sm font-semibold mt-3">{x.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{x.hint}</p>
            </button>
          );
        })}
      </div>

      {/* Lista */}
      <div>
        <div className="rounded-2xl sm:rounded-3xl border border-border bg-card min-w-0 overflow-hidden">
          <div className="p-3 sm:p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto] items-center border-b border-border/60">
            <label className="relative sm:col-span-2 lg:col-span-1">
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome, e-mail, telefone ou cidade"
                className="h-9 pl-9 pr-3 rounded-xl border border-border bg-background text-xs outline-none focus:border-primary w-full" />
            </label>
            <label className="relative">
              <Store className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
              <select value={shopId ?? ""} onChange={(e) => setShopId(e.target.value || null)} className={selectCls}>
                <option value="">Todas as lojas</option>
                {d.shops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="relative">
              <CalendarDays className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
              <select value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)} className={selectCls}>
                {PERIODS.map(([v, l]) => <option key={l} value={v ?? ""}>{l}</option>)}
              </select>
            </label>
            {segment !== "problema" && (
              <button type="button" role="switch" aria-checked={excludeProblems} onClick={() => setExcludeProblems((v) => !v)}
                className="sm:col-span-2 lg:col-span-3 inline-flex items-center gap-2 text-xs text-muted-foreground w-fit">
                <span className={`relative h-4 w-7 rounded-full transition-colors ${excludeProblems ? "bg-primary" : "bg-muted-foreground/30"}`}>
                  <span className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition-all ${excludeProblems ? "left-3.5" : "left-0.5"}`} />
                </span>
                Tirar quem teve reembolso ou chargeback
                {excludeProblems && s.problems > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold">{int(s.problems)} fora</span>}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] text-muted-foreground text-left">
                  <th className="px-4 py-2.5 font-medium w-10">#</th>
                  <th className="px-2 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium max-md:hidden">Telefone</th>
                  <th className="px-3 py-2.5 font-medium max-md:hidden">Local</th>
                  <th className="px-3 py-2.5 font-medium max-lg:hidden">Lojas</th>
                  <th className="px-3 py-2.5 font-medium text-center">Pedidos</th>
                  <th className="px-4 py-2.5 font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, PREVIEW).map((r, i) => {
                  const name = [r.fn, r.ln].filter(Boolean).join(" ");
                  const initials = (name || r.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
                  return (
                    <tr key={r.email ?? r.phone ?? i} className="border-t border-border/60 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`size-8 shrink-0 rounded-full grid place-items-center text-[10px] font-bold ${AVATAR[i % AVATAR.length]}`}>{initials}</span>
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[220px] flex items-center gap-1.5">
                              {name || "Sem nome"}
                              {r.refund && <span className="rounded-full px-1.5 text-[10px] font-semibold bg-amber-500/10 text-amber-700">Reembolso</span>}
                              {r.chargeback && <span className="rounded-full px-1.5 text-[10px] font-semibold bg-rose-500/10 text-rose-600">Chargeback</span>}
                            </p>
                            <p className="text-muted-foreground truncate max-w-[220px]">{r.email ?? "sem e-mail"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums max-md:hidden">{r.phone ? `+${r.phone}` : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap max-md:hidden">
                        {r.ct || r.st ? <span>{[r.ct, r.st].filter(Boolean).join(", ")}</span> : <span className="text-muted-foreground">—</span>}
                        {r.country && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{r.country}</span>}
                      </td>
                      <td className="px-3 py-2.5 max-lg:hidden">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {r.shops.slice(0, 2).map((x) => <span key={x} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium whitespace-nowrap">{x}</span>)}
                          {r.shops.length > 2 && <span className="text-[10px] text-muted-foreground">+{r.shops.length - 2}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-grid min-w-6 h-6 px-1.5 place-items-center rounded-full text-[11px] font-semibold tabular-nums ${r.orders >= 2 ? "bg-sky-500/10 text-sky-700" : "bg-muted"}`}>{r.orders}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums">{usd(r.value)}</td>
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr><td colSpan={7} className="px-4 py-14 text-center">
                    <Users className="size-6 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">{search ? "Ninguém com essa busca." : "Ninguém nesse filtro."}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {visible.length > PREVIEW && (
            <p className="px-4 py-3 text-[11px] text-muted-foreground border-t border-border/60 bg-muted/20">
              Mostrando {PREVIEW} de {int(visible.length)}. O CSV leva todo o público ({int(d.rows.length)}), sem a busca.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

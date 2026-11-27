import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock, Check, ChevronLeft, ChevronRight, Circle, CircleDot, Flag, Gift, Layers, Lightbulb, Loader2, Pencil, Plus, Sparkles, Target, Trash2, Truck, User, Wand2,
} from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isoTodayUS } from "@/lib/timezone";
import { listTaskAssignees } from "@/lib/tasks.functions";
import { getGerencial } from "@/lib/gerencial.functions";
import { getDashboardBalances } from "@/lib/wise-cash.functions";
import {
  deleteStrategyItem, getStrategy, getStrategyBaseline, saveInitiative, saveKeyResult, saveObjective, saveStrategyPlan, setInitiativeStatus, setKeyResultValue,
  type InitiativeStatus, type KrUnit, type StrategyInitiative, type StrategyKr, type StrategyObjective,
} from "@/lib/strategy.functions";
import {
  buildDiagnosis, buildSeasonPlan, daysBetween, PHASE_LABEL, quarterOf, seasonForecast, seasonStatus, upcomingSeasons,
  type Baseline, type Finance, type PlanTemplate, type Season, type SeasonPhase,
} from "@/lib/strategy-plan";

// Gerencial › Planejamento: plano estratégico quase pronto.
//  1. Calendário de datas sazonais (EUA) com a janela de preparo de 90 dias,
//     o último dia de pedido pra chegar a tempo (prazo real de entrega) e a
//     meta/orçamento calculados com os números do sistema → "Montar plano"
//     cria o objetivo com resultados-chave medidos sozinhos e o checklist datado.
//  2. Diagnóstico (reembolso, recompra, entrega, margem) com o objetivo
//     sugerido pro trimestre.
//  3. Objetivos do trimestre (OKR), editáveis.

const shiftQuarter = (q: string, n: number) => {
  const i = Number(q.slice(0, 4)) * 4 + Number(q.slice(6)) - 1 + n;
  return `${Math.floor(i / 4)}-T${(i % 4) + 1}`;
};
const quarterLabel = (q: string) => `${q.slice(6)}º tri ${q.slice(0, 4)}`;
const usd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
const fmtVal = (v: number, u: KrUnit) =>
  u === "usd" ? `US$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`
  : u === "pct" ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
  : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const krProgress = (k: StrategyKr) => {
  const span = k.target_value - k.start_value;
  if (span === 0) return k.current_value >= k.target_value ? 1 : 0;
  return Math.max(0, Math.min(1, (k.current_value - k.start_value) / span));
};
const objProgress = (o: StrategyObjective) => {
  if (o.krs.length) return o.krs.reduce((s, k) => s + krProgress(k), 0) / o.krs.length;
  if (o.initiatives.length) return o.initiatives.filter((i) => i.status === "concluida").length / o.initiatives.length;
  return 0;
};
const tone = (p: number) => (p >= 0.7 ? "text-emerald-600" : p >= 0.4 ? "text-amber-600" : "text-rose-600");
const barTone = (p: number) => (p >= 0.7 ? "bg-emerald-500" : p >= 0.4 ? "bg-amber-500" : "bg-rose-500");
const pct = (p: number) => `${Math.round(p * 100)}%`;
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dm = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
const dmw = (k: string) => `${WD[new Date(`${k}T12:00:00Z`).getUTCDay()]}, ${dm(k)}`;
const rel = (n: number) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : n === -1 ? "ontem" : n > 0 ? `em ${n} dias` : `há ${-n} dias`);

const PHASE_TONE: Record<SeasonPhase, string> = {
  planejar: "bg-muted-foreground/40", preparar: "bg-amber-500", campanha: "bg-emerald-500", ultimos_dias: "bg-rose-500", pos: "bg-muted-foreground/30",
};
const STATUS: Record<InitiativeStatus, { label: string; icon: any; cls: string; next: InitiativeStatus }> = {
  a_fazer: { label: "A fazer", icon: Circle, cls: "text-muted-foreground", next: "em_andamento" },
  em_andamento: { label: "Em andamento", icon: CircleDot, cls: "text-sky-600", next: "concluida" },
  concluida: { label: "Concluída", icon: Check, cls: "text-emerald-600", next: "a_fazer" },
};

function Ring({ value, size = 44 }: { value: number; size?: number }) {
  const r = 18, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 44 44" className="size-full -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`}
          className={value >= 0.7 ? "stroke-emerald-500" : value >= 0.4 ? "stroke-amber-500" : "stroke-rose-500"} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums">{pct(value)}</span>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
);
const SectionTitle = ({ icon: Icon, children, right }: { icon: any; children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center gap-2 mb-2">
    <Icon className="size-4 text-primary" />
    <p className="text-sm font-semibold">{children}</p>
    <div className="ml-auto">{right}</div>
  </div>
);

type Editing =
  | { kind: "objective"; item?: StrategyObjective }
  | { kind: "kr"; objectiveId: string; item?: StrategyKr }
  | { kind: "initiative"; objectiveId: string; item?: StrategyInitiative };

export function StrategyView() {
  const today = isoTodayUS();
  const [quarter, setQuarter] = useState(() => quarterOf(today));
  const [editing, setEditing] = useState<Editing | null>(null);
  const seasons = useMemo(() => upcomingSeasons(today, 8), [today]);
  const [seasonKey, setSeasonKey] = useState<string>(() => seasons[0]?.key ?? "");
  const qc = useQueryClient();
  const confirm = useConfirm();

  const fn = useServerFn(getStrategy);
  const baseFn = useServerFn(getStrategyBaseline);
  const gerFn = useServerFn(getGerencial);
  const balFn = useServerFn(getDashboardBalances);
  const membersFn = useServerFn(listTaskAssignees);
  const q = useQuery({ queryKey: ["strategy", quarter], queryFn: () => fn({ data: { quarter } }), placeholderData: keepPreviousData });
  const base = useQuery({ queryKey: ["strategy-baseline"], queryFn: () => baseFn(), staleTime: 30 * 60_000 });
  const month = today.slice(0, 7);
  const ger = useQuery({ queryKey: ["gerencial", month], queryFn: () => gerFn({ data: { month } }), staleTime: 5 * 60_000 });
  const bal = useQuery({ queryKey: ["dashboard-balances"], queryFn: () => balFn(), staleTime: 60_000 });
  const members = useQuery({ queryKey: ["task-assignees"], queryFn: () => membersFn(), staleTime: 10 * 60_000 });
  const nameOf = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.name])), [members.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["strategy"] });

  // Margem e CPA: mês atual; com pouco pedido ainda, o mês anterior fechado.
  const finance: Finance = useMemo(() => {
    const r = (ger.data as any)?.resultado;
    const m = r?.atual && r.atual.pedidos >= 100 ? r.atual : r?.anterior ?? r?.atual;
    return m ? { margem: m.margem ?? null, cpa: m.cpa ?? null, anuncios: m.anuncios ?? null, lucro: m.lucro ?? null } : null;
  }, [ger.data]);
  const b = (base.data ?? null) as Baseline | null;

  const delFn = useServerFn(deleteStrategyItem);
  const statusFn = useServerFn(setInitiativeStatus);
  const valueFn = useServerFn(setKeyResultValue);
  const planFn = useServerFn(saveStrategyPlan);
  const onErr = (e: Error) => toast.error(e.message);
  const del = useMutation({ mutationFn: (v: { kind: "objective" | "kr" | "initiative"; id: string }) => delFn({ data: v }), onSuccess: refresh, onError: onErr });
  const setStatus = useMutation({ mutationFn: (v: { id: string; status: InitiativeStatus }) => statusFn({ data: v }), onSuccess: refresh, onError: onErr });
  const setValue = useMutation({ mutationFn: (v: { id: string; current_value: number }) => valueFn({ data: v }), onSuccess: refresh, onError: onErr });
  const createPlan = useMutation({
    mutationFn: (p: PlanTemplate) => planFn({ data: p }),
    onSuccess: (_r, p) => { toast.success(`Plano "${p.title}" montado`); refresh(); },
    onError: onErr,
  });

  const remove = async (kind: "objective" | "kr" | "initiative", id: string, what: string) => {
    if (await confirm({ title: `Excluir ${what}?`, description: kind === "objective" ? "Os resultados-chave e as iniciativas dele também saem." : undefined, confirmText: "Excluir", variant: "destructive" })) {
      del.mutate({ kind, id });
    }
  };

  const objs = q.data?.objectives ?? [];
  const planByKey = useMemo(() => {
    const m = new Map<string, StrategyObjective>();
    for (const o of [...(q.data?.plans ?? []), ...objs]) if (o.plan_key) m.set(o.plan_key, o);
    return m;
  }, [q.data, objs]);
  const season = seasons.find((s) => s.key === seasonKey) ?? seasons[0];
  const diagnosis = b ? buildDiagnosis(b, finance, quarterOf(today)) : [];

  const cardProps = {
    nameOf, today,
    onEdit: setEditing,
    onRemove: remove,
    onStatus: (id: string, status: InitiativeStatus) => setStatus.mutate({ id, status }),
    onValue: (id: string, v: number) => setValue.mutate({ id, current_value: v }),
  };

  return (
    <div className="space-y-5">
      {/* ── 1. Calendário sazonal ── */}
      <section>
        <SectionTitle icon={CalendarClock}>Datas sazonais · prepare 90 dias antes</SectionTitle>
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {seasons.map((s) => {
            const st = seasonStatus(s, b, today);
            const plan = planByKey.get(s.key);
            const active = s.key === season?.key;
            return (
              <button key={s.key} onClick={() => setSeasonKey(s.key)}
                className={`shrink-0 text-left rounded-xl border px-3 py-2 transition-colors min-w-[150px] ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`size-1.5 rounded-full shrink-0 ${PHASE_TONE[st.phase]}`} />
                  <p className="text-xs font-semibold truncate">{s.label}</p>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap">
                  {dm(s.date)} · {rel(st.daysToDate)}
                  {plan && <span className="ml-1 font-semibold text-primary">· {pct(objProgress(plan))}</span>}
                </p>
              </button>
            );
          })}
        </div>
        {season && (
          <SeasonPanel season={season} b={b} finance={finance} saldo={bal.data?.caixa ?? null}
            plan={planByKey.get(season.key) ?? null} loadingBase={base.isLoading}
            onCreate={(p) => createPlan.mutate(p)} creating={createPlan.isPending} {...cardProps} />
        )}
      </section>

      {/* ── 2. Diagnóstico ── */}
      <section>
        <SectionTitle icon={Lightbulb}>O que os números dizem</SectionTitle>
        {base.isLoading ? <div className="py-8 grid place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
          : !diagnosis.length ? <p className="text-xs text-muted-foreground">Sem dados suficientes ainda.</p>
          : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {diagnosis.map((dg) => {
                const inPlan = planByKey.has(dg.plan.plan_key);
                const dot = dg.status === "ruim" ? "bg-rose-500" : dg.status === "atencao" ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <div key={dg.key} className="rounded-2xl border border-border bg-card p-3.5 flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={`size-1.5 rounded-full ${dot}`} />{dg.title}</div>
                    <p className="text-xl font-semibold tabular-nums">{dg.metric}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 flex-1" title={dg.insight}>{dg.insight}</p>
                    <button disabled={inPlan || createPlan.isPending} onClick={() => createPlan.mutate(dg.plan)}
                      className={`mt-2.5 h-8 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 ${inPlan ? "bg-emerald-500/10 text-emerald-700" : "bg-primary/10 text-primary hover:bg-primary/15"}`}>
                      {inPlan ? <><Check className="size-3.5" /> No plano do trimestre</> : <><Wand2 className="size-3.5" /> {dg.plan.title}</>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
      </section>

      {/* ── 3. Objetivos do trimestre ── */}
      <section>
        <SectionTitle icon={Target} right={
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-xl border border-border bg-card h-8">
              <button onClick={() => setQuarter((x) => shiftQuarter(x, -1))} className="h-full px-1.5 text-muted-foreground hover:text-foreground" aria-label="Trimestre anterior"><ChevronLeft className="size-4" /></button>
              <span className="px-1 text-xs font-semibold whitespace-nowrap min-w-[78px] text-center">{quarterLabel(quarter)}</span>
              <button onClick={() => setQuarter((x) => shiftQuarter(x, 1))} className="h-full px-1.5 text-muted-foreground hover:text-foreground" aria-label="Próximo trimestre"><ChevronRight className="size-4" /></button>
            </div>
            <button onClick={() => setEditing({ kind: "objective" })}
              className="h-8 px-3 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1">
              <Plus className="size-3.5" /> Objetivo
            </button>
          </div>
        }>Objetivos do trimestre</SectionTitle>
        {q.isLoading ? <div className="py-12 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          : q.isError ? <div className="py-12 text-center text-sm text-destructive">{(q.error as any)?.message ?? "Erro"}</div>
          : !objs.length ? (
            <div className="rounded-2xl border border-dashed border-border bg-card py-8 text-center px-4">
              <p className="text-sm font-medium">Nenhum objetivo no {quarterLabel(quarter)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Monte o plano de uma data acima, adicione um objetivo do diagnóstico ou crie o seu.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {objs.map((o, idx) => <ObjectiveCard key={o.id} o={o} label={o.plan_key && !o.plan_key.startsWith("diag:") ? "Data sazonal" : `Objetivo ${idx + 1}`} {...cardProps} />)}
            </div>
          )}
      </section>

      {editing && (
        <EditDialog editing={editing} quarter={quarter} members={members.data ?? []} projects={q.data?.projects ?? []}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
    </div>
  );
}

type CardProps = {
  nameOf: Map<string, string>; today: string;
  onEdit: (e: Editing) => void;
  onRemove: (kind: "objective" | "kr" | "initiative", id: string, what: string) => void;
  onStatus: (id: string, s: InitiativeStatus) => void;
  onValue: (id: string, v: number) => void;
};

// Painel da data escolhida: números, meta e o checklist (do plano montado ou a prévia).
function SeasonPanel({ season: s, b, finance, saldo, today, plan, loadingBase, onCreate, creating, ...card }: CardProps & {
  season: Season; b: Baseline | null; finance: Finance; saldo: number | null; today: string; plan: StrategyObjective | null;
  loadingBase: boolean; onCreate: (p: PlanTemplate) => void; creating: boolean;
}) {
  const st = seasonStatus(s, b, today);
  const fc = seasonForecast(s, b, finance);
  const tpl = buildSeasonPlan(s, b, finance);
  const facts: { icon: any; label: string; value: string; sub?: string; warn?: boolean }[] = [
    { icon: CalendarClock, label: "Data", value: dmw(s.date) + (s.end ? ` a ${dm(s.end)}` : ""), sub: rel(st.daysToDate) },
    { icon: Sparkles, label: "Começar o preparo", value: dm(st.prepStart), sub: rel(st.daysToPrep), warn: st.daysToPrep < 0 && st.phase === "preparar" },
    ...(st.cutoff ? [{ icon: Truck, label: "Último pedido pra chegar a tempo", value: dmw(st.cutoff), sub: `${rel(daysBetween(today, st.cutoff))} · 80% chega em ${Math.ceil(b?.deliveryP80 ?? 21)} dias`, warn: st.cutoff >= today && daysBetween(today, st.cutoff) <= 10 }] : []),
    { icon: Target, label: `Meta (${fc.days} dias de campanha)`, value: usd(fc.revenue), sub: `~${Math.round(fc.orders)} pedidos · ${s.uplift.toLocaleString("pt-BR")}× a venda diária` },
    ...(fc.budget != null ? [{ icon: Gift, label: "Orçamento de anúncio", value: usd(fc.budget), sub: saldo != null ? `Saldo total hoje: ${usd(saldo)}` : `CPA US$ ${finance?.cpa?.toFixed(2)}`, warn: saldo != null && fc.budget > saldo }] : []),
  ];

  return (
    <div className="mt-2 rounded-2xl sm:rounded-3xl border border-border bg-card overflow-hidden">
      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] lg:divide-x divide-border/60">
        {/* Números da data */}
        <div className="p-4 sm:p-5 bg-gradient-to-br from-primary/10 via-card to-card">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold">{s.label}</p>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-card border border-border inline-flex items-center gap-1">
              <span className={`size-1.5 rounded-full ${PHASE_TONE[st.phase]}`} />{PHASE_LABEL[st.phase]}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{s.tip}</p>
          {loadingBase ? <div className="py-8 grid place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div> : (
            <div className="mt-3 space-y-2.5">
              {facts.map((f) => (
                <div key={f.label} className="flex items-start gap-2.5">
                  <span className={`size-7 shrink-0 rounded-lg grid place-items-center ${f.warn ? "bg-rose-500/10 text-rose-600" : "bg-card border border-border text-muted-foreground"}`}><f.icon className="size-3.5" /></span>
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">{f.label}</p>
                    <p className={`text-sm font-semibold tabular-nums ${f.warn ? "text-rose-600" : ""}`}>{f.value}</p>
                    {f.sub && <p className="text-[10px] text-muted-foreground">{f.sub}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Checklist */}
        <div className="p-4 sm:p-5 min-w-0">
          {plan ? (
            <ObjectiveBody o={plan} today={today} {...card} />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold flex items-center gap-1.5"><Layers className="size-3.5 text-primary" /> Plano sugerido</p>
                <button onClick={() => onCreate(tpl)} disabled={creating || loadingBase}
                  className="ml-auto h-8 px-3 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Montar plano
                </button>
              </div>
              <ol className="space-y-0.5">
                {tpl.initiatives.map((i) => {
                  const past = !!i.due_date && i.due_date < today;
                  return (
                    <li key={i.title} className={`flex gap-2.5 rounded-xl px-2 py-1.5 -mx-2 ${past ? "opacity-50" : ""}`}>
                      <span className="text-[10px] font-semibold tabular-nums w-11 shrink-0 pt-0.5 text-muted-foreground">{i.due_date ? dm(i.due_date) : ""}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{i.title}{past && <span className="ml-1.5 text-[10px] text-muted-foreground">(já passou)</span>}</p>
                        <p className="text-[11px] text-muted-foreground">{i.notes}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="text-[10px] text-muted-foreground mt-3">Ao montar, vira um objetivo do {quarterLabel(tpl.quarter)} com faturamento e pedidos da campanha medidos sozinhos.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ObjectiveCard({ o, label, ...card }: CardProps & { o: StrategyObjective; label: string }) {
  const p = objProgress(o);
  return (
    <div className="rounded-2xl sm:rounded-3xl border border-border bg-card">
      <div className="flex items-start gap-3 p-4 sm:px-5 border-b border-border/60">
        <Ring value={p} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-sm sm:text-base font-semibold leading-snug">{o.title}</p>
          {o.description && <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>}
        </div>
        {o.owner_id && (
          <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium shrink-0"><User className="size-3" />{card.nameOf.get(o.owner_id) ?? "—"}</span>
        )}
        <div className="flex items-center shrink-0">
          <button onClick={() => card.onEdit({ kind: "objective", item: o })} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted" title="Editar"><Pencil className="size-3.5" /></button>
          <button onClick={() => card.onRemove("objective", o.id, "objetivo")} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10" title="Excluir"><Trash2 className="size-3.5" /></button>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 lg:divide-x divide-border/60">
        <div className="p-4 sm:px-5"><KrList o={o} {...card} /></div>
        <div className="p-4 sm:px-5 border-t lg:border-t-0 border-border/60"><InitiativeList o={o} {...card} /></div>
      </div>
    </div>
  );
}

// Plano montado dentro do painel da data: progresso, resultados-chave e checklist.
function ObjectiveBody({ o, ...card }: CardProps & { o: StrategyObjective }) {
  const p = objProgress(o);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Ring value={p} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Plano montado · {o.initiatives.filter((i) => i.status === "concluida").length}/{o.initiatives.length} etapas</p>
          <p className="text-[11px] text-muted-foreground">Faturamento e pedidos da campanha são medidos sozinhos.</p>
        </div>
        <button onClick={() => card.onRemove("objective", o.id, "plano")} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10" title="Desfazer plano"><Trash2 className="size-3.5" /></button>
      </div>
      <KrList o={o} {...card} />
      <InitiativeList o={o} {...card} />
    </div>
  );
}

function KrList({ o, ...card }: CardProps & { o: StrategyObjective }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Flag className="size-3.5 text-primary" /> Resultados-chave</p>
      <div className="space-y-1">
        {o.krs.map((k) => {
          const kp = krProgress(k);
          return (
            <div key={k.id} className="group rounded-xl px-2 py-1.5 -mx-2 hover:bg-muted/40">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium flex-1 min-w-0 truncate" title={k.title}>{k.title}</p>
                {k.auto
                  ? <span className="text-xs font-semibold tabular-nums whitespace-nowrap px-1.5" title="Medido pelo sistema">{fmtVal(k.current_value, k.unit)}</span>
                  : <KrValue kr={k} onSave={(v) => card.onValue(k.id, v)} />}
                <span className="text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">/ {fmtVal(k.target_value, k.unit)}</span>
                <span className={`text-[11px] font-semibold tabular-nums w-9 text-right ${tone(kp)}`}>{pct(kp)}</span>
                <div className="flex opacity-0 group-hover:opacity-100 max-md:opacity-100">
                  <button onClick={() => card.onEdit({ kind: "kr", objectiveId: o.id, item: k })} className="size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground"><Pencil className="size-3" /></button>
                  <button onClick={() => card.onRemove("kr", k.id, "resultado-chave")} className="size-6 rounded grid place-items-center text-muted-foreground hover:text-rose-600"><Trash2 className="size-3" /></button>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden"><div className={`h-full rounded-full ${barTone(kp)}`} style={{ width: `${kp * 100}%` }} /></div>
            </div>
          );
        })}
      </div>
      <button onClick={() => card.onEdit({ kind: "kr", objectiveId: o.id })} className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline"><Plus className="size-3.5" /> Resultado-chave</button>
    </div>
  );
}

function InitiativeList({ o, ...card }: CardProps & { o: StrategyObjective }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Layers className="size-3.5 text-primary" /> Iniciativas</p>
      <div className="space-y-0.5">
        {o.initiatives.map((i) => {
          const st = STATUS[i.status];
          const isLate = i.status !== "concluida" && !!i.due_date && i.due_date < card.today;
          return (
            <div key={i.id} className="group flex items-start gap-2 rounded-xl px-2 py-1.5 -mx-2 hover:bg-muted/40">
              <button onClick={() => card.onStatus(i.id, st.next)} title={`${st.label} — clique pra mudar`}
                className={`mt-0.5 size-5 shrink-0 rounded-full grid place-items-center ${i.status === "concluida" ? "bg-emerald-500 text-white" : st.cls}`}>
                <st.icon className={i.status === "concluida" ? "size-3" : "size-4"} />
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-medium ${i.status === "concluida" ? "line-through text-muted-foreground" : ""}`}>{i.title}</p>
                {i.notes && i.status !== "concluida" && <p className="text-[11px] text-muted-foreground">{i.notes}</p>}
                {(i.project || i.owner_id) && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {i.owner_id && <span>{card.nameOf.get(i.owner_id) ?? "—"}</span>}
                    {i.owner_id && i.project && <span> · </span>}
                    {i.project && <span>Projeto {i.project.name} ({i.project.progress}%)</span>}
                  </p>
                )}
              </div>
              {i.due_date && (
                <span className={`mt-0.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5 whitespace-nowrap tabular-nums ${isLate ? "bg-rose-500/10 text-rose-600" : "bg-muted text-muted-foreground"}`}>{dm(i.due_date)}</span>
              )}
              <div className="flex opacity-0 group-hover:opacity-100 max-md:opacity-100">
                <button onClick={() => card.onEdit({ kind: "initiative", objectiveId: o.id, item: i })} className="size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground"><Pencil className="size-3" /></button>
                <button onClick={() => card.onRemove("initiative", i.id, "iniciativa")} className="size-6 rounded grid place-items-center text-muted-foreground hover:text-rose-600"><Trash2 className="size-3" /></button>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={() => card.onEdit({ kind: "initiative", objectiveId: o.id })} className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline"><Plus className="size-3.5" /> Iniciativa</button>
    </div>
  );
}

// Valor atual do resultado-chave: clique pra editar na linha.
function KrValue({ kr, onSave }: { kr: StrategyKr; onSave: (v: number) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (edit == null) {
    return (
      <button onClick={() => setEdit(String(kr.current_value))} title="Atualizar valor atual"
        className="text-xs font-semibold tabular-nums whitespace-nowrap rounded-md px-1.5 py-0.5 hover:bg-background border border-transparent hover:border-border">
        {fmtVal(kr.current_value, kr.unit)}
      </button>
    );
  }
  const commit = () => {
    const v = Number(edit.replace(",", "."));
    if (Number.isFinite(v) && v !== kr.current_value) onSave(v);
    setEdit(null);
  };
  return (
    <input autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(null); }}
      inputMode="decimal" className="w-20 h-6 rounded-md border border-primary bg-background px-1.5 text-xs font-semibold tabular-nums outline-none" />
  );
}

function EditDialog({ editing, quarter, members, projects, onClose, onSaved }: {
  editing: Editing; quarter: string; members: { id: string; name: string }[]; projects: { id: string; name: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const objFn = useServerFn(saveObjective);
  const krFn = useServerFn(saveKeyResult);
  const initFn = useServerFn(saveInitiative);
  const it: any = editing.item ?? {};
  const [title, setTitle] = useState<string>(it.title ?? "");
  const [description, setDescription] = useState<string>(it.description ?? "");
  const [notes, setNotes] = useState<string>(it.notes ?? "");
  const [owner, setOwner] = useState<string>(it.owner_id ?? "");
  const [unit, setUnit] = useState<KrUnit>(it.unit ?? "numero");
  const [start, setStart] = useState<string>(it.start_value != null ? String(it.start_value) : "0");
  const [target, setTarget] = useState<string>(it.target_value != null ? String(it.target_value) : "");
  const [current, setCurrent] = useState<string>(it.current_value != null ? String(it.current_value) : "0");
  const [due, setDue] = useState<string>(it.due_date ?? "");
  const [status, setStatusV] = useState<InitiativeStatus>(it.status ?? "a_fazer");
  const [project, setProject] = useState<string>(it.project?.id ?? "");
  const n = (s: string) => Number(s.replace(",", "."));
  const autoKr = editing.kind === "kr" && !!editing.item?.auto;

  const save = useMutation({
    mutationFn: async () => {
      if (editing.kind === "objective") {
        return objFn({ data: { id: editing.item?.id, quarter: editing.item?.quarter ?? quarter, title, description: description || null, owner_id: owner || null } });
      }
      if (editing.kind === "kr") {
        if (!Number.isFinite(n(target)) || target.trim() === "") throw new Error("Informe a meta");
        return krFn({ data: { id: editing.item?.id, objective_id: editing.objectiveId, title, unit, start_value: n(start) || 0, target_value: n(target), current_value: n(current) || 0 } });
      }
      return initFn({ data: { id: editing.item?.id, objective_id: editing.objectiveId, title, notes: notes || null, owner_id: owner || null, due_date: due || null, status, project_id: project || null } });
    },
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  });

  const heading = { objective: "objetivo", kr: "resultado-chave", initiative: "iniciativa" }[editing.kind];
  const placeholder = { objective: "Ex.: Reduzir reembolsos e chargebacks", kr: "Ex.: Taxa de reembolso abaixo de", initiative: "Ex.: Trocar fornecedor do produto X" }[editing.kind];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{editing.item ? "Editar" : "Novo"} {heading}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (title.trim()) save.mutate(); }}>
          <Field label="Título"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} className={inputCls} maxLength={160} /></Field>
          {editing.kind === "objective" && (
            <Field label="Por que importa (opcional)"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none" /></Field>
          )}
          {editing.kind === "kr" && (
            <>
              <Field label="Unidade">
                <select value={unit} onChange={(e) => setUnit(e.target.value as KrUnit)} className={inputCls}>
                  <option value="numero">Número</option><option value="pct">Porcentagem (%)</option><option value="usd">Dinheiro (US$)</option>
                </select>
              </Field>
              <div className={`grid gap-2 ${autoKr ? "grid-cols-2" : "grid-cols-3"}`}>
                <Field label="Início"><input value={start} onChange={(e) => setStart(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
                {!autoKr && <Field label="Atual"><input value={current} onChange={(e) => setCurrent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>}
                <Field label="Meta"><input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              </div>
              <p className="text-[11px] text-muted-foreground">{autoKr ? "O valor atual é medido pelo sistema." : "Pra meta de baixar (ex.: reembolso de 8% pra 4%), coloque início 8 e meta 4."}</p>
            </>
          )}
          {editing.kind === "initiative" && (
            <Field label="Como fazer (opcional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none" /></Field>
          )}
          {editing.kind !== "kr" && (
            <Field label="Responsável">
              <select value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls}>
                <option value="">Ninguém</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          )}
          {editing.kind === "initiative" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Prazo"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} /></Field>
                <Field label="Status">
                  <select value={status} onChange={(e) => setStatusV(e.target.value as InitiativeStatus)} className={inputCls}>
                    {(Object.keys(STATUS) as InitiativeStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Projeto ligado (opcional)">
                <select value={project} onChange={(e) => setProject(e.target.value)} className={inputCls}>
                  <option value="">Nenhum</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </>
          )}
          <DialogFooter className="pt-1">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-xl text-xs font-medium bg-muted hover:bg-muted/70">Cancelar</button>
            <button type="submit" disabled={!title.trim() || save.isPending}
              className="h-9 px-4 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, ChevronRight, CircleDollarSign, Clock, ExternalLink, FileText, FlaskConical, Headphones,
  Loader2, Megaphone, MessageSquareText, MoreHorizontal, Package, PackageSearch, RotateCcw, Settings2, ShieldAlert, Sparkles, Target, Truck, X,
} from "lucide-react";
import { US_TIME_ZONE, formatTimeUS, isoDateUS, isoTodayUS } from "@/lib/timezone";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getConsultant, runConsultantNow, requestConsultantAnalysis, setConsultantTipStatus, endConsultantTest, type TipStatus, type ConsultantReport } from "@/lib/consultant.functions";
import { getIntelOrders, type IntelOrder } from "@/lib/intel.functions";
import type { ConsultantTip, ConsultantTest } from "@/lib/consultant.server";

// Inteligência: central de decisões. Tela principal = problema → evidência →
// impacto → ação, em poucos segundos. A profundidade (evidências, padrões,
// cálculos, pedidos, linha do tempo) fica na gaveta "Ver análise".

export const Route = createFileRoute("/inteligencia")({
  beforeLoad: requireAuth,
  component: InteligenciaPage,
});

// ─── Rótulos e cores ──────────────────────────────────────────────────────────
type Prio = "critico" | "alto" | "medio" | "baixo" | "oportunidade";
const PRIO: Record<Prio, { label: string; chip: string; bar: string; value: string; icon: string; rank: number }> = {
  critico: { label: "CRÍTICO", chip: "bg-destructive text-white", bar: "border-l-destructive", value: "text-destructive", icon: "bg-destructive/10 text-destructive", rank: 0 },
  alto: { label: "ALTO", chip: "bg-orange-500 text-white", bar: "border-l-orange-500", value: "text-orange-500", icon: "bg-orange-500/10 text-orange-500", rank: 1 },
  medio: { label: "ATENÇÃO", chip: "bg-amber-400 text-white", bar: "border-l-amber-400", value: "text-amber-500", icon: "bg-amber-400/15 text-amber-600", rank: 2 },
  baixo: { label: "BAIXO", chip: "bg-muted-foreground/70 text-white", bar: "border-l-border", value: "text-muted-foreground", icon: "bg-surface text-muted-foreground", rank: 3 },
  oportunidade: { label: "OPORTUNIDADE", chip: "bg-success text-white", bar: "border-l-success", value: "text-success", icon: "bg-success/10 text-success", rank: 4 },
};
const CAT: Record<string, { label: string; icon: any }> = {
  chargeback: { label: "Chargeback", icon: ShieldAlert }, rastreamento: { label: "Rastreamento", icon: Truck },
  fornecedor: { label: "Fornecedor", icon: PackageSearch }, atendimento: { label: "Atendimento", icon: Headphones },
  reembolso: { label: "Reembolso", icon: RotateCcw }, financeiro: { label: "Financeiro", icon: CircleDollarSign },
  ads: { label: "Ads", icon: Megaphone }, metas: { label: "Metas", icon: Target }, operacao: { label: "Operação", icon: Settings2 },
};
// Análises antigas: objetivo/area/impacto no lugar de categoria/prioridade.
const OLD_CAT: Record<string, string> = { lucro: "financeiro", logistica: "rastreamento", outros: "operacao", pagamento: "chargeback", produtos: "operacao", anuncios: "ads", lojas: "operacao", paises: "operacao" };
const catOf = (t: ConsultantTip) => { const c = t.categoria ?? t.objetivo ?? t.area ?? "operacao"; return CAT[c] ? c : OLD_CAT[c] ?? "operacao"; };
const prioOf = (t: ConsultantTip): Prio => t.prioridade ?? (t.impacto === "alto" ? "alto" : t.impacto === "medio" ? "medio" : "baixo");
const firstSentence = (s?: string) => (s ?? "").split(/(?<=[.!?])\s/)[0] ?? "";
const fraseOf = (t: ConsultantTip) => t.frase ?? firstSentence(t.o_que_vi);
const CONF: Record<string, { label: string; level: number }> = { alta: { label: "Alta", level: 5 }, media: { label: "Média", level: 3 }, baixa: { label: "Baixa", level: 1 } };
const RESULT: Record<string, { label: string; done: boolean; ok?: boolean }> = {
  funcionou: { label: "Funcionou", done: true, ok: true }, provavelmente_funcionou: { label: "Provavelmente funcionou", done: false, ok: true },
  inconclusivo: { label: "Ainda inconclusivo", done: false }, provavelmente_nao_funcionou: { label: "Provavelmente não funcionou", done: false, ok: false },
  nao_funcionou: { label: "Não funcionou", done: true, ok: false },
};
const ORDER_STATUS: Record<IntelOrder["status"], { label: string; cls: string }> = {
  entregue: { label: "Entregue", cls: "bg-success/10 text-success" }, em_transito: { label: "Em trânsito", cls: "bg-primary/10 text-primary" },
  parado: { label: "Parado", cls: "bg-destructive/10 text-destructive" }, nao_postado: { label: "Não postado", cls: "bg-orange-500/10 text-orange-600" },
  sem_codigo: { label: "Sem código", cls: "bg-surface text-muted-foreground" },
};
const CB_REASON: Record<string, string> = {
  product_not_received: "não recebido", product_unacceptable: "produto não aceito", fraudulent: "fraude",
  credit_not_processed: "reembolso não processado", subscription_canceled: "assinatura cancelada", general: "geral", unrecognized: "não reconhecida",
};
const usd = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const usd2 = (x: number) => `US$ ${x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n1 = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
// Horários no fuso de Nova York (o do sistema).
function whenLabel(iso: string) {
  const day = isoDateUS(iso), hm = formatTimeUS(iso);
  return day === isoTodayUS() ? `hoje às ${hm}` : `${day.slice(8, 10)}/${day.slice(5, 7)} às ${hm}`;
}
const fmtDay = (iso?: string) => {
  if (!iso) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  if (!dateOnly && Number.isNaN(Date.parse(iso))) return iso;
  const day = dateOnly ? iso : isoDateUS(iso);
  return day === isoTodayUS() ? "hoje" : new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).replace(".", "");
};
type Tab = "agora" | "testando" | "concluido";
type TipItem = { tip: ConsultantTip; index: number; status: TipStatus | null };
type DrawerTab = "geral" | "pedidos" | "padroes" | "dados" | "historico";

// ─── Página ───────────────────────────────────────────────────────────────────
function InteligenciaPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getConsultant);
  const runFn = useServerFn(runConsultantNow);
  const statusFn = useServerFn(setConsultantTipStatus);
  const q = useQuery({ queryKey: ["consultant", null], queryFn: () => getFn({ data: { report_id: null } }) });
  const report = q.data?.report ?? null;
  const [tab, setTab] = useState<Tab>("agora");
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<"prioridade" | "valor">("prioridade");
  const [openTip, setOpenTip] = useState<{ item: TipItem; tab: DrawerTab } | null>(null);
  const [openTest, setOpenTest] = useState<ConsultantTest | null>(null);

  const askFn = useServerFn(requestConsultantAnalysis);
  const [askOpen, setAskOpen] = useState(false);
  const ask = useMutation({
    mutationFn: (pedido: string) => askFn({ data: { pedido } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["consultant"] }); qc.invalidateQueries({ queryKey: ["nav-badges"] });
      setTab("agora");
      toast.success(r.added ? `Análise pronta: ${r.added} ${r.added === 1 ? "dica nova" : "dicas novas"} em Agora` : "Análise pronta");
    },
    onError: (e: any) => toast.error(e.message ?? "A análise falhou"),
  });
  // Encerrar teste: sai de Testando e não entra mais na próxima análise.
  const endFn = useServerFn(endConsultantTest);
  const endTest = useMutation({
    mutationFn: (t: ConsultantTest) => endFn({ data: { report_id: report!.id, titulo: t.titulo, origem: t.origem || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["consultant"] }); qc.invalidateQueries({ queryKey: ["nav-badges"] }); toast.success("Teste encerrado"); },
    onError: (e: any) => toast.error(e.message ?? "Falha ao encerrar"),
  });
  const run = useMutation({
    mutationFn: () => runFn(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["consultant"] }); qc.invalidateQueries({ queryKey: ["nav-badges"] }); toast.success("Análise pronta"); },
    onError: (e: any) => toast.error(e.message ?? "A análise falhou"),
  });
  const setStatus = useMutation({
    mutationFn: (v: { index: number; status: TipStatus | null; motivo?: "ja_sei" | "sem_sentido" }) => statusFn({ data: { report_id: report!.id, ...v } }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["consultant"] }); qc.invalidateQueries({ queryKey: ["nav-badges"] });
      toast.success(v.status === "testando" ? "Movido para Testando" : v.status === "ignorada" ? "Ignorada" : v.status === "feita" ? "Concluída" : "Voltou para Agora");
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });

  const { items, tests } = useMemo(() => {
    if (!report) return { items: [] as TipItem[], tests: [] as ConsultantTest[] };
    return {
      items: report.result.dicas.map((tip, index) => ({ tip, index, status: (report.tipsStatus[String(index)]?.status ?? null) as TipStatus | null })),
      tests: report.result.testes_avaliados ?? [],
    };
  }, [report]);
  const byTab: Record<Tab, TipItem[]> = {
    agora: items.filter((i) => !i.status),
    testando: items.filter((i) => i.status === "testando"),
    concluido: items.filter((i) => i.status === "feita" || i.status === "ignorada"),
  };
  const testsRunning = tests.filter((t) => !RESULT[t.resultado]?.done);
  const testsDone = tests.filter((t) => RESULT[t.resultado]?.done);
  const counts: Record<Tab, number> = {
    agora: byTab.agora.length,
    testando: byTab.testando.length + testsRunning.length, concluido: byTab.concluido.length + testsDone.length,
  };
  const inTab = byTab[tab];
  const visible = inTab.filter((i) => !cat || catOf(i.tip) === cat).sort((a, b) => sort === "valor"
    ? (b.tip.valor_envolvido ?? 0) - (a.tip.valor_envolvido ?? 0)
    : PRIO[prioOf(a.tip)].rank - PRIO[prioOf(b.tip)].rank || (b.tip.valor_envolvido ?? 0) - (a.tip.valor_envolvido ?? 0));
  const catCounts = Object.keys(CAT).map((c) => ({ c, n: inTab.filter((i) => catOf(i.tip) === c).length })).filter((x) => x.n > 0);

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">Inteligência</h1>
          {report && <span className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">IA analisou seus dados {whenLabel(report.createdAt)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAskOpen(true)} disabled={ask.isPending}>
            {ask.isPending ? <><Loader2 className="size-4 animate-spin" /> Analisando seu pedido…</> : <><MessageSquareText className="size-4" /> Pedir análise</>}
          </Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <><Loader2 className="size-4 animate-spin" /> Analisando… (1-2 min)</> : <><Sparkles className="size-4" /> Analisar agora</>}
          </Button>
        </div>
      </div>

      <AskDialog open={askOpen} onOpenChange={setAskOpen} onSubmit={(pedido) => { setAskOpen(false); ask.mutate(pedido); }} />

      {q.isLoading ? (
        <div className="premium-card p-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
      ) : !report ? (
        <div className="premium-card p-8 text-center text-sm text-muted-foreground">
          Nenhuma análise ainda. Clique em <strong>Analisar agora</strong>.
        </div>
      ) : (
        <>
          {/* Estados de trabalho à esquerda; categoria e ordem à direita — uma linha só */}
          <div className="flex flex-col-reverse md:flex-row md:items-end justify-between gap-3 border-b border-border mb-5">
            <div className="flex gap-6 overflow-x-auto">
              {([["agora", "Agora"], ["testando", "Testando"], ["concluido", "Concluído"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} type="button" onClick={() => { setTab(k); setCat(null); }}
                  className={`pb-3 -mb-px border-b-2 text-sm font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {label}
                  <span className={`text-[11px] min-w-5 h-5 px-1.5 rounded-full grid place-items-center tabular-nums ${tab === k ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}>{counts[k]}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pb-2.5">
              {catCounts.length > 1 && (
                <select value={cat ?? ""} onChange={(e) => setCat(e.target.value || null)} aria-label="Categoria"
                  className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs">
                  <option value="">Todas as categorias ({inTab.length})</option>
                  {catCounts.map(({ c, n }) => <option key={c} value={c}>{CAT[c].label} ({n})</option>)}
                </select>
              )}
              {tab === "agora" && (
                <select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Ordenar por"
                  className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs">
                  <option value="prioridade">Ordenar: prioridade</option><option value="valor">Ordenar: valor</option>
                </select>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {tab === "testando" && testsRunning.map((t, i) => <TestRow key={`t${i}`} test={t} onOpen={() => setOpenTest(t)}
              onEnd={() => endTest.mutate(t)} />)}
            {tab === "concluido" && testsDone.map((t, i) => <TestRow key={`d${i}`} test={t} onOpen={() => setOpenTest(t)} />)}
            {visible.map((item) => (
              <TipCard key={item.index} item={item} saving={setStatus.isPending}
                onOpen={(t) => setOpenTip({ item, tab: t })}
                onStatus={(status, motivo) => setStatus.mutate({ index: item.index, status, motivo })} />
            ))}
            {visible.length === 0 && !(tab === "testando" && testsRunning.length) && !(tab === "concluido" && testsDone.length) && (
              <div className="premium-card p-6 text-sm text-muted-foreground text-center">
                {tab === "agora" ? "Nenhuma nova descoberta relevante nesta análise." : tab === "testando" ? "Nenhum teste em andamento." : "Nada concluído ainda."}
              </div>
            )}
          </div>
        </>
      )}

      {openTip && (
        <TipDrawer key={`${openTip.item.index}:${openTip.tab}`} open={openTip} report={report} saving={setStatus.isPending} onClose={() => setOpenTip(null)}
          onStatus={(index, status) => { setStatus.mutate({ index, status }); setOpenTip(null); }} />
      )}
      <TestDrawer test={openTest} onClose={() => setOpenTest(null)} />
    </PageShell>
  );
}

// ─── Card da recomendação ─────────────────────────────────────────────────────
const META_ICONS = [FileText, Package, Clock];
function TipCard({ item, saving, onOpen, onStatus }: {
  item: TipItem; saving: boolean; onOpen: (tab: DrawerTab) => void; onStatus: (s: TipStatus | null, motivo?: "ja_sei" | "sem_sentido") => void;
}) {
  const { tip, status } = item;
  const p = PRIO[prioOf(tip)];
  const c = CAT[catOf(tip)];
  const orders = tip.pedidos_afetados ?? [];
  const value = tip.valor_envolvido && tip.valor_tipo !== "nenhum" ? tip.valor_envolvido : 0;
  const isCustomers = catOf(tip) === "atendimento";
  return (
    <section className={`premium-card border-l-4 ${p.bar} p-4 sm:p-5 ${status === "ignorada" ? "opacity-60" : ""}`}>
      <div className="flex gap-3 sm:gap-4">
        <span className={`hidden sm:grid size-11 rounded-xl place-items-center shrink-0 ${p.icon}`}><c.icon className="size-5" /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold mb-1.5">
                <span className={`px-2 py-0.5 rounded ${p.chip}`}>{p.label}</span>
                <span className="px-2 py-0.5 rounded bg-primary/10 text-primary">{c.label}</span>
                {tip.do_pedido && <span className="px-2 py-0.5 rounded bg-primary text-primary-foreground inline-flex items-center gap-1"><MessageSquareText className="size-3" /> SEU PEDIDO</span>}
                {status === "testando" && <span className="px-2 py-0.5 rounded bg-primary text-primary-foreground">EM ANDAMENTO</span>}
                {status === "feita" && <span className="px-2 py-0.5 rounded bg-success text-white">FEITO</span>}
                {status === "ignorada" && <span className="px-2 py-0.5 rounded bg-surface text-muted-foreground">IGNORADA</span>}
              </div>
              <h3 className="text-lg font-bold leading-snug">{tip.titulo}</h3>
            </div>
            {value > 0 && (
              <div className="text-right shrink-0">
                <p className={`text-xl sm:text-2xl font-bold tabular-nums ${p.value}`}>{usd(value)}</p>
                <p className={`text-xs ${p.value}`}>{tip.valor_rotulo || (tip.valor_tipo === "estimado" ? "estimado" : "em risco")}</p>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{fraseOf(tip)}</p>
          {(tip.destaques?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5 text-xs">
              {tip.destaques!.slice(0, 3).map((d, i) => { const I = META_ICONS[i % 3]; return <span key={i} className="flex items-center gap-1.5"><I className="size-3.5 text-muted-foreground" /> {d}</span>; })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3.5">
            {orders.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => onOpen("pedidos")}>
                <Package className="size-3.5" /> {isCustomers ? "Ver clientes" : `Ver ${orders.length} ${orders.length === 1 ? "pedido" : "pedidos"}`}
              </Button>
            )}
            <button type="button" onClick={() => onOpen("geral")} className="text-sm text-primary font-medium px-2 hover:underline">Ver análise →</button>
            <div className="flex-1" />
            {!status && <Button size="sm" disabled={saving} onClick={() => onStatus("testando")}><CheckCircle2 className="size-3.5" /> {tip.acao || "Vou fazer"}</Button>}
            {status === "testando" && <Button size="sm" disabled={saving} onClick={() => onStatus("feita")}><CheckCircle2 className="size-3.5" /> Concluir</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline" aria-label="Mais opções"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!status && <DropdownMenuItem onClick={() => onStatus("ignorada", "ja_sei")}>Já sei disso</DropdownMenuItem>}
                {!status && <DropdownMenuItem onClick={() => onStatus("ignorada", "sem_sentido")}>Não faz sentido</DropdownMenuItem>}
                {!status && <DropdownMenuItem onClick={() => onStatus("feita")}>Já fiz</DropdownMenuItem>}
                {status && <DropdownMenuItem onClick={() => onStatus(null)}>Voltar para Agora</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Testes ───────────────────────────────────────────────────────────────────
function TestRow({ test, onOpen, onEnd }: { test: ConsultantTest; onOpen: () => void; onEnd?: () => void }) {
  const r = RESULT[test.resultado] ?? RESULT.inconclusivo;
  return (
    <section className="premium-card p-4 flex items-center gap-3">
      <span className="size-10 rounded-xl grid place-items-center bg-primary/10 text-primary shrink-0"><FlaskConical className="size-5" /></span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{test.titulo}</p>
        <p className="text-xs text-muted-foreground">
          {test.comecou_em ? `Começou ${fmtDay(test.comecou_em)} · ` : ""}
          <span className={r.ok === true ? "text-success font-medium" : r.ok === false ? "text-destructive font-medium" : ""}>{r.label}</span>
          {test.proxima_leitura && !r.done ? ` · Próxima análise: ${fmtDay(test.proxima_leitura)}` : ""}
        </p>
        {test.resumo_curto && <p className="text-xs text-muted-foreground mt-0.5 truncate">{test.resumo_curto}</p>}
      </div>
      <Button size="sm" variant="outline" onClick={onOpen}>Ver teste</Button>
      {onEnd && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline" aria-label="Mais opções"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onClick={onEnd}>Encerrar teste</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      )}
    </section>
  );
}

function TestDrawer({ test, onClose }: { test: ConsultantTest | null; onClose: () => void }) {
  const r = test ? RESULT[test.resultado] ?? RESULT.inconclusivo : null;
  const rows: [string, string | undefined][] = test ? [
    ["Hipótese", test.hipotese], ["Baseline", test.baseline], ["Métricas", test.metricas], ["Antes", test.antes], ["Depois", test.depois],
    ["Amostra", test.amostra], ["Período", test.periodo], ["Confiança", test.confianca ? CONF[test.confianca]?.label : undefined], ["Resultado", test.explicacao],
  ] : [];
  return (
    <Sheet open={!!test} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {test && r && (
          <>
            <SheetTitle className="flex items-center gap-2 pr-6"><FlaskConical className="size-5 text-primary" /> {test.titulo}</SheetTitle>
            <SheetDescription className={r.ok === true ? "text-success" : r.ok === false ? "text-destructive" : ""}>
              {r.label}{test.comecou_em ? ` · começou ${fmtDay(test.comecou_em)}` : ""}{test.proxima_leitura && !r.done ? ` · próxima análise ${fmtDay(test.proxima_leitura)}` : ""}
            </SheetDescription>
            <dl className="mt-5 space-y-3 text-sm">
              {rows.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border p-3"><dt className="text-xs font-medium text-muted-foreground mb-0.5">{k}</dt><dd className="whitespace-pre-line">{v}</dd></div>
              ))}
            </dl>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Gaveta "Ver análise" ─────────────────────────────────────────────────────
function TipDrawer({ open, report, saving, onClose, onStatus }: {
  open: { item: TipItem; tab: DrawerTab }; report: ConsultantReport | null; saving: boolean;
  onClose: () => void; onStatus: (index: number, s: TipStatus | null) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>(open.tab);
  const [orderOpen, setOrderOpen] = useState<IntelOrder | null>(null);
  const tip = open.item.tip;
  const orders = tip.pedidos_afetados ?? [];
  const ordersFn = useServerFn(getIntelOrders);
  const oq = useQuery({
    queryKey: ["intel-orders", report?.id, open.item.index], enabled: orders.length > 0,
    queryFn: () => ordersFn({ data: { numbers: orders } }), staleTime: 10 * 60_000,
  });
  const p = PRIO[prioOf(tip)];
  const c = CAT[catOf(tip)];
  const value = tip.valor_envolvido && tip.valor_tipo !== "nenhum" ? tip.valor_envolvido : 0;
  const status = open.item.status;
  const list = oq.data ?? [];
  const tabs: [DrawerTab, string][] = [["geral", "Visão geral"], ...(orders.length ? [["pedidos", `Pedidos (${orders.length})`] as [DrawerTab, string]] : []),
    ["padroes", "Padrões"], ["dados", "Dados"], ["historico", "Histórico"]];
  const statusAt = report?.tipsStatus[String(open.item.index)]?.at;

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col gap-0">
        <div className="p-5 pb-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${p.chip}`}>{p.label}</span>
          <div className="flex items-start gap-3 mt-3">
            <span className={`size-11 rounded-xl grid place-items-center shrink-0 ${p.icon}`}><c.icon className="size-5" /></span>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg leading-snug">{tip.titulo}</SheetTitle>
              <SheetDescription className={`font-semibold ${p.value}`}>{value > 0 ? `${usd(value)} ${tip.valor_rotulo || "em risco"}` : c.label}</SheetDescription>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-semibold mr-6 shrink-0">{c.label}</span>
          </div>
          <div className="flex gap-4 border-b border-border mt-4 text-sm overflow-x-auto">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setTab(k); setOrderOpen(null); }}
                className={`pb-2 -mb-px border-b-2 whitespace-nowrap ${tab === k ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground"}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
          {tab === "geral" && (
            <>
              <div>
                {tip.pedido && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 mb-4">
                    <p className="text-xs font-medium text-primary flex items-center gap-1.5 mb-0.5"><MessageSquareText className="size-3.5" /> Você pediu</p>
                    <p className="text-sm">{tip.pedido}</p>
                  </div>
                )}
                <h4 className="font-semibold mb-1">Por que a IA está sugerindo isso?</h4>
                <p className="text-muted-foreground">{tip.por_que ?? tip.o_que_vi}</p>
              </div>
              {(tip.evidencias?.length ?? 0) > 0 && (
                <div className="rounded-xl bg-surface p-4">
                  <h4 className="font-semibold mb-2">Principais evidências</h4>
                  <ul className="space-y-1.5">
                    {tip.evidencias!.map((e, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" /> {e}</li>)}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Confiança da análise</p>
                  <div className="flex items-center gap-2">
                    <span className="flex gap-0.5">{[1, 2, 3, 4, 5].map((n) => <span key={n} className={`h-2 w-3 rounded-sm ${n <= (CONF[tip.confianca]?.level ?? 1) ? "bg-amber-400" : "bg-border"}`} />)}</span>
                    <span>{CONF[tip.confianca]?.label}</span>
                  </div>
                  {tip.amostra_pequena && <p className="text-[11px] text-warning mt-1 flex items-center gap-1"><AlertTriangle className="size-3" /> Amostra pequena</p>}
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Impacto financeiro</p>
                  <p className={`text-xl font-bold tabular-nums ${p.value}`}>{value > 0 ? usd(value) : "—"}</p>
                  <p className="text-[11px] text-muted-foreground">{value > 0 ? (tip.valor_tipo === "estimado" ? "valor estimado" : "valor real") : "sem valor direto"}</p>
                </div>
              </div>
              {orders.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">Pedidos envolvidos ({orders.length})</h4>
                    <button type="button" onClick={() => setTab("pedidos")} className="text-xs text-primary font-medium">Ver todos</button>
                  </div>
                  <OrderList orders={list.slice(0, 4)} loading={oq.isLoading} onOpen={(o) => { setTab("pedidos"); setOrderOpen(o); }} />
                </div>
              )}
              {list[0] && (
                <div>
                  <h4 className="font-semibold mb-2">Linha do tempo do pedido {list[0].orderNumber}</h4>
                  <Milestones order={list[0]} />
                </div>
              )}
            </>
          )}

          {tab === "pedidos" && (orderOpen ? (
            <div>
              <button type="button" onClick={() => setOrderOpen(null)} className="text-xs text-primary font-medium mb-3">← Todos os pedidos</button>
              <OrderDetail order={orderOpen} />
            </div>
          ) : (
            <>
              <OrderList orders={list} loading={oq.isLoading} onOpen={setOrderOpen} />
              {!oq.isLoading && list.length < orders.length && (
                <p className="text-xs text-muted-foreground">Sem dados de rastreio para: {orders.filter((n) => !list.some((o) => o.orderNumber === n)).join(", ")}</p>
              )}
            </>
          ))}

          {tab === "padroes" && (
            <>
              <Block title="Padrões encontrados" text={tip.padroes} />
              <Block title="Comparação com o normal da operação" text={tip.comparacao_historica} />
              <Block title="Possíveis causas" text={tip.possivel_causa ?? tip.hipotese} />
              <Block title="Limitações da análise" text={tip.limitacoes} />
            </>
          )}

          {tab === "dados" && (
            <>
              {(tip.calculos?.length ?? 0) > 0 && (
                <div><h4 className="font-semibold mb-1.5">Cálculos</h4>
                  <ul className="space-y-1 text-muted-foreground">{tip.calculos!.map((x, i) => <li key={i} className="font-mono text-xs">{x}</li>)}</ul></div>
              )}
              <Block title="O que fazer" text={tip.teste} />
              <Block title="Como medir" text={tip.como_medir} />
              <Block title="Resultado esperado" text={tip.resultado_esperado} />
              {tip.o_que_vi && <Block title="Leitura completa" text={tip.o_que_vi} />}
              <details className="text-xs">
                <summary className="cursor-pointer text-primary">Números que a IA recebeu</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{JSON.stringify(report?.facts, null, 2)}</pre>
              </details>
            </>
          )}

          {tab === "historico" && (
            <ol className="space-y-3">
              <li className="flex gap-3"><span className="size-2.5 rounded-full bg-primary mt-1.5" />
                <div><p className="text-xs text-muted-foreground">{report ? whenLabel(report.createdAt) : ""}</p><p>Recomendação criada pela análise da IA</p></div></li>
              {status && statusAt && (
                <li className="flex gap-3"><span className="size-2.5 rounded-full bg-success mt-1.5" />
                  <div><p className="text-xs text-muted-foreground">{whenLabel(statusAt)}</p>
                    <p>{status === "testando" ? "Você decidiu fazer/testar" : status === "feita" ? "Marcada como concluída" : "Ignorada"}</p></div></li>
              )}
            </ol>
          )}
        </div>

        <div className="p-4 border-t border-border flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setTab("dados")}><ExternalLink className="size-4" /> Ver análise completa</Button>
          {!status ? (
            <Button className="flex-1" disabled={saving} onClick={() => onStatus(open.item.index, "testando")}><CheckCircle2 className="size-4" /> {tip.acao || "Vou fazer"}</Button>
          ) : status === "testando" ? (
            <Button className="flex-1" disabled={saving} onClick={() => onStatus(open.item.index, "feita")}><CheckCircle2 className="size-4" /> Concluir</Button>
          ) : (
            <Button className="flex-1" variant="outline" disabled={saving} onClick={() => onStatus(open.item.index, null)}><X className="size-4" /> Voltar para Agora</Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Block({ title, text }: { title: string; text?: string }) {
  if (!text) return null;
  return <div><h4 className="font-semibold mb-1">{title}</h4><p className="text-muted-foreground whitespace-pre-line">{text}</p></div>;
}

function orderMetric(o: IntelOrder) {
  if (o.deliveredToChargebackDays != null) return `${n1(o.deliveredToChargebackDays)} dias`;
  if (o.status === "parado" && o.daysSinceLastEvent != null) return `parado há ${n1(o.daysSinceLastEvent)}d`;
  return `${n1(o.daysSincePurchase)}d da compra`;
}

function OrderList({ orders, loading, onOpen }: { orders: IntelOrder[]; loading: boolean; onOpen: (o: IntelOrder) => void }) {
  if (loading) return <div className="py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  if (!orders.length) return <p className="text-xs text-muted-foreground">Sem dados de rastreio desses pedidos.</p>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {orders.map((o) => (
        <li key={o.orderNumber}>
          <button type="button" onClick={() => onOpen(o)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface">
            <span className="font-semibold w-24 shrink-0">{o.orderNumber}</span>
            <span className="tabular-nums text-muted-foreground w-24 shrink-0 hidden sm:inline">{usd2(o.revenue)}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${ORDER_STATUS[o.status].cls}`}>{ORDER_STATUS[o.status].label}</span>
            <span className="flex-1 text-right text-xs text-muted-foreground tabular-nums">{orderMetric(o)}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function OrderDetail({ order }: { order: IntelOrder }) {
  const [all, setAll] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-base font-semibold">{order.orderNumber} <span className="text-muted-foreground font-normal">· {usd2(order.revenue)}</span></p>
        <p className="text-xs text-muted-foreground">{order.shopName} · <span className="font-mono">{order.trackingCode ?? "sem código"}</span></p>
        <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
          <span className={`px-2 py-0.5 rounded font-medium ${ORDER_STATUS[order.status].cls}`}>{ORDER_STATUS[order.status].label}</span>
          {order.chargeback && <span className="px-2 py-0.5 rounded bg-destructive/10 text-destructive font-medium">Chargeback: {CB_REASON[order.chargeback.reason ?? ""] ?? order.chargeback.reason ?? "—"}</span>}
          {order.deliveredToChargebackDays != null && <span className="px-2 py-0.5 rounded border border-border">Entrega → chargeback: {n1(order.deliveredToChargebackDays)} dias</span>}
        </div>
      </div>
      {order.flags.length > 0 && (
        <ul className="rounded-xl bg-surface p-3 space-y-1 text-xs">{order.flags.map((f, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="size-3.5 text-warning shrink-0 mt-0.5" /> {f}</li>)}</ul>
      )}
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">Linha do tempo</h4>
        <button type="button" onClick={() => setAll((v) => !v)} className="text-xs text-primary font-medium">{all ? "Só as etapas principais" : "Todos os eventos do rastreio"}</button>
      </div>
      {all ? <AllEvents order={order} /> : <Milestones order={order} />}
    </div>
  );
}

// Etapas principais: compra, fornecedor, código, 1ª movimentação, trânsito, entrega, chargeback.
function Milestones({ order }: { order: IntelOrder }) {
  const s = order.steps;
  const first = (pred: (x: IntelOrder["steps"][number]) => boolean) => s.find(pred);
  const firstMove = first((x) => x.kind === "evento" && x.stage !== "info");
  const transit = first((x) => x.kind === "evento" && x !== firstMove && ["voo", "transito", "alfandega_destino", "transporte_local"].includes(x.stage ?? ""));
  const items = ([
    [first((x) => x.kind === "compra"), "Compra realizada"],
    [first((x) => x.kind === "fornecedor"), "Enviado ao fornecedor (pago)"],
    [first((x) => x.kind === "codigo"), "Código de rastreamento criado"],
    [firstMove, "Primeira movimentação"],
    [transit, "Em trânsito"],
    [first((x) => x.stage === "entregue" || x.kind === "entrega"), "Entregue"],
    [first((x) => x.kind === "chargeback"), "Chargeback aberto"],
  ] as const).filter(([x]) => x).map(([x, label]) => ({ at: x!.at, label, bad: x!.kind === "chargeback" }));
  if (items.length <= 1) return <p className="text-xs text-muted-foreground">Sem eventos de rastreio guardados para este pedido.</p>;
  return (
    <ol>
      {items.map((x, i) => (
        <li key={i} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <span className={`size-3 rounded-full mt-1 ${x.bad ? "bg-destructive" : "bg-success"}`} />
            {i < items.length - 1 && <span className="w-px h-6 bg-success/40" />}
          </div>
          <span className="text-xs text-muted-foreground w-12 shrink-0 tabular-nums mt-0.5">{new Date(x.at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: US_TIME_ZONE })}</span>
          <span className={`flex-1 ${x.bad ? "font-medium" : ""}`}>{x.label}</span>
          {x.bad && order.deliveredToChargebackDays != null && <span className="text-[11px] px-1.5 rounded bg-destructive/10 text-destructive">+{n1(order.deliveredToChargebackDays)} dias</span>}
        </li>
      ))}
    </ol>
  );
}

function AllEvents({ order }: { order: IntelOrder }) {
  return (
    <ol className="relative border-l border-border ml-2">
      {order.steps.map((x, i) => (
        <li key={i} className="ml-4 pb-3">
          <span className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ${x.kind === "chargeback" ? "bg-destructive" : x.stage === "entregue" ? "bg-success" : x.stage === "info" ? "bg-border" : "bg-primary"}`} />
          <p className="text-[11px] text-muted-foreground tabular-nums">{new Date(x.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: US_TIME_ZONE })}</p>
          <p className="font-medium">{x.label}</p>
          {x.detail && <p className="text-xs text-muted-foreground">{x.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

// "Pedir análise": o dono escreve o que quer investigar; a IA faz uma análise nova.
const ASK_EXAMPLES = [
  "Analisa os pedidos de setembro que ainda não foram entregues",
  "Os chargebacks têm alguma coisa em comum no rastreio?",
  "O fornecedor está demorando mais para postar nesta semana?",
];
function AskDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (v: boolean) => void; onSubmit: (pedido: string) => void }) {
  const [text, setText] = useState("");
  const ok = text.trim().length >= 5;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pedir análise</DialogTitle>
          <DialogDescription>Escreva o que você quer que a IA investigue. Ela analisa os pedidos, o rastreio, os chargebacks e o atendimento das lojas ativas e traz as dicas para a aba Agora.</DialogDescription>
        </DialogHeader>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={800} autoFocus
          placeholder="Ex.: analisa os pedidos parados há mais de 10 dias"
          className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
        <div className="flex flex-wrap gap-1.5">
          {ASK_EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => setText(e)} className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-surface">{e}</button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!ok} onClick={() => { onSubmit(text.trim()); setText(""); }}><Sparkles className="size-4" /> Analisar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

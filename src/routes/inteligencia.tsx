import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Brain, CheckCircle2, ChevronDown, FlaskConical, Loader2, Sparkles, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { Button } from "@/components/ui/button";
import { getConsultant, runConsultantNow, setConsultantTipStatus, type TipStatus } from "@/lib/consultant.functions";
import type { ConsultantTip } from "@/lib/consultant.server";

export const Route = createFileRoute("/inteligencia")({
  beforeLoad: requireAuth,
  component: ConsultorPage,
});

// Categoria da dica (análises antigas tinham objetivo/area no lugar).
const CATEGORIA: Record<string, string> = {
  chargeback: "Chargeback", rastreamento: "Rastreamento", fornecedor: "Fornecedor", atendimento: "Atendimento",
  reembolso: "Reembolso", financeiro: "Financeiro", ads: "Ads", metas: "Metas", operacao: "Operação",
  lucro: "Financeiro", logistica: "Rastreamento", outros: "Operação", pagamento: "Chargeback", produtos: "Operação", anuncios: "Ads", lojas: "Operação", paises: "Operação",
};
const catOf = (t: ConsultantTip) => t.categoria ?? t.objetivo ?? t.area ?? "operacao";
const PRIORIDADE: Record<string, { label: string; cls: string }> = {
  critico: { label: "Crítico", cls: "bg-destructive text-destructive-foreground border-destructive" },
  alto: { label: "Alto", cls: "border-destructive/40 text-destructive" },
  medio: { label: "Médio", cls: "border-warning/40 text-warning" },
  baixo: { label: "Baixo", cls: "border-border text-muted-foreground" },
  oportunidade: { label: "Oportunidade", cls: "border-success/40 text-success" },
};
const prioOf = (t: ConsultantTip) => t.prioridade ?? (t.impacto === "alto" ? "alto" : t.impacto === "medio" ? "medio" : "baixo");
const CONF: Record<string, string> = { alta: "Confiança alta", media: "Confiança média", baixa: "Confiança baixa" };
const RESULTADO: Record<string, string> = {
  funcionou: "funcionou", provavelmente_funcionou: "provavelmente funcionou", inconclusivo: "ainda inconclusivo",
  provavelmente_nao_funcionou: "provavelmente não funcionou", nao_funcionou: "não funcionou",
};
const STATUS: { key: TipStatus; label: string }[] = [
  { key: "testando", label: "Vou testar" }, { key: "feita", label: "Feito" }, { key: "ignorada", label: "Ignorar" },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function greeting(user: any) {
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false })) % 24;
  const name = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "").split(" ")[0];
  return `${h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"}${name ? `, ${name}` : ""}.`;
}

function ConsultorPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getConsultant);
  const runFn = useServerFn(runConsultantNow);
  const statusFn = useServerFn(setConsultantTipStatus);
  const [reportId, setReportId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["consultant", reportId], queryFn: () => getFn({ data: { report_id: reportId } }) });
  const report = q.data?.report ?? null;
  const history = q.data?.history ?? [];
  const [filter, setFilter] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => runFn(),
    onSuccess: (r) => { setReportId(r.id); qc.invalidateQueries({ queryKey: ["consultant"] }); toast.success("Análise pronta"); },
    onError: (e: any) => toast.error(e.message ?? "A análise falhou"),
  });
  const setStatus = useMutation({
    mutationFn: (v: { index: number; status: TipStatus | null }) => statusFn({ data: { report_id: report!.id, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consultant"] }),
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="size-6 text-primary" /> Inteligência
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {greeting(user)} A IA analisa a operação das lojas ativas — chargeback, rastreio, fornecedor e atendimento primeiro — e sugere testes. Você decide se faz sentido.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 1 && (
            <select value={report?.id ?? ""} onChange={(e) => setReportId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              {history.map((h) => <option key={h.id} value={h.id}>Análise de {fmtDate(h.createdAt)}</option>)}
            </select>
          )}
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <><Loader2 className="size-4 animate-spin" /> Analisando… (1-2 min)</> : <><Sparkles className="size-4" /> Analisar agora</>}
          </Button>
        </div>
      </div>


      {q.isLoading ? (
        <div className="premium-card p-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
      ) : !report ? (
        <div className="premium-card p-8 text-center text-sm text-muted-foreground">
          Nenhuma análise ainda. Clique em <strong>Analisar agora</strong> para a primeira.
        </div>
      ) : (
        <div className="space-y-5">
          <section className="premium-card p-5">
            <p className="text-xs text-muted-foreground mb-2">
              Análise de {fmtDate(report.createdAt)} · últimos 30 dias ({fmtDay(report.periodFrom)} a {fmtDay(report.periodTo)}) comparados com os 30 anteriores
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-line">{report.result.resumo}</p>
          </section>

          {report.result.testes_avaliados?.length > 0 && (
            <section className="premium-card p-5">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><FlaskConical className="size-4 text-primary" /> Testes em andamento</h2>
              <ul className="space-y-3">
                {report.result.testes_avaliados.map((t, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    {/(^|_)funcionou$/.test(t.resultado) && !/nao_funcionou/.test(t.resultado) ? <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" />
                      : /nao_funcionou/.test(t.resultado) ? <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                      : <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-medium">{t.titulo} · <span className="text-muted-foreground font-normal">
                        {RESULTADO[t.resultado] ?? t.resultado}</span></p>
                      <p className="text-muted-foreground">{t.explicacao}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(() => {
            const objs = [...new Set(report.result.dicas.map(catOf))];
            return objs.length > 1 && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={filter == null ? "default" : "outline"} onClick={() => setFilter(null)}>Todas ({report.result.dicas.length})</Button>
                {objs.map((o) => (
                  <Button key={o} size="sm" variant={filter === o ? "default" : "outline"} onClick={() => setFilter(o)}>
                    {CATEGORIA[o] ?? o} ({report.result.dicas.filter((t) => catOf(t) === o).length})
                  </Button>
                ))}
              </div>
            );
          })()}

          <div className="grid gap-4 lg:grid-cols-2">
            {report.result.dicas.map((tip, i) => (filter && catOf(tip) !== filter) ? null : (
              <TipCard key={i} tip={tip} status={report.tipsStatus[String(i)]?.status ?? null}
                saving={setStatus.isPending}
                onStatus={(s) => setStatus.mutate({ index: i, status: report.tipsStatus[String(i)]?.status === s ? null : s })} />
            ))}
          </div>

          <details className="premium-card p-5 text-xs">
            <summary className="cursor-pointer text-sm font-medium flex items-center gap-1.5">
              <ChevronDown className="size-4" /> Por que a IA está dizendo isso? Ver os números que ela usou
            </summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">{JSON.stringify(report.facts, null, 2)}</pre>
          </details>
        </div>
      )}
    </PageShell>
  );
}

function TipCard({ tip, status, saving, onStatus }: {
  tip: ConsultantTip; status: TipStatus | null; saving: boolean; onStatus: (s: TipStatus) => void;
}) {
  const muted = status === "ignorada" || status === "feita";
  const prio = PRIORIDADE[prioOf(tip)] ?? PRIORIDADE.baixo;
  const orders = tip.pedidos_afetados ?? [];
  return (
    <section className={`premium-card p-5 flex flex-col gap-3 ${muted ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`px-2 py-0.5 rounded-full border font-semibold ${prio.cls}`}>{prio.label}</span>
        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{CATEGORIA[catOf(tip)] ?? catOf(tip)}</span>
        <span className="px-2 py-0.5 rounded-full border border-border text-muted-foreground">{CONF[tip.confianca]}</span>
        {tip.amostra_pequena && (
          <span className="px-2 py-0.5 rounded-full border border-warning/40 text-warning inline-flex items-center gap-1">
            <AlertTriangle className="size-3" /> Amostra pequena
          </span>
        )}
        {!!tip.valor_envolvido && tip.valor_tipo !== "nenhum" && (
          <span className="px-2 py-0.5 rounded-full border border-border font-medium tabular-nums">
            ${tip.valor_envolvido.toLocaleString("en-US", { maximumFractionDigits: 0 })} {tip.valor_tipo === "estimado" ? "estimado" : "em jogo"}
          </span>
        )}
      </div>
      <h3 className="font-semibold leading-snug">{tip.titulo}</h3>
      <dl className="text-sm space-y-2">
        <div><dt className="text-xs font-medium text-muted-foreground">O que vi</dt><dd>{tip.o_que_vi}</dd></div>
        <div><dt className="text-xs font-medium text-muted-foreground">Possível causa</dt><dd>{tip.possivel_causa ?? tip.hipotese}</dd></div>
        <div><dt className="text-xs font-medium text-muted-foreground">Teste sugerido</dt><dd>{tip.teste}</dd></div>
        <div><dt className="text-xs font-medium text-muted-foreground">Como medir</dt><dd>{tip.como_medir}</dd></div>
        {tip.resultado_esperado && <div><dt className="text-xs font-medium text-muted-foreground">Resultado esperado</dt><dd>{tip.resultado_esperado}</dd></div>}
        {orders.length > 0 && (
          <div><dt className="text-xs font-medium text-muted-foreground">Pedidos ({orders.length})</dt>
            <dd className="text-xs font-mono text-muted-foreground break-words">{orders.join(" · ")}</dd></div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2 mt-auto pt-1">
        {STATUS.map((s) => (
          <Button key={s.key} size="sm" variant={status === s.key ? "default" : "outline"} disabled={saving} onClick={() => onStatus(s.key)}>
            {s.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

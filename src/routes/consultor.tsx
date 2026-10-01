import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, FlaskConical, Lightbulb, Loader2, Sparkles, XCircle } from "lucide-react";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { Button } from "@/components/ui/button";
import { getConsultant, runConsultantNow, setConsultantTipStatus, type TipStatus } from "@/lib/consultant.functions";
import type { ConsultantTip } from "@/lib/consultant.server";

export const Route = createFileRoute("/consultor")({
  beforeLoad: requireAuth,
  component: ConsultorPage,
});

const AREA: Record<string, string> = {
  pagamento: "Pagamento", chargeback: "Chargeback", produtos: "Produtos", anuncios: "Anúncios",
  lojas: "Lojas", logistica: "Logística", paises: "Países", outros: "Outros",
};
const IMPACT: Record<string, string> = { alto: "Impacto alto", medio: "Impacto médio", baixo: "Impacto baixo" };
const CONF: Record<string, string> = { alta: "Confiança alta", media: "Confiança média", baixa: "Confiança baixa" };
const STATUS: { key: TipStatus; label: string }[] = [
  { key: "testando", label: "Vou testar" }, { key: "feita", label: "Feito" }, { key: "ignorada", label: "Ignorar" },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function ConsultorPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getConsultant);
  const runFn = useServerFn(runConsultantNow);
  const statusFn = useServerFn(setConsultantTipStatus);
  const [reportId, setReportId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["consultant", reportId], queryFn: () => getFn({ data: { report_id: reportId } }) });
  const report = q.data?.report ?? null;
  const history = q.data?.history ?? [];

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
            <Lightbulb className="size-6 text-primary" /> Consultor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            A IA lê os números das lojas ativas e sugere testes. Roda sozinha toda segunda-feira.
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
                    {t.resultado === "funcionou" ? <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" />
                      : t.resultado === "nao_funcionou" ? <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                      : <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-medium">{t.titulo} · <span className="text-muted-foreground font-normal">
                        {t.resultado === "funcionou" ? "funcionou" : t.resultado === "nao_funcionou" ? "não funcionou" : "ainda inconclusivo"}</span></p>
                      <p className="text-muted-foreground">{t.explicacao}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {report.result.dicas.map((tip, i) => (
              <TipCard key={i} tip={tip} status={report.tipsStatus[String(i)]?.status ?? null}
                saving={setStatus.isPending}
                onStatus={(s) => setStatus.mutate({ index: i, status: report.tipsStatus[String(i)]?.status === s ? null : s })} />
            ))}
          </div>

          <details className="premium-card p-5 text-xs">
            <summary className="cursor-pointer text-sm font-medium flex items-center gap-1.5">
              <ChevronDown className="size-4" /> Números que a IA recebeu
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
  return (
    <section className={`premium-card p-5 flex flex-col gap-3 ${muted ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{AREA[tip.area] ?? tip.area}</span>
        <span className={`px-2 py-0.5 rounded-full border ${tip.impacto === "alto" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}>{IMPACT[tip.impacto]}</span>
        <span className="px-2 py-0.5 rounded-full border border-border text-muted-foreground">{CONF[tip.confianca]}</span>
        {tip.amostra_pequena && (
          <span className="px-2 py-0.5 rounded-full border border-warning/40 text-warning inline-flex items-center gap-1">
            <AlertTriangle className="size-3" /> Amostra pequena
          </span>
        )}
      </div>
      <h3 className="font-semibold leading-snug">{tip.titulo}</h3>
      <dl className="text-sm space-y-2">
        <div><dt className="text-xs font-medium text-muted-foreground">O que vi</dt><dd>{tip.o_que_vi}</dd></div>
        <div><dt className="text-xs font-medium text-muted-foreground">Hipótese</dt><dd>{tip.hipotese}</dd></div>
        <div><dt className="text-xs font-medium text-muted-foreground">Teste sugerido</dt><dd>{tip.teste}</dd></div>
        <div><dt className="text-xs font-medium text-muted-foreground">Como medir</dt><dd>{tip.como_medir}</dd></div>
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

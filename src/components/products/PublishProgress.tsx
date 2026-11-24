import { useEffect, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, Film, Loader2, Megaphone, Minimize2, RotateCcw, Users, X, XCircle, Image as ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { publishProgress, usePublishJobs, type Job, type Step, type StepGroup } from "@/lib/publish-progress";
import { cn } from "@/lib/utils";
import { MetaUsageBadge } from "@/components/products/MetaUsageBadge";
import { useConfirm } from "@/components/ui/confirm-dialog";

// Janela "Publicando campanha" + bolinha no canto quando minimizada. Montada no
// layout raiz: aparece em qualquer página enquanto a publicação roda.

const GROUP_LABEL: Record<StepGroup, string> = { campaign: "Campanha", media: "Mídias", adset: "Conjuntos", ad: "Anúncios" };
const GROUP_ICON = { campaign: Megaphone, media: Film, adset: Users, ad: ImageIcon } as const;

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const elapsed = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, "0")}s`; };

function summary(job: Job) {
  const done = job.steps.filter((s) => s.state === "ok" || s.state === "error").length;
  const ads = job.steps.filter((s) => s.group === "ad");
  return {
    done, total: job.steps.length, pct: job.steps.length ? Math.round((done / job.steps.length) * 100) : 0,
    adsOk: ads.filter((s) => s.state === "ok").length, adsTotal: ads.length, adsFailed: ads.filter((s) => s.state === "error").length,
  };
}

export function PublishProgressHost() {
  const jobs = usePublishJobs();
  const anyRunning = jobs.some((j) => j.status === "running");
  const now = useNow(anyRunning);
  const opened = jobs.find((j) => j.open);
  const minimized = jobs.filter((j) => !j.open);

  return (
    <>
      {opened && <ProgressDialog job={opened} now={now} />}
      {minimized.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end">
          {minimized.map((j) => <Chip key={j.id} job={j} />)}
        </div>
      )}
    </>
  );
}

function Chip({ job }: { job: Job }) {
  const s = summary(job);
  const running = job.status === "running";
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card soft-shadow-lg pl-1 pr-1.5 py-1">
      <button onClick={() => publishProgress.open(job.id, true)} className="flex items-center gap-2 rounded-full pl-2 pr-3 py-1 hover:bg-muted" title="Ver andamento">
        {running ? <Loader2 className="size-4 animate-spin text-primary" /> : job.status === "ok" ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className={cn("size-4", job.status === "partial" ? "text-warning" : "text-destructive")} />}
        <span className="text-xs font-medium max-w-[220px] truncate">{running ? `Publicando… ${s.pct}%` : job.status === "ok" ? "Campanha publicada" : `${s.adsFailed} anúncio(s) falharam`}</span>
        {running && <span className="w-16 h-1.5 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-primary transition-all" style={{ width: `${s.pct}%` }} /></span>}
      </button>
      {!running && (
        <button onClick={() => publishProgress.dismiss(job.id)} className="size-6 rounded-full grid place-items-center text-muted-foreground hover:bg-muted" title="Fechar">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function ProgressDialog({ job, now }: { job: Job; now: number }) {
  const confirm = useConfirm();
  const s = summary(job);
  const running = job.status === "running";
  const groups = (["campaign", "media", "adset", "ad"] as const).map((g) => ({ g, steps: job.steps.filter((x) => x.group === g) })).filter((x) => x.steps.length);
  // Fechar a janela durante a publicação só minimiza.
  const close = () => (running ? publishProgress.open(job.id, false) : publishProgress.dismiss(job.id));

  return (
    <Dialog open onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-border space-y-3">
          <div className="flex items-start gap-3 pr-6">
            <div className={cn("size-10 rounded-xl grid place-items-center shrink-0", running ? "bg-primary/10 text-primary" : job.status === "ok" ? "bg-success/15 text-success" : job.status === "partial" ? "bg-warning/15 text-warning" : "bg-destructive/10 text-destructive")}>
              {running ? <Loader2 className="size-5 animate-spin" /> : job.status === "ok" ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">
                {running ? "Publicando campanha" : job.status === "ok" ? "Campanha publicada" : job.status === "partial" ? "Publicada com falhas" : "Não foi publicada"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground truncate" title={job.title}>{job.title}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full transition-all duration-500", running ? "bg-primary" : job.status === "ok" ? "bg-success" : job.status === "partial" ? "bg-warning" : "bg-destructive")} style={{ width: `${running ? s.pct : 100}%` }} />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{running ? `${s.done} de ${s.total} etapas` : `${s.adsOk} de ${s.adsTotal} anúncio(s) criado(s)`}</span>
              <span className="tabular-nums">{elapsed((job.finishedAt ?? now) - job.startedAt)}</span>
            </div>
          </div>
          {running && job.videoDeadline && (
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs flex items-center justify-between gap-2">
              <span>Espera máxima pelos vídeos na Meta: <strong className="font-semibold">até {new Date(job.videoDeadline).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong></span>
              <span className="text-muted-foreground tabular-nums">faltam {elapsed(job.videoDeadline - now)}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {running ? <p className="text-xs text-muted-foreground">Pode minimizar e usar o sistema. Só não feche nem recarregue esta aba.</p> : <span />}
            <MetaUsageBadge adAccountId={job.adAccountId} live={running} />
          </div>
          {job.cancelled && running && <p className="text-xs text-warning">Cancelando… termina a etapa atual e para.</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {groups.map(({ g, steps }) => {
            const Icon = GROUP_ICON[g];
            const ok = steps.filter((x) => x.state === "ok").length;
            return (
              <div key={g}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="text-[13px] font-semibold">{GROUP_LABEL[g]}</span>
                  <span className="text-xs text-muted-foreground">{ok}/{steps.length}</span>
                </div>
                <div className="space-y-1">{steps.map((st) => <StepRow key={st.key} step={st} />)}</div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center gap-2 bg-background/40">
          {job.managerUrl && (
            <a href={job.managerUrl} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-lg border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-muted">
              Abrir no Gerenciador <ExternalLink className="size-3.5" />
            </a>
          )}
          {!running && s.adsFailed > 0 && job.onRetry && (
            <button onClick={() => { publishProgress.dismiss(job.id); job.onRetry!(); }} className="h-9 px-3 rounded-lg border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-muted">
              <RotateCcw className="size-3.5" /> Tentar de novo os que falharam
            </button>
          )}
          {running && !job.cancelled && (
            <button
              onClick={() => confirm({
                title: "Cancelar publicação?",
                description: "O sistema para depois da etapa atual. O que já foi criado (campanha, conjuntos, anúncios) continua na Meta; dá para apagar no Gerenciador ou completar depois com \"Tentar de novo\".",
                confirmText: "Cancelar publicação", cancelText: "Continuar publicando", variant: "destructive",
              }).then((yes) => yes && publishProgress.cancel(job.id))}
              className="h-9 px-3 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              Cancelar publicação
            </button>
          )}
          <div className="ml-auto">
            {running ? (
              <button onClick={() => publishProgress.open(job.id, false)} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5">
                <Minimize2 className="size-3.5" /> Minimizar
              </button>
            ) : (
              <button onClick={() => publishProgress.dismiss(job.id)} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Fechar</button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepRow({ step }: { step: Step }) {
  const color = step.state === "ok" ? "text-success" : step.state === "error" ? "text-destructive" : step.state === "running" ? "text-foreground" : "text-muted-foreground";
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg px-2 py-1.5", step.state === "running" && "bg-primary/5", step.state === "error" && "bg-destructive/5")}>
      <div className="mt-0.5 shrink-0">
        {step.state === "ok" ? <CheckCircle2 className="size-4 text-success" />
          : step.state === "error" ? <XCircle className="size-4 text-destructive" />
          : step.state === "running" ? <Loader2 className="size-4 animate-spin text-primary" />
          : <Circle className="size-4 text-muted-foreground/40" />}
      </div>
      {step.thumb && (
        <div className="relative w-6 aspect-[9/16] rounded overflow-hidden bg-muted shrink-0">
          {step.thumb.url && (step.thumb.video
            ? <video src={`${step.thumb.url}#t=0.1`} preload="metadata" muted playsInline className="absolute inset-0 w-full h-full object-cover" />
            : <img src={step.thumb.url} alt="" className="absolute inset-0 w-full h-full object-cover" />)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate" title={step.label}>{step.label}</div>
        {step.detail && <div className={cn("text-xs", color, step.state === "error" ? "whitespace-normal" : "truncate")}>{step.detail}</div>}
        {step.state === "running" && step.progress != null && (
          <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden max-w-[220px]"><div className="h-full bg-primary transition-all" style={{ width: `${step.progress}%` }} /></div>
        )}
      </div>
    </div>
  );
}

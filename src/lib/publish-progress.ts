import { useSyncExternalStore } from "react";

// Andamento das publicações de campanha (Lançamentos), fora da tela do produto:
// a publicação roda na aba do navegador e continua mesmo fechando o produto ou
// trocando de página; a janela (PublishProgressHost, no layout raiz) só mostra.
// Fechar ou recarregar a aba interrompe — por isso o aviso de beforeunload.

export type StepGroup = "campaign" | "media" | "adset" | "ad";
export type StepState = "pending" | "running" | "ok" | "error";
export type Step = {
  key: string; group: StepGroup; label: string; state: StepState;
  detail?: string; progress?: number | null; thumb?: { url?: string | null; video?: boolean };
};
export type Job = {
  id: string; title: string; startedAt: number; finishedAt?: number;
  status: "running" | "ok" | "partial" | "error";
  open: boolean; steps: Step[];
  managerUrl?: string; onRetry?: () => void;
};

let jobs: Job[] = [];
const listeners = new Set<() => void>();
const emit = () => { jobs = [...jobs]; listeners.forEach((l) => l()); };
const patchJob = (id: string, fn: (j: Job) => Job) => { jobs = jobs.map((j) => (j.id === id ? fn(j) : j)); emit(); };

export const publishProgress = {
  start(title: string, steps: Omit<Step, "state">[]): string {
    const id = crypto.randomUUID();
    jobs = [...jobs.filter((j) => j.status === "running"), { id, title, startedAt: Date.now(), status: "running", open: true, steps: steps.map((s) => ({ ...s, state: "pending" })) }];
    emit();
    return id;
  },
  step(id: string, key: string, patch: Partial<Omit<Step, "key" | "group">>) {
    patchJob(id, (j) => ({ ...j, steps: j.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  },
  set(id: string, patch: Partial<Job>) { patchJob(id, (j) => ({ ...j, ...patch })); },
  finish(id: string, status: Job["status"], extra: Partial<Job> = {}) {
    // Etapa que ficou pra trás (ex.: anúncio de mídia que falhou) vira erro.
    patchJob(id, (j) => ({
      ...j, ...extra, status, finishedAt: Date.now(),
      steps: j.steps.map((s) => (s.state === "pending" || s.state === "running" ? { ...s, state: "error", detail: s.detail ?? "Não foi feito" } : s)),
    }));
  },
  open(id: string, open: boolean) { patchJob(id, (j) => ({ ...j, open })); },
  dismiss(id: string) { jobs = jobs.filter((j) => j.id !== id); emit(); },
  running: () => jobs.some((j) => j.status === "running"),
};

export function usePublishJobs() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => jobs,
    () => jobs,
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!publishProgress.running()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

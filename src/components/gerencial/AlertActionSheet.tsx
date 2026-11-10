import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, ChevronRight, ExternalLink, EyeOff, ListTodo, Loader2, Lightbulb } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { getAlertDetail } from "@/lib/gerencial-alert-detail.functions";
import { createTask, listTaskAssignees, updateTask, TASK_AREAS } from "@/lib/tasks.functions";
import { saveTrackingPhase } from "@/lib/tracking-texts.functions";
import { PHASES, phaseLabel, type Phase } from "@/lib/tracking-phases";
import { isoTodayUS, US_TIME_ZONE } from "@/lib/timezone";

// Hora do evento no fuso de Nova York (dd/mm HH:mm).
const fmtNY = (ts: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: US_TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
};

// Gerencial › Alertas: gaveta de todo alerta que não é de rastreio (esses usam
// AlertOrdersSheet) — o que fazer, a lista pra resolver ali mesmo (concluir
// tarefa, classificar texto, abrir a disputa/conversa/pedido), o atalho pra tela,
// "Criar tarefa" (pra quem?) e Descartar. Pedido do usuário em 06/11/2026.

type Alert = { key: string; kind: string; level: "critico" | "atencao"; title: string; detail: string; link: string; action: string };

// O que fazer, por tipo de alerta.
function guideOf(a: Alert): string {
  const k = a.key;
  if (k === "meta") return "No ritmo atual o mês fecha abaixo da meta. Veja em Metas quais grupos estão abaixo e onde acelerar.";
  if (k.startsWith("prejuizo:")) return "Esse grupo está com lucro negativo nos últimos 7 dias. Abra o grupo e compare gasto de anúncio × vendas por dia.";
  if (k === "chargeback") return "Responda cada disputa na Shopify antes do prazo — sem resposta, perde automático. Clique na disputa pra abrir o pedido no admin.";
  if (k === "produto") return "Produtos com reembolso acima do limite. Veja na Análise de reembolsos o motivo e decida (trocar fornecedor, foto, descrição ou pausar).";
  if (k === "reembolso") return "Reembolso pedido na Shopify e ainda pendente. Veja na Análise de reembolsos e finalize.";
  if (k.startsWith("fora:sem_pagamento:")) return "Despachado sem pagamento ao fornecedor marcado. Se já pagou, marque no lote do fornecedor (aba Pedidos do grupo); se não, pague.";
  if (k.startsWith("fora:lojas:")) return "Deixe a loja igual nos dois lugares: coluna Ativas no Banco de Lojas e card ativo em Lojas e Grupos.";
  if (k === "rastreio:sem_fase") return "Escolha aqui a fase de cada texto — os prazos e a alfândega das transportadoras passam a contar certo.";
  if (k === "tarefa") return "Conclua aqui as que já foram feitas; as outras, cobre o responsável.";
  if (k === "atendimento") return "Cliente esperando resposta há mais de 36h — o caminho mais curto pro chargeback. Clique na conversa pra responder.";
  return "Abra a tela indicada e corrija. Se não for com você, crie uma tarefa pra quem resolve.";
}
const AREA_OF: [RegExp, (typeof TASK_AREAS)[number]][] = [
  [/^(meta|prejuizo)/, "gestao"], [/^chargeback/, "atendimento"], [/^(produto|reembolso)/, "produtos"],
  [/^fora:sem_pagamento/, "fornecedores"], [/^fora:lojas/, "lojas"], [/^rastreio/, "pedidos"], [/^atendimento/, "atendimento"],
  [/^meta_/, "marketing"], [/^(shopify|system)/, "sistema"],
];

export function AlertActionSheet({ alert, month, onClose, onDismiss, onGo }: {
  alert: Alert; month: string; onClose: () => void; onDismiss: () => void; onGo: (href: string) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fn = useServerFn(getAlertDetail);
  const q = useQuery({ queryKey: ["alert-detail", alert.key, month], queryFn: () => fn({ data: { key: alert.key, month } }) });
  const items = q.data?.items ?? [];
  const texts = q.data?.texts ?? [];

  // Concluir tarefa / classificar texto ali mesmo.
  const updFn = useServerFn(updateTask);
  const [done, setDone] = useState<Set<string>>(new Set());
  const finish = useMutation({
    mutationFn: (id: string) => updFn({ data: { id, patch: { status: "concluida" } } }),
    onSuccess: (_r, id) => { setDone((s) => new Set(s).add(id)); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["gerencial", month] }); toast.success("Tarefa concluída"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const phaseFn = useServerFn(saveTrackingPhase);
  const [phases, setPhases] = useState<Record<string, string>>({});
  const savePhase = useMutation({
    mutationFn: (v: { example: string; phase: Phase; key: string }) => phaseFn({ data: { example: v.example, phase: v.phase } }),
    onSuccess: (_r, v) => { setPhases((p) => ({ ...p, [v.key]: v.phase })); qc.invalidateQueries({ queryKey: ["gerencial", month] }); toast.success("Fase salva"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Criar tarefa (pergunta pra quem).
  const assigneesFn = useServerFn(listTaskAssignees);
  const [taskOpen, setTaskOpen] = useState(false);
  const [assignee, setAssignee] = useState("");
  const assignees = useQuery({ queryKey: ["task-assignees"], queryFn: () => assigneesFn(), enabled: taskOpen, staleTime: 5 * 60_000 });
  const createFn = useServerFn(createTask);
  const mkTask = useMutation({
    mutationFn: () => createFn({ data: {
      title: alert.title.slice(0, 200),
      description: [alert.detail, ...items.slice(0, 15).map((i) => `• ${i.title}${i.sub ? ` — ${i.sub}` : ""}`)].join("\n").slice(0, 2000),
      area: AREA_OF.find(([re]) => re.test(alert.key))?.[1] ?? "gestao",
      priority: alert.level === "critico" ? "alta" : "media", status: "pendente", due_date: isoTodayUS(), assignee_id: assignee || null,
    } }),
    onSuccess: () => { setTaskOpen(false); setAssignee(""); qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Tarefa criada", { action: { label: "Ver", onClick: () => navigate({ to: "/tarefas" }) } }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const open = (href: string) => onGo(href);
  const hasLink = !!alert.link;

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-0">
        <div className="p-5 sm:p-6 space-y-5">
          <div className="pr-6 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">{alert.title}</SheetTitle>
              <SheetDescription className="text-xs mt-1 whitespace-pre-line">{alert.detail}</SheetDescription>
            </div>
            <button onClick={onDismiss} title="Desconsiderar este alerta neste mês (some pra toda a equipe; dá pra voltar lá embaixo)"
              className="shrink-0 h-8 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5">
              <EyeOff className="size-3.5" /> Descartar
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-muted/30 p-4 flex gap-2.5">
            <Lightbulb className="size-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm">{guideOf(alert)}</p>
          </div>

          {q.isLoading ? <div className="py-10 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            : q.isError ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
            : (
              <>
                {texts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Textos sem fase · {texts.length}</p>
                    {texts.map((t) => (
                      <div key={t.key} className="rounded-xl border border-border p-3 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm break-words">{t.example}</p>
                            <p className="text-[11px] text-muted-foreground">{t.count} evento{t.count === 1 ? "" : "s"}</p>
                          </div>
                          <select value={phases[t.key] ?? ""} disabled={savePhase.isPending}
                            onChange={(e) => e.target.value && savePhase.mutate({ example: t.example, phase: e.target.value as Phase, key: t.key })}
                            className={`h-9 rounded-lg border px-2 text-xs ${phases[t.key] ? "border-emerald-500/50 bg-emerald-500/5" : "border-border bg-card"}`}>
                            <option value="">Escolher fase…</option>
                            {PHASES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                          </select>
                        </div>
                        {t.sample && t.sample.events.length > 1 && (
                          <div className="rounded-lg bg-muted/40 p-2.5 space-y-1.5">
                            <p className="text-[11px] text-muted-foreground">
                              Exemplo: <span className="font-medium text-foreground">{t.sample.order}</span>
                              {t.sample.tracking && <> · <span className="font-mono">{t.sample.tracking}</span></>} — onde o texto cai no caminho do pacote
                            </p>
                            <ol className="space-y-1">
                              {t.sample.events.map((e, i) => (
                                <li key={i} className={`grid grid-cols-[4.75rem_1fr] gap-2 text-[11px] leading-snug ${e.hit ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                                  <span className="tabular-nums">{fmtNY(e.ts)}</span>
                                  <span className="min-w-0 break-words">
                                    {e.d}
                                    <span className={`ml-1.5 inline-block rounded px-1 py-px text-[10px] font-medium ${e.hit ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
                                      {e.hit ? "este texto" : phaseLabel(e.phase)}
                                    </span>
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {items.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{items.length} {items.length === 1 ? "item" : "itens"}</p>
                    {items.map((i) => {
                      const isDone = i.taskId && done.has(i.taskId);
                      return (
                        <div key={i.id} className={`rounded-xl border p-3 flex items-center gap-3 ${isDone ? "border-emerald-500/40 bg-emerald-500/5" : "border-border"}`}>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium break-words ${isDone ? "line-through text-muted-foreground" : ""}`}>{i.title}</p>
                            {i.sub && <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{i.sub}</p>}
                          </div>
                          {i.taskId && !isDone && (
                            <button onClick={() => finish.mutate(i.taskId!)} disabled={finish.isPending}
                              className="shrink-0 h-8 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                              <Check className="size-3.5" /> Concluir
                            </button>
                          )}
                          {i.href && (
                            <button onClick={() => open(i.href!)} title="Abrir"
                              className="shrink-0 size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
                              {/^https?:/.test(i.href) ? <ExternalLink className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

          <div className="rounded-2xl border border-border p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {hasLink && (
                <button onClick={() => open(alert.link)}
                  className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5">
                  {alert.action === "Acertar" ? "Abrir onde acerta" : alert.action} {/^https?:/.test(alert.link) ? <ExternalLink className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
              )}
              <button onClick={() => setTaskOpen((v) => !v)}
                className="h-9 px-4 rounded-xl border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-muted">
                <ListTodo className="size-4" /> Criar tarefa
              </button>
            </div>
            {taskOpen && (
              <div className="flex flex-col sm:flex-row gap-2">
                <select autoFocus value={assignee} onChange={(e) => setAssignee(e.target.value)}
                  className="flex-1 h-9 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary">
                  <option value="">Pra quem?</option>
                  {(assignees.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button onClick={() => mkTask.mutate()} disabled={!assignee || mkTask.isPending}
                  className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                  {mkTask.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Criar
                </button>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">A tarefa leva o título, o detalhe e a lista deste alerta, com prazo hoje{alert.level === "critico" ? " e prioridade alta" : ""}.</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, CheckCircle2, ChevronDown, Clock, Loader2, Mail, Pause, Pencil, Play, Plus, Trash2, Users, Workflow, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  deleteEmailFlow, listEmailFlows, listFlowEnrollments, previewFlowAudience, saveEmailFlow, setEmailFlowStatus, stopFlowEnrollment,
  type EmailFlow, type FlowEnrollment,
} from "@/lib/email-flows.functions";
import {
  EMPTY_FILTERS, FLOW_DELIVERY, FLOW_FINANCIAL, FLOW_STOP_RULES, stepsSummary, type FlowFilters, type FlowStep,
} from "@/lib/email-flows";
import { listNoticeTemplates } from "@/lib/order-notices.functions";
import { customerOrderNumber } from "@/lib/order-notices";
import { US_TIME_ZONE } from "@/lib/timezone";

// Notificações › Fluxos: escolhe o público por filtro e monta uma sequência
// (e-mail, esperar, e-mail…). Campanha = público tirado uma vez, ao ativar;
// Automação = quem passa a bater no filtro entra sozinho.

const CARD = "rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(16,24,40,0.04)]";

const STATUS: Record<EmailFlow["status"], { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  ativo: { label: "Ativo", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  pausado: { label: "Pausado", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  concluido: { label: "Concluído", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
};
const MODE_LABEL = { campanha: "Campanha", continuo: "Automação" } as const;

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: US_TIME_ZONE }).replace(",", "");
const newId = () => Math.random().toString(36).slice(2, 10);

// "Loja 2 · compra há 5–20 dias · Em trânsito, Problema · sem chargeback"
function filtersSummary(f: FlowFilters, shops: { id: string; name: string }[]) {
  const out: string[] = [];
  out.push(f.shopIds.length ? shops.filter((s) => f.shopIds.includes(s.id)).map((s) => s.name).join(", ") || "Lojas inativas" : "Todas as lojas");
  if (f.purchase.kind === "dias" && (f.purchase.min != null || f.purchase.max != null)) {
    out.push(`compra há ${f.purchase.min ?? 0}–${f.purchase.max ?? "180"} dias`);
  }
  if (f.purchase.kind === "periodo" && (f.purchase.from || f.purchase.to)) {
    const d = (s: string | null) => (s ? s.split("-").reverse().slice(0, 2).join("/") : "…");
    out.push(`compra de ${d(f.purchase.from)} a ${d(f.purchase.to)}`);
  }
  if (f.delivery.length) out.push(f.delivery.map((k) => FLOW_DELIVERY.find((d) => d.key === k)?.label).join(", "));
  if (f.financial.length) out.push(f.financial.map((k) => FLOW_FINANCIAL.find((d) => d.key === k)?.label ?? k).join(", "));
  if (f.dispute !== "qualquer") out.push(f.dispute === "sem" ? "sem chargeback" : "com chargeback");
  if (f.support !== "qualquer") out.push(f.support === "sem" ? "não falou com o suporte" : "falou com o suporte");
  if (f.product) out.push(`produto "${f.product}"`);
  if (f.minValue != null || f.maxValue != null) out.push(`valor ${f.minValue ?? 0}–${f.maxValue ?? "∞"}`);
  return out.join(" · ");
}

export function EmailFlowsTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listFn = useServerFn(listEmailFlows);
  const statusFn = useServerFn(setEmailFlowStatus);
  const deleteFn = useServerFn(deleteEmailFlow);
  const q = useQuery({ queryKey: ["email-flows"], queryFn: () => listFn(), refetchInterval: 60_000 });
  const [editing, setEditing] = useState<EmailFlow | "novo" | null>(null);
  const [people, setPeople] = useState<EmailFlow | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["email-flows"] });
    qc.invalidateQueries({ queryKey: ["notice-queue"] });
  };
  const toggle = useMutation({
    mutationFn: (f: EmailFlow) => statusFn({ data: { id: f.id, status: f.status === "ativo" ? "pausado" : "ativo" } }),
    onSuccess: (r, f) => {
      toast.success(f.status === "ativo" ? "Fluxo pausado — e-mails dele na fila não saem" : `Fluxo ativo${r.enrolled ? ` — ${r.enrolled} entraram` : ""}`);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });
  const remove = useMutation({
    mutationFn: (f: EmailFlow) => deleteFn({ data: { id: f.id } }),
    onSuccess: () => { toast.success("Fluxo apagado"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const flows = q.data?.flows ?? [];
  const shops = q.data?.shops ?? [];

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div className="min-w-0">
          <p className="text-base font-semibold">Fluxos de e-mail</p>
          <p className="text-xs text-muted-foreground">Escolha quem recebe pelo filtro e monte a sequência. Os e-mails saem pela mesma fila dos avisos, 1 a cada 3 minutos.</p>
        </div>
        <Button onClick={() => setEditing("novo")}><Plus className="size-4" /> Novo fluxo</Button>
      </div>

      {q.isLoading ? (
        <div className="py-24 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : q.error ? (
        <div className="py-16 text-center text-sm text-destructive">{(q.error as Error).message}</div>
      ) : !flows.length ? (
        <div className={`${CARD} py-16 text-center`}>
          <Workflow className="size-7 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">Nenhum fluxo ainda</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Ex.: compra há 7–20 dias, sem rastreio → e-mail de desculpas → esperar 5 dias → e-mail de atualização.</p>
          <Button variant="outline" onClick={() => setEditing("novo")}><Plus className="size-4" /> Criar o primeiro</Button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {flows.map((f) => (
            <div key={f.id} className={`${CARD} p-4 flex flex-col gap-3 min-w-0`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{f.name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS[f.status].cls}`}>{STATUS[f.status].label}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium">{MODE_LABEL[f.mode]}</span>
                    <span className="text-xs text-muted-foreground">{stepsSummary(f.steps)}</span>
                  </div>
                </div>
                {f.status !== "concluido" && (
                  <Button size="sm" variant={f.status === "ativo" ? "outline" : "default"} disabled={toggle.isPending}
                    onClick={async () => {
                      if (f.status === "ativo") { toggle.mutate(f); return; }
                      if (await confirm({
                        title: `Ativar "${f.name}"?`,
                        description: f.mode === "campanha" && !f.activatedAt
                          ? "Quem bate no filtro agora entra na sequência e o 1º e-mail já vai pra fila."
                          : "Quem bate no filtro entra na sequência, e quem passar a bater depois também entra.",
                        confirmText: "Ativar",
                      })) toggle.mutate(f);
                    }}>
                    {f.status === "ativo" ? <><Pause className="size-3.5" /> Pausar</> : <><Play className="size-3.5" /> Ativar</>}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{filtersSummary(f.filters, shops)}</p>
              <div className="grid grid-cols-4 gap-px rounded-xl border border-border bg-border overflow-hidden text-center">
                <Stat label="Na sequência" value={f.counts.ativo} />
                <Stat label="Concluíram" value={f.counts.concluido} />
                <Stat label="Saíram" value={f.counts.parado} />
                <Stat label="E-mails" value={f.counts.emails} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setPeople(f)}><Users className="size-3.5" /> Contatos</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(f)}><Pencil className="size-3.5" /> Editar</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" disabled={remove.isPending}
                  onClick={async () => {
                    if (await confirm({ title: `Apagar "${f.name}"?`, description: "Quem está na sequência para de receber, e os e-mails dele que estão na fila não saem.", confirmText: "Apagar", variant: "destructive" })) remove.mutate(f);
                  }}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <FlowEditor flow={editing === "novo" ? null : editing} shops={shops} onClose={() => setEditing(null)} />}
      {people && <EnrollmentsDialog flow={people} onClose={() => setPeople(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card px-2 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// ─── Editor ───────────────────────────────────────────────────────────────────
// Três passos, um por vez: quem recebe → sequência → revisar e ativar.

const DEFAULT_STEPS: FlowStep[] = [
  { id: "a", type: "email", subject: "", body: "Hi {nome},\n\n" },
  { id: "b", type: "esperar", amount: 3, unit: "dias" },
  { id: "c", type: "email", subject: "", body: "Hi {nome},\n\n" },
];

// Filtros que dá pra pôr no público, um por linha.
type FilterKey = "lojas" | "compra" | "envio" | "pagamento" | "chargeback" | "suporte" | "produto" | "valor";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "lojas", label: "Lojas" },
  { key: "compra", label: "Data da compra" },
  { key: "envio", label: "Envio" },
  { key: "pagamento", label: "Pagamento" },
  { key: "chargeback", label: "Chargeback" },
  { key: "suporte", label: "Falou com o suporte" },
  { key: "produto", label: "Produto" },
  { key: "valor", label: "Valor do pedido" },
];
// Tirar a linha volta o filtro pro "qualquer".
const RESET: Record<FilterKey, Partial<FlowFilters>> = {
  lojas: { shopIds: [] },
  compra: { purchase: { kind: "dias", min: null, max: null } },
  envio: { delivery: [], deliveredMin: null, deliveredMax: null },
  pagamento: { financial: [] },
  chargeback: { dispute: "qualquer" },
  suporte: { support: "qualquer" },
  produto: { product: "" },
  valor: { minValue: null, maxValue: null },
};
// Chargeback/suporte entram como "sem" ao pôr a linha (a linha sozinha já filtra).
const ON_ADD: Partial<Record<FilterKey, Partial<FlowFilters>>> = { chargeback: { dispute: "sem" }, suporte: { support: "sem" } };
function activeFilterKeys(f: FlowFilters): FilterKey[] {
  const p = f.purchase;
  const on: Record<FilterKey, boolean> = {
    lojas: f.shopIds.length > 0,
    compra: p.kind === "dias" ? p.min != null || p.max != null : !!(p.from || p.to),
    envio: f.delivery.length > 0,
    pagamento: f.financial.length > 0,
    chargeback: f.dispute !== "qualquer",
    suporte: f.support !== "qualquer",
    produto: !!f.product,
    valor: f.minValue != null || f.maxValue != null,
  };
  return FILTERS.map((x) => x.key).filter((k) => on[k]);
}

const PAGES = ["Quem recebe", "Sequência", "Revisar"] as const;

function FlowEditor({ flow, shops, onClose }: { flow: EmailFlow | null; shops: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const saveFn = useServerFn(saveEmailFlow);
  const previewFn = useServerFn(previewFlowAudience);

  const [page, setPage] = useState(0);
  const [name, setName] = useState(flow?.name ?? "");
  const [mode, setMode] = useState<EmailFlow["mode"]>(flow?.mode ?? "campanha");
  const [filters, setFilters] = useState<FlowFilters>(flow?.filters ?? EMPTY_FILTERS);
  const [steps, setSteps] = useState<FlowStep[]>(flow?.steps ?? DEFAULT_STEPS);
  const [stopRules, setStopRules] = useState<string[]>(flow?.stopRules ?? ["respondeu", "reembolsado", "chargeback"]);
  const [rows, setRows] = useState<FilterKey[]>(() => {
    const on = activeFilterKeys(flow?.filters ?? EMPTY_FILTERS);
    return on.length ? on : ["compra"];
  });
  const set = (patch: Partial<FlowFilters>) => setFilters((f) => ({ ...f, ...patch }));

  // Prévia do público: espera parar de mexer no filtro.
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => { const t = setTimeout(() => setDebounced(filters), 600); return () => clearTimeout(t); }, [filters]);
  const audience = useQuery({
    queryKey: ["flow-audience", debounced], queryFn: () => previewFn({ data: { filters: debounced } }),
    staleTime: 60_000, retry: false,
  });
  const [showSample, setShowSample] = useState(false);

  const isActive = flow?.status === "ativo";
  const firstRun = !flow?.activatedAt;
  const emails = steps.filter((s) => s.type === "email");
  const stepsOk = emails.length > 0 && emails.every((s) => s.subject.trim() && s.body.trim());
  const ready = !!name.trim() && stepsOk;

  const save = useMutation({
    mutationFn: async (activate: boolean) => {
      if (activate && !(await confirm({
        title: "Ativar o fluxo?",
        description: mode === "campanha" && firstRun
          ? `${audience.data ? `${audience.data.count} ${audience.data.count === 1 ? "pessoa entra" : "pessoas entram"}` : "Quem bate no filtro entra"} agora e o 1º e-mail já vai pra fila. Depois disso ninguém mais entra.`
          : "Quem bate no filtro entra agora, e quem passar a bater depois também entra (a cada 10 minutos).",
        confirmText: "Ativar",
      }))) return null;
      return saveFn({ data: { id: flow?.id ?? null, name, mode, filters, steps, stopRules: stopRules as any, activate } });
    },
    onSuccess: (r, activate) => {
      if (!r) return;
      toast.success(activate ? `Fluxo ativo${r.enrolled ? ` — ${r.enrolled} entraram` : ""}` : "Fluxo salvo");
      qc.invalidateQueries({ queryKey: ["email-flows"] });
      qc.invalidateQueries({ queryKey: ["notice-queue"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const removeRow = (k: FilterKey) => { setRows((r) => r.filter((x) => x !== k)); set(RESET[k]); };
  const missing = FILTERS.filter((x) => !rows.includes(x.key));

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !save.isPending) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border/70">
          <DialogHeader>
            <DialogTitle>{flow ? "Editar fluxo" : "Novo fluxo"}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-4">
            {PAGES.map((p, i) => (
              <button key={p} type="button" onClick={() => setPage(i)}
                className={`flex items-center gap-2 text-sm ${i === page ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <span className={`size-6 rounded-full grid place-items-center text-xs ${i === page ? "bg-primary text-primary-foreground" : i < page ? "bg-primary/15 text-primary" : "bg-muted"}`}>
                  {i < page ? <CheckCircle2 className="size-3.5" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{p}</span>
                {i < PAGES.length - 1 && <span className="w-6 sm:w-10 h-px bg-border ml-1" />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-[320px]">
          {page === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Quem bate em <b className="text-foreground">todos</b> os filtros recebe. Sem filtro, entra todo mundo das lojas ativas (compras dos últimos 180 dias).</p>
              <div className="space-y-2">
                {rows.map((k) => (
                  <div key={k} className="flex items-start gap-3 rounded-xl border border-border p-3">
                    <span className="w-32 shrink-0 text-sm font-medium pt-1.5">{FILTERS.find((x) => x.key === k)!.label}</span>
                    <div className="flex-1 min-w-0">
                      <FilterControl k={k} filters={filters} set={set} shops={shops} />
                    </div>
                    <IconBtn label="Tirar filtro" onClick={() => removeRow(k)}><X className="size-3.5" /></IconBtn>
                  </div>
                ))}
              </div>
              {missing.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm"><Plus className="size-3.5" /> Adicionar filtro</Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-1">
                    {missing.map((x) => (
                      <button key={x.key} onClick={() => { setRows((r) => [...r, x.key]); if (ON_ADD[x.key]) set(ON_ADD[x.key]!); }}
                        className="w-full text-left px-2.5 py-1.5 rounded-md text-sm hover:bg-muted">{x.label}</button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
              {showSample && audience.data && (
                <div className="rounded-xl border border-border divide-y divide-border/60 text-xs">
                  {audience.data.sample.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 px-3 py-2 min-w-0">
                      <span className="font-medium whitespace-nowrap">{customerOrderNumber(a.orderNumber)}</span>
                      <span className="truncate min-w-0 flex-1 text-muted-foreground">{a.customerName} · {a.shopName}</span>
                      <span className="text-muted-foreground whitespace-nowrap">{FLOW_DELIVERY.find((d) => d.key === a.delivery)?.label}</span>
                    </div>
                  ))}
                  {audience.data.count > audience.data.sample.length && <p className="px-3 py-2 text-muted-foreground">e mais {audience.data.count - audience.data.sample.length}…</p>}
                </div>
              )}
              {flow?.activatedAt && mode === "campanha" && <Warn>Campanha já ativada: mudar o filtro não põe nem tira ninguém.</Warn>}
            </div>
          )}

          {page === 1 && (
            <div>
              <SequenceEditor steps={steps} setSteps={setSteps} />
              {isActive && <div className="mt-3"><Warn>Fluxo ativo: quem já está na sequência segue a partir do passo em que está, pela nova ordem.</Warn></div>}
            </div>
          )}

          {page === 2 && (
            <div className="space-y-5">
              <Field label="Nome do fluxo">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Atrasados sem rastreio" maxLength={120} />
              </Field>
              <Field label="Tipo">
                <div className="grid gap-2 sm:grid-cols-2">
                  {([["campanha", "Campanha", "Entra quem bate no filtro na hora de ativar, uma vez só."],
                    ["continuo", "Automação", "Quem passar a bater no filtro depois também entra, sozinho."]] as const).map(([k, l, d]) => (
                    <button key={k} type="button" disabled={!!flow?.activatedAt} onClick={() => setMode(k)}
                      className={`text-left rounded-xl border p-3 transition-colors disabled:opacity-60 ${mode === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                      <span className="text-sm font-medium block">{l}</span>
                      <span className="text-xs text-muted-foreground">{d}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Sai da sequência quando">
                <div className="space-y-1">
                  {FLOW_STOP_RULES.map((r) => (
                    <label key={r.key} className="flex items-center gap-2.5 py-1 cursor-pointer text-sm">
                      <Checkbox checked={stopRules.includes(r.key)}
                        onCheckedChange={(v) => setStopRules((cur) => (v ? [...cur, r.key] : cur.filter((k) => k !== r.key)))} />
                      {r.label}
                      <span className="text-xs text-muted-foreground hidden sm:inline">— {r.hint}</span>
                    </label>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">Pedido cancelado sempre sai.</p>
                </div>
              </Field>
              <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Público:</span> {filtersSummary(filters, shops)}</p>
                <p><span className="text-muted-foreground">Sequência:</span> {stepsSummary(steps)}</p>
                {!stepsOk && <p className="text-amber-700 dark:text-amber-400 text-xs pt-1">Falta assunto ou texto em algum e-mail da sequência.</p>}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-t border-border/70 bg-muted/20">
          <span className="flex items-center gap-2 text-sm mr-auto min-w-0">
            <Users className="size-4 text-muted-foreground shrink-0" />
            {audience.isFetching ? <Loader2 className="size-4 animate-spin" />
              : audience.error ? <span className="text-destructive truncate">{(audience.error as Error).message}</span>
              : <span><b>{audience.data?.count ?? 0}</b> {audience.data?.count === 1 ? "cliente" : "clientes"}</span>}
            {page === 0 && !!audience.data?.count && (
              <button className="text-xs text-primary hover:underline" onClick={() => setShowSample((v) => !v)}>{showSample ? "esconder" : "ver quem"}</button>
            )}
          </span>
          {page > 0 && <Button variant="ghost" onClick={() => setPage(page - 1)}>Voltar</Button>}
          {page < PAGES.length - 1 ? (
            <Button onClick={() => setPage(page + 1)} disabled={page === 1 && !stepsOk}>Próximo</Button>
          ) : (
            <>
              <Button variant={isActive ? "default" : "outline"} disabled={!ready || save.isPending} onClick={() => save.mutate(false)}>
                {isActive ? "Salvar alterações" : "Salvar rascunho"}
              </Button>
              {!isActive && flow?.status !== "concluido" && (
                <Button disabled={!ready || save.isPending} onClick={() => save.mutate(true)}>
                  {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Ativar
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterControl({ k, filters, set, shops }: {
  k: FilterKey; filters: FlowFilters; set: (p: Partial<FlowFilters>) => void; shops: { id: string; name: string }[];
}) {
  const p = filters.purchase;
  switch (k) {
    case "lojas":
      return <ShopPicker shops={shops} value={filters.shopIds} onChange={(v) => set({ shopIds: v })} />;
    case "compra":
      return (
        <div className="space-y-2">
          <Segmented value={p.kind}
            onChange={(kind) => set({ purchase: kind === "dias" ? { kind: "dias", min: null, max: null } : { kind: "periodo", from: null, to: null } })}
            options={[["dias", "Há X dias"], ["periodo", "Período"]]} />
          {p.kind === "dias" ? (
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
              entre <NumInput value={p.min} onChange={(min) => set({ purchase: { ...p, min } })} placeholder="0" />
              e <NumInput value={p.max} onChange={(max) => set({ purchase: { ...p, max } })} placeholder="180" /> dias atrás
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
              <Input type="date" className="h-9 w-40" value={p.from ?? ""} onChange={(e) => set({ purchase: { ...p, from: e.target.value || null } })} />
              até
              <Input type="date" className="h-9 w-40" value={p.to ?? ""} onChange={(e) => set({ purchase: { ...p, to: e.target.value || null } })} />
            </span>
          )}
        </div>
      );
    case "envio":
      return (
        <div className="space-y-2">
          <Chips options={FLOW_DELIVERY.map((d) => [d.key, d.label] as const)} value={filters.delivery} onChange={(v) => set({ delivery: v as any })} />
          {filters.delivery.includes("entregue") && (
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
              entregue entre <NumInput value={filters.deliveredMin} onChange={(v) => set({ deliveredMin: v })} placeholder="0" />
              e <NumInput value={filters.deliveredMax} onChange={(v) => set({ deliveredMax: v })} placeholder="∞" /> dias atrás
            </span>
          )}
        </div>
      );
    case "pagamento":
      return <Chips options={FLOW_FINANCIAL.map((d) => [d.key, d.label] as const)} value={filters.financial} onChange={(v) => set({ financial: v })} />;
    case "chargeback":
      return <Segmented value={filters.dispute} onChange={(v) => set({ dispute: v as any })} options={[["sem", "Sem chargeback"], ["com", "Com chargeback"]]} />;
    case "suporte":
      return <Segmented value={filters.support} onChange={(v) => set({ support: v as any })} options={[["sem", "Não falou"], ["com", "Já falou"]]} />;
    case "produto":
      return <Input value={filters.product} onChange={(e) => set({ product: e.target.value })} placeholder="Nome contém… (ex.: Sneaker)" className="h-9" />;
    case "valor":
      return (
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          de US$ <NumInput value={filters.minValue} onChange={(v) => set({ minValue: v })} placeholder="0" wide />
          a US$ <NumInput value={filters.maxValue} onChange={(v) => set({ maxValue: v })} placeholder="∞" wide />
        </span>
      );
  }
}

function ShopPicker({ shops, value, onChange }: { shops: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const label = !value.length ? "Escolha as lojas" : value.length === 1 ? shops.find((s) => s.id === value[0])?.name ?? "1 loja" : `${value.length} lojas`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="h-9 w-full max-w-xs px-3 rounded-lg border border-border bg-background text-sm text-left flex items-center gap-2">
          <span className={`flex-1 truncate ${value.length ? "" : "text-muted-foreground"}`}>{label}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1 max-h-72 overflow-y-auto">
        {shops.map((s) => (
          <label key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm hover:bg-muted cursor-pointer">
            <Checkbox checked={value.includes(s.id)} onCheckedChange={(v) => onChange(v ? [...value, s.id] : value.filter((x) => x !== s.id))} />
            {s.name}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// E-mails fechados (só o assunto) e a espera como uma linha fina entre eles.
function SequenceEditor({ steps, setSteps }: { steps: FlowStep[]; setSteps: (fn: (s: FlowStep[]) => FlowStep[]) => void }) {
  const tplFn = useServerFn(listNoticeTemplates);
  const templates = useQuery({ queryKey: ["notice-templates"], queryFn: () => tplFn() });
  const [open, setOpen] = useState<string | null>(() => steps.find((s) => s.type === "email" && !s.subject.trim())?.id ?? null);
  const update = (i: number, patch: Partial<FlowStep>) => setSteps((s) => s.map((x, j) => (j === i ? ({ ...x, ...patch } as FlowStep) : x)));
  const move = (i: number, d: -1 | 1) => setSteps((s) => { const n = [...s]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const remove = (i: number) => setSteps((s) => s.filter((_, j) => j !== i));
  let emailNo = 0;

  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        if (s.type === "esperar") {
          return (
            <div key={s.id} className="group flex items-center gap-2 pl-4 py-1 text-sm text-muted-foreground">
              <span className="w-px h-6 bg-border" />
              <Clock className="size-3.5" /> Esperar
              <NumInput value={s.amount} onChange={(v) => update(i, { amount: Math.max(1, v ?? 1) })} placeholder="1" />
              <select value={s.unit} onChange={(e) => update(i, { unit: e.target.value as "dias" | "horas" })}
                className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground">
                <option value="dias">dias</option>
                <option value="horas">horas</option>
              </select>
              <span className="ml-auto opacity-0 group-hover:opacity-100 flex">
                <IconBtn label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></IconBtn>
                <IconBtn label="Descer" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></IconBtn>
                <IconBtn label="Tirar" onClick={() => remove(i)}><X className="size-3.5" /></IconBtn>
              </span>
            </div>
          );
        }
        emailNo++;
        const isOpen = open === s.id;
        const incomplete = !s.subject.trim() || !s.body.trim();
        return (
          <div key={s.id} className={`rounded-xl border ${isOpen ? "border-primary/50" : "border-border"}`}>
            <div className="group flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={() => setOpen(isOpen ? null : s.id)}>
              <span className="size-7 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0"><Mail className="size-3.5" /></span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">E-mail {emailNo}</p>
                <p className={`text-xs truncate ${incomplete ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {s.subject.trim() || "Sem assunto ainda — clique pra escrever"}
                </p>
              </div>
              <span className="opacity-0 group-hover:opacity-100 flex" onClick={(e) => e.stopPropagation()}>
                <IconBtn label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></IconBtn>
                <IconBtn label="Descer" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></IconBtn>
                <IconBtn label="Tirar" onClick={() => remove(i)}><X className="size-3.5" /></IconBtn>
              </span>
              <ChevronDown className={`size-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </div>
            {isOpen && (
              <div className="px-3 pb-3 space-y-2 border-t border-border/60 pt-3">
                {!!templates.data?.length && (
                  <select value="" onChange={(e) => {
                    const t = templates.data!.find((x) => x.id === e.target.value);
                    if (t) update(i, { subject: t.subject, body: t.body });
                  }} className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-muted-foreground">
                    <option value="">Usar uma mensagem pronta…</option>
                    {templates.data!.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                )}
                <Input value={s.subject} onChange={(e) => update(i, { subject: e.target.value })} placeholder="Assunto" className="h-9" />
                <Textarea value={s.body} onChange={(e) => update(i, { body: e.target.value })} rows={7} placeholder="Texto do e-mail" className="text-sm" />
                <p className="text-[11px] text-muted-foreground">Use {"{nome}"}, {"{pedido}"} e {"{rastreio}"}. Vai com a assinatura do Atendimento.</p>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex gap-2 pt-2">
        <Button size="sm" variant="outline" onClick={() => {
          const id = newId();
          setSteps((s) => [...s, { id, type: "email", subject: "", body: "Hi {nome},\n\n" }]);
          setOpen(id);
        }}>
          <Plus className="size-3.5" /> E-mail
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSteps((s) => [...s, { id: newId(), type: "esperar", amount: 3, unit: "dias" }])}>
          <Plus className="size-3.5" /> Espera
        </Button>
      </div>
    </div>
  );
}

// ─── Contatos do fluxo ────────────────────────────────────────────────────────

const ENROLL_STATUS: Record<FlowEnrollment["status"], { label: string; cls: string }> = {
  ativo: { label: "Na sequência", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  concluido: { label: "Concluiu", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  parado: { label: "Saiu", cls: "bg-muted text-muted-foreground" },
};

function EnrollmentsDialog({ flow, onClose }: { flow: EmailFlow; onClose: () => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listFlowEnrollments);
  const stopFn = useServerFn(stopFlowEnrollment);
  const q = useQuery({ queryKey: ["flow-enrollments", flow.id], queryFn: () => listFn({ data: { flowId: flow.id } }) });
  const [tab, setTab] = useState<"todos" | FlowEnrollment["status"]>("todos");
  const stop = useMutation({
    mutationFn: (id: string) => stopFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Tirado do fluxo");
      qc.invalidateQueries({ queryKey: ["flow-enrollments", flow.id] });
      qc.invalidateQueries({ queryKey: ["email-flows"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });
  const rows = (q.data ?? []).filter((r) => tab === "todos" || r.status === tab);
  const totalEmails = flow.steps.filter((s) => s.type === "email").length;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contatos — {flow.name}</DialogTitle>
          <DialogDescription>Quem entrou no fluxo, em que passo está e por que saiu. Horários de Nova York.</DialogDescription>
        </DialogHeader>
        <Segmented value={tab} onChange={(v) => setTab(v as any)}
          options={[["todos", `Todos (${q.data?.length ?? 0})`], ["ativo", `Na sequência (${flow.counts.ativo})`], ["concluido", `Concluíram (${flow.counts.concluido})`], ["parado", `Saíram (${flow.counts.parado})`]]} />
        {q.isLoading ? (
          <div className="py-16 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : !rows.length ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-6 mx-auto mb-2 text-muted-foreground/60" />
            {flow.status === "rascunho" ? "Ative o fluxo pra começar." : "Ninguém aqui."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border text-left">
                  <th className="font-medium py-2 pr-2">Pedido</th>
                  <th className="font-medium py-2 px-2">E-mail</th>
                  <th className="font-medium py-2 px-2">Progresso</th>
                  <th className="font-medium py-2 px-2">Situação</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <p className="font-semibold">{customerOrderNumber(r.orderNumber)}</p>
                      <p className="text-[11px] text-muted-foreground">{r.shopName}</p>
                    </td>
                    <td className="py-2 px-2 max-w-[220px] truncate" title={r.email}>{r.email}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{r.emailsSent}/{totalEmails} e-mails</td>
                    <td className="py-2 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${ENROLL_STATUS[r.status].cls}`}>{ENROLL_STATUS[r.status].label}</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {r.status === "ativo" ? `próximo passo ${fmtDateTime(r.nextAt)}`
                          : r.status === "parado" ? `${r.stopReason ?? ""}${r.finishedAt ? ` · ${fmtDateTime(r.finishedAt)}` : ""}`
                          : r.finishedAt ? fmtDateTime(r.finishedAt) : ""}
                      </p>
                    </td>
                    <td className="py-2 pl-2 text-right">
                      {r.status === "ativo" && (
                        <button onClick={() => stop.mutate(r.id)} disabled={stop.isPending}
                          className="text-[11px] text-muted-foreground hover:text-destructive whitespace-nowrap">Tirar do fluxo</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Peças ────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-xs font-medium text-muted-foreground block mb-1">{label}</span>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options, disabled }: {
  value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[]; disabled?: boolean;
}) {
  return (
    <div className={`inline-flex flex-wrap gap-1 p-1 rounded-lg bg-muted ${disabled ? "opacity-60" : ""}`}>
      {options.map(([k, l]) => (
        <button key={k} type="button" disabled={disabled} onClick={() => onChange(k)}
          className={`h-7 px-3 rounded-md text-xs font-medium whitespace-nowrap ${value === k ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

// Vários marcados; nenhum marcado = qualquer um.
function Chips({ options, value, onChange, emptyLabel }: {
  options: readonly (readonly [string, string])[]; value: string[]; onChange: (v: string[]) => void; emptyLabel?: string;
}) {
  const chip = (on: boolean) => `h-7 px-2.5 rounded-lg border text-xs font-medium transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="flex flex-wrap gap-1.5">
      {emptyLabel && <button type="button" className={chip(!value.length)} onClick={() => onChange([])}>{emptyLabel}</button>}
      {options.map(([k, l]) => (
        <button key={k} type="button" className={chip(value.includes(k))}
          onClick={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])}>
          {l}
        </button>
      ))}
    </div>
  );
}

function NumInput({ value, onChange, placeholder, wide }: { value: number | null; onChange: (v: number | null) => void; placeholder: string; wide?: boolean }) {
  return (
    <Input inputMode="numeric" value={value ?? ""} placeholder={placeholder} className={`h-9 ${wide ? "w-24" : "w-16"} text-center`}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, "");
        onChange(v === "" ? null : Math.min(Number(v), wide ? 100_000 : 365));
      }} />
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="size-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30">
      {children}
    </button>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return <p className="text-xs text-amber-800 dark:text-amber-300">{children}</p>;
}

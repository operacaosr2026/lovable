import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  KINDS, KIND_LABEL, METRICS, METRIC_LABEL, RESULT_LABEL, STATUSES, STATUS_LABEL,
  createExperiment, deleteExperiment, listProductExperiments, updateExperiment,
  type Experiment, type Kind, type Metric, type Result, type Status,
} from "@/lib/experiments.functions";
import { ExperimentView } from "@/components/products/ExperimentView";
import { ProductClarityBar } from "@/components/products/ProductClarityBar";
import { BASELINE_METRICS, FORMAT_UNIT, SOURCE_LABEL, type MetricSource } from "@/lib/experiment-metrics";

// Aba Inteligência › Testes do produto: Ideias → Testando → Concluído
// (Validado, Inconclusivo ou Rejeitado).
// Iniciar e concluir viram registro no Diário (feito no servidor).

const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const areaCls = "px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 resize-y";

export const RESULT_CLS: Record<Result, string> = {
  won: "bg-emerald-500/10 text-emerald-600", lost: "bg-destructive/10 text-destructive", tie: "bg-muted text-muted-foreground",
};
const RESULT_DOT: Record<Result, string> = { won: "bg-emerald-500", lost: "bg-destructive", tie: "bg-muted-foreground/50" };
const HINT: Record<Status, string> = {
  idea: "O que você quer testar",
  running: "No ar agora",
  done: "Validado, inconclusivo ou rejeitado",
};
const RESULT_ORDER: Result[] = ["won", "tie", "lost"];

export function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

type Opt = { id: string; name: string };
type Editing = Experiment | { status: Status };

export function ProductExperiments({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const QK = ["product-experiments", productId];
  const getFn = useServerFn(listProductExperiments);
  const updateFn = useServerFn(updateExperiment);
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: () => getFn({ data: { product_id: productId } }) });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: QK });
    qc.invalidateQueries({ queryKey: ["product-diary", productId] });
    qc.invalidateQueries({ queryKey: ["learnings"] });
  };
  const move = useMutation({
    mutationFn: (v: { id: string; status: Status }) => updateFn({ data: v }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Não foi possível carregar os testes."}</p>;

  const running = data.experiments.filter((e) => e.status === "running");
  // Dois testes no ar no mesmo produto misturam o resultado (a não ser que sejam em lojas diferentes).
  const clash = (e: Experiment) => running.some((o) => o.id !== e.id && (!o.shop_id || !e.shop_id || o.shop_id === e.shop_id));

  return (
    <div>
      <ProductClarityBar productId={productId} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STATUSES.map((status, idx) => {
          const items = data.experiments.filter((e) => e.status === status);
          return (
            <section key={status} className="rounded-2xl bg-muted/40 p-3 flex flex-col gap-2 min-h-[160px]">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-semibold">{STATUS_LABEL[status]}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                <button onClick={() => setEditing({ status })} title="Novo teste" className="ml-auto size-7 rounded-lg grid place-items-center text-muted-foreground hover:bg-background hover:text-foreground">
                  <Plus className="size-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground px-1 -mt-1">{HINT[status]}</p>
              {items.map((e) => (
                <article key={e.id} onClick={() => setViewingId(e.id)}
                  className="group premium-card rounded-[10px]! pl-3 pr-1.5 py-2 cursor-pointer hover:border-primary/40 flex items-center gap-2">
                  {e.result && <span title={RESULT_LABEL[e.result]} className={`size-2 rounded-full shrink-0 ${RESULT_DOT[e.result]}`} />}
                  <p className="text-sm font-medium flex-1 min-w-0 truncate" title={e.title}>{e.title}</p>
                  {e.status === "running" && clash(e) && (
                    <span title="Outro teste no ar ao mesmo tempo"><AlertTriangle className="size-3.5 text-amber-600 shrink-0" /></span>
                  )}
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground">
                    {idx > 0 && (
                      <button onClick={(ev) => { ev.stopPropagation(); move.mutate({ id: e.id, status: STATUSES[idx - 1] }); }} title="Voltar" className="size-6 rounded-md grid place-items-center hover:bg-muted">
                        <ChevronLeft className="size-3.5" />
                      </button>
                    )}
                    {idx < 2 && (
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          // Concluir pede o resultado: abre o cartão já em Concluído.
                          if (STATUSES[idx + 1] === "done") setEditing({ ...e, status: "done" });
                          else move.mutate({ id: e.id, status: STATUSES[idx + 1] });
                        }}
                        title="Avançar" className="size-6 rounded-md grid place-items-center hover:bg-muted">
                        <ChevronRight className="size-3.5" />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground mt-3">Ao iniciar e ao concluir um teste, um registro entra automaticamente no Diário.</p>

      {viewingId && data.experiments.some((e) => e.id === viewingId) && (
        <ExperimentView experiment={data.experiments.find((e) => e.id === viewingId)!}
          onEdit={() => setEditing(data.experiments.find((e) => e.id === viewingId)!)} onClose={() => setViewingId(null)} />
      )}
      {editing && (
        <ExperimentDialog key={"id" in editing ? editing.id : "new"} productId={productId} initial={editing} shops={data.shops} campaigns={data.campaigns}
          onSaved={refresh} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

type Form = {
  campaign_id: string | null; baseline: Record<string, string>; kind: Kind; title: string; hypothesis: string; control: string; variant: string; shop_id: string | null;
  metric: Metric; stop_rule: string; budget: string; status: Status; result: Result | null; learning: string;
  started_at: string; ended_at: string;
};

function ExperimentDialog({ productId, initial, shops, campaigns, onSaved, onClose }: {
  productId: string; initial: Editing; shops: Opt[]; campaigns: Opt[]; onSaved: () => void; onClose: () => void;
}) {
  const confirm = useConfirm();
  const createFn = useServerFn(createExperiment);
  const updateFn = useServerFn(updateExperiment);
  const deleteFn = useServerFn(deleteExperiment);
  const existing = "id" in initial ? initial : null;
  const [f, setF] = useState<Form>(() => existing ? {
    ...existing, budget: existing.budget?.toString() ?? "", started_at: existing.started_at ?? "", ended_at: existing.ended_at ?? "",
    baseline: Object.fromEntries(Object.entries(existing.baseline ?? {}).map(([k, v]) => [k, String(v)])),
  } : {
    campaign_id: null, baseline: {}, kind: "creative", title: "", hypothesis: "", control: "", variant: "", shop_id: null, metric: "cpa",
    stop_rule: "", budget: "", status: initial.status, result: null, learning: "", started_at: "", ended_at: "",
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const num = (v: string) => Number(v.trim().replace(",", "."));
  const budget = f.budget.trim() ? num(f.budget) : null;
  const budgetOk = budget === null || Number.isFinite(budget);
  const baselineEntries = Object.entries(f.baseline).filter(([, v]) => v.trim());
  const baselineOk = baselineEntries.every(([, v]) => Number.isFinite(num(v)));
  const [showBase, setShowBase] = useState(baselineEntries.length > 0);
  const canSave = f.title.trim() && budgetOk && baselineOk && !(f.status === "done" && !f.result);
  const payload = () => ({
    ...f, title: f.title.trim(), budget, result: f.status === "done" ? f.result : null,
    baseline: Object.fromEntries(baselineEntries.map(([k, v]) => [k, num(v)])),
    started_at: f.started_at || null, ended_at: f.ended_at || null,
  });
  const done = () => { onSaved(); onClose(); };
  const save = useMutation({
    mutationFn: () => existing
      ? updateFn({ data: { id: existing.id, ...payload() } })
      : createFn({ data: { product_id: productId, ...payload() } }),
    onSuccess: () => { toast.success(existing ? "Teste salvo" : "Teste criado"); done(); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: existing!.id } }),
    onSuccess: done,
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Teste" : "Novo teste"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nome do teste" full>
            <input autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: Vídeo UGC x imagem estática" className={`${inputCls} w-full`} />
          </Field>
          <Field label="Campanha" full>
            <select value={f.campaign_id ?? ""} onChange={(e) => set("campaign_id", e.target.value || null)} className={`${inputCls} w-full`}>
              <option value="">{campaigns.length ? "Nenhuma" : "Nenhuma campanha ligada ao produto"}</option>
              {f.campaign_id && !campaigns.some((c) => c.id === f.campaign_id) && (
                <option value={f.campaign_id}>{existing?.campaign_name ?? f.campaign_id} (desligada do produto)</option>
              )}
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!campaigns.length && <p className="text-[11px] text-muted-foreground mt-1">Ligue as campanhas do produto em Inteligência › Vendas.</p>}
          </Field>
          <Field label="O que está testando">
            <select value={f.kind} onChange={(e) => set("kind", e.target.value as Kind)} className={`${inputCls} w-full`}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Métrica que decide">
            <select value={f.metric} onChange={(e) => set("metric", e.target.value as Metric)} className={`${inputCls} w-full`}>
              {METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Hipótese" full>
            <textarea rows={2} value={f.hypothesis} onChange={(e) => set("hypothesis", e.target.value)} placeholder="Ex.: vídeo curto vai baixar o custo por compra" className={`${areaCls} w-full`} />
          </Field>
          <Field label="Controle (versão atual)">
            <input value={f.control} onChange={(e) => set("control", e.target.value)} placeholder="Ex.: imagem estática" className={`${inputCls} w-full`} />
          </Field>
          <Field label="Variação (o que muda)">
            <input value={f.variant} onChange={(e) => set("variant", e.target.value)} placeholder="Ex.: vídeo UGC 15s" className={`${inputCls} w-full`} />
          </Field>
          <Field label="Regra de parada" full>
            <input value={f.stop_rule} onChange={(e) => set("stop_rule", e.target.value)} placeholder="Ex.: gastou 2x o CPA alvo sem venda, mata" className={`${inputCls} w-full`} />
          </Field>
          <Field label="Loja (opcional)">
            <select value={f.shop_id ?? ""} onChange={(e) => set("shop_id", e.target.value || null)} className={`${inputCls} w-full`}>
              <option value="">Todas / nenhuma</option>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Verba (US$)">
            <input inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} placeholder="Ex.: 150" className={`${inputCls} w-full ${budgetOk ? "" : "border-destructive"}`} />
          </Field>
          <Field label="Etapa">
            <select value={f.status} onChange={(e) => set("status", e.target.value as Status)} className={`${inputCls} w-full`}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início">
              <input type="date" value={f.started_at} onChange={(e) => set("started_at", e.target.value)} className={`${inputCls} w-full px-2`} />
            </Field>
            <Field label="Fim">
              <input type="date" value={f.ended_at} onChange={(e) => set("ended_at", e.target.value)} className={`${inputCls} w-full px-2`} />
            </Field>
          </div>
          <div className="sm:col-span-2 rounded-xl border border-border">
            <button type="button" onClick={() => setShowBase((v) => !v)} className="w-full flex items-center gap-2 px-3 h-10 text-sm font-medium">
              <ChevronDown className={`size-4 transition-transform ${showBase ? "" : "-rotate-90"}`} />
              Base para comparar
              <span className="text-xs font-normal text-muted-foreground">{baselineEntries.length ? `${baselineEntries.length} preenchidas` : "opcional"}</span>
            </button>
            {showBase && (
              <div className="px-3 pb-3 space-y-3">
                <p className="text-xs text-muted-foreground">Os números de referência (ex.: os da página atual). O resultado do teste é comparado com eles. Preencha só os que importam.</p>
                {(["meta", "shopify", "clarity"] as MetricSource[]).map((src) => (
                  <div key={src}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{SOURCE_LABEL[src]}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {BASELINE_METRICS.filter((m) => m.source === src).map((m) => {
                        const v = f.baseline[m.key] ?? "";
                        const bad = v.trim() !== "" && !Number.isFinite(num(v));
                        return (
                          <label key={m.key} className="block" title={m.hint}>
                            <span className="text-[11px] text-muted-foreground line-clamp-1">{m.label}{FORMAT_UNIT[m.format] && ` (${FORMAT_UNIT[m.format]})`}</span>
                            <input inputMode="decimal" value={v} onChange={(e) => set("baseline", { ...f.baseline, [m.key]: e.target.value })}
                              className={`${inputCls} w-full mt-0.5 ${bad ? "border-destructive" : ""}`} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {f.status === "done" && (
            <>
              <div className="sm:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Resultado</span>
                <div className="mt-1 flex gap-2">
                  {RESULT_ORDER.map((r) => (
                    <button key={r} type="button" onClick={() => set("result", r)}
                      className={`h-9 px-3 rounded-lg border text-sm ${f.result === r ? `${RESULT_CLS[r]} border-transparent font-medium` : "border-border hover:bg-muted"}`}>
                      {RESULT_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="O que você aprendeu" full>
                <textarea rows={3} value={f.learning} onChange={(e) => set("learning", e.target.value)}
                  placeholder="Ex.: vídeo UGC baixou o CPA de $32 para $21; usar nos outros produtos de casa" className={`${areaCls} w-full`} />
              </Field>
            </>
          )}
          <div className="sm:col-span-2 flex items-center gap-2 pt-1">
            {existing && (
              <button type="button" onClick={() => confirm(`Excluir o teste "${existing.title}"?`).then((ok) => { if (ok) remove.mutate(); })}
                className="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex items-center gap-1.5">
                <Trash2 className="size-3.5" /> Excluir
              </button>
            )}
            {f.status === "done" && !f.result && <span className="text-xs text-muted-foreground">Escolha o resultado para concluir</span>}
            <button type="button" onClick={onClose} className="ml-auto h-9 px-3 rounded-lg border border-border text-sm hover:bg-muted">Cancelar</button>
            <button type="submit" disabled={!canSave || save.isPending} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

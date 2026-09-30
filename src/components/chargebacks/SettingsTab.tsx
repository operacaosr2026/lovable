import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Mail, Plus, Trash2, ArrowUp, ArrowDown, Send, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { getChargebackSettings, saveChargebackSettings, sendDunningTest } from "@/lib/chargeback-alerts.functions";
import { DUNNING_VARS, type ChargebackSettings, type DunningStep } from "@/lib/chargeback-alerts.shared";

// Chargebacks > Configurações. Por enquanto: sequência de cobrança dos Alertas.

const CARD = "rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(16,24,40,0.04)]";
const INPUT = "w-full rounded-lg border border-border bg-background text-sm outline-none focus:border-primary";

export function SettingsTab() {
  const fn = useServerFn(getChargebackSettings);
  const q = useQuery({ queryKey: ["chargeback-settings"], queryFn: () => fn() });
  if (q.isLoading) return <div className="py-24 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <p className="text-sm text-destructive py-10 text-center">{(q.error as any)?.message ?? "Erro ao carregar"}</p>;
  return <div className="max-w-3xl space-y-4"><DunningSettings initial={q.data} /></div>;
}

function DunningSettings({ initial }: { initial: ChargebackSettings }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveChargebackSettings);
  const testFn = useServerFn(sendDunningTest);
  const [cfg, setCfg] = useState<ChargebackSettings>(initial);
  useEffect(() => setCfg(initial), [initial]);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(initial);
  const bodies = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focused, setFocused] = useState(0);

  const save = useMutation({
    mutationFn: (c: ChargebackSettings) => saveFn({ data: c }),
    onSuccess: () => { toast.success("Configurações salvas"); qc.invalidateQueries({ queryKey: ["chargeback-settings"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });
  const test = useMutation({
    mutationFn: (s: DunningStep) => testFn({ data: s }),
    onSuccess: (r) => toast.success(`Teste enviado pra ${r.to} (dados do pedido ${r.orderNumber})`),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao enviar o teste"),
  });

  const steps = cfg.dunningSteps;
  const setSteps = (s: DunningStep[]) => setCfg({ ...cfg, dunningSteps: s });
  const upd = (i: number, p: Partial<DunningStep>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => { const s = [...steps]; [s[i], s[i + d]] = [s[i + d], s[i]]; setSteps(s); };
  const insertVar = (v: string) => {
    const i = Math.min(focused, steps.length - 1);
    const el = bodies.current[i];
    if (i < 0 || !el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    upd(i, { body: el.value.slice(0, a) + v + el.value.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + v.length, a + v.length); });
  };

  return (
    <div className={`${CARD} p-5 space-y-5`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Mail className="size-4 text-primary" />Sequência de cobrança dos Alertas</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Quando um pedido reembolsado por alerta é <strong className="text-foreground font-medium">entregue</strong>, os e-mails abaixo saem sozinhos pelo Atendimento, um de cada vez.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium shrink-0 cursor-pointer">
          {cfg.dunningEnabled ? "Ligada" : "Desligada"}
          <Switch checked={cfg.dunningEnabled} onCheckedChange={(v) => setCfg({ ...cfg, dunningEnabled: v })} />
        </label>
      </div>

      <div className="rounded-xl bg-muted/50 p-3.5 text-xs text-muted-foreground space-y-1">
        <p className="flex items-center gap-1.5 font-medium text-foreground"><Info className="size-3.5" />Como funciona</p>
        <p>• Só pedidos de lojas ativas, com status <b>A contatar</b> e rastreio <b>Entregue</b>. No 1º envio o status vira <b>Contatado</b>.</p>
        <p>• Envia das 9h às 20h no horário de Nova York, no máximo 15 e-mails a cada 5 minutos.</p>
        <p>• A sequência para quando o cliente responde (segue na mão pelo Atendimento), quando alguém muda o status ou pausa a cobrança do pedido.</p>
        <p>• Terminou a sequência sem resposta: depois dos dias abaixo o status vira <b>Sem retorno</b>.</p>
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">E-mail {i + 1}</span>
                <span className="text-muted-foreground">·</span>
                <input type="number" min={0} max={90} value={s.days} onChange={(e) => upd(i, { days: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
                  className={`${INPUT} w-16 h-8 px-2 text-center`} />
                <span className="text-muted-foreground">{i === 0 ? "dias depois da entrega" : "dias depois do e-mail anterior"}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => test.mutate(s)} disabled={test.isPending || !s.subject.trim() || !s.body.trim()}
                  className="h-8 px-2.5 rounded-lg border border-border text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
                  {test.isPending && test.variables === s ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Enviar teste pra mim
                </button>
                <IconBtn title="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></IconBtn>
                <IconBtn title="Descer" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></IconBtn>
                <IconBtn title="Remover" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconBtn>
              </div>
            </div>
            <input value={s.subject} onChange={(e) => upd(i, { subject: e.target.value })} placeholder="Assunto (ex.: About your order {pedido})"
              className={`${INPUT} h-10 px-3`} />
            <textarea ref={(el) => { bodies.current[i] = el; }} onFocus={() => setFocused(i)} value={s.body} onChange={(e) => upd(i, { body: e.target.value })}
              rows={8} placeholder={"Hi {nome},\n\nWe noticed your order {pedido} was refunded, but tracking shows it was delivered on {data_entrega}…"}
              className={`${INPUT} p-3 resize-y leading-relaxed`} />
          </div>
        ))}
        <button onClick={() => { setSteps([...steps, { subject: "", body: "", days: steps.length ? 3 : 0 }]); setFocused(steps.length); }} disabled={steps.length >= 10}
          className="w-full h-10 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
          <Plus className="size-4" /> Adicionar e-mail
        </button>
      </div>

      {steps.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1.5">Campos (clique pra inserir no texto do e-mail {Math.min(focused, steps.length - 1) + 1})</p>
          <div className="flex flex-wrap gap-1.5">
            {DUNNING_VARS.map(([v, d]) => (
              <button key={v} onClick={() => insertVar(v)} title={d}
                className="h-7 px-2 rounded-md bg-muted text-xs font-mono hover:bg-primary/10 hover:text-primary">{v}</button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">Funcionam no assunto também. Datas saem em inglês (September 26, 2026). A assinatura do Atendimento é adicionada no fim.</p>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span>Marcar como <b>Sem retorno</b></span>
        <input type="number" min={1} max={60} value={cfg.dunningFinalWaitDays}
          onChange={(e) => setCfg({ ...cfg, dunningFinalWaitDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
          className={`${INPUT} w-16 h-8 px-2 text-center`} />
        <span className="text-muted-foreground">dias depois do último e-mail sem resposta</span>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
        {dirty && <button onClick={() => setCfg(initial)} className="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground mt-4">Descartar</button>}
        <button onClick={() => save.mutate(cfg)} disabled={!dirty || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 mt-4">
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  );
}

function IconBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">{children}</button>;
}

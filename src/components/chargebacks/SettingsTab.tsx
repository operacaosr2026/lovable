import { forwardRef, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Mail, Plus, Trash2, ArrowUp, ArrowDown, Eye, Lightbulb, Bold, Italic, Link2, Truck, CreditCard, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getChargebackSettings, saveChargebackSettings, getChargebackAlerts } from "@/lib/chargeback-alerts.functions";
import { DUNNING_VARS, dunningVars, renderDunning, dunningTextToHtml, type ChargebackSettings, type DunningStep } from "@/lib/chargeback-alerts.shared";

// Chargebacks > Configurações. Por enquanto: sequência de cobrança dos Alertas.

const CARD = "rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(16,24,40,0.04)]";
const INPUT = "w-full rounded-lg border border-border bg-background text-sm outline-none focus:border-primary";
const NUM = "w-16 shrink-0 h-8 px-2 text-center rounded-lg border border-border bg-background text-sm outline-none focus:border-primary";

export function SettingsTab() {
  const fn = useServerFn(getChargebackSettings);
  const q = useQuery({ queryKey: ["chargeback-settings"], queryFn: () => fn() });
  if (q.isLoading) return <div className="py-24 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <p className="text-sm text-destructive py-10 text-center">{(q.error as any)?.message ?? "Erro ao carregar"}</p>;
  return <div className="space-y-4"><DunningSettings initial={q.data} /></div>;
}

function DunningSettings({ initial }: { initial: ChargebackSettings }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveChargebackSettings);
  const [preview, setPreview] = useState<number | null>(null);
  const [cfg, setCfg] = useState<ChargebackSettings>(initial);
  useEffect(() => setCfg(initial), [initial]);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(initial);
  const bodies = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focused, setFocused] = useState(0);
  // E-mails recolhidos por padrão (a lista fica curta); abre clicando no cabeçalho.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggleOpen = (i: number) => setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const save = useMutation({
    mutationFn: (c: ChargebackSettings) => saveFn({ data: c }),
    onSuccess: () => { toast.success("Configurações salvas"); qc.invalidateQueries({ queryKey: ["chargeback-settings"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const steps = cfg.dunningSteps;
  const setSteps = (s: DunningStep[]) => setCfg({ ...cfg, dunningSteps: s });
  const upd = (i: number, p: Partial<DunningStep>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => {
    const s = [...steps]; [s[i], s[i + d]] = [s[i + d], s[i]]; setSteps(s);
    setOpen((o) => { const n = new Set(o); const a = o.has(i), b = o.has(i + d); n.delete(i); n.delete(i + d); if (a) n.add(i + d); if (b) n.add(i); return n; });
  };
  const remove = (i: number) => {
    setSteps(steps.filter((_, j) => j !== i));
    setOpen((o) => new Set([...o].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
  };
  // Envolve a seleção com o marcador (*negrito*, _itálico_); sem seleção, insere o par e põe o cursor no meio.
  const wrap = (i: number, mark: string) => {
    const el = bodies.current[i];
    if (!el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    const sel = el.value.slice(a, b);
    const lead = sel.match(/^\s*/)![0], trail = sel.match(/\s*$/)![0], core = sel.trim();
    upd(i, { body: el.value.slice(0, a) + lead + mark + core + mark + trail + el.value.slice(b) });
    requestAnimationFrame(() => {
      el.focus();
      const start = a + lead.length + mark.length;
      el.setSelectionRange(start, start + core.length);
    });
  };
  // Link com texto: [texto](url). Sem seleção, usa o texto padrão do link escolhido.
  const link = (i: number, url: string, fallback = "Track your order") => {
    const el = bodies.current[i];
    if (!el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    const label = el.value.slice(a, b).trim() || fallback;
    const md = `[${label}](${url})`;
    upd(i, { body: el.value.slice(0, a) + md + el.value.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + md.length, a + md.length); });
  };
  const insertVar = (v: string) => {
    const i = Math.min(focused, steps.length - 1);
    if (i < 0) return;
    const el = open.has(i) ? bodies.current[i] : null;
    // E-mail recolhido: abre e põe o campo no fim do texto.
    if (!el) { upd(i, { body: steps[i].body + v }); setOpen((o) => new Set(o).add(i)); return; }
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    upd(i, { body: el.value.slice(0, a) + v + el.value.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + v.length, a + v.length); });
  };

  return (
    <div className={`${CARD} p-5 sm:p-6 space-y-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="size-14 rounded-2xl grid place-items-center shrink-0 bg-violet-500/10 text-violet-600 dark:text-violet-400"><Mail className="size-6" /></div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight">Sequência de cobrança dos Alertas</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Quando um pedido reembolsado por alerta é <strong className="text-foreground font-medium">entregue</strong>, os e-mails abaixo saem sozinhos pelo Atendimento, um de cada vez.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2.5 text-sm font-medium shrink-0 cursor-pointer">
          {cfg.dunningEnabled ? "Ativada" : "Desativada"}
          <Switch checked={cfg.dunningEnabled} onCheckedChange={(v) => setCfg({ ...cfg, dunningEnabled: v })} />
        </label>
      </div>

      <div className="rounded-2xl bg-violet-500/[0.06] border border-violet-500/10 overflow-hidden">
        <div className="p-4 sm:p-5 space-y-3">
          <p className="flex items-center gap-2.5 font-bold">
            <span className="size-8 rounded-lg grid place-items-center bg-violet-500/10 text-violet-600 dark:text-violet-400"><Lightbulb className="size-4" /></span>
            Como funciona?
          </p>
          <ol className="space-y-2.5 text-sm text-foreground/80">
            {[
              <>Só pedidos de lojas ativas, com status <b className="text-foreground">A contatar</b> e rastreio <b className="text-foreground">Entregue</b>. No 1º envio o status vira <b className="text-foreground">Contatado</b>.</>,
              <>Envia das 9h às 20h (fuso Nova York), um e-mail por vez, com 30 min de intervalo. Quem espera há mais tempo sai primeiro.</>,
              <>A próxima etapa só é enviada se o cliente não responder.</>,
              <>Se o cliente responder, a sequência para e a conversa segue na mão do Atendimento (a IA não responde conversas com a tag Chargeback). Também para se alguém mudar o status ou pausar a cobrança do pedido.</>,
              <>Sem resposta {cfg.dunningFinalWaitDays} dia{cfg.dunningFinalWaitDays === 1 ? "" : "s"} depois do último e-mail, o status vira <b className="text-foreground">Sem retorno</b>.</>,
            ].map((t, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="size-6 rounded-md grid place-items-center shrink-0 bg-violet-500/10 text-violet-700 dark:text-violet-400 text-xs font-semibold">{i + 1}</span>
                <span className="pt-0.5">{t}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="flex items-start gap-2.5 px-4 sm:px-5 py-3 bg-violet-500/[0.07] border-t border-violet-500/10 text-xs text-foreground/80">
          <Link2 className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <span>
            <b className="text-violet-700 dark:text-violet-400">Link de pagamento</b>: só é criado clicando em <b>Gerar link</b> na aba Alertas (ou no envio, se o e-mail usar {"{link_pagamento}"}).
            Quando o cliente paga, o pedido vira <b>Recuperado</b> sozinho, é dado como atendido na Shopify e o valor volta pro lucro — sem aparecer em Pedidos, Logística ou Rastreio.
          </span>
        </p>
      </div>

      <div className="space-y-3">
        {steps.length > 1 && (
          <div className="flex justify-end">
            <button onClick={() => setOpen(open.size === steps.length ? new Set() : new Set(steps.map((_, i) => i)))}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5">
              <ChevronsUpDown className="size-3.5" />{open.size === steps.length ? "Recolher todos" : "Expandir todos"}
            </button>
          </div>
        )}
        {steps.map((s, i) => (
          <div key={i} className="rounded-xl border border-border">
            <div className="flex items-center justify-between gap-2 flex-wrap p-3 pl-2">
              <div className="flex items-center gap-2 text-sm flex-wrap min-w-0 flex-1">
                <button onClick={() => toggleOpen(i)} title={open.has(i) ? "Recolher" : "Expandir"}
                  className="flex items-center gap-2 min-w-0 rounded-lg px-1.5 py-1 hover:bg-muted">
                  <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${open.has(i) ? "" : "-rotate-90"}`} />
                  <span className="font-semibold whitespace-nowrap">E-mail {i + 1}</span>
                </button>
                <span className="text-muted-foreground">·</span>
                <input type="number" min={0} max={90} value={s.days} onChange={(e) => upd(i, { days: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
                  className={NUM} />
                <span className="text-muted-foreground">{i === 0 ? "dias depois da entrega" : "dias depois do e-mail anterior"}</span>
                {!open.has(i) && (
                  <button onClick={() => toggleOpen(i)} className="min-w-0 flex-1 text-left truncate text-muted-foreground hover:text-foreground">
                    · {s.subject.trim() || <i>sem assunto</i>}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPreview(i)} disabled={!s.subject.trim() && !s.body.trim()}
                  className="h-8 px-2.5 rounded-lg border border-border text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
                  <Eye className="size-3.5" /> Pré-visualizar
                </button>
                <IconBtn title="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></IconBtn>
                <IconBtn title="Descer" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></IconBtn>
                <IconBtn title="Remover" onClick={() => remove(i)}><Trash2 className="size-3.5" /></IconBtn>
              </div>
            </div>
            {open.has(i) && <div className="px-4 pb-4 space-y-3">
            <input value={s.subject} onChange={(e) => upd(i, { subject: e.target.value })} placeholder="Assunto (ex.: About your order {pedido})"
              className={`${INPUT} h-10 px-3`} />
            <div className="rounded-lg border border-border focus-within:border-primary overflow-hidden">
            <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border bg-muted/40">
              <IconBtn title="Negrito (*texto*)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap(i, "*")}><Bold className="size-3.5" /></IconBtn>
              <IconBtn title="Itálico (_texto_)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap(i, "_")}><Italic className="size-3.5" /></IconBtn>
              <LinkButton onPick={(url, fallback) => link(i, url, fallback)} />
              <span className="text-[11px] text-muted-foreground ml-1.5 hidden sm:inline">Selecione o texto e clique · *negrito* · _itálico_ · [texto](link)</span>
            </div>
            <textarea ref={(el) => { bodies.current[i] = el; }} onFocus={() => setFocused(i)} value={s.body} onChange={(e) => upd(i, { body: e.target.value })}
              rows={8} placeholder={"Hi {nome},\n\nWe noticed your order {pedido} was refunded, but tracking shows it was delivered on {data_entrega}…"}
              onKeyDown={(e) => {
                if (!(e.ctrlKey || e.metaKey)) return;
                const k = e.key.toLowerCase();
                if (k === "b" || k === "i") { e.preventDefault(); wrap(i, k === "b" ? "*" : "_"); }
              }}
              className="w-full bg-background text-sm outline-none p-3 resize-y leading-relaxed block" />
            </div>
            </div>}
          </div>
        ))}
        <button onClick={() => { setSteps([...steps, { subject: "", body: "", days: steps.length ? 3 : 0 }]); setFocused(steps.length); setOpen((o) => new Set(o).add(steps.length)); }} disabled={steps.length >= 10}
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
          className={NUM} />
        <span className="text-muted-foreground">dias depois do último e-mail sem resposta</span>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
        {dirty && <button onClick={() => setCfg(initial)} className="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground mt-4">Descartar</button>}
        <button onClick={() => save.mutate(cfg)} disabled={!dirty || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 mt-4">
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar
        </button>
      </div>
      <PreviewDialog step={preview != null ? steps[preview] : null} index={preview ?? 0} onClose={() => setPreview(null)} />
    </div>
  );
}

// Mostra o e-mail como o cliente vai receber, com os dados de um alerta real.
function PreviewDialog({ step, index, onClose }: { step: DunningStep | null; index: number; onClose: () => void }) {
  const fn = useServerFn(getChargebackAlerts);
  const q = useQuery({ queryKey: ["chargeback-alerts"], queryFn: () => fn(), enabled: !!step });
  const rows = q.data?.rows ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const sample = rows.find((r) => `${r.shopId}:${r.orderExternalId}` === pick) ?? rows.find((r) => r.deliveryStatus === "delivered") ?? rows[0];
  const vars = sample ? dunningVars(sample, { preview: true }) : {};
  return (
    <Dialog open={!!step} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pré-visualizar · E-mail {index + 1}</DialogTitle>
          <DialogDescription>Como o cliente vai receber. A assinatura do Atendimento entra no fim.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <div className="py-10 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : !sample ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum alerta pra usar de exemplo</p>
        ) : step && (
          <div className="space-y-3 min-w-0">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Dados do pedido
              <select value={`${sample.shopId}:${sample.orderExternalId}`} onChange={(e) => setPick(e.target.value)}
                className="h-8 px-2 rounded-lg border border-border bg-background text-xs text-foreground outline-none">
                {rows.map((r) => <option key={`${r.shopId}:${r.orderExternalId}`} value={`${r.shopId}:${r.orderExternalId}`}>{r.orderNumber} · {r.customerName ?? "—"}</option>)}
              </select>
            </label>
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/40 text-sm space-y-0.5">
                <p className="text-xs text-muted-foreground">Para: {sample.customerName ?? ""} &lt;{sample.customerEmail ?? "—"}&gt;</p>
                <p className="font-semibold break-words">{renderDunning(step.subject, vars) || "(sem assunto)"}</p>
              </div>
              {step.body.trim()
                // HTML seguro: dunningTextToHtml escapa o texto antes de formatar.
                ? <div className="p-4 break-words max-h-[55vh] overflow-y-auto [&_a]:text-primary [&_a]:underline" dangerouslySetInnerHTML={{ __html: dunningTextToHtml(renderDunning(step.body, vars)) }} />
                : <p className="p-4 text-sm text-muted-foreground">(sem texto)</p>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkButton({ onPick }: { onPick: (url: string, fallback?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const pick = (u: string, fallback?: string) => { onPick(u, fallback); setOpen(false); setUrl(""); };
  const valid = /^https?:\/\/\S+$/.test(url.trim());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconBtn title="Link com texto (selecione o texto antes)" onMouseDown={(e) => e.preventDefault()}><Link2 className="size-3.5" /></IconBtn>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <p className="text-xs text-muted-foreground">O texto selecionado vira o link.</p>
        <button onClick={() => pick("{link_rastreio}", "Track your order")}
          className="w-full h-9 px-3 rounded-lg border border-border text-sm inline-flex items-center gap-2 hover:bg-muted">
          <Truck className="size-4 text-primary" /> Link do rastreio
        </button>
        <button onClick={() => pick("{link_pagamento}", "Complete your payment")}
          className="w-full h-9 px-3 rounded-lg border border-border text-sm inline-flex items-center gap-2 hover:bg-muted">
          <CreditCard className="size-4 text-primary" /> Link de pagamento
        </button>
        <div className="flex gap-1.5">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
            onKeyDown={(e) => { if (e.key === "Enter" && valid) { e.preventDefault(); pick(url.trim()); } }}
            className={`${INPUT} h-9 px-2.5`} />
          <button disabled={!valid} onClick={() => pick(url.trim())}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 shrink-0">OK</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const IconBtn = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(({ children, ...p }, ref) => (
  <button ref={ref} type="button" {...p} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">{children}</button>
));
IconBtn.displayName = "IconBtn";

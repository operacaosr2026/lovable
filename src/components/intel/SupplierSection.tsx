import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Clock, Info, Loader2, PackageSearch, ShieldAlert, Truck } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { getSupplierAudit } from "@/lib/intel.functions";
import type { AuditedOrder, Severity } from "@/lib/intel/supplier-audit";

// Inteligência → Rastreamento / Fornecedor: tempos contra o normal da operação,
// score de confiabilidade (fatores à mostra) e envios com sinais, com evidências.
// A classificação não acusa o fornecedor: mostra os fatos de cada envio.

const SEV: Record<Severity, { label: string; cls: string }> = {
  altamente_suspeito: { label: "Altamente suspeito", cls: "bg-destructive/10 text-destructive border-destructive/30" },
  suspeito: { label: "Suspeito", cls: "bg-warning/10 text-warning border-warning/30" },
  atencao: { label: "Atenção", cls: "bg-primary/10 text-primary border-primary/30" },
  normal: { label: "Normal", cls: "bg-surface text-muted-foreground border-border" },
};
const SIGNAL: Record<string, string> = {
  codigo_sem_movimentacao: "Código criado sem movimentação", postagem_tardia: "Postagem tardia (código → 1ª movimentação)",
  sem_codigo: "Pedido sem código", parado_em_transito: "Parado em trânsito", parada_longa: "Parada longa no trânsito",
  entrega_rapida_incoerente: "Entrega rápida demais", entregue_sem_etapas: "Entregue sem etapas locais",
  entregue_sem_historico: "Entregue sem movimentação", codigo_substituido: "Código substituído",
  codigo_sem_registro: "Código não encontrado no Track123", evento_problema: "Exceção no rastreio",
  entregue_contestado: "Entregue, mas contestado (chargeback)",
};
const d1 = (x: number | null | undefined) => (x == null ? "—" : `${x.toFixed(1).replace(".", ",")}d`);
const pct = (x: number | null | undefined) => (x == null ? "—" : `${x.toFixed(1).replace(".", ",")}%`);
const usd = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const fmtDT = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/New_York", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function SupplierSection() {
  const fn = useServerFn(getSupplierAudit);
  const q = useQuery({ queryKey: ["intel-supplier"], queryFn: () => fn(), staleTime: 10 * 60_000 });
  const [sev, setSev] = useState<Severity>("altamente_suspeito");
  const [open, setOpen] = useState<AuditedOrder | null>(null);

  if (q.isLoading) return <div className="premium-card p-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  if (q.error || !q.data) return <div className="premium-card p-6 text-sm text-destructive">{(q.error as any)?.message ?? "Falha ao carregar"}</div>;
  const a = q.data;
  const alert = a.contagem.suspeito + a.contagem.altamente_suspeito;
  const pm = a.intervalos.pedido_ate_movimentacao;
  const nm72 = a.semMovimentacao.find((s) => s.horas === 72);
  const list = a.envios.filter((e) => e.severity === sev).sort((x, y) => y.flags.length - x.flags.length);
  const scoreCls = a.score.valor == null ? "text-muted-foreground" : a.score.valor >= 85 ? "text-success" : a.score.valor >= 70 ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-5">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi icon={ShieldAlert} label="Envios em alerta" value={String(alert)} hint={`${a.contagem.altamente_suspeito} altamente suspeitos · ${a.contagem.atencao} em atenção`} />
        <Kpi icon={Truck} label="Confiabilidade logística" value={a.score.valor == null ? "—" : `${a.score.valor}/100`} valueCls={scoreCls} hint={a.score.label} />
        <Kpi icon={Clock} label="Pedido → 1ª movimentação" value={d1(pm.recentes.mediana)} hint={`normal: ${d1(pm.base.mediana)} (mediana)`} />
        <Kpi icon={PackageSearch} label="Sem movimentação após 72h" value={pct(nm72?.recentes.pct)} hint={`normal: ${pct(nm72?.base.pct)}`} />
      </div>

      <section className="premium-card p-5">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><Truck className="size-4 text-primary" /> Rastreamento e fornecedor</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Código criado não é pedido enviado: a postagem conta da 1ª movimentação real no rastreio.
          "Normal" = pedidos de 8 a 67 dias atrás; "últimos 7 dias" = pedidos recentes que já tiveram o evento.
        </p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">Score de confiabilidade — como é calculado</h3>
            <ul className="space-y-2.5">
              {a.score.fatores.map((f) => (
                <li key={f.key} className={f.usado ? "" : "opacity-50"}>
                  <div className="flex justify-between text-xs gap-2"><span>{f.label}</span><span className="tabular-nums font-medium shrink-0">{pct(f.valor)} · peso {f.peso}</span></div>
                  <div className="h-1.5 rounded-full bg-surface mt-1 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${f.valor ?? 0}%` }} /></div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{f.n} pedidos{f.usado ? "" : " · poucos dados, fora da nota"}</p>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-2">Nota = média dos fatores pelo peso. 85+ confiável · 70–84 atenção · abaixo de 70 risco alto.</p>
          </div>
          <div className="space-y-4">
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground"><th className="text-left font-medium pb-1">Tempo</th><th className="text-right font-medium">Normal (mediana · p90)</th><th className="text-right font-medium">Últimos 7 dias</th></tr></thead>
              <tbody>
                {Object.values(a.intervalos).map((v) => (
                  <tr key={v.label} className="border-t border-border">
                    <td className="py-1.5">{v.label}</td>
                    <td className="text-right tabular-nums">{d1(v.base.mediana)} · {d1(v.base.p90)} <span className="text-muted-foreground">({v.base.n})</span></td>
                    <td className="text-right tabular-nums">{d1(v.recentes.mediana)} <span className="text-muted-foreground">({v.recentes.n})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground"><th className="text-left font-medium pb-1">Sem 1ª movimentação após</th><th className="text-right font-medium">Normal</th><th className="text-right font-medium">Últimos 7 dias</th></tr></thead>
              <tbody>
                {a.semMovimentacao.map((s) => (
                  <tr key={s.horas} className="border-t border-border">
                    <td className="py-1.5">{s.horas < 120 ? `${s.horas}h` : `${s.horas / 24} dias`}</td>
                    <td className="text-right tabular-nums">{pct(s.base.pct)} <span className="text-muted-foreground">({s.base.n})</span></td>
                    <td className={`text-right tabular-nums ${s.recentes.pct != null && s.base.pct != null && s.recentes.pct > s.base.pct * 1.2 ? "text-destructive font-medium" : ""}`}>
                      {pct(s.recentes.pct)} <span className="text-muted-foreground">({s.recentes.n})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="premium-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="size-4 text-primary" /> Envios com sinais</h2>
          <div className="flex flex-wrap gap-1.5">
            {(["altamente_suspeito", "suspeito", "atencao"] as Severity[]).map((s) => (
              <Button key={s} size="sm" variant={sev === s ? "default" : "outline"} onClick={() => setSev(s)}>
                {SEV[s].label} ({a.contagem[s]})
              </Button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum envio nessa classificação.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.slice(0, 50).map((e) => (
              <li key={e.id} className="py-3 flex flex-col sm:flex-row sm:items-start gap-2">
                <div className="sm:w-48 shrink-0">
                  <p className="text-sm font-medium">{e.orderNumber ?? "—"} <span className="text-muted-foreground font-normal">· {usd(e.revenue)}</span></p>
                  <p className="text-[11px] text-muted-foreground truncate">{e.shopName}</p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">{e.trackingCode ?? "sem código"}</p>
                </div>
                <ul className="flex-1 text-xs space-y-1">
                  {e.flags.map((f, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className={`shrink-0 px-1.5 rounded border text-[10px] ${SEV[f.severity].cls}`}>{SEV[f.severity].label}</span>
                      <span>{f.text}{(a.flagCount as any)[f.key] > 1 && <span className="text-muted-foreground"> · mesmo sinal em {(a.flagCount as any)[f.key] - 1} outro(s) pedido(s)</span>}</span>
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="outline" onClick={() => setOpen(e)}>Linha do tempo</Button>
              </li>
            ))}
          </ul>
        )}
        {list.length > 50 && <p className="text-xs text-muted-foreground mt-2">Mostrando 50 de {list.length}.</p>}
      </section>

      <section className="premium-card p-5">
        <h2 className="text-sm font-semibold mb-1">Sinais × chargeback e reembolso</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Pedidos com 25+ dias (deu tempo de abrir disputa): {a.taxaGeral.pedidos} pedidos, {a.taxaGeral.chargebacks} chargeback(s), {a.taxaGeral.reembolsos} reembolso(s).
          <strong> Amostra ainda pequena</strong> — é correlação, não causa; fica mais confiável com o tempo.
        </p>
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground"><th className="text-left font-medium pb-1">Sinal</th><th className="text-right font-medium">Pedidos com o sinal</th><th className="text-right font-medium">Chargebacks</th><th className="text-right font-medium">Reembolsos</th></tr></thead>
          <tbody>
            {a.sinaisVsPerda.map((s) => (
              <tr key={s.sinal} className="border-t border-border">
                <td className="py-1.5">{SIGNAL[s.sinal] ?? s.sinal}</td>
                <td className="text-right tabular-nums">{s.com.pedidos}</td>
                <td className="text-right tabular-nums">{s.com.chargebacks} <span className="text-muted-foreground">(sem o sinal: {s.sem.chargebacks}/{s.sem.pedidos})</span></td>
                <td className="text-right tabular-nums">{s.com.reembolsos} <span className="text-muted-foreground">(sem: {s.sem.reembolsos}/{s.sem.pedidos})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>{open.orderNumber} · {SEV[open.severity].label}</SheetTitle>
                <SheetDescription>{open.shopName} · {open.trackingCode ?? "sem código"} · horários de Nova York</SheetDescription>
              </SheetHeader>
              <div className="mt-4 rounded-lg border border-border p-3 text-xs space-y-1">
                <p className="font-medium flex items-center gap-1"><Info className="size-3.5" /> Por que essa classificação</p>
                {open.flags.map((f, i) => <p key={i}>• {f.text}</p>)}
              </div>
              <ol className="mt-4 relative border-l border-border ml-2">
                {open.steps.map((s, i) => (
                  <li key={i} className="ml-4 pb-3">
                    <span className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ${
                      s.kind === "chargeback" ? "bg-destructive" : s.kind === "codigo" || s.kind === "fornecedor" || s.kind === "compra" ? "bg-primary"
                      : s.stage === "info" ? "bg-border" : s.stage === "entregue" ? "bg-success" : "bg-muted-foreground"}`} />
                    <p className="text-[11px] text-muted-foreground tabular-nums">{fmtDT(s.at)}</p>
                    <p className="text-sm font-medium">{s.label}</p>
                    {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, valueCls }: { icon: any; label: string; value: string; hint?: string; valueCls?: string }) {
  return (
    <div className="premium-card p-4">
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Icon className="size-3.5" /> {label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${valueCls ?? ""}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

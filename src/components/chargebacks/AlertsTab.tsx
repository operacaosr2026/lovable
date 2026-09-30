import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BellRing, CircleCheck, Pause, Play, Reply, DollarSign, Clock, CalendarDays, ChevronDown, Truck, Mail, HandCoins, ExternalLink, Loader2, Search, Package, Headphones, StickyNote, Wallet,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getChargebackAlerts, saveAlertFollowup, getChargebackSettings, saveChargebackSettings } from "@/lib/chargeback-alerts.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ALERT_STATUSES, type AlertRow, type AlertStatus, type ChargebackSettings } from "@/lib/chargeback-alerts.shared";

// Chargebacks > Alertas: pedidos reembolsados pelo Disputifier por alerta de
// pré-chargeback (CDRN/Ethoca/RDR). Como o pedido quase sempre foi entregue, a
// equipe contata o cliente pra reaver o valor e acompanha aqui.

const CARD = "rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(16,24,40,0.04)]";
const money = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
};

const STATUS: Record<AlertStatus, { label: string; cls: string }> = {
  a_contatar:      { label: "A contatar",      cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  contatado:       { label: "Contatado",       cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  recuperado:      { label: "Recuperado",      cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  sem_retorno:     { label: "Sem retorno",     cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  nao_recuperavel: { label: "Não recuperável", cls: "bg-muted text-muted-foreground" },
};
const DELIVERY: Record<string, string> = {
  pending_shipment: "Aguardando envio", shipped: "Em trânsito", in_transit: "Em trânsito", delivered: "Entregue",
  returned: "Devolvido", problem: "Problema", waiting_customer: "Esperando cliente",
};

export function AlertsTab() {
  const fn = useServerFn(getChargebackAlerts);
  // Recarrega sozinha: a cobrança automática muda status a cada rodada (5 em 5 min).
  const q = useQuery({ queryKey: ["chargeback-alerts"], queryFn: () => fn(), refetchInterval: 2 * 60_000 });
  const settingsFn = useServerFn(getChargebackSettings);
  const settings = useQuery({ queryKey: ["chargeback-settings"], queryFn: () => settingsFn() });
  const seq = { enabled: !!settings.data?.dunningEnabled, total: settings.data?.dunningSteps.filter((st) => st.subject && st.body).length ?? 0 };
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "todos">("todos");
  const [search, setSearch] = useState("");

  const rows = q.data?.rows ?? [];
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => (statusFilter === "todos" || r.status === statusFilter) &&
      (!s || [r.orderNumber, r.customerName, r.customerEmail, r.product, r.trackingCode].some((v) => v?.toLowerCase().includes(s))));
  }, [rows, statusFilter, search]);

  const sum = (xs: AlertRow[], f: (r: AlertRow) => number) => xs.reduce((t, r) => t + f(r), 0);
  const delivered = rows.filter((r) => r.deliveryStatus === "delivered");
  const contacted = rows.filter((r) => r.status === "contatado");
  const recovered = rows.filter((r) => r.status === "recuperado");
  const toContact = rows.filter((r) => r.status === "a_contatar");

  if (q.isLoading) return <div className="py-24 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (q.isError) return <p className="text-sm text-destructive py-10 text-center">{(q.error as any)?.message ?? "Erro ao carregar"}</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat icon={BellRing} tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" label="Alertas" value={String(rows.length)} sub={`${money(sum(rows, (r) => r.refundedAmount))} reembolsados`} />
        <Stat icon={Truck} tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" label="Entregues" value={String(delivered.length)} sub={`${money(sum(delivered, (r) => r.refundedAmount))} dá pra cobrar`} />
        <Stat icon={Mail} tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" label="A contatar" value={String(toContact.length)} sub={`${contacted.length} já contatado${contacted.length === 1 ? "" : "s"}`}
          onClick={() => setStatusFilter(statusFilter === "a_contatar" ? "todos" : "a_contatar")} active={statusFilter === "a_contatar"} />
        <Stat icon={HandCoins} tone="bg-sky-500/10 text-sky-600 dark:text-sky-400" label="Recuperado" value={money(sum(recovered, (r) => r.recoveredAmount ?? 0))} sub={`${recovered.length} pedido${recovered.length === 1 ? "" : "s"}`}
          onClick={() => setStatusFilter(statusFilter === "recuperado" ? "todos" : "recuperado")} active={statusFilter === "recuperado"} />
      </div>

      <DunningMetrics rows={rows} sends={q.data?.sends ?? []} settings={settings.data} />

      <div className={`${CARD} p-5`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["todos", ...ALERT_STATUSES] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground"}`}>
                {s === "todos" ? `Todos (${rows.length})` : `${STATUS[s].label} (${rows.filter((r) => r.status === s).length})`}
              </button>
            ))}
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pedido, cliente ou produto…"
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary" />
          </div>
        </div>

        {!list.length ? <p className="text-sm text-muted-foreground text-center py-10">Nenhum alerta nesse filtro</p> : (<>
          <table className="hidden lg:table w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[12%]" /><col className="w-[19%]" /><col className="w-[8%]" /><col className="w-[11%]" />
              <col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="font-medium py-2.5 px-2 text-left">Pedido</th>
                <th className="font-medium py-2.5 px-2 text-left">Produto / cliente</th>
                <th className="font-medium py-2.5 px-2 text-center">Alerta</th>
                <th className="font-medium py-2.5 px-2 text-center">Reembolsado</th>
                <th className="font-medium py-2.5 px-2 text-center">Entrega</th>
                <th className="font-medium py-2.5 px-2 text-center">Cobrança</th>
                <th className="font-medium py-2.5 px-2 text-left">Notas</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => <AlertLine key={`${r.shopId}:${r.orderExternalId}`} r={r} seq={seq} />)}
            </tbody>
          </table>
          <div className="lg:hidden divide-y divide-border/60">
            {list.map((r) => <AlertLine key={`${r.shopId}:${r.orderExternalId}`} r={r} seq={seq} mobile />)}
          </div>
        </>)}
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-sm text-muted-foreground">
          Pedidos que o <strong className="text-foreground font-medium">Disputifier reembolsou</strong> por alerta de pré-chargeback (CDRN, Ethoca, RDR).
          O reembolso evita o chargeback, mas o pedido quase sempre foi entregue — dá pra contatar o cliente e tentar reaver o valor.
        </p>
        <div className="grid sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
          {([
            ["CDRN", "Rede da Verifi (Visa). O banco avisa que o cliente vai contestar; reembolsando em até 72h, o chargeback não é aberto."],
            ["Ethoca", "Rede da Mastercard. Mesmo esquema: o banco alerta sobre a reclamação e o reembolso rápido cancela a disputa."],
            ["RDR", "Rapid Dispute Resolution, da Visa. O reembolso sai automático por regra pré-definida, sem a loja decidir caso a caso."],
          ] as const).map(([k, d]) => (
            <p key={k}><span className="inline-flex text-[11px] px-1.5 py-0.5 mr-1.5 rounded-full font-semibold bg-violet-500/10 text-violet-700 dark:text-violet-400">{k}</span>{d}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function AlertLine({ r, seq, mobile }: { r: AlertRow; seq: { enabled: boolean; total: number }; mobile?: boolean }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveAlertFollowup);
  const save = useMutation({
    mutationFn: (v: { status: AlertStatus; recoveredAmount?: number | null; note?: string | null; dunningPaused?: boolean }) =>
      saveFn({ data: { shopId: r.shopId, orderExternalId: r.orderExternalId, status: v.status, recoveredAmount: v.recoveredAmount ?? r.recoveredAmount, note: "note" in v ? v.note : r.followupNote, dunningPaused: v.dunningPaused } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chargeback-alerts"] }),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });
  const delivered = r.deliveryStatus === "delivered";
  const dl = r.orderNumber ? (r.deliveryStatus ? DELIVERY[r.deliveryStatus] ?? r.deliveryStatus : "Sem rastreio") : "—";

  const order = <>
    <span className="font-semibold">{r.orderNumber ?? `#${r.orderExternalId}`}</span>
    <div className="text-xs text-muted-foreground truncate">{r.shopName.replace(/^Loja \d+ - /, "")} · {fmtDate(r.orderDate)}</div>
  </>;
  const product = <>
    <div className="truncate font-medium" title={r.product ?? undefined}>{r.product ?? "—"}</div>
    <div className="text-xs text-muted-foreground truncate">{r.customerName ?? "—"}</div>
  </>;
  const network = <span className="inline-flex text-xs px-2 py-0.5 rounded-full font-semibold bg-violet-500/10 text-violet-700 dark:text-violet-400">{r.network}</span>;
  const refund = <>
    <div className="font-semibold tabular-nums">{money(r.refundedAmount)}</div>
    <div className="text-xs text-muted-foreground">{fmtDate(r.refundedAt)}</div>
  </>;
  const delivery = <>
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${delivered ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
      {delivered ? <CircleCheck className="size-3" /> : <Package className="size-3" />}{dl}{delivered && r.deliveredAt ? ` · ${fmtDate(r.deliveredAt)}` : ""}
    </span>
    {r.trackingCode && (
      <div className="mt-1 truncate">
        {r.trackingUrl
          ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-primary hover:underline">{r.trackingCode}</a>
          : <span className="text-[11px] font-mono text-muted-foreground">{r.trackingCode}</span>}
      </div>
    )}
  </>;
  const status = <>
    <select value={r.status} disabled={save.isPending}
      onChange={(e) => {
        const st = e.target.value as AlertStatus;
        save.mutate({ status: st, recoveredAmount: st === "recuperado" ? r.recoveredAmount ?? r.refundedAmount : null });
      }}
      className={`h-7 px-2.5 rounded-full text-xs font-medium border-0 outline-none cursor-pointer appearance-none text-center ${STATUS[r.status].cls}`}
      style={{ backgroundImage: "none" }}>
      {ALERT_STATUSES.map((st) => <option key={st} value={st}>{STATUS[st].label}</option>)}
    </select>
    {r.status === "recuperado" && r.recoveredAmount != null && <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">{money(r.recoveredAmount)}</div>}
    <DunningInfo r={r} seq={seq} busy={save.isPending} onPause={(p) => save.mutate({ status: r.status, dunningPaused: p })} />
  </>;
  const notes = <FollowupPopover r={r} saving={save.isPending} onSave={(v) => save.mutate({ status: r.status, ...v })} />;

  if (mobile) return (
    <div className="py-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">{order}</div>
        <div className="text-right shrink-0">{refund}</div>
      </div>
      <div className="flex items-center gap-2 min-w-0"><div className="min-w-0 flex-1">{product}</div>{network}</div>
      <div>{delivery}</div>
      <div>{status}</div>
      <div>{notes}</div>
    </div>
  );

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/30 align-middle">
      <td className="py-3 px-2">{order}</td>
      <td className="py-3 px-2">{product}</td>
      <td className="py-3 px-2 text-center">{network}</td>
      <td className="py-3 px-2 text-center">{refund}</td>
      <td className="py-3 px-2 text-center">{delivery}</td>
      <td className="py-3 px-2 text-center">{status}</td>
      <td className="py-3 px-2">{notes}</td>
    </tr>
  );
}

// Métricas da sequência de cobrança: funil (cobrados → responderam → recuperados)
// e o resultado de cada e-mail (depois de qual e-mail o cliente respondeu / pagou).
const PERIODS = [["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["all", "Todo o período"]] as const;

function DunningMetrics({ rows, sends, settings }: { rows: AlertRow[]; sends: { step: number; sentAt: string }[]; settings: ChargebackSettings | undefined }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const saveFn = useServerFn(saveChargebackSettings);
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("90");
  const enabled = !!settings?.dunningEnabled;
  const total = settings?.dunningSteps.filter((st) => st.subject && st.body).length ?? 0;
  const toggle = useMutation({
    mutationFn: (on: boolean) => saveFn({ data: { ...settings!, dunningEnabled: on } }),
    onSuccess: (_, on) => { toast.success(on ? "Cobrança automática ativada" : "Cobrança automática desativada"); qc.invalidateQueries({ queryKey: ["chargeback-settings"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });
  const onToggle = async () => {
    if (!settings) return;
    if (!enabled) {
      const n = rows.filter((r) => r.status === "a_contatar" && r.deliveryStatus === "delivered" && r.customerEmail && !r.dunningPaused && !r.dunningStep).length;
      const ok = await confirm({
        title: "Ativar cobrança automática?",
        description: n
          ? `${n} pedido${n === 1 ? "" : "s"} entregue${n === 1 ? "" : "s"} em "A contatar" vai receber o 1º e-mail, um de cada vez, a cada 30 minutos (das 9h às 20h de Nova York).`
          : `Os pedidos entregues em "A contatar" passam a receber os e-mails da sequência.`,
        confirmText: "Ativar",
      });
      if (!ok) return;
    }
    toggle.mutate(!enabled);
  };

  const inSeq = rows.filter((r) => r.dunningStep > 0);
  const replied = inSeq.filter((r) => r.repliedAt);
  const recovered = rows.filter((r) => r.status === "recuperado" && (r.recoveredStep ?? 0) > 0);
  const manual = rows.filter((r) => r.status === "recuperado" && !((r.recoveredStep ?? 0) > 0));
  const noReturn = inSeq.filter((r) => r.dunningStopReason === "fim");
  const charged = inSeq.reduce((t, r) => t + r.refundedAmount, 0);
  const got = recovered.reduce((t, r) => t + (r.recoveredAmount ?? 0), 0);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const hours = replied.map((r) => (Date.parse(r.repliedAt!) - Date.parse(r.dunningStartedAt ?? r.repliedAt!)) / 3_600_000).filter((h) => h >= 0);
  const avgH = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
  const avgLabel = avgH == null ? "—" : avgH < 48 ? `${Math.round(avgH)}h` : `${Math.round(avgH / 24)} dias`;

  // Detalhamento por e-mail, no período escolhido.
  const since = period === "all" ? "" : new Date(Date.now() - Number(period) * 86_400_000).toISOString();
  const inRange = (iso: string | null) => !!iso && iso >= since;
  const nSteps = Math.max(total, ...sends.map((x) => x.step), 0);

  const tiles: { icon: typeof Mail; tone: string; label: string; value: string; sub: string }[] = [
    { icon: Mail, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400", label: "Cobrados", value: String(inSeq.length), sub: `${money(charged)} em cobrança` },
    { icon: Reply, tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400", label: "Responderam", value: String(replied.length), sub: `${pct(replied.length, inSeq.length)} dos cobrados` },
    { icon: CircleCheck, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", label: "Recuperados", value: String(recovered.length), sub: `${pct(recovered.length, inSeq.length)} dos cobrados` },
    { icon: DollarSign, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400", label: "Valor recuperado", value: money(got), sub: `${pct(got, charged)} do valor cobrado` },
    { icon: Clock, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400", label: "Tempo até responder", value: avgLabel, sub: "média depois do 1º e-mail" },
  ];
  return (
    <div className={`${CARD} p-5 sm:p-6 space-y-5`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="size-14 rounded-2xl grid place-items-center shrink-0 bg-violet-500/10 text-violet-600 dark:text-violet-400"><Mail className="size-6" /></div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight">Cobrança automática</h2>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <span className={`h-10 px-4 rounded-full inline-flex items-center gap-2 text-sm font-medium ${enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
            <span className={`size-2 rounded-full ${enabled ? "bg-emerald-500" : "bg-muted-foreground/60"}`} />{enabled ? "Ligada" : "Desligada"}
          </span>
          <button onClick={onToggle} disabled={!settings || toggle.isPending}
            className={`h-10 px-5 rounded-xl text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60 ${enabled ? "border border-border hover:bg-muted" : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"}`}>
            {toggle.isPending && <Loader2 className="size-4 animate-spin" />}{enabled ? "Desativar" : "Ativar cobrança automática"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {tiles.map(({ icon: Icon, tone, label, value, sub }) => (
          <div key={label} className="rounded-2xl border border-border/70 p-4 flex items-center gap-3.5 min-w-0">
            <div className={`size-12 rounded-full grid place-items-center shrink-0 ${tone}`}><Icon className="size-5" /></div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 truncate">{label}</p>
              <p className="text-2xl font-bold leading-tight tabular-nums truncate">{value}</p>
              <p className="text-xs text-muted-foreground truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border/70 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-bold">Detalhamento por e-mail</h3>
          </div>
          <div className="relative shrink-0 self-start sm:self-auto">
            <CalendarDays className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select value={period} onChange={(e) => setPeriod(e.target.value as (typeof PERIODS)[number][0])}
              className="h-10 pl-9 pr-9 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary cursor-pointer appearance-none">
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <ChevronDown className="size-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
        {!nSteps ? <p className="text-sm text-muted-foreground text-center py-6">Nenhum e-mail na sequência — escreva em Configurações</p> : (
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-xs font-semibold text-foreground/80 bg-muted/60">
                <th className="py-3 px-4 text-left rounded-l-lg">E-mail</th>
                <th className="py-3 px-3 text-left">Enviados</th>
                <th className="py-3 px-3 text-left">Respostas</th>
                <th className="py-3 px-3 text-left">Recuperados</th>
                <th className="py-3 px-3 text-left rounded-r-lg">Valor recuperado</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: nSteps }, (_, i) => i + 1).map((n) => {
                const sent = sends.filter((x) => x.step === n && inRange(x.sentAt)).length;
                const rep = replied.filter((r) => r.repliedStep === n && inRange(r.repliedAt)).length;
                const rec = recovered.filter((r) => r.recoveredStep === n && inRange(r.recoveredAt));
                return (
                  <tr key={n} className="border-b border-border/60 last:border-0">
                    <td className="py-3 px-4 font-semibold">E-mail {n}</td>
                    <td className="py-3 px-3 tabular-nums">{sent}</td>
                    <td className="py-3 px-3 tabular-nums">{rep}{sent > 0 && <span className="text-xs text-muted-foreground ml-1">({pct(rep, sent)})</span>}</td>
                    <td className="py-3 px-3 tabular-nums">{rec.length}{sent > 0 && <span className="text-xs text-muted-foreground ml-1">({pct(rec.length, sent)})</span>}</td>
                    <td className="py-3 px-3 tabular-nums">{money(rec.reduce((t, r) => t + (r.recoveredAmount ?? 0), 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {(noReturn.length > 0 || manual.length > 0) && (
          <p className="text-xs text-muted-foreground mt-3">
            {noReturn.length > 0 && <>{noReturn.length} terminaram a sequência sem resposta. </>}
            {manual.length > 0 && <>{manual.length} recuperado{manual.length === 1 ? "" : "s"} fora da sequência ({money(manual.reduce((t, r) => t + (r.recoveredAmount ?? 0), 0))}).</>}
          </p>
        )}
      </div>
    </div>
  );
}

// Progresso da cobrança automática (Configurações > Sequência de cobrança).
function DunningInfo({ r, seq, busy, onPause }: { r: AlertRow; seq: { enabled: boolean; total: number }; busy: boolean; onPause: (paused: boolean) => void }) {
  const open = r.status === "a_contatar" || r.status === "contatado";
  if (!seq.enabled && !r.dunningStep) return null;
  if (!r.dunningStep && (!open || r.status !== "a_contatar" || r.deliveryStatus !== "delivered")) return null;
  const err = r.dunningStopReason?.startsWith("erro") ? r.dunningStopReason.slice(6) : null;
  const label = r.dunningStopReason === "respondeu" ? "Cliente respondeu"
    : r.dunningStopReason === "fim" ? `Sequência concluída (${r.dunningStep})`
    : r.dunningPaused ? `Cobrança pausada${r.dunningStep ? ` · ${r.dunningStep}/${seq.total}` : ""}`
    : err ? "Erro no envio"
    : r.dunningStep ? `E-mail ${r.dunningStep}/${seq.total}${r.dunningLastAt ? ` · ${fmtDate(r.dunningLastAt)}` : ""}`
    : "Cobrança na fila";
  const canToggle = open && r.dunningStopReason !== "respondeu" && r.dunningStopReason !== "fim";
  return (
    <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={err ?? undefined}>
      <span className={err ? "text-destructive" : r.dunningStopReason === "respondeu" ? "text-sky-700 dark:text-sky-400" : ""}>{label}</span>
      {canToggle && (
        <button disabled={busy} onClick={() => onPause(!r.dunningPaused)} title={r.dunningPaused ? "Retomar cobrança automática" : "Pausar cobrança automática"}
          className="size-5 rounded grid place-items-center hover:bg-muted hover:text-foreground disabled:opacity-50">
          {r.dunningPaused ? <Play className="size-3" /> : <Pause className="size-3" />}
        </button>
      )}
    </div>
  );
}

// Anotação + valor recuperado.
function FollowupPopover({ r, saving, onSave }: { r: AlertRow; saving: boolean; onSave: (v: { recoveredAmount: number | null; note: string | null }) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(r.followupNote ?? "");
  const [amount, setAmount] = useState(String(r.recoveredAmount ?? r.refundedAmount));
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setNote(r.followupNote ?? ""); setAmount(String(r.recoveredAmount ?? r.refundedAmount)); } }}>
      <PopoverTrigger asChild>
        <button title={r.followupNote ?? "Adicionar nota"}
          className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-muted text-xs">
          {r.followupNote
            ? <span className="line-clamp-2 whitespace-pre-line text-foreground/80">{r.followupNote}</span>
            : <span className="inline-flex items-center gap-1.5 text-muted-foreground"><StickyNote className="size-3.5" />Adicionar nota</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2.5">
        <p className="text-xs font-semibold">{r.orderNumber} · cobrança</p>
        {r.status === "recuperado" && (
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Valor recuperado (US$)</span>
            <div className="relative mt-1">
              <Wallet className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal"
                className="w-full h-9 pl-8 pr-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary" />
            </div>
          </label>
        )}
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Anotação</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Ex.: cliente confirmou que recebeu, vai pagar pelo link…"
            className="mt-1 w-full resize-none rounded-lg border border-border bg-background p-2 text-xs outline-none focus:border-primary" />
        </label>
        <div className="flex justify-end">
          <button disabled={saving} onClick={() => { onSave({ recoveredAmount: r.status === "recuperado" ? Number(amount.replace(",", ".")) || 0 : null, note: note.trim() || null }); setOpen(false); }}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-60">Salvar</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Stat({ icon: Icon, tone, label, value, sub, onClick, active }: {
  icon: typeof BellRing; tone: string; label: string; value: string; sub: string; onClick?: () => void; active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`${CARD} p-5 flex items-start gap-3.5 min-w-0 text-left transition-colors ${active ? "ring-2 ring-primary/30 border-primary/50" : ""} ${onClick ? "hover:border-primary/40 cursor-pointer" : ""}`}>
      <div className={`size-12 rounded-2xl grid place-items-center shrink-0 ${tone}`}><Icon className="size-6" /></div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 truncate">{label}</p>
        <p className="text-3xl font-bold tracking-tight leading-none mt-0.5">{value}</p>
        <p className="text-xs text-muted-foreground mt-1.5 truncate">{sub}</p>
      </div>
    </Tag>
  );
}

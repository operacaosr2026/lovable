import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BellRing, CircleCheck, ArrowUp, ArrowDown, ArrowRight, Database, Pause, Play, Reply, DollarSign, CalendarDays, ChevronDown, Truck, Mail, HandCoins, ExternalLink, Loader2, Search, Package, Headphones, Link2, Copy, Check,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getChargebackAlerts, saveAlertFollowup, getChargebackSettings, saveChargebackSettings, createRecoveryPaymentLink } from "@/lib/chargeback-alerts.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ALERT_STATUSES, type AlertRow, type AlertStatus, type ChargebackSettings } from "@/lib/chargeback-alerts.shared";
import { US_TIME_ZONE } from "@/lib/timezone";

// Chargebacks > Alertas: pedidos reembolsados pelo Disputifier por alerta de
// pré-chargeback (CDRN/Ethoca/RDR). Como o pedido quase sempre foi entregue, a
// equipe contata o cliente pra reaver o valor e acompanha aqui.

const CARD = "rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(16,24,40,0.04)]";
const money = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: US_TIME_ZONE });
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
        <Stat icon={BellRing} color="violet" label="Alertas" value={String(rows.length)} sub={`${money(sum(rows, (r) => r.refundedAmount))} reembolsados`}
          trend={trendOf(rows.map((r) => r.refundedAt))} upIsBad spark={sparkOf(rows.map((r) => r.refundedAt))} />
        <Stat icon={Truck} color="emerald" label="Entregues" value={String(delivered.length)} sub={`${money(sum(delivered, (r) => r.refundedAmount))} dá pra cobrar`}
          trend={trendOf(delivered.map((r) => r.deliveredAt ?? r.refundedAt))} spark={sparkOf(delivered.map((r) => r.deliveredAt ?? r.refundedAt))} />
        <Stat icon={Mail} color="amber" label="A contatar" value={String(toContact.length)} sub={`${contacted.length} já contatado${contacted.length === 1 ? "" : "s"}`}
          trend={trendOf(toContact.map((r) => r.refundedAt))} upIsBad spark={sparkOf(toContact.map((r) => r.refundedAt))}
          onClick={() => setStatusFilter(statusFilter === "a_contatar" ? "todos" : "a_contatar")} active={statusFilter === "a_contatar"} />
        <Stat icon={HandCoins} color="sky" label="Recuperado" value={money(sum(recovered, (r) => r.recoveredAmount ?? 0))} sub={`${recovered.length} pedido${recovered.length === 1 ? "" : "s"}`}
          spark={sparkOf(recovered.map((r) => r.recoveredAt ?? r.followupAt), recovered.map((r) => r.recoveredAmount ?? 0))}
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
          <table className="hidden xl:table w-full table-fixed text-sm">
            <colgroup>
              {/* Espaço dividido entre as colunas (não sobra tudo pro produto); etiquetas encolhem até caber. */}
              <col className="w-[12%]" /><col className="w-[20%]" /><col className="w-[9%]" /><col className="w-[11%]" />
              <col className="w-[17%]" /><col className="w-[15%]" /><col className="w-[16%]" />
            </colgroup>
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="font-medium py-2.5 px-2 text-left">Pedido</th>
                <th className="font-medium py-2.5 px-2 text-left">Produto / cliente</th>
                <th className="font-medium py-2.5 px-2 text-center">Alerta</th>
                <th className="font-medium py-2.5 px-2 text-center">Reembolsado</th>
                <th className="font-medium py-2.5 px-2 text-center">Entrega</th>
                <th className="font-medium py-2.5 px-2 text-center">Cobrança</th>
                <th className="font-medium py-2.5 px-2 text-center">Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => <AlertLine key={`${r.shopId}:${r.orderExternalId}`} r={r} seq={seq} />)}
            </tbody>
          </table>
          <div className="xl:hidden divide-y divide-border/60">
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
    <span className={`inline-flex items-center justify-center gap-1 w-full max-w-[150px] text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap overflow-hidden ${delivered ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
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
      className={`h-7 w-full max-w-[124px] px-2 rounded-full text-xs font-medium border-0 outline-none cursor-pointer appearance-none text-center ${STATUS[r.status].cls}`}
      style={{ backgroundImage: "none" }}>
      {ALERT_STATUSES.map((st) => <option key={st} value={st}>{STATUS[st].label}</option>)}
    </select>
    {r.status === "recuperado" && r.recoveredAmount != null && <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">{money(r.recoveredAmount)}</div>}
    <DunningInfo r={r} seq={seq} busy={save.isPending} onPause={(p) => save.mutate({ status: r.status, dunningPaused: p })} />
  </>;
  const payment = <PaymentLink r={r} />;

  if (mobile) return (
    <div className="py-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">{order}</div>
        <div className="text-right shrink-0">{refund}</div>
      </div>
      <div className="flex items-center gap-2 min-w-0"><div className="min-w-0 flex-1">{product}</div>{network}</div>
      <div>{delivery}</div>
      <div>{status}</div>
      <div>{payment}</div>
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
      <td className="py-3 px-2 text-center">{payment}</td>
    </tr>
  );
}

// Liga/desliga a cobrança automática — fica no cabeçalho da página, ao lado das abas.
export function DunningToggle() {
  const alertsFn = useServerFn(getChargebackAlerts);
  const settingsFn = useServerFn(getChargebackSettings);
  const rows = useQuery({ queryKey: ["chargeback-alerts"], queryFn: () => alertsFn(), refetchInterval: 2 * 60_000 }).data?.rows ?? [];
  const settings = useQuery({ queryKey: ["chargeback-settings"], queryFn: () => settingsFn() }).data;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const saveFn = useServerFn(saveChargebackSettings);
  const enabled = !!settings?.dunningEnabled;
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

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className={`h-10 px-3.5 rounded-xl border inline-flex items-center gap-2 text-sm font-medium ${enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-border bg-card text-muted-foreground"}`}>
        <span className={`size-2 rounded-full ${enabled ? "bg-emerald-500" : "bg-muted-foreground/60"}`} />{enabled ? "Cobrança ligada" : "Cobrança desligada"}
      </span>
      <button onClick={onToggle} disabled={!settings || toggle.isPending}
        className={`h-10 px-3.5 rounded-xl text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60 ${enabled ? "border border-border bg-card hover:bg-muted" : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"}`}>
        {toggle.isPending ? <Loader2 className="size-4 animate-spin" /> : enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
        {enabled ? "Desativar" : "Ativar cobrança"}
      </button>
    </div>
  );
}

// Métricas da sequência de cobrança: funil (cobrados → responderam → recuperados)
// e o resultado de cada e-mail (depois de qual e-mail o cliente respondeu / pagou).
const PERIODS = [["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["all", "Todo o período"]] as const;
type Period = (typeof PERIODS)[number][0];
const sinceOf = (p: Period) => (p === "all" ? "" : new Date(Date.now() - Number(p) * 86_400_000).toISOString());

function PeriodSelect({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="relative shrink-0 self-start sm:self-auto">
      <CalendarDays className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <select value={value} onChange={(e) => onChange(e.target.value as Period)}
        className="h-10 pl-9 pr-9 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary cursor-pointer appearance-none">
        {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <ChevronDown className="size-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

const STEP_TONES = [
  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
];

function DunningMetrics({ rows, sends, settings }: { rows: AlertRow[]; sends: { step: number; sentAt: string }[]; settings: ChargebackSettings | undefined }) {
  const [period, setPeriod] = useState<Period>("90");
  const [detailPeriod, setDetailPeriod] = useState<Period>("90");
  const total = settings?.dunningSteps.filter((st) => st.subject && st.body).length ?? 0;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  // Resumo: pedidos que entraram na sequência no período escolhido.
  const since = sinceOf(period);
  const inSeq = rows.filter((r) => r.dunningStep > 0 && (r.dunningStartedAt ?? r.dunningLastAt ?? "") >= since);
  const replied = inSeq.filter((r) => r.repliedAt);
  const recovered = inSeq.filter((r) => r.status === "recuperado" && (r.recoveredStep ?? 0) > 0);
  const charged = inSeq.reduce((t, r) => t + r.refundedAmount, 0);
  const got = recovered.reduce((t, r) => t + (r.recoveredAmount ?? 0), 0);
  const hours = replied.map((r) => (Date.parse(r.repliedAt!) - Date.parse(r.dunningStartedAt ?? r.repliedAt!)) / 3_600_000).filter((h) => h >= 0);
  const avgH = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
  const avgLabel = avgH == null ? "" : ` · responde em ${avgH < 48 ? `${Math.round(avgH)}h` : `${Math.round(avgH / 24)} dias`}`;

  // Detalhamento por e-mail, no período escolhido.
  const dSince = sinceOf(detailPeriod);
  const inRange = (iso: string | null) => !!iso && iso >= dSince;
  const allReplied = rows.filter((r) => r.dunningStep > 0 && r.repliedAt);
  const allRecovered = rows.filter((r) => r.status === "recuperado" && (r.recoveredStep ?? 0) > 0);
  const manual = rows.filter((r) => r.status === "recuperado" && !((r.recoveredStep ?? 0) > 0));
  const noReturn = rows.filter((r) => r.dunningStep > 0 && r.dunningStopReason === "fim");
  const nSteps = Math.max(total, ...sends.map((x) => x.step), 0);

  const tiles: { icon: typeof Mail; tone: string; label: string; value: string; sub: string }[] = [
    { icon: Mail, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400", label: "Cobrados", value: String(inSeq.length), sub: `${money(charged)} em cobrança` },
    { icon: Reply, tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400", label: "Responderam", value: String(replied.length), sub: `${pct(replied.length, inSeq.length)} dos cobrados${avgLabel}` },
    { icon: CircleCheck, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", label: "Recuperados", value: String(recovered.length), sub: `${pct(recovered.length, inSeq.length)} dos cobrados` },
    { icon: DollarSign, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400", label: "Valor recuperado", value: money(got), sub: `${pct(got, charged)} do valor cobrado` },
  ];
  return (
    <>
      <div className={`${CARD} p-5 sm:p-6 space-y-5`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl grid place-items-center shrink-0 bg-violet-500/10 text-violet-600 dark:text-violet-400"><Database className="size-5" /></div>
            <h3 className="text-lg font-bold">Resumo da cobrança</h3>
          </div>
          <PeriodSelect value={period} onChange={setPeriod} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {tiles.map(({ icon: Icon, tone, label, value, sub }) => (
            <div key={label} className="rounded-2xl border border-border/70 bg-muted/20 p-4 flex items-center gap-3.5 min-w-0">
              <div className={`size-12 rounded-full grid place-items-center shrink-0 ${tone}`}><Icon className="size-5" /></div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 truncate">{label}</p>
                <p className="text-2xl font-bold leading-tight tabular-nums truncate">{value}</p>
                <p className="text-xs text-muted-foreground truncate" title={sub}>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${CARD} p-5 sm:p-6`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold">Detalhamento por e-mail</h3>
            <p className="text-sm text-muted-foreground">Acompanhe o desempenho de cada e-mail no processo de cobrança.</p>
          </div>
          <PeriodSelect value={detailPeriod} onChange={setDetailPeriod} />
        </div>
        {!nSteps ? <p className="text-sm text-muted-foreground text-center py-6">Nenhum e-mail na sequência — escreva em Configurações</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm table-fixed">
              <thead>
                <tr className="text-xs font-semibold text-foreground/80 bg-muted/60">
                  <th className="py-3 px-4 text-left rounded-l-lg w-[20%]">E-mail</th>
                  <th className="py-3 px-3 text-left">Enviados</th>
                  <th className="py-3 px-3 text-left">Respostas</th>
                  <th className="py-3 px-3 text-left">Recuperados</th>
                  <th className="py-3 px-3 text-left">Valor recuperado</th>
                  <th className="py-3 px-3 text-left rounded-r-lg w-[22%]">Taxa de resposta</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: nSteps }, (_, i) => i + 1).map((n) => {
                  const sent = sends.filter((x) => x.step === n && inRange(x.sentAt)).length;
                  const rep = allReplied.filter((r) => r.repliedStep === n && inRange(r.repliedAt)).length;
                  const rec = allRecovered.filter((r) => r.recoveredStep === n && inRange(r.recoveredAt));
                  const rate = sent ? Math.min(100, Math.round((rep / sent) * 100)) : 0;
                  return (
                    <tr key={n} className="border-b border-border/60 last:border-0">
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-3 font-semibold">
                          <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${STEP_TONES[(n - 1) % STEP_TONES.length]}`}><Mail className="size-4" /></span>
                          E-mail {n}
                        </span>
                      </td>
                      <td className="py-3 px-3 tabular-nums">{sent}</td>
                      <td className="py-3 px-3 tabular-nums">{rep}</td>
                      <td className="py-3 px-3 tabular-nums">{rec.length}{sent > 0 && <span className="text-xs text-muted-foreground ml-1">({pct(rec.length, sent)})</span>}</td>
                      <td className="py-3 px-3 tabular-nums">{money(rec.reduce((t, r) => t + (r.recoveredAmount ?? 0), 0))}</td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-3">
                          <span className="tabular-nums w-9 shrink-0">{rate}%</span>
                          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${rate}%` }} /></div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(noReturn.length > 0 || manual.length > 0) && (
          <p className="text-xs text-muted-foreground mt-3">
            {noReturn.length > 0 && <>{noReturn.length} terminaram a sequência sem resposta. </>}
            {manual.length > 0 && <>{manual.length} recuperado{manual.length === 1 ? "" : "s"} fora da sequência ({money(manual.reduce((t, r) => t + (r.recoveredAmount ?? 0), 0))}).</>}
          </p>
        )}
      </div>
    </>
  );
}

// Progresso da cobrança automática (Configurações > Sequência de cobrança).
function DunningInfo({ r, seq, busy, onPause }: { r: AlertRow; seq: { enabled: boolean; total: number }; busy: boolean; onPause: (paused: boolean) => void }) {
  const open = r.status === "a_contatar" || r.status === "contatado";
  if (!seq.enabled && !r.dunningStep && !r.recoveryOrderName) return null;
  if (!r.dunningStep && (!open || r.status !== "a_contatar" || r.deliveryStatus !== "delivered")) return null;
  const err = r.dunningStopReason?.startsWith("erro") ? r.dunningStopReason.slice(6) : null;
  if (r.recoveryOrderName) {
    return (
      <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400" title={r.recoveryError ?? undefined}>
        Pago no pedido {r.recoveryOrderName}{!r.recoveryFulfilled && <span className="text-amber-600 dark:text-amber-400"> · falta dar como atendido</span>}
      </div>
    );
  }
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

// Link de pagamento (pedido "Payment for order #X" na Shopify): cria na 1ª vez e
// copia; depois só copia. Pago → mostra o pedido.
function PaymentLink({ r }: { r: AlertRow }) {
  const qc = useQueryClient();
  const fn = useServerFn(createRecoveryPaymentLink);
  const [copied, setCopied] = useState(false);
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link de pagamento copiado");
    } catch {
      // Navegador bloqueou a cópia (ex.: depois de esperar a Shopify): mostra o link.
      toast("Link de pagamento", { description: url, duration: 20_000 });
    }
  };
  const create = useMutation({
    mutationFn: () => fn({ data: { shopId: r.shopId, orderExternalId: r.orderExternalId } }),
    onSuccess: async ({ url }) => { await copy(url); qc.invalidateQueries({ queryKey: ["chargeback-alerts"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao criar o link"),
  });
  if (r.recoveryOrderName) {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CircleCheck className="size-3.5" />Pago · {r.recoveryOrderName}</span>;
  }
  const has = !!r.recoveryInvoiceUrl;
  return (
    <button onClick={() => (has ? copy(r.recoveryInvoiceUrl!) : create.mutate())} disabled={create.isPending}
      title={has ? r.recoveryInvoiceUrl! : "Cria o pedido de cobrança na Shopify e copia o link"}
      className={`h-8 w-full max-w-[112px] px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-60 ${has ? "border border-border hover:bg-muted" : "bg-primary/10 text-primary hover:bg-primary/15"}`}>
      {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : copied ? <Check className="size-3.5" /> : has ? <Copy className="size-3.5" /> : <Link2 className="size-3.5" />}
      {create.isPending ? "Criando…" : copied ? "Copiado" : has ? "Copiar link" : "Gerar link"}
    </button>
  );
}

// Variação dos últimos 30 dias contra os 30 anteriores.
type Trend = { dir: "up" | "down" | "flat"; label: string };
function trendOf(dates: (string | null)[]): Trend {
  const now = Date.now(), d30 = 30 * 86_400_000;
  let cur = 0, prev = 0;
  for (const iso of dates) {
    if (!iso) continue;
    const age = now - Date.parse(iso);
    if (age < d30) cur++;
    else if (age < 2 * d30) prev++;
  }
  if (cur === prev) return { dir: "flat", label: "0%" };
  if (!prev) return { dir: "up", label: "novo" };
  const p = Math.round(((cur - prev) / prev) * 100);
  return { dir: p > 0 ? "up" : "down", label: `${Math.abs(p)}%` };
}

// Minigráfico: total acumulado semana a semana nas últimas 12 semanas.
function sparkOf(dates: (string | null)[], weights?: number[]): number[] {
  const WEEKS = 12, week = 7 * 86_400_000, start = Date.now() - WEEKS * week;
  const pts = Array<number>(WEEKS + 1).fill(0);
  dates.forEach((iso, i) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (t < start) return;
    const b = Math.min(WEEKS, Math.ceil((t - start) / week));
    pts[b] += weights?.[i] ?? 1;
  });
  for (let i = 1; i <= WEEKS; i++) pts[i] += pts[i - 1];
  return pts;
}

const COLORS = {
  violet:  { icon: "bg-violet-500/10 text-violet-600 dark:text-violet-400",   line: "text-violet-500" },
  emerald: { icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", line: "text-emerald-500" },
  amber:   { icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400",       line: "text-amber-500" },
  sky:     { icon: "bg-sky-500/10 text-sky-600 dark:text-sky-400",             line: "text-sky-500" },
};

function Sparkline({ pts, className }: { pts: number[]; className: string }) {
  const id = useId();
  const max = Math.max(...pts, 1);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 100, 38 - (v / max) * 32] as const);
  // Curva suave (Catmull-Rom → Bézier).
  let d = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const [p0, p1, p2, p3] = [xy[i - 1] ?? xy[i], xy[i], xy[i + 1], xy[i + 2] ?? xy[i + 1]];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={`pointer-events-none ${className}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L100,40 L0,40 Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
    </svg>
  );
}

function Stat({ icon: Icon, color, label, value, sub, trend, upIsBad, spark, onClick, active }: {
  icon: typeof BellRing; color: keyof typeof COLORS; label: string; value: string; sub: string;
  trend?: Trend; upIsBad?: boolean; spark?: number[]; onClick?: () => void; active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  const c = COLORS[color];
  const TrendIcon = trend?.dir === "up" ? ArrowUp : trend?.dir === "down" ? ArrowDown : ArrowRight;
  const trendCls = !trend || trend.dir === "flat" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
    : (trend.dir === "up") !== !!upIsBad ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : "bg-rose-500/10 text-rose-700 dark:text-rose-400";
  return (
    <Tag onClick={onClick}
      className={`${CARD} relative overflow-hidden p-5 pb-7 flex items-start gap-3.5 min-w-0 text-left transition-colors ${active ? "ring-2 ring-primary/30 border-primary/50" : ""} ${onClick ? "hover:border-primary/40 cursor-pointer" : ""}`}>
      {spark && <Sparkline pts={spark} className={`absolute bottom-0 right-0 w-3/5 h-16 ${c.line}`} />}
      <div className={`relative size-12 rounded-full grid place-items-center shrink-0 ${c.icon}`}><Icon className="size-6" /></div>
      <div className="relative min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80 truncate">{label}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-3xl font-bold tracking-tight leading-none truncate">{value}</p>
          {trend && (
            <span className={`inline-flex items-center gap-0.5 h-5 px-1.5 rounded-md text-[11px] font-semibold shrink-0 ${trendCls}`} title="Últimos 30 dias contra os 30 anteriores">
              <TrendIcon className="size-3" />{trend.label}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 truncate">{sub}</p>
      </div>
    </Tag>
  );
}

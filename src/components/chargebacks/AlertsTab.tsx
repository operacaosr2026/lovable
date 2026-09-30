import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BellRing, CircleCheck, Truck, Mail, HandCoins, ExternalLink, Loader2, Search, Package, Headphones, StickyNote, Wallet,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getChargebackAlerts, saveAlertFollowup, ALERT_STATUSES, type AlertRow, type AlertStatus,
} from "@/lib/chargeback-alerts.functions";

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

export function AlertsTab({ scope }: { scope: "ativas" | "todas" }) {
  const fn = useServerFn(getChargebackAlerts);
  const q = useQuery({ queryKey: ["chargeback-alerts", scope], queryFn: () => fn({ data: { scope } }) });
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
      <p className="text-sm text-muted-foreground">
        Pedidos que o <strong className="text-foreground font-medium">Disputifier reembolsou</strong> por alerta de pré-chargeback (CDRN, Ethoca, RDR).
        O reembolso evita o chargeback, mas o pedido quase sempre foi entregue — dá pra contatar o cliente e tentar reaver o valor.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat icon={BellRing} tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" label="Alertas" value={String(rows.length)} sub={`${money(sum(rows, (r) => r.refundedAmount))} reembolsados`} />
        <Stat icon={Truck} tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" label="Entregues" value={String(delivered.length)} sub={`${money(sum(delivered, (r) => r.refundedAmount))} dá pra cobrar`} />
        <Stat icon={Mail} tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" label="A contatar" value={String(toContact.length)} sub={`${contacted.length} já contatado${contacted.length === 1 ? "" : "s"}`}
          onClick={() => setStatusFilter(statusFilter === "a_contatar" ? "todos" : "a_contatar")} active={statusFilter === "a_contatar"} />
        <Stat icon={HandCoins} tone="bg-sky-500/10 text-sky-600 dark:text-sky-400" label="Recuperado" value={money(sum(recovered, (r) => r.recoveredAmount ?? 0))} sub={`${recovered.length} pedido${recovered.length === 1 ? "" : "s"}`}
          onClick={() => setStatusFilter(statusFilter === "recuperado" ? "todos" : "recuperado")} active={statusFilter === "recuperado"} />
      </div>

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

        {!list.length ? <p className="text-sm text-muted-foreground text-center py-10">Nenhum alerta nesse filtro</p> : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[1050px]">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="font-medium py-2.5 px-2 text-left">Pedido</th>
                  <th className="font-medium py-2.5 px-2 text-left">Produto / cliente</th>
                  <th className="font-medium py-2.5 px-2 text-center">Alerta</th>
                  <th className="font-medium py-2.5 px-2 text-center">Reembolsado</th>
                  <th className="font-medium py-2.5 px-2 text-center">Entrega</th>
                  <th className="font-medium py-2.5 px-2 text-center">Cobrança</th>
                  <th className="font-medium py-2.5 px-2 text-center">Contato</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => <AlertLine key={`${r.shopId}:${r.orderExternalId}`} r={r} scope={scope} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AlertLine({ r, scope }: { r: AlertRow; scope: "ativas" | "todas" }) {
  const router = useRouter();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveAlertFollowup);
  const save = useMutation({
    mutationFn: (v: { status: AlertStatus; recoveredAmount?: number | null; note?: string | null }) =>
      saveFn({ data: { shopId: r.shopId, orderExternalId: r.orderExternalId, status: v.status, recoveredAmount: v.recoveredAmount ?? null, note: v.note ?? r.followupNote } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chargeback-alerts", scope] }),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });
  const delivered = r.deliveryStatus === "delivered";
  const dl = r.orderNumber ? (r.deliveryStatus ? DELIVERY[r.deliveryStatus] ?? r.deliveryStatus : "Sem rastreio") : "—";
  const go = (href: string) => router.history.push(href);

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/30 align-middle">
      <td className="py-3 px-2 whitespace-nowrap">
        <span className="font-semibold">{r.orderNumber ?? `#${r.orderExternalId}`}</span>
        <div className="text-xs text-muted-foreground">{r.shopName.replace(/^Loja \d+ - /, "")} · {fmtDate(r.orderDate)}</div>
      </td>
      <td className="py-3 px-2 max-w-[260px]">
        <div className="truncate font-medium" title={r.product ?? undefined}>{r.product ?? "—"}</div>
        <div className="text-xs text-muted-foreground truncate">{r.customerName ?? "—"}{r.customerEmail ? ` · ${r.customerEmail}` : ""}</div>
      </td>
      <td className="py-3 px-2 text-center">
        <span className="inline-flex text-xs px-2 py-0.5 rounded-full font-semibold bg-violet-500/10 text-violet-700 dark:text-violet-400">{r.network}</span>
      </td>
      <td className="py-3 px-2 text-center whitespace-nowrap">
        <div className="font-semibold tabular-nums">{money(r.refundedAmount)}</div>
        <div className="text-xs text-muted-foreground">{fmtDate(r.refundedAt)}</div>
      </td>
      <td className="py-3 px-2 text-center">
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${delivered ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          {delivered ? <CircleCheck className="size-3" /> : <Package className="size-3" />}{dl}{delivered && r.deliveredAt ? ` · ${fmtDate(r.deliveredAt)}` : ""}
        </span>
        {r.trackingCode && (
          <div className="mt-1">
            {r.trackingUrl
              ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-primary hover:underline inline-flex items-center gap-1">{r.trackingCode}<ExternalLink className="size-3" /></a>
              : <span className="text-[11px] font-mono text-muted-foreground">{r.trackingCode}</span>}
          </div>
        )}
      </td>
      <td className="py-3 px-2 text-center">
        <div className="inline-flex items-center gap-1">
          <select value={r.status} disabled={save.isPending}
            onChange={(e) => {
              const status = e.target.value as AlertStatus;
              save.mutate({ status, recoveredAmount: status === "recuperado" ? r.recoveredAmount ?? r.refundedAmount : null });
            }}
            className={`h-7 pl-2 pr-6 rounded-full text-xs font-medium border-0 outline-none cursor-pointer appearance-none ${STATUS[r.status].cls}`}
            style={{ backgroundImage: "none" }}>
            {ALERT_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
          <FollowupPopover r={r} saving={save.isPending} onSave={(v) => save.mutate({ status: r.status, ...v })} />
        </div>
        {r.status === "recuperado" && r.recoveredAmount != null && <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">{money(r.recoveredAmount)}</div>}
      </td>
      <td className="py-3 px-2 text-center whitespace-nowrap">
        <div className="inline-flex gap-1.5">
          <button onClick={() => { if (r.orderNumber) go(`/atendimento?novo=${encodeURIComponent(r.orderNumber)}`); }} disabled={!r.orderNumber}
            title="Abre uma mensagem nova no Atendimento pra este cliente"
            className="h-8 px-2.5 rounded-lg border border-border text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
            <Mail className="size-3.5" /> Contatar
          </button>
          {r.conversationId && (
            <button onClick={() => go(`/atendimento?c=${r.conversationId}`)} title="Abrir a conversa com este cliente"
              className="h-8 w-8 rounded-lg border border-border grid place-items-center hover:bg-muted text-primary">
              <Headphones className="size-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
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
        <button title={r.followupNote ? `Anotação: ${r.followupNote}` : "Anotar"}
          className={`size-7 rounded-full grid place-items-center hover:bg-muted ${r.followupNote ? "text-primary" : "text-muted-foreground"}`}>
          <StickyNote className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2.5">
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

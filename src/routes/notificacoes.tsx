import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Send, Loader2, Search, ChevronDown, Truck, Package, AlertTriangle, Hourglass, ShieldAlert, Headphones, Mail,
  Plus, Trash2, FileText, ChevronLeft, ChevronRight, CheckCircle2, Clock, X, Check,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  listNoticeOrders, listNoticeTemplates, saveNoticeTemplate, deleteNoticeTemplate, queueOrderNotices, getNoticeQueue, cancelNoticeQueue,
  type NoticeOrder, type NoticeTemplate, type NoticeQueue,
} from "@/lib/order-notices.functions";
import { NOTICE_STAGES, NOTICE_INTERVAL_MIN, stageOf, renderNotice, customerOrderNumber, type NoticeStageKey } from "@/lib/order-notices";
import { US_TIME_ZONE } from "@/lib/timezone";

export const Route = createFileRoute("/notificacoes")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Notificações — SRX Growth" }] }),
  component: NotificacoesPage,
});

const CARD = "rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(16,24,40,0.04)]";

const STATUS: Record<NoticeOrder["status"], { label: string; cls: string; icon: typeof Truck }> = {
  transito:          { label: "Em trânsito",       cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400",       icon: Truck },
  sem_envio:         { label: "Ainda não enviado", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: Package },
  problema:          { label: "Problema",          cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400",    icon: AlertTriangle },
  esperando_cliente: { label: "Esperando cliente", cls: "bg-muted text-muted-foreground",                     icon: Hourglass },
};

// Avisado há menos que isso: some da lista com o filtro padrão.
const RECENT_DAYS = 5;
const INTERVAL_MS = NOTICE_INTERVAL_MIN * 60_000;

const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: US_TIME_ZONE });
};
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: US_TIME_ZONE }).replace(",", "");
const daysAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;
const recentlyNotified = (o: NoticeOrder) => !!o.notices[0] && daysAgo(o.notices[0].at) < RECENT_DAYS;

function NotificacoesPage() {
  const listFn = useServerFn(listNoticeOrders);
  const tplFn = useServerFn(listNoticeTemplates);
  const queueFn = useServerFn(getNoticeQueue);
  const queue = useQuery({
    queryKey: ["notice-queue"], queryFn: () => queueFn(),
    // Com fila andando, atualiza a cada 20 s.
    refetchInterval: (query) => (query.state.data?.pending.length ? 20_000 : false),
  });
  const pendingCount = queue.data?.pending.length ?? 0;
  const q = useQuery({ queryKey: ["notice-orders"], queryFn: () => listFn(), refetchInterval: pendingCount ? 60_000 : false });
  const templates = useQuery({ queryKey: ["notice-templates"], queryFn: () => tplFn() });

  const [stage, setStage] = useState<NoticeStageKey | "todos">("todos");
  const [search, setSearch] = useState("");
  const [shop, setShop] = useState("todas");
  const [status, setStatus] = useState<"todos" | NoticeOrder["status"]>("todos");
  const [hideRecent, setHideRecent] = useState(true);
  const [hideDispute, setHideDispute] = useState(true);
  // "Esperando cliente": a bola está com o cliente (Rastreamento), não é atraso da loja.
  const [hideWaiting, setHideWaiting] = useState(true);
  // Cliente que já escreveu pro suporte: a conversa segue pelo Atendimento.
  const [hideSupport, setHideSupport] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const orders = q.data ?? [];
  const shops = useMemo(() => [...new Map(orders.map((o) => [o.shopId, o.shopName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [orders]);

  // Tudo menos a etapa (os cards de etapa contam com os outros filtros aplicados).
  const base = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^#/, "");
    return orders.filter((o) => {
      if (shop !== "todas" && o.shopId !== shop) return false;
      if (status !== "todos" && o.status !== status) return false;
      if (hideRecent && recentlyNotified(o)) return false;
      if (hideDispute && o.dispute) return false;
      if (hideWaiting && o.status === "esperando_cliente") return false;
      if (hideSupport && o.supportAt) return false;
      if (term && !`${o.orderNumber} ${o.customerName} ${o.email ?? ""} ${o.trackingCode ?? ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [orders, search, shop, status, hideRecent, hideDispute, hideWaiting, hideSupport]);
  const rows = useMemo(() => (stage === "todos" ? base : base.filter((o) => stageOf(o.days) === stage)), [base, stage]);

  // Seleção só do que está na tela (mudou o filtro, o que sumiu sai da seleção).
  useEffect(() => {
    const visible = new Set(rows.map((o) => o.id));
    setSelected((cur) => {
      const next = new Set([...cur].filter((id) => visible.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [rows]);

  const selectedOrders = rows.filter((o) => selected.has(o.id));
  const allChecked = rows.length > 0 && selectedOrders.length === rows.length;
  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <PageShell wide>
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notificações</h1>
          <p className="text-sm text-muted-foreground mt-1">
            E-mail pros clientes de pedidos atrasados, antes que abram chargeback. Sai pelo e-mail do Atendimento, com a assinatura.
          </p>
        </div>
        <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
          <FileText className="size-4" /> Mensagens
        </Button>
      </div>

      {/* Etapas */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <StageCard active={stage === "todos"} onClick={() => setStage("todos")} label="Todos os atrasados" hint="7 dias ou mais desde a compra"
          count={base.length} notNotified={base.filter((o) => !o.notices.length).length} />
        {NOTICE_STAGES.map((s) => {
          const list = base.filter((o) => stageOf(o.days) === s.key);
          return (
            <StageCard key={s.key} active={stage === s.key} onClick={() => setStage(stage === s.key ? "todos" : s.key)}
              label={s.label} hint={s.hint} count={list.length} notNotified={list.filter((o) => !o.notices.length).length} />
          );
        })}
      </div>

      {/* Filtros */}
      {/* Tela larga: tudo numa linha só (a busca encolhe); menor que isso, quebra. */}
      <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 mb-3">
        <div className="relative w-full sm:w-64 xl:w-auto xl:flex-1 xl:min-w-40">
          <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pedido, cliente, e-mail ou rastreio" className="pl-9 h-10 rounded-xl" />
        </div>
        <Select value={shop} onChange={setShop} className="w-40 shrink-0"
          options={[["todas", "Todas as lojas"], ...shops.map(([id, name]) => [id, name] as const)]} />
        <Select value={status} onChange={(v) => setStatus(v as any)} className="w-44 shrink-0"
          options={[["todos", "Todos os status"], ...Object.entries(STATUS).map(([k, v]) => [k, v.label] as const)]} />
        {/* Esconder: grupo único (quebra de linha junto, não um por um). */}
        <div className="flex flex-wrap xl:flex-nowrap xl:shrink-0 items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground mr-0.5">Esconder</span>
          <HideChip on={hideRecent} onToggle={() => setHideRecent(!hideRecent)} title={`Cliente que recebeu e-mail há menos de ${RECENT_DAYS} dias`}>
            Avisados há {"<"} {RECENT_DAYS} dias
          </HideChip>
          <HideChip on={hideDispute} onToggle={() => setHideDispute(!hideDispute)} title="Pedido com chargeback ou inquiry aberto">
            Com chargeback
          </HideChip>
          <HideChip on={hideWaiting} onToggle={() => setHideWaiting(!hideWaiting)} title='Status "Esperando cliente" no Rastreamento'>
            Esperando cliente
          </HideChip>
          <HideChip on={hideSupport} onToggle={() => setHideSupport(!hideSupport)} title="Cliente que já escreveu pro suporte (conversa no Atendimento)">
            Escreveu pro suporte
          </HideChip>
        </div>
      </div>

      {queue.data && (queue.data.pending.length > 0 || queue.data.failed.length > 0) && <QueuePanel queue={queue.data} />}

      {/* Ação */}
      <div className={`${CARD} sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 mb-3`}>
        <span className="text-sm text-muted-foreground">
          {selectedOrders.length
            ? <><b className="text-foreground">{selectedOrders.length}</b> {selectedOrders.length === 1 ? "pedido selecionado" : "pedidos selecionados"}</>
            : `${rows.length} ${rows.length === 1 ? "pedido" : "pedidos"} na lista — marque quem vai receber o e-mail`}
        </span>
        <div className="flex items-center gap-2">
          {selectedOrders.length > 0 && <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Limpar</Button>}
          <Button disabled={!selectedOrders.length} onClick={() => setSendOpen(true)}>
            <Send className="size-4" /> Enviar e-mail
          </Button>
        </div>
      </div>

      {/* Lista */}
      <div className={`${CARD} overflow-x-auto`}>
        {q.isLoading ? (
          <div className="py-24 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : q.error ? (
          <div className="py-16 text-center text-sm text-destructive">{(q.error as Error).message}</div>
        ) : !rows.length ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-6 mx-auto mb-2 text-emerald-500" />
            Nenhum pedido atrasado com esses filtros.
          </div>
        ) : (
          <table className="w-full text-sm min-w-[1100px] table-fixed">
            {/* Larguras fixas: sem isso a coluna Rastreio esticava e sobrava um vão. */}
            <colgroup>
              <col className="w-12" />
              <col className="w-[150px]" />
              <col className="w-[22%]" />
              <col className="w-[96px]" />
              <col />
              <col className="w-[200px]" />
              <col className="w-[200px]" />
            </colgroup>
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border text-left">
                <th className="py-2.5 pl-4 pr-2 w-8">
                  <Checkbox checked={allChecked ? true : selectedOrders.length ? "indeterminate" : false}
                    onCheckedChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((o) => o.id)))} aria-label="Marcar todos" />
                </th>
                <th className="font-medium py-2.5 px-2">Pedido</th>
                <th className="font-medium py-2.5 px-2">Cliente</th>
                <th className="font-medium py-2.5 px-2 text-center">Compra</th>
                <th className="font-medium py-2.5 px-2">Rastreio</th>
                <th className="font-medium py-2.5 px-2">Código de rastreio</th>
                <th className="font-medium py-2.5 px-2">Último aviso</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const st = STATUS[o.status];
                return (
                  <tr key={o.id} onClick={() => toggle(o.id)}
                    className={`border-b border-border/60 last:border-0 cursor-pointer align-top ${selected.has(o.id) ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <td className="py-3 pl-4 pr-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} aria-label={`Marcar ${o.orderNumber}`} />
                    </td>
                    <td className="py-3 px-2">
                      <div className="font-medium">{customerOrderNumber(o.orderNumber)}</div>
                      <div className="text-xs text-muted-foreground">{o.shopName}</div>
                      {o.dispute && (
                        <Pill cls="bg-rose-500/10 text-rose-700 dark:text-rose-400 mt-1" icon={ShieldAlert}>
                          {o.dispute.type === "inquiry" ? "Inquiry" : "Chargeback"}
                        </Pill>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <div className="truncate">{o.customerName}</div>
                      <div className={`text-xs truncate ${o.email ? "text-muted-foreground" : "text-rose-600"}`}>{o.email ?? "sem e-mail"}</div>
                    </td>
                    <td className="py-3 px-2 text-center whitespace-nowrap">
                      <div className={`font-semibold ${o.days >= 21 ? "text-rose-600" : o.days >= 14 ? "text-amber-600" : ""}`}>{o.days} dias</div>
                      <div className="text-xs text-muted-foreground">{fmtDate(o.orderDate)}</div>
                    </td>
                    <td className="py-3 px-2">
                      <Pill cls={st.cls} icon={st.icon}>{st.label}</Pill>
                      {o.lastEvent && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2" title={o.lastEvent}>
                          {o.lastEventAt && <span className="text-foreground/80">{fmtDate(o.lastEventAt)} · </span>}{o.lastEvent}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2 whitespace-nowrap">
                      {o.trackingCode ? (
                        o.trackingUrl ? (
                          <a href={o.trackingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            className="text-xs tabular-nums text-primary hover:underline" title="Abrir a página de rastreio">
                            {o.trackingCode}
                          </a>
                        ) : <span className="text-xs tabular-nums">{o.trackingCode}</span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 px-2">
                      {o.notices[0] ? (
                        <>
                          <div className="flex items-center gap-1.5 whitespace-nowrap"><Mail className="size-3.5 text-emerald-600" />{fmtDateTime(o.notices[0].at)}</div>
                          <div className="text-xs text-muted-foreground">
                            {o.notices[0].title}{o.notices.length > 1 && ` · ${o.notices.length} avisos`}
                          </div>
                        </>
                      ) : !o.queued && <span className="text-xs text-muted-foreground">Nunca avisado</span>}
                      {o.queued && <Pill cls="bg-violet-500/10 text-violet-700 dark:text-violet-400 mt-1" icon={Clock}>Na fila</Pill>}
                      {o.supportAt && (
                        <div className="flex items-center gap-1 text-xs text-sky-700 dark:text-sky-400 mt-1" title="Última vez que o cliente mandou e-mail pro suporte">
                          <Headphones className="size-3" /> Escreveu pro suporte {fmtDate(o.supportAt)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <SendDialog open={sendOpen} onOpenChange={setSendOpen} orders={selectedOrders} templates={templates.data ?? []} queueSize={pendingCount}
        onEditTemplates={() => { setSendOpen(false); setTemplatesOpen(true); }}
        onDone={() => setSelected(new Set())} />
      <TemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} templates={templates.data ?? []} />
    </PageShell>
  );
}

// ─── Envio ────────────────────────────────────────────────────────────────────

function SendDialog({ open, onOpenChange, orders, templates, queueSize, onEditTemplates, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; orders: NoticeOrder[]; templates: NoticeTemplate[]; queueSize: number;
  onEditTemplates: () => void; onDone: () => void;
}) {
  const qc = useQueryClient();
  const queueFn = useServerFn(queueOrderNotices);
  const [templateId, setTemplateId] = useState("");
  const [previewIdx, setPreviewIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    setPreviewIdx(0);
    // Sugestão: "Ainda não foi enviado" quando todos estão sem envio; senão a 1ª.
    const allUnsent = orders.length > 0 && orders.every((o) => o.status === "sem_envio");
    const pick = (allUnsent && templates.find((t) => !/\{rastreio\}/i.test(t.body))) || templates[0];
    setTemplateId((cur) => (templates.some((t) => t.id === cur) ? cur : pick?.id ?? ""));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const tpl = templates.find((t) => t.id === templateId);
  const needsLink = !!tpl && (/\{rastreio\}/i.test(tpl.body) || /\{rastreio\}/i.test(tpl.subject));
  const noEmail = orders.filter((o) => !o.email);
  const noLink = needsLink ? orders.filter((o) => o.email && !o.trackingUrl) : [];
  const recent = orders.filter(recentlyNotified);
  const withDispute = orders.filter((o) => o.dispute);
  const inQueue = orders.filter((o) => o.queued);
  const sendable = orders.filter((o) => !o.queued && o.email && (!needsLink || o.trackingUrl));
  const preview = orders[Math.min(previewIdx, orders.length - 1)];
  const vars = preview ? { nome: preview.firstName, pedido: preview.orderNumber, rastreio: preview.trackingUrl ?? "[sem link de rastreio]" } : null;
  // 1 a cada NOTICE_INTERVAL_MIN, depois do que já está na fila.
  const finishAt = new Date(Date.now() + (queueSize + sendable.length) * INTERVAL_MS);

  const send = useMutation({
    mutationFn: async () => {
      if (!tpl) throw new Error("Escolha a mensagem");
      return queueFn({ data: { templateId: tpl.id, orderIds: sendable.map((o) => o.id) } });
    },
    onSuccess: (r) => {
      if (r.queued) toast.success(r.queued === 1 ? "1 e-mail na fila" : `${r.queued} e-mails na fila — sai 1 a cada ${NOTICE_INTERVAL_MIN} minutos`);
      if (r.skipped.length) toast.warning(`Fora da fila: ${r.skipped.map((x) => `${customerOrderNumber(x.order)} (${x.motivo})`).join(", ")}`, { duration: 12_000 });
      qc.invalidateQueries({ queryKey: ["notice-orders"] });
      qc.invalidateQueries({ queryKey: ["notice-queue"] });
      onDone();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao colocar na fila"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!send.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enviar e-mail {orders.length === 1 ? "pro cliente" : `pra ${orders.length} clientes`}</DialogTitle>
          <DialogDescription>
            Cada cliente recebe um e-mail só dele, com o nome, o número do pedido e o link de rastreio. Sai 1 a cada {NOTICE_INTERVAL_MIN} minutos, pelo servidor — pode fechar a tela.
          </DialogDescription>
        </DialogHeader>

        {!templates.length ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma mensagem cadastrada. <button className="text-primary hover:underline" onClick={onEditTemplates}>Criar mensagem</button>
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            <div className="flex items-center gap-2">
              <Select value={templateId} onChange={setTemplateId} className="flex-1" options={templates.map((t) => [t.id, t.title] as const)} />
              <Button variant="outline" onClick={onEditTemplates}>Editar mensagens</Button>
            </div>

            {tpl && preview && vars && (
              <div className="rounded-xl border border-border bg-muted/30 min-w-0">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border text-xs text-muted-foreground">
                  <span className="truncate">Prévia — {customerOrderNumber(preview.orderNumber)} · {preview.email ?? "sem e-mail"}</span>
                  {orders.length > 1 && (
                    <span className="flex items-center gap-1 shrink-0">
                      <button className="p-0.5 rounded hover:bg-muted disabled:opacity-40" disabled={previewIdx === 0} onClick={() => setPreviewIdx((i) => i - 1)} aria-label="Anterior"><ChevronLeft className="size-4" /></button>
                      {Math.min(previewIdx, orders.length - 1) + 1}/{orders.length}
                      <button className="p-0.5 rounded hover:bg-muted disabled:opacity-40" disabled={previewIdx >= orders.length - 1} onClick={() => setPreviewIdx((i) => i + 1)} aria-label="Próximo"><ChevronRight className="size-4" /></button>
                    </span>
                  )}
                </div>
                <div className="px-3 py-2 text-sm"><span className="text-muted-foreground">Assunto: </span><b>{renderNotice(tpl.subject, vars)}</b></div>
                <div className="px-3 pb-3 text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{renderNotice(tpl.body, vars)}</div>
                <div className="px-3 pb-2 text-xs text-muted-foreground">+ assinatura do Atendimento. O link aparece como "Track your order here".</div>
              </div>
            )}

            <div className="space-y-1.5 text-sm">
              {noEmail.length > 0 && <Warn>{noEmail.length} sem e-mail do cliente — fica de fora ({noEmail.map((o) => customerOrderNumber(o.orderNumber)).join(", ")}).</Warn>}
              {noLink.length > 0 && <Warn>{noLink.length} sem link de rastreio — fica de fora, porque a mensagem usa {"{rastreio}"} ({noLink.map((o) => customerOrderNumber(o.orderNumber)).join(", ")}).</Warn>}
              {recent.length > 0 && <Warn>{recent.length} já {recent.length === 1 ? "foi avisado" : "foram avisados"} nos últimos {RECENT_DAYS} dias ({recent.map((o) => `${customerOrderNumber(o.orderNumber)} em ${fmtDateTime(o.notices[0].at)}`).join(", ")}).</Warn>}
              {withDispute.length > 0 && <Warn>{withDispute.length} com chargeback/inquiry aberto ({withDispute.map((o) => customerOrderNumber(o.orderNumber)).join(", ")}).</Warn>}
              {inQueue.length > 0 && <Warn>{inQueue.length} já {inQueue.length === 1 ? "está" : "estão"} na fila — fica de fora ({inQueue.map((o) => customerOrderNumber(o.orderNumber)).join(", ")}).</Warn>}
            </div>
            {sendable.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {queueSize > 0 && `Já tem ${queueSize} na fila antes. `}
                Termina por volta de <b className="text-foreground">{fmtDateTime(finishAt.toISOString())}</b> (horário de NY).
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={send.isPending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!tpl || !sendable.length || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {sendable.length === 1 ? "Enviar 1 e-mail" : `Enviar ${sendable.length} e-mails`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fila ─────────────────────────────────────────────────────────────────────

function QueuePanel({ queue }: { queue: NoticeQueue }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const cancelFn = useServerFn(cancelNoticeQueue);
  const [open, setOpen] = useState(false);
  const n = queue.pending.length;
  // Próximo sai um intervalo depois do último envio; os outros, 1 por intervalo.
  const nextAt = Math.max(Date.now(), (queue.lastSentAt ? Date.parse(queue.lastSentAt) : 0) + INTERVAL_MS);
  const finishAt = new Date(nextAt + Math.max(0, n - 1) * INTERVAL_MS).toISOString();
  const cancel = useMutation({
    mutationFn: (ids?: string[]) => cancelFn({ data: { ids } }),
    onSuccess: (r) => {
      toast.success(r.cancelled === 1 ? "1 e-mail tirado da fila" : `${r.cancelled} e-mails tirados da fila`);
      qc.invalidateQueries({ queryKey: ["notice-queue"] });
      qc.invalidateQueries({ queryKey: ["notice-orders"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao cancelar"),
  });

  return (
    <div className={`${CARD} px-4 py-3 mb-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm min-w-0">
          {n > 0 ? (
            <>
              <Loader2 className="size-4 animate-spin text-violet-600 shrink-0" />
              <span>
                <b>{n}</b> {n === 1 ? "e-mail na fila" : "e-mails na fila"} — 1 a cada {NOTICE_INTERVAL_MIN} minutos, termina por volta de <b>{fmtDateTime(finishAt)}</b>
              </span>
            </>
          ) : (
            <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500" /> Fila vazia</span>
          )}
          {queue.failed.length > 0 && (
            <span className="text-rose-600 whitespace-nowrap">· {queue.failed.length} com erro (2 dias)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>{open ? "Esconder" : "Ver fila"}</Button>
          {n > 0 && (
            <Button variant="outline" size="sm" disabled={cancel.isPending}
              onClick={async () => {
                if (await confirm({ title: "Cancelar a fila?", description: `Os ${n} e-mails que ainda não saíram não serão enviados.`, confirmText: "Cancelar fila" })) cancel.mutate(undefined);
              }}>
              Cancelar fila
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-border/60 text-sm">
          {queue.pending.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 py-1.5">
              <span className="w-12 text-xs text-muted-foreground tabular-nums">{p.status === "enviando" ? "agora" : `${i + 1}º`}</span>
              <span className="w-20 font-medium">{customerOrderNumber(p.orderNumber)}</span>
              <span className="flex-1 truncate text-muted-foreground">{p.email} · {p.title}</span>
              {p.status === "na_fila" && (
                <button className="p-1 rounded hover:bg-muted text-muted-foreground" title="Tirar da fila" aria-label="Tirar da fila"
                  disabled={cancel.isPending} onClick={() => cancel.mutate([p.id])}>
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
          {queue.failed.map((f) => (
            <div key={f.id} className="flex items-center gap-3 py-1.5 text-rose-700 dark:text-rose-400">
              <span className="w-12 text-xs">erro</span>
              <span className="w-20 font-medium">{customerOrderNumber(f.orderNumber)}</span>
              <span className="flex-1 truncate" title={f.error ?? ""}>{f.email} · {f.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

function TemplatesDialog({ open, onOpenChange, templates }: { open: boolean; onOpenChange: (v: boolean) => void; templates: NoticeTemplate[] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const saveFn = useServerFn(saveNoticeTemplate);
  const deleteFn = useServerFn(deleteNoticeTemplate);
  const [editing, setEditing] = useState<{ id?: string; title: string; subject: string; body: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = templates[0];
    setEditing(t ? { id: t.id, title: t.title, subject: t.subject, body: t.body } : { title: "", subject: "", body: "" });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = templates.find((t) => t.id === editing?.id);
  const dirty = !!editing && (!current
    ? !!(editing.title || editing.subject || editing.body)
    : editing.title !== current.title || editing.subject !== current.subject || editing.body !== current.body);

  const save = useMutation({
    mutationFn: () => saveFn({ data: editing! }),
    onSuccess: (r) => {
      toast.success("Mensagem salva");
      setEditing((e) => (e ? { ...e, id: r.id } : e));
      qc.invalidateQueries({ queryKey: ["notice-templates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (_r, id) => {
      toast.success("Mensagem apagada");
      const next = templates.find((t) => t.id !== id);
      setEditing(next ? { id: next.id, title: next.title, subject: next.subject, body: next.body } : { title: "", subject: "", body: "" });
      qc.invalidateQueries({ queryKey: ["notice-templates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao apagar"),
  });

  const pick = async (t: NoticeTemplate | null) => {
    if (dirty && !(await confirm({ title: "Descartar alterações?", description: "A mensagem aberta tem alterações que não foram salvas.", confirmText: "Descartar" }))) return;
    setEditing(t ? { id: t.id, title: t.title, subject: t.subject, body: t.body } : { title: "", subject: "", body: "" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Mensagens</DialogTitle>
          <DialogDescription>
            Escritas em inglês, como o cliente recebe. Use <code>{"{nome}"}</code> (primeiro nome), <code>{"{pedido}"}</code> (nº do pedido) e <code>{"{rastreio}"}</code> (link de rastreio).
          </DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-[220px_1fr] gap-4 min-w-0">
          <div className="space-y-1">
            {templates.map((t) => (
              <button key={t.id} onClick={() => pick(t)}
                className={`w-full text-left text-sm px-3 py-2 rounded-lg truncate ${editing?.id === t.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}>
                {t.title}
              </button>
            ))}
            <button onClick={() => pick(null)}
              className={`w-full text-left text-sm px-3 py-2 rounded-lg flex items-center gap-1.5 ${editing && !editing.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}>
              <Plus className="size-4" /> Nova mensagem
            </button>
          </div>
          {editing && (
            <div className="space-y-3 min-w-0">
              <Field label="Nome (só pra equipe)">
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Ex.: Desculpas pelo atraso" />
              </Field>
              <Field label="Assunto do e-mail">
                <Input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="Ex.: Update on your order {pedido}" />
              </Field>
              <Field label="Texto">
                <Textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={14} className="font-mono text-[13px]" />
              </Field>
              <div className="flex items-center justify-between gap-2">
                {editing.id ? (
                  <Button variant="ghost" className="text-destructive" disabled={remove.isPending}
                    onClick={async () => {
                      if (await confirm({ title: `Apagar "${current?.title ?? editing.title}"?`, description: "O histórico de quem já recebeu continua.", confirmText: "Apagar" })) remove.mutate(editing.id!);
                    }}>
                    <Trash2 className="size-4" /> Apagar
                  </Button>
                ) : <span />}
                <Button disabled={!dirty || !editing.title.trim() || !editing.subject.trim() || !editing.body.trim() || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Peças ────────────────────────────────────────────────────────────────────

function StageCard({ active, onClick, label, hint, count, notNotified }: {
  active: boolean; onClick: () => void; label: string; hint: string; count: number; notNotified: number;
}) {
  return (
    <button onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-all ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{count}</div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {notNotified > 0 ? <span className="text-amber-700 dark:text-amber-400">{notNotified} nunca avisado{notNotified === 1 ? "" : "s"}</span> : hint}
      </div>
    </button>
  );
}

// Filtro liga/desliga em forma de pílula (ligado = escondido).
function HideChip({ on, onToggle, title, children }: { on: boolean; onToggle: () => void; title: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onToggle} title={title} aria-pressed={on}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors whitespace-nowrap ${
        on ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
      {on ? <Check className="size-3.5" /> : <span className="size-3.5" />}
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
      <AlertTriangle className="size-4 shrink-0 mt-0.5" /><span className="break-words min-w-0">{children}</span>
    </div>
  );
}

function Pill({ cls, icon: Icon, children }: { cls: string; icon?: typeof Truck; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>
      {Icon && <Icon className="size-3" />}{children}
    </span>
  );
}

function Select({ value, onChange, options, className = "" }: { value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[]; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 pl-3 pr-8 rounded-xl border border-border bg-card text-sm outline-none focus:border-primary appearance-none cursor-pointer truncate">
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <ChevronDown className="size-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

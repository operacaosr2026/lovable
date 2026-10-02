import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Mail, MailWarning, MessageCircle, Percent, CircleCheck, Timer, Search, SlidersHorizontal, Settings, PenSquare,
  RefreshCw, Loader2, Star, Paperclip, X, ChevronDown, Inbox, Check, ArrowDownUp, Sparkles, BarChart3, CalendarDays,
  Bot,
} from "lucide-react";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useMyAccess } from "@/hooks/useMyAccess";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SupportSettings, type ConfigTab } from "@/components/atendimento/SupportSettings";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { businessHoursLabel, currentMonth } from "@/lib/support-kpis";
import { SupportKpisView } from "@/components/atendimento/SupportKpisView";
import type { DateRange } from "react-day-picker";
import { localDateKey } from "@/lib/timezone";
import {
  getZohoStatus, listSupportConversations, syncSupportInbox, findEmailsByOrder, markConversationRead,
  updateSupportConversations, sendSupportNewMessage, deleteSupportConversations, findOrderCustomers, SUPPORT_STATUSES,
  type SupportConversation, type SupportStatus,
} from "@/lib/atendimento.functions";
import { ConversationView } from "@/components/atendimento/ConversationView";
import { CustomerPanel, tagTone } from "@/components/atendimento/CustomerPanel";
import { AttachmentChips, SavedReplies, TemplateTextarea, TranslateToEnglish, useAttachments } from "@/components/atendimento/Composer";
import { Avatar, STATUS_META, displayName, formatDuration, fullTime, listTime, resolvePeriod } from "@/components/atendimento/utils";
import { useSupportFn, useIsDemo, DemoContext, isDemoUrl } from "@/components/atendimento/demo";
import { useSupportTags } from "@/components/atendimento/useSupportTags";

export const Route = createFileRoute("/atendimento")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Atendimento — SRX Growth" }] }),
  component: AtendimentoPage,
});

type Tab = "todos" | "nao_respondidos" | "favoritos";
// Não respondido: conversa em aberto em que o cliente escreveu por último.
const isUnanswered = (c: SupportConversation) =>
  c.status !== "resolvido" && !!c.last_inbound_at && (!c.last_outbound_at || c.last_inbound_at > c.last_outbound_at);
const PERIODS = [
  ["hoje", "Hoje"], ["ontem", "Ontem"], ["7d", "Últimos 7 dias"], ["30d", "Últimos 30 dias"], ["mes", "Este mês"], ["custom", "Personalizado"],
] as const;
// Complemento do card "E-mails recebidos" conforme o período escolhido.
const PERIOD_SUFFIX: Record<string, string> = {
  hoje: "hoje", ontem: "ontem", "7d": "em 7 dias", "30d": "em 30 dias", mes: "este mês", custom: "no período",
};
const fmtDay = (d: string) => d.split("-").reverse().slice(0, 2).join("/");

type Sort = "recentes" | "antigos" | "nao_lidos";
const SORT_LABELS: Record<Sort, string> = { recentes: "Mais recentes", antigos: "Mais antigos", nao_lidos: "Não lidos primeiro" };

type View = "inbox" | "kpi" | "config";

function AtendimentoPage() {
  // Modo demonstração (?demo=1): lido só no navegador, antes de qualquer consulta.
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => { setDemo(isDemoUrl()); }, []);
  if (demo === null) return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  return (
    <DemoContext.Provider value={demo}>
      <AtendimentoContent />
    </DemoContext.Provider>
  );
}

function AtendimentoContent() {
  const demo = useIsDemo();
  const statusFn = useSupportFn(getZohoStatus, "getZohoStatus");
  const status = useQuery({ queryKey: ["zoho-status", demo], queryFn: () => statusFn(), refetchInterval: 60_000 });

  if (status.isLoading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }
  if (status.isError) {
    return <div className="min-h-[60vh] grid place-items-center text-sm text-destructive">{(status.error as any)?.message ?? "Erro"}</div>;
  }
  return <Inboxes status={status.data!} />;
}

type ZohoStatus = Awaited<ReturnType<typeof getZohoStatus>>;

function Inboxes({ status }: { status: ZohoStatus }) {
  const demo = useIsDemo();
  // Subabas liberadas (Configurações > Membros); admin e modo de exemplo veem todas.
  const { canAccessSection, isLoading: accessLoading } = useMyAccess();
  const VIEW_SECTION = { inbox: "at_caixa", kpi: "at_kpi", config: "at_config" } as const;
  const canView = (v: View) => demo || accessLoading || canAccessSection(VIEW_SECTION[v]);
  const [view, setViewState] = useState<View>("inbox");
  const setView = (v: View) => setViewState(v);
  useEffect(() => {
    if (!canView(view)) {
      const first = (["inbox", "kpi", "config"] as View[]).find(canView);
      if (first) setViewState(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLoading, view]);
  // Mês da aba KPI (independente do filtro da Caixa).
  const [kpiMonth, setKpiMonth] = useState(() => currentMonth());
  const [configTab, setConfigTab] = useState<ConfigTab>("integracao");
  const qc = useQueryClient();
  const listFn = useSupportFn(listSupportConversations, "listSupportConversations");
  const syncFn = useSupportFn(syncSupportInbox, "syncSupportInbox");
  const orderFn = useSupportFn(findEmailsByOrder, "findEmailsByOrder");
  const readFn = useSupportFn(markConversationRead, "markConversationRead");
  const updateFn = useSupportFn(updateSupportConversations, "updateSupportConversations");

  const [period, setPeriod] = useState("30d");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | undefined>();
  const range = useMemo(() => resolvePeriod(period, customRange), [period, customRange]);

  const list = useQuery({
    queryKey: ["support-list", range.from, range.to],
    queryFn: () => listFn({ data: range }),
    refetchInterval: 60_000,
  });

  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["support-list"] });
    qc.invalidateQueries({ queryKey: ["zoho-status"] });
  }, [qc]);

  // Sincroniza ao abrir e a cada minuto enquanto a tela está aberta.
  const sync = useMutation({
    mutationFn: (force: boolean) => syncFn({ data: { force } }),
    onSuccess: (r: any) => {
      if (!r?.skipped) { refreshAll(); qc.invalidateQueries({ queryKey: ["support-conv"] }); }
    },
    onError: (e: any, force) => { if (force) toast.error(e.message ?? "Erro ao sincronizar"); qc.invalidateQueries({ queryKey: ["zoho-status"] }); },
  });
  useEffect(() => {
    if (!status.connected) return;
    sync.mutate(false);
    const t = setInterval(() => { if (document.visibilityState === "visible") sync.mutate(false); }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.connected]);

  const [tab, setTab] = useState<Tab>("todos");
  const [sort, setSort] = useState<Sort>("recentes");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SupportStatus[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Link da notificação de e-mail (/atendimento?c=<conversa>): abre direto nela.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c && /^[0-9a-f-]{36}$/i.test(c)) {
      setSelectedId(c);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  // Rastreamento > "Avisar cliente": ?novo=<nº do pedido> abre a Nova mensagem
  // já com o pedido buscado (e-mail do cliente e {rastreio} dele).
  const [composeOrder, setComposeOrder] = useState<string | null>(null);
  useEffect(() => {
    const novo = new URLSearchParams(window.location.search).get("novo");
    if (novo) {
      setComposeOrder(novo);
      setComposeOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // "#4532" ou número → procura o pedido e traz o e-mail do comprador.
  const [orderQuery, setOrderQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setOrderQuery(/^#?\d{3,}$/.test(search.trim()) ? search.trim() : ""), 350);
    return () => clearTimeout(t);
  }, [search]);
  const orderEmails = useQuery({
    queryKey: ["support-order-search", orderQuery],
    queryFn: () => orderFn({ data: { q: orderQuery } }),
    enabled: !!orderQuery,
    staleTime: 60_000,
  });

  const conversations = list.data?.conversations ?? [];
  // Tags fixas (Configurações > Tags) primeiro, depois as usadas que não estão na lista.
  const { fixed: fixedTags } = useSupportTags();
  const allTags = useMemo(() => {
    const used = [...new Set(conversations.flatMap((c) => c.tags))].sort();
    return [...fixedTags, ...used.filter((t) => !fixedTags.some((f) => f.toLowerCase() === t.toLowerCase()))];
  }, [conversations, fixedTags]);

  const filteredBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byOrder = new Set(orderEmails.data ?? []);
    return conversations.filter((c) =>
      (!q || byOrder.has(c.customer_email) ||
        [c.customer_email, c.customer_name, c.subject, c.summary].some((v) => v?.toLowerCase().includes(q))) &&
      (!statusFilter.length || statusFilter.includes(c.status)) &&
      (!tagFilter.length || tagFilter.some((t) => c.tags.includes(t))));
  }, [conversations, search, orderEmails.data, statusFilter, tagFilter]);

  const counts = {
    todos: filteredBase.length,
    nao_respondidos: filteredBase.filter(isUnanswered).length,
    favoritos: filteredBase.filter((c) => c.favorite).length,
  };

  const visible = useMemo(() => {
    const rows = filteredBase.filter((c) => tab === "todos" || (tab === "nao_respondidos" ? isUnanswered(c) : c.favorite));
    const t = (c: SupportConversation) => c.last_message_at ?? "";
    return [...rows].sort((a, b) =>
      sort === "antigos" ? t(a).localeCompare(t(b))
        : sort === "nao_lidos" ? (Number(b.unread_count > 0) - Number(a.unread_count > 0)) || t(b).localeCompare(t(a))
        : t(b).localeCompare(t(a)));
  }, [filteredBase, tab, sort]);

  // Desktop: abre a primeira conversa automaticamente.
  useEffect(() => {
    if (!selectedId && visible.length && typeof window !== "undefined" && window.innerWidth >= 1024) setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  const bulk = useMutation({
    mutationFn: async (action: "read" | "unread" | "resolve" | "progress") => {
      const ids = [...checked];
      if (action === "read" || action === "unread") await readFn({ data: { ids, read: action === "read" } });
      else await updateFn({ data: { ids, patch: { status: action === "resolve" ? "resolvido" : "em_atendimento" } } });
    },
    onSuccess: () => { setChecked(new Set()); refreshAll(); qc.invalidateQueries({ queryKey: ["support-conv"] }); },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const deleteFn = useSupportFn(deleteSupportConversations, "deleteSupportConversations");
  const confirm = useConfirm();
  // Excluir e Spam fazem o mesmo (Lixeira do Zoho + sai daqui e dos KPIs); só o texto muda.
  const askBulkDelete = async (spam = false) => {
    const n = checked.size;
    if (!(await confirm({
      title: spam ? `Marcar ${n} conversa${n > 1 ? "s" : ""} como spam?` : `Excluir ${n} conversa${n > 1 ? "s" : ""}?`,
      description: spam
        ? "Saem do Atendimento (e dos indicadores) e os e-mails vão para a Lixeira do Zoho, onde ficam recuperáveis por 30 dias."
        : "Os e-mails delas (do cliente e as respostas) vão para a Lixeira do Zoho, onde ficam recuperáveis por 30 dias.",
      confirmText: spam ? "Mover para o lixo" : "Excluir", variant: "destructive",
    }))) return;
    try {
      const r = await deleteFn({ data: { ids: [...checked] } });
      if (selectedId && checked.has(selectedId)) setSelectedId(null);
      setChecked(new Set());
      refreshAll();
      if (r.failed) toast.warning(`${r.deleted} excluída${r.deleted === 1 ? "" : "s"}; ${r.failed} não deu (Zoho recusou) — tente de novo`);
      else toast.success(`${r.deleted} conversa${r.deleted > 1 ? "s" : ""} excluída${r.deleted > 1 ? "s" : ""}`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir");
    }
  };

  const k = list.data?.kpis;
  // Cards clicáveis: contam as conversas do período (as mesmas da lista).
  const periodCounts = {
    unanswered: conversations.filter(isUnanswered).length,
    em_atendimento: conversations.filter((c) => c.status === "em_atendimento").length,
    resolvido: conversations.filter((c) => c.status === "resolvido").length,
  };
  const onlyStatus = (st: SupportStatus) => statusFilter.length === 1 && statusFilter[0] === st;
  const toggleStatusCard = (st: SupportStatus) => {
    setStatusFilter(onlyStatus(st) ? [] : [st]);
    setTab("todos");
  };
  const connected = status.connected;
  // Sem dados (erro ou Zoho não conectado): "—" em vez de ficar carregando.
  const kv = (v: number | undefined) => (v ?? (list.isError || !connected ? "—" : undefined));
  const syncOk = connected && !status.lastSyncError;
  const activeFilters = statusFilter.length + tagFilter.length + (period !== "30d" ? 1 : 0);

  return (
    <PageShell fit wide>
      {/* ── Cabeçalho ── */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight whitespace-nowrap">Atendimento</h1>
          <span
            title={!connected ? "Zoho Mail não conectado" : syncOk ? `Conectado a ${status.email}` : status.lastSyncError ?? ""}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${!connected ? "bg-muted text-muted-foreground" : syncOk ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
          >
            <span className={`size-1.5 rounded-full ${!connected ? "bg-muted-foreground" : syncOk ? "bg-success" : "bg-destructive"}`} />
            {!connected ? "Desconectado" : syncOk ? "Online" : "Erro na sincronização"}
          </span>
          {demo && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium pl-2 pr-1 py-0.5 rounded-full whitespace-nowrap bg-amber-500/15 text-amber-700 dark:text-amber-400">
              Dados fictícios
              <a href="/atendimento" className="px-1.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30">Sair</a>
            </span>
          )}
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-muted ml-1 shrink-0">
            {([["inbox", "Caixa de entrada", Inbox], ["kpi", "KPI", BarChart3], ["config", "Configurações", Settings]] as const).filter(([key]) => canView(key)).map(([key, label, Icon]) => (
              <button key={key} onClick={() => setView(key)}
                className={`h-7 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${view === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon className="size-3.5" /> <span className="hidden sm:inline">{key === "inbox" ? <><span className="2xl:hidden">Caixa</span><span className="hidden 2xl:inline">Caixa de entrada</span></> : label}</span>
              </button>
            ))}
          </div>
        </div>
        {view === "kpi" && (
          <div className="flex items-center gap-2 lg:ml-auto">
            <MonthSelect value={kpiMonth} onChange={setKpiMonth} />
          </div>
        )}
        {view === "inbox" && (
        <div className="flex items-center gap-2 flex-1 min-w-0 lg:justify-end">
          <div className="relative flex-1 min-w-[120px] lg:max-w-80">
            <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, assunto ou pedido…"
              className="w-full h-8 pl-8 pr-7 rounded-xl bg-card border border-border text-xs outline-none focus:border-primary"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Limpar busca">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button title="Filtros" className={`h-8 px-2.5 xl:px-3 rounded-xl border text-xs flex items-center gap-1.5 bg-card shrink-0 whitespace-nowrap ${activeFilters ? "border-primary/50 text-primary" : "border-border"}`}>
                <SlidersHorizontal className="size-3.5" /><span className="hidden xl:inline">Filtros</span>{activeFilters ? ` (${activeFilters})` : ""}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3 space-y-3 max-h-[80vh] overflow-y-auto">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Período</p>
                {PERIODS.map(([key, label]) => (
                  <CheckRow key={key} radio checked={period === key}
                    onToggle={() => { setPeriod(key); if (key !== "custom") setCustomRange(undefined); }}>
                    {label}
                    {key === "custom" && customRange && period === "custom" && (
                      <span className="ml-auto text-[10px] text-muted-foreground">{fmtDay(customRange.from)} → {fmtDay(customRange.to)}</span>
                    )}
                  </CheckRow>
                ))}
                {period === "custom" && (
                  <div className="mt-1 rounded-lg border border-border">
                    <Calendar
                      mode="range"
                      numberOfMonths={1}
                      selected={customRange ? { from: new Date(`${customRange.from}T00:00:00`), to: new Date(`${customRange.to}T00:00:00`) } : undefined}
                      onSelect={(r: DateRange | undefined) => {
                        if (!r?.from) return setCustomRange(undefined);
                        setCustomRange({ from: localDateKey(r.from), to: localDateKey(r.to ?? r.from) });
                      }}
                    />
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Status</p>
                {SUPPORT_STATUSES.map((st) => (
                  <CheckRow key={st} checked={statusFilter.includes(st)}
                    onToggle={() => setStatusFilter((f) => f.includes(st) ? f.filter((x) => x !== st) : [...f, st])}>
                    <span className={`size-2 rounded-full ${STATUS_META[st].dot}`} />{STATUS_META[st].label}
                  </CheckRow>
                ))}
              </div>
              {allTags.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Tags</p>
                  <div className="flex flex-wrap gap-1">
                    {allTags.map((t) => (
                      <button key={t} onClick={() => setTagFilter((f) => f.includes(t) ? f.filter((x) => x !== t) : [...f, t])}
                        className={`h-6 px-2 rounded-md text-[11px] font-medium border ${tagFilter.includes(t) ? `${tagTone(t, fixedTags)} border-current` : "border-border text-muted-foreground"}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {activeFilters > 0 && (
                <button onClick={() => { setStatusFilter([]); setTagFilter([]); setPeriod("30d"); setCustomRange(undefined); }} className="text-xs text-primary hover:underline">Limpar filtros</button>
              )}
            </PopoverContent>
          </Popover>
          {connected && <SyncedAgo at={status.lastSyncAt} syncing={sync.isPending} />}
          <button onClick={() => sync.mutate(true)} disabled={sync.isPending || !connected} title="Sincronizar agora"
            className="size-8 shrink-0 rounded-xl bg-card border border-border grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-60">
            <RefreshCw className={`size-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => setComposeOpen(true)} disabled={!connected} title="Nova mensagem"
            className="h-8 px-2.5 xl:px-3.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 shrink-0 whitespace-nowrap disabled:opacity-50">
            <PenSquare className="size-3.5" /><span className="hidden xl:inline">Nova mensagem</span>
          </button>
        </div>
        )}
      </div>

      {view === "kpi" ? (
        <SupportKpisView month={kpiMonth} />
      ) : view === "config" ? (
        <SupportSettings status={status} tab={configTab} setTab={setConfigTab} />
      ) : (
      <>
      {/* ── Indicadores ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Kpi icon={Mail} cls="bg-primary/10 text-primary" label={`E-mails recebidos ${PERIOD_SUFFIX[period] ?? "no período"}`} value={kv(k?.received)}
          onClick={() => { setTab("todos"); setStatusFilter([]); }} />
        <Kpi icon={MailWarning} cls="bg-destructive/10 text-destructive" label="Não respondidos" value={kv(list.data ? periodCounts.unanswered : undefined)}
          hint="Conversas em que o cliente escreveu por último e ainda não teve resposta sua"
          active={tab === "nao_respondidos"} onClick={() => { setTab(tab === "nao_respondidos" ? "todos" : "nao_respondidos"); setStatusFilter([]); }} />
        <Kpi icon={MessageCircle} cls="bg-info/10 text-info" label="Em atendimento" value={kv(list.data ? periodCounts.em_atendimento : undefined)}
          active={onlyStatus("em_atendimento")} onClick={() => toggleStatusCard("em_atendimento")} />
        <Kpi icon={CircleCheck} cls="bg-success/15 text-success" label="Resolvidos" value={kv(list.data ? periodCounts.resolvido : undefined)}
          active={onlyStatus("resolvido")} onClick={() => toggleStatusCard("resolvido")} />
        <Kpi icon={Timer} cls="bg-violet-500/10 text-violet-600 dark:text-violet-400" label="Tempo médio de resposta"
          hint={k?.hours ? `Tempo médio de resposta em horário comercial: ${businessHoursLabel(k.hours)}` : undefined}
          value={k ? formatDuration(k.avgResponseMs) : kv(undefined)} />
        {/* Resolvidas ÷ conversas do período (as mesmas da lista). */}
        <Kpi icon={Percent} cls="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" label="Taxa de resolução"
          hint="Conversas do período já resolvidas ÷ total de conversas do período"
          value={list.data
            ? (conversations.length ? `${(Math.round((periodCounts.resolvido / conversations.length) * 1000) / 10).toLocaleString("pt-BR")}%` : "—")
            : kv(undefined)} />
      </div>

      {/* ── Lista | Conversa | Cliente ── */}
      <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_258px] 2xl:grid-cols-[340px_minmax(0,1fr)_294px] gap-3 lg:flex-1 lg:min-h-[520px]">
        <section className={`rounded-2xl border border-border bg-card flex-col min-h-0 overflow-hidden ${selectedId ? "hidden lg:flex" : "flex"} h-[70vh] lg:h-auto`}>
          <div className="flex items-center justify-between gap-2 px-3 border-b border-border">
            <div className="flex">
              {([["todos", "Todos"], ["nao_respondidos", "Não respondidos"], ["favoritos", "Favoritos"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`h-11 px-2.5 text-xs font-medium border-b-2 -mb-px whitespace-nowrap ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {label} <span className="text-[10px] opacity-70">({counts[key]})</span>
                </button>
              ))}
            </div>
            {/* Ordenação: botão compacto (a coluna é estreita) que abre as opções. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button title={`Ordenar: ${SORT_LABELS[sort]}`}
                  className={`h-7 pl-2 pr-1.5 rounded-lg border text-muted-foreground hover:text-foreground flex items-center gap-0.5 shrink-0 ${sort !== "recentes" ? "border-primary/50 text-primary" : "border-border bg-background"}`}>
                  <ArrowDownUp className="size-3.5" />
                  <ChevronDown className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <p className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">Ordenar por</p>
                {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
                  <DropdownMenuItem key={key} onClick={() => setSort(key)}>
                    {SORT_LABELS[key]}
                    {sort === key && <Check className="size-3.5 ml-auto text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {checked.size > 0 && (
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/40 text-xs">
              <span className="font-medium mr-auto">{checked.size} selecionada{checked.size > 1 ? "s" : ""}</span>
              <BulkBtn onClick={() => bulk.mutate("read")}>Lida</BulkBtn>
              <BulkBtn onClick={() => bulk.mutate("unread")}>Não lida</BulkBtn>
              <BulkBtn onClick={() => bulk.mutate("resolve")}>Resolver</BulkBtn>
              <BulkBtn danger onClick={() => askBulkDelete(true)}>Spam</BulkBtn>
              <BulkBtn danger onClick={() => askBulkDelete()}>Excluir</BulkBtn>
              <button onClick={() => setChecked(new Set())} className="size-6 grid place-items-center rounded text-muted-foreground hover:text-foreground" aria-label="Limpar seleção"><X className="size-3.5" /></button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            {list.isLoading ? (
              <div className="p-3 space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
            ) : !visible.length ? (
              <div className="text-center py-16 px-6">
                <Inbox className="size-7 mx-auto text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground mt-2">
                  {conversations.length ? "Nada com esses filtros" : sync.isPending ? "Buscando e-mails…" : "Nenhum e-mail no período"}
                </p>
              </div>
            ) : visible.map((c) => (
              <ConversationRow
                key={c.id}
                c={c}
                fixedTags={fixedTags}
                active={c.id === selectedId}
                checked={checked.has(c.id)}
                onCheck={() => setChecked((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                onOpen={() => setSelectedId(c.id)}
              />
            ))}
          </div>
        </section>

        <section className={`rounded-2xl border border-border bg-card min-h-0 overflow-hidden flex-col ${selectedId ? "flex" : "hidden lg:flex"} h-[80vh] lg:h-auto`}>
          {selectedId ? (
            <ConversationView
              key={selectedId}
              id={selectedId}
              allTags={allTags}
              onBack={() => setSelectedId(null)}
              onChanged={refreshAll}
              onDeleted={() => { setSelectedId(null); refreshAll(); }}
            />
          ) : (
            <div className="flex-1 grid place-items-center text-center p-8">
              <div>
                <Mail className="size-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground mt-2">Selecione uma conversa</p>
              </div>
            </div>
          )}
        </section>

        <section className="hidden xl:flex rounded-2xl border border-border bg-card min-h-0 overflow-hidden flex-col">
          <CustomerPanel
            conversationId={selectedId}
            allTags={allTags}
            onChanged={refreshAll}
          />
        </section>
      </div>

      {/* Telas menores que xl: painel do cliente abaixo da conversa. */}
      {selectedId && (
        <section className="xl:hidden mt-3 rounded-2xl border border-border bg-card overflow-hidden h-[520px] flex flex-col">
          <CustomerPanel
            conversationId={selectedId}
            allTags={allTags}
            onChanged={refreshAll}
          />
        </section>
      )}

      </>
      )}

      <NewMessageDialog
        open={composeOpen}
        onOpenChange={(o) => { setComposeOpen(o); if (!o) setComposeOrder(null); }}
        initialOrder={composeOrder}
        onSent={(id) => { refreshAll(); if (id) setSelectedId(id); }}
      />
    </PageShell>
  );
}

// "Sincronizado há 3 min" ao lado do botão de sincronizar (atualiza sozinho).
function SyncedAgo({ at, syncing }: { at: string | null; syncing: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  let text = "Nunca sincronizado";
  if (syncing) text = "Sincronizando…";
  else if (at) {
    const min = Math.floor((Date.now() - new Date(at).getTime()) / 60_000);
    text = min < 1 ? "Sincronizado agora"
      : min < 60 ? `Sincronizado há ${min} min`
      : min < 24 * 60 ? `Sincronizado há ${Math.floor(min / 60)}h`
      : `Sincronizado em ${fullTime(at)}`;
  }
  return (
    <span className="hidden md:inline text-[11px] text-muted-foreground whitespace-nowrap shrink-0" title={at ? `Última sincronização: ${fullTime(at)}` : undefined}>
      {text}
    </span>
  );
}

function Kpi({ icon: Icon, cls, label, value, active, onClick, hint }: {
  icon: typeof Mail; cls: string; label: string; value: number | string | undefined; active?: boolean; onClick?: () => void; hint?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      title={hint ?? (onClick ? (active ? "Clique para tirar o filtro" : `Mostrar: ${label}`) : undefined)}
      className={`rounded-2xl border bg-card p-3.5 flex items-center gap-3 min-w-0 text-left transition-colors ${
        active ? "border-primary ring-2 ring-primary/20" : "border-border"
      } ${onClick ? "hover:border-primary/50 cursor-pointer" : ""}`}
    >
      <div className={`size-10 rounded-xl grid place-items-center shrink-0 ${cls}`}><Icon className="size-[18px]" /></div>
      <div className="min-w-0">
        <p className="text-xl font-bold tracking-tight leading-tight">{value ?? <span className="inline-block w-8 h-5 rounded bg-muted animate-pulse align-middle" />}</p>
        <p className="text-[11px] text-muted-foreground truncate" title={label}>{label}</p>
      </div>
    </Tag>
  );
}

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// Mês da aba KPI: os últimos 12 meses.
function MonthSelect({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const options = useMemo(() => {
    const [y, m] = currentMonth().split("-").map(Number);
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(y, m - 1 - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { key, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}${i === 0 ? " (atual)" : ""}` };
    });
  }, []);
  return (
    <div className="relative">
      <CalendarDays className="size-3.5 text-primary absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-card border border-border hover:border-primary/30 text-xs rounded-xl pl-8 pr-7 h-8 cursor-pointer outline-none focus:border-primary">
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

function CheckRow({ checked, onToggle, children, radio }: { checked: boolean; onToggle: () => void; children: React.ReactNode; radio?: boolean }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-2 h-7 px-1 rounded-md text-xs hover:bg-muted">
      {radio ? (
        <span className={`size-4 rounded-full border grid place-items-center shrink-0 ${checked ? "border-primary" : "border-border"}`}>
          {checked && <span className="size-2 rounded-full bg-primary" />}
        </span>
      ) : (
        <span className={`size-4 rounded border grid place-items-center shrink-0 ${checked ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
      )}
      {children}
    </button>
  );
}

function BulkBtn({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return <button onClick={onClick} className={`h-6 px-2 rounded-md border bg-background ${danger ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-border hover:border-primary"}`}>{children}</button>;
}

function ConversationRow({ c, fixedTags, active, checked, onCheck, onOpen }: {
  c: SupportConversation; fixedTags: string[]; active: boolean; checked: boolean; onCheck: () => void; onOpen: () => void;
}) {
  const unread = c.unread_count > 0;
  const name = displayName(c.customer_name, c.customer_email);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className={`group flex gap-2.5 px-3 py-3 border-b border-border/60 cursor-pointer transition-colors ${active ? "bg-primary/[0.07]" : "hover:bg-muted/50"}`}
    >
      <button
        role="checkbox"
        aria-checked={checked}
        aria-label="Selecionar"
        onClick={(e) => { e.stopPropagation(); onCheck(); }}
        className={`mt-2.5 size-4 rounded border grid place-items-center shrink-0 transition-opacity ${checked ? "bg-primary border-primary text-primary-foreground" : "border-border bg-background opacity-60 group-hover:opacity-100"}`}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </button>
      <Avatar name={c.customer_name} email={c.customer_email} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`text-[13px] truncate flex-1 ${unread ? "font-bold" : "font-medium"}`}>{name}</p>
          {c.favorite && <Star className="size-3 fill-amber-400 text-amber-400 shrink-0" />}
          <span className={`text-[10px] shrink-0 ${unread ? "text-primary font-semibold" : "text-muted-foreground"}`}>{listTime(c.last_message_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className={`text-xs truncate flex-1 ${unread ? "text-foreground font-medium" : "text-foreground/80"}`}>{c.subject || "(sem assunto)"}</p>
          {unread && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center shrink-0">{c.unread_count}</span>}
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{c.summary}</p>
        <div className="flex items-center gap-1 mt-1">
          <span className={`text-[9px] px-1.5 py-px rounded font-medium ${STATUS_META[c.status].cls}`}>{STATUS_META[c.status].label}</span>
          {c.auto_reply === "enviado" && <span className="text-[9px] px-1.5 py-px rounded font-medium bg-success/10 text-success inline-flex items-center gap-0.5 shrink-0" title="Respondido automaticamente"><Bot className="size-2.5" /> Auto</span>}
          {c.tags.slice(0, 2).map((t) => <span key={t} className={`text-[9px] px-1.5 py-px rounded font-medium truncate max-w-[90px] inline-flex items-center gap-0.5 ${tagTone(t, fixedTags)}`}>{c.ai_tags.includes(t) && <Sparkles className="size-2.5 shrink-0" />}{t}</span>)}
          {c.tags.length > 2 && (
            <span className="text-[9px] px-1.5 py-px rounded font-medium bg-muted text-muted-foreground shrink-0" title={c.tags.slice(2).join(", ")}>+{c.tags.length - 2}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function NewMessageDialog({ open, onOpenChange, onSent, initialOrder }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSent: (id: string | null) => void; initialOrder?: string | null;
}) {
  const sendFn = useSupportFn(sendSupportNewMessage, "sendSupportNewMessage");
  const orderFn = useSupportFn(findOrderCustomers, "findOrderCustomers");
  const [to, setTo] = useState("");
  // Nº do pedido → e-mail do cliente (1 resultado preenche o "Para"; vários, escolhe).
  const [order, setOrder] = useState("");
  const [orderEmails, setOrderEmails] = useState<{ order: string; email: string }[] | null>(null);
  const lookup = useMutation({
    mutationFn: (q: string) => orderFn({ data: { q } }) as Promise<{ order: string; email: string }[]>,
    onSuccess: (hits) => {
      setOrderEmails(hits);
      if (hits.length === 1) setTo(hits[0].email);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao buscar o pedido"),
  });
  const searchOrder = () => { const q = order.trim(); if (q.length >= 2 && !lookup.isPending) lookup.mutate(q); };
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  // Veio do Rastreamento com um pedido: busca na hora e sugere o assunto.
  useEffect(() => {
    if (!open || !initialOrder) return;
    setOrder(initialOrder);
    setOrderEmails(null);
    lookup.mutate(initialOrder);
    setSubject((s) => s || `Update on your order ${initialOrder.startsWith("#") ? initialOrder : `#${initialOrder}`}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialOrder]);
  const att = useAttachments();
  const send = useMutation({
    mutationFn: () => sendFn({ data: { to: to.trim(), subject: subject.trim(), text, attachments: att.refs } }),
    onSuccess: (r) => {
      toast.success("E-mail enviado");
      setTo(""); setSubject(""); setText(""); setOrder(""); setOrderEmails(null); att.clear();
      onOpenChange(false);
      onSent(r.conversationId);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao enviar"),
  });
  const input = "w-full h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg"
        onEscapeKeyDown={(e) => { if ((document.activeElement as HTMLElement | null)?.dataset.slashOpen) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>Nova mensagem</DialogTitle></DialogHeader>
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <input value={order} onChange={(e) => { setOrder(e.target.value); setOrderEmails(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchOrder(); } }}
              placeholder="Nº do pedido (ex.: 1508 ou #L4-1508)" className={input} />
            <button type="button" onClick={searchOrder} disabled={order.trim().length < 2 || lookup.isPending}
              className="h-10 px-3.5 rounded-xl border border-border text-sm flex items-center gap-1.5 shrink-0 hover:bg-muted disabled:opacity-50">
              {lookup.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Buscar
            </button>
          </div>
          {orderEmails && orderEmails.length === 0 && (
            <p className="text-xs text-muted-foreground px-1">Nenhum pedido com esse número (ou sem e-mail do cliente).</p>
          )}
          {orderEmails && orderEmails.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 px-1">
              <span className="text-xs text-muted-foreground">Mais de um pedido com esse número:</span>
              {orderEmails.map((h) => (
                <button key={`${h.order}:${h.email}`} type="button" onClick={() => setTo(h.email)}
                  className={`text-xs px-2 py-1 rounded-lg border ${to === h.email ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                  <span className="font-semibold">{h.order}</span> · {h.email}
                </button>
              ))}
            </div>
          )}
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Para (e-mail do cliente)" type="email" className={input} />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" className={input} />
          <TemplateTextarea value={text} onChange={setText} rows={8} placeholder="Mensagem  (/ = mensagens salvas)"
            customerEmail={to} orderNumber={order}
            className="w-full resize-none rounded-xl bg-background border border-border p-3.5 text-sm outline-none focus:border-primary" />
          <AttachmentChips files={att.files} onRemove={att.remove} />
          <div className="flex items-center justify-between gap-2">
            <label className="h-9 px-3 rounded-lg border border-border text-xs flex items-center gap-1.5 cursor-pointer hover:bg-muted">
              {att.uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />} Anexar
              <input type="file" multiple className="hidden" onChange={(e) => { att.add(e.target.files); e.target.value = ""; }} />
            </label>
            <SavedReplies text={text} setText={setText} customerEmail={to} orderNumber={order} />
            <TranslateToEnglish text={text} setText={setText} />
            <div className="flex-1" />
            <button
              onClick={() => send.mutate()}
              disabled={!to.trim() || !subject.trim() || !text.trim() || send.isPending || att.uploading}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {send.isPending && <Loader2 className="size-4 animate-spin" />} Enviar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

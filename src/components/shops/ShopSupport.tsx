import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageCircle, Inbox, Settings, AlertCircle, Send, Search, Plus, X, Trash2,
  Mail, Crown, Shield, Flame, AlertTriangle, ChevronDown, Check, Loader2,
  Clock, CheckCircle2, MoreHorizontal, FileText, Wifi, WifiOff, Edit2, RefreshCw, Package
} from "lucide-react";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  listInboxes, upsertInbox, deleteInbox, testInboxConnection,
  listConversations, getConversation, sendMessage, updateConversation,
  listStatuses, upsertStatus, deleteStatus,
  updateCustomerPriority,
  listTemplates, upsertTemplate, deleteTemplate,
  PRIORITY_TAGS,
} from "@/lib/support.functions";
import { listShops } from "@/lib/shops.functions";

// --------- helpers ---------
function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function avatarColor(email: string) {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return `oklch(0.65 0.14 ${h % 360})`;
}
function initials(name?: string | null, email?: string | null) {
  const s = (name || email || "?").trim();
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

const PRIORITY_META: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  vip:             { label: "VIP",                icon: Crown,         color: "oklch(0.55 0.18 295)", bg: "oklch(0.95 0.05 295)" },
  high_attention:  { label: "Alta atenção",       icon: AlertTriangle, color: "oklch(0.55 0.16 75)",  bg: "oklch(0.96 0.05 75)"  },
  difficult:       { label: "Cliente difícil",    icon: Shield,        color: "oklch(0.45 0.015 260)",bg: "oklch(0.95 0.005 260)" },
  chargeback_risk: { label: "Risco chargeback",   icon: Flame,         color: "oklch(0.5 0.18 25)",   bg: "oklch(0.95 0.06 25)"   },
};

export function ShopSupport({ shopIds }: { shopIds: string[] }) {
  const shopId = shopIds[0];
  const _listInboxes    = useServerFn(listInboxes);
  const _listConversations = useServerFn(listConversations);
  const _listStatuses   = useServerFn(listStatuses);
  const _listShops      = useServerFn(listShops);

  const [selectedInbox, setSelectedInbox] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [unidentifiedOnly, setUnidentifiedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<null | "inboxes" | "statuses" | "templates">(null);

  const cacheKey = shopIds.slice().sort().join(",");

  const inboxesQ = useQuery({ queryKey: ["support", "inboxes"], queryFn: () => _listInboxes() });
  const statusesQ = useQuery({ queryKey: ["support", "statuses"], queryFn: () => _listStatuses() });
  const shopsQ = useQuery({ queryKey: ["shops"], queryFn: () => _listShops() });
  const convsQ = useQuery({
    queryKey: ["support", "conversations", cacheKey, selectedInbox, statusFilter, unidentifiedOnly, search],
    queryFn: () => _listConversations({ data: { shopIds, inboxId: selectedInbox, statusKey: statusFilter, unidentifiedOnly, search: search || null } }),
  });

  const allInboxes = inboxesQ.data?.inboxes ?? [];
  const inboxes = allInboxes.filter((i: any) => shopIds.includes(i.shop_id));
  const statuses = statusesQ.data?.statuses ?? [];
  const conversations = convsQ.data?.conversations ?? [];
  const shops = shopsQ.data?.shops ?? [];

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[600px] bg-background text-foreground overflow-hidden rounded-xl border border-border">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <div className="size-8 rounded-lg gradient-primary grid place-items-center">
              <MessageCircle className="size-4 text-white" />
            </div>
            <div>
              <div className="font-semibold text-sm">Atendimento</div>
              <div className="text-[11px] text-muted-foreground">Central de suporte</div>
            </div>
          </div>
        </div>

        <div className="px-3 pt-3 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-between">
          Caixas
          <button onClick={() => setShowSettings("inboxes")} className="text-muted-foreground hover:text-foreground p-1 rounded">
            <Plus className="size-3" />
          </button>
        </div>
        <div className="px-2 space-y-0.5">
          <button
            onClick={() => setSelectedInbox(null)}
            className={`w-full flex items-center gap-2 px-2.5 h-9 rounded-md text-sm transition ${
              selectedInbox === null ? "bg-primary/10 text-primary font-medium" : "hover:bg-surface text-foreground/80"
            }`}
          >
            <Inbox className="size-3.5" />
            Todas desta loja
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
              {inboxes.reduce((a: number, i: any) => a + (i.open || 0), 0)}
            </span>
          </button>
          {inboxes.map((i: any) => {
            const active = selectedInbox === i.id;
            return (
              <button
                key={i.id}
                onClick={() => setSelectedInbox(i.id)}
                className={`w-full flex items-center gap-2 px-2.5 h-9 rounded-md text-sm transition ${
                  active ? "bg-primary/10 text-primary font-medium" : "hover:bg-surface text-foreground/80"
                }`}
              >
                <span className={`size-1.5 rounded-full ${i.connection_status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                <span className="truncate flex-1 text-left">{i.email_address}</span>
                {i.overdue > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 font-medium tabular-nums">{i.overdue}</span>
                )}
                <span className="text-[11px] tabular-nums text-muted-foreground">{i.open || 0}</span>
              </button>
            );
          })}
          {inboxes.length === 0 && (
            <button onClick={() => setShowSettings("inboxes")} className="w-full text-left text-xs text-muted-foreground px-2.5 py-2 hover:bg-surface rounded-md">
              + Configurar primeira caixa
            </button>
          )}
        </div>

        <div className="px-3 pt-4 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</div>
        <div className="px-2 space-y-0.5">
          <button
            onClick={() => { setStatusFilter(null); setUnidentifiedOnly(false); }}
            className={`w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-[13px] ${!statusFilter && !unidentifiedOnly ? "bg-surface font-medium" : "hover:bg-surface text-foreground/70"}`}
          >
            Todas
          </button>
          {statuses.filter((s: any) => s.system_key !== "unidentified").map((s: any) => (
            <button
              key={s.id}
              onClick={() => { setStatusFilter(s.system_key); setUnidentifiedOnly(false); }}
              className={`w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-[13px] ${statusFilter === s.system_key ? "bg-surface font-medium" : "hover:bg-surface text-foreground/70"}`}
            >
              <span className="size-1.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
          <button
            onClick={() => { setUnidentifiedOnly(true); setStatusFilter(null); }}
            className={`w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-[13px] ${unidentifiedOnly ? "bg-amber-500/15 text-amber-700 font-medium" : "hover:bg-surface text-foreground/70"}`}
          >
            <AlertCircle className="size-3.5" />
            Sem pedido vinculado
          </button>
        </div>

        <div className="mt-auto p-3 border-t border-border space-y-1">
          <button onClick={() => setShowSettings("templates")} className="w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-[13px] hover:bg-surface text-foreground/70">
            <FileText className="size-3.5" /> Templates
          </button>
          <button onClick={() => setShowSettings("statuses")} className="w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-[13px] hover:bg-surface text-foreground/70">
            <Settings className="size-3.5" /> Status & Configurações
          </button>
        </div>
      </aside>

      {/* Conversation list */}
      <div className="w-[340px] shrink-0 border-r border-border flex flex-col bg-background">
        <div className="p-3 border-b border-border">
          <div className="relative">

            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente, email, assunto..."
              className="w-full pl-8 pr-3 h-9 rounded-md bg-surface border border-border text-sm focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convsQ.isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">Carregando...</div>
          )}
          {!convsQ.isLoading && conversations.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Inbox className="size-8 mx-auto mb-2 opacity-40" />
              Nenhuma conversa
            </div>
          )}
          {conversations.map((c: any) => {
            const inbox = inboxes.find((i: any) => i.id === c.inbox_id);
            const sla = computeSla(c, inbox);
            const status = statuses.find((s: any) => s.id === c.status_id);
            const priority = c.customer?.priority_tag ? PRIORITY_META[c.customer.priority_tag] : null;
            const Active = selectedConv === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedConv(c.id)}
                className={`w-full text-left px-3 py-3 border-b border-border/60 transition relative ${
                  Active ? "bg-primary/5" : "hover:bg-surface/60"
                }`}
              >
                {sla === "critical" && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-red-500" />}
                {sla === "warning" && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-500" />}
                <div className="flex items-start gap-2.5">
                  <div
                    className="size-9 rounded-full grid place-items-center text-[11px] font-semibold text-white shrink-0"
                    style={{ background: avatarColor(c.customer?.email ?? "?") }}
                  >
                    {initials(c.customer?.name, c.customer?.email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate flex-1">{c.customer?.name ?? c.customer?.email ?? "Anônimo"}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{timeAgo(c.last_message_at)}</span>
                    </div>
                    <div className="text-[12px] text-foreground/70 truncate">{c.subject || "(sem assunto)"}</div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">{c.preview}</div>
                    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                      {priority && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: priority.color, background: priority.bg }}>
                          <priority.icon className="size-2.5" /> {priority.label}
                        </span>
                      )}
                      {c.is_unidentified && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 font-medium">Sem pedido</span>
                      )}
                      {status && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: status.color, background: `color-mix(in oklab, ${status.color} 12%, transparent)` }}>
                          {status.name}
                        </span>
                      )}
                      {c.unread_count > 0 && (
                        <span className="ml-auto size-4 rounded-full bg-primary text-[10px] text-primary-foreground font-bold grid place-items-center tabular-nums">{c.unread_count}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation view */}
      <main className="flex-1 min-w-0 flex">
        {selectedConv ? (
          <ConversationView conversationId={selectedConv} onClose={() => setSelectedConv(null)} statuses={statuses} />
        ) : (
          <div className="flex-1 grid place-items-center text-muted-foreground">
            <div className="text-center">
              <MessageCircle className="size-12 mx-auto mb-3 opacity-30" />
              <div className="text-sm">Selecione uma conversa para começar</div>
            </div>
          </div>
        )}
      </main>

      {/* Settings modals */}
      {showSettings === "inboxes" && <InboxesModal onClose={() => setShowSettings(null)} shops={shops} inboxes={inboxes} lockedShopId={shopId} />}
      {showSettings === "statuses" && <StatusesModal onClose={() => setShowSettings(null)} statuses={statuses} />}
      {showSettings === "templates" && <TemplatesModal onClose={() => setShowSettings(null)} />}
    </div>
  );
}

function computeSla(conv: any, inbox: any): "ok" | "warning" | "critical" {
  if (conv.last_message_from !== "customer") return "ok";
  const ageH = (Date.now() - new Date(conv.last_message_at).getTime()) / 36e5;
  const warn = inbox?.sla_warning_hours ?? 2;
  const crit = inbox?.sla_critical_hours ?? 12;
  if (ageH >= crit) return "critical";
  if (ageH >= warn) return "warning";
  return "ok";
}

function MetricsBar({ metrics }: { metrics: any }) {
  if (!metrics) return <div className="h-12" />;
  const fmt = (s: number | null) => {
    if (!s) return "—";
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${(s / 3600).toFixed(1)}h`;
  };
  return (
    <div className="grid grid-cols-4 gap-1.5">
      <Metric label="Abertos" value={metrics.open} />
      <Metric label="Aguardando" value={metrics.waiting} />
      <Metric label="Atrasados" value={metrics.overdue} danger={metrics.overdue > 0} />
      <Metric label="MTTFR" value={fmt(metrics.avgFirstResponse)} />
    </div>
  );
}
function Metric({ label, value, danger }: { label: string; value: any; danger?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${danger ? "border-red-500/30 bg-red-500/5" : "border-border bg-surface/40"}`}>
      <div className={`text-base font-bold leading-tight tabular-nums ${danger ? "text-red-600" : ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

// --------- Conversation view ---------
function ConversationView({ conversationId, onClose, statuses }: { conversationId: string; onClose: () => void; statuses: any[] }) {
  const qc = useQueryClient();
  const _getConv = useServerFn(getConversation);
  const _send    = useServerFn(sendMessage);
  const _update  = useServerFn(updateConversation);
  const _updatePriority = useServerFn(updateCustomerPriority);

  const detail = useQuery({ queryKey: ["support", "conversation", conversationId], queryFn: () => _getConv({ data: { id: conversationId } }) });
  const sendM = useMutation({
    mutationFn: (vars: { body: string; internal: boolean }) => _send({ data: { conversationId, body: vars.body, internalNote: vars.internal } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support"] });
    },
  });
  const updateM = useMutation({
    mutationFn: (vars: any) => _update({ data: { id: conversationId, ...vars } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["support"] }),
  });
  const prioM = useMutation({
    mutationFn: (vars: any) => _updatePriority({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["support"] }),
  });

  const [draft, setDraft] = useState("");
  const [isNote, setIsNote] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(""); setIsNote(false);
  }, [conversationId]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [detail.data?.messages?.length]);

  if (detail.isLoading || !detail.data) {
    return <div className="flex-1 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  }
  const { conversation, messages, customer, shop, linkedOrder } = detail.data;
  const status = statuses.find((s: any) => s.id === conversation.status_id);

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    sendM.mutate({ body, internal: isNote });
    setDraft(""); setIsNote(false);
  };

  return (
    <>
      <div className="flex-1 min-w-0 flex flex-col">
        {/* header */}
        <div className="h-14 border-b border-border px-4 flex items-center gap-3 bg-card/60">
          <div className="size-9 rounded-full grid place-items-center text-[11px] font-semibold text-white shrink-0" style={{ background: avatarColor(customer?.email ?? "?") }}>
            {initials(customer?.name, customer?.email)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate">{customer?.name ?? customer?.email}</div>
            <div className="text-[11px] text-muted-foreground truncate">{customer?.email} · {shop?.name}</div>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu((v) => !v)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border hover:bg-surface"
              style={status ? { color: status.color, borderColor: `color-mix(in oklab, ${status.color} 35%, transparent)`, background: `color-mix(in oklab, ${status.color} 8%, transparent)` } : {}}
            >
              {status?.name ?? "Status"} <ChevronDown className="size-3" />
            </button>
            {showStatusMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-popover border border-border rounded-md shadow-lg z-20 py-1">
                {statuses.map((s: any) => (
                  <button key={s.id} onClick={() => { updateM.mutate({ status_id: s.id }); setShowStatusMenu(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: s.color }} /> {s.name}
                    {conversation.status_id === s.id && <Check className="size-3 ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-md hover:bg-surface text-muted-foreground md:hidden">
            <X className="size-4" />
          </button>
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-3" style={{ background: "linear-gradient(180deg, oklch(0.985 0.003 250), oklch(0.97 0.005 250))" }}>
          {messages.map((m: any) => {
            if (m.direction === "internal_note") {
              return (
                <div key={m.id} className="max-w-[80%] mx-auto bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[13px]">
                  <div className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-0.5">Nota interna · {m.from_name || "Você"}</div>
                  <div className="whitespace-pre-wrap text-amber-900">{m.body_text}</div>
                </div>
              );
            }
            const isOut = m.direction === "outbound";
            return (
              <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-[14px] shadow-sm ${
                  isOut ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border border-border rounded-bl-md"
                }`}>
                  <div className="whitespace-pre-wrap">{m.body_text}</div>
                  <div className={`text-[10px] mt-1 ${isOut ? "text-primary-foreground/70" : "text-muted-foreground"} text-right`}>
                    {new Date(m.sent_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* composer */}
        <div className="border-t border-border bg-card p-3">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setIsNote(false)} className={`text-xs px-2.5 h-7 rounded-md ${!isNote ? "bg-primary text-primary-foreground font-medium" : "bg-surface text-foreground/70"}`}>
              Resposta
            </button>
            <button onClick={() => setIsNote(true)} className={`text-xs px-2.5 h-7 rounded-md ${isNote ? "bg-amber-500 text-white font-medium" : "bg-surface text-foreground/70"}`}>
              Nota interna
            </button>
            <TemplatePicker onPick={(b) => setDraft((d) => (d ? `${d}\n${b}` : b))} />
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
            placeholder={isNote ? "Escreva uma nota visível apenas para a equipe..." : "Digite sua resposta..."}
            rows={3}
            className={`w-full resize-none rounded-md border px-3 py-2 text-sm focus:outline-none focus:border-primary ${
              isNote ? "bg-amber-50 border-amber-200" : "bg-surface border-border"
            }`}
          />
          <div className="flex items-center justify-between mt-2">
            <div className="text-[11px] text-muted-foreground">⌘+Enter para enviar</div>
            <button
              onClick={handleSend}
              disabled={!draft.trim() || sendM.isPending}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {sendM.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {isNote ? "Adicionar nota" : "Enviar"}
            </button>
          </div>
        </div>
      </div>

      {/* Customer panel */}
      <aside className="w-[300px] shrink-0 border-l border-border bg-card overflow-y-auto hidden lg:block">
        <div className="p-4 border-b border-border">
          <div className="flex flex-col items-center text-center">
            <div className="size-16 rounded-full grid place-items-center text-lg font-semibold text-white" style={{ background: avatarColor(customer?.email ?? "?") }}>
              {initials(customer?.name, customer?.email)}
            </div>
            <div className="mt-2 font-semibold text-sm">{customer?.name ?? "Sem nome"}</div>
            <a href={`mailto:${customer?.email}`} className="text-[12px] text-primary hover:underline">{customer?.email}</a>
          </div>

          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Prioridade</div>
            <div className="flex flex-wrap gap-1">
              {PRIORITY_TAGS.map((tag) => {
                const meta = PRIORITY_META[tag];
                const active = customer?.priority_tag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => customer && prioM.mutate({ id: customer.id, priority_tag: active ? null : tag })}
                    className="text-[10px] px-1.5 py-1 rounded font-medium inline-flex items-center gap-1 transition"
                    style={active
                      ? { color: meta.color, background: meta.bg, boxShadow: `inset 0 0 0 1px ${meta.color}` }
                      : { color: "var(--muted-foreground)", background: "var(--surface)" }}
                  >
                    <meta.icon className="size-2.5" /> {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Resumo</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-[11px] text-muted-foreground">Pedidos</div>
              <div className="font-semibold tabular-nums">{customer?.orders_count ?? 0}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Total gasto</div>
              <div className="font-semibold tabular-nums">{(customer?.total_spent ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div>
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Pedido vinculado</div>
          {linkedOrder ? (
            <div className="rounded-md border border-border p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <Package className="size-3.5 text-muted-foreground" />
                <span className="font-medium text-sm">#{linkedOrder.order_number || linkedOrder.external_id}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mb-2">{new Date(linkedOrder.order_date).toLocaleDateString("pt-BR")}</div>
              <OrderTimeline o={linkedOrder} />
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-3 text-center">
              <AlertCircle className="size-4 mx-auto mb-1 text-amber-600" />
              <div className="text-[12px] text-amber-700 font-medium">Sem pedido vinculado</div>
              <div className="text-[10px] text-amber-600 mt-0.5">Cliente não identificado automaticamente</div>
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Métricas</div>
          <div className="space-y-1.5 text-[12px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Aberta há</span><span className="font-medium">{timeAgo(conversation.created_at)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Última msg</span><span className="font-medium">{timeAgo(conversation.last_message_at)}</span></div>
            {conversation.first_response_seconds != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Tempo 1ª resposta</span><span className="font-medium">{Math.round(conversation.first_response_seconds / 60)} min</span></div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function OrderTimeline({ o }: { o: any }) {
  const steps = [
    { label: "Pedido criado", at: o.order_date, done: !!o.order_date },
    { label: "Pago",          at: null,         done: o.payment_status === "paid" },
    { label: "Enviado",       at: o.shipped_at, done: !!o.shipped_at },
    { label: "Entregue",      at: o.delivered_at, done: !!o.delivered_at },
  ];
  return (
    <div className="space-y-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          {s.done ? <CheckCircle2 className="size-3 text-emerald-500" /> : <Clock className="size-3 text-muted-foreground/50" />}
          <span className={s.done ? "" : "text-muted-foreground"}>{s.label}</span>
          {s.at && <span className="ml-auto text-muted-foreground tabular-nums">{new Date(s.at).toLocaleDateString("pt-BR")}</span>}
        </div>
      ))}
      {o.problem_at && (
        <div className="flex items-center gap-2 text-[11px] text-red-600">
          <AlertTriangle className="size-3" /> Problema reportado
        </div>
      )}
    </div>
  );
}

function TemplatePicker({ onPick }: { onPick: (body: string) => void }) {
  const _list = useServerFn(listTemplates);
  const tpls = useQuery({ queryKey: ["support", "templates"], queryFn: () => _list() });
  const [open, setOpen] = useState(false);
  return (
    <div className="relative ml-auto">
      <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md bg-surface hover:bg-surface/70 text-foreground/70">
        <FileText className="size-3" /> Templates
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 bg-popover border border-border rounded-md shadow-lg z-20 py-1 max-h-72 overflow-y-auto">
          {(tpls.data?.templates ?? []).map((t: any) => (
            <button key={t.id} onClick={() => { onPick(t.body); setOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-surface text-sm">
              <div className="font-medium">{t.title}</div>
              <div className="text-[11px] text-muted-foreground line-clamp-1">{t.body}</div>
            </button>
          ))}
          {(tpls.data?.templates ?? []).length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum template ainda</div>
          )}
        </div>
      )}
    </div>
  );
}

// --------- Settings modals ---------
function ModalShell({ children, title, onClose, wide }: { children: any; title: string; onClose: () => void; wide?: boolean }) {
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className={`bg-background rounded-xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-xl"} max-h-[90vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-12 border-b border-border">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-md hover:bg-surface"><X className="size-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

function InboxesModal({ onClose, shops, inboxes, lockedShopId }: { onClose: () => void; shops: any[]; inboxes: any[]; lockedShopId?: string }) {
  const qc = useQueryClient();
  const _upsert = useServerFn(upsertInbox);
  const _delete = useServerFn(deleteInbox);
  const _test   = useServerFn(testInboxConnection);
  const [editing, setEditing] = useState<any | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const confirm = useConfirm();

  const save = useMutation({
    mutationFn: (v: any) => _upsert({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["support"] }); setEditing(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => _delete({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["support"] }),
  });

  if (editing) {
    return (
      <ModalShell title={editing.id ? "Editar caixa" : "Nova caixa de atendimento"} onClose={() => setEditing(null)} wide>
        <InboxForm
          shops={shops}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={(v) => save.mutate(v)}
          saving={save.isPending}
        />
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Caixas de atendimento" onClose={onClose} wide>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">Conecte um email profissional por loja para receber e responder mensagens.</p>
          <button onClick={() => setEditing({ shop_id: lockedShopId ?? shops[0]?.id })} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium">
            <Plus className="size-3.5" /> Nova caixa
          </button>
        </div>
        <div className="space-y-2">
          {inboxes.map((i: any) => {
            const shop = shops.find((s: any) => s.id === i.shop_id);
            const isTesting = testing === i.id;
            return (
              <div key={i.id} className="border border-border rounded-lg p-3 flex items-center gap-3">
                <div className={`size-8 rounded-md grid place-items-center ${i.connection_status === "connected" ? "bg-emerald-500/15 text-emerald-600" : "bg-muted-foreground/10 text-muted-foreground"}`}>
                  {i.connection_status === "connected" ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{shop?.name ?? "Loja"} · {i.email_address}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {i.connection_status === "connected" ? `Conectado` : i.connection_status === "error" ? "Erro de conexão" : "Desconectado"}
                    {i.last_poll_at && ` · último poll ${timeAgo(i.last_poll_at)}`}
                    {i.last_poll_status === "error" && i.last_poll_error && ` · ${i.last_poll_error}`}
                    {i.last_error && i.last_poll_status !== "error" && ` · ${i.last_error}`}
                  </div>
                </div>
                <button
                  onClick={async () => { setTesting(i.id); setTestMsg(null); const r = await _test({ data: { id: i.id } }); setTestMsg(r.message); qc.invalidateQueries({ queryKey: ["support"] }); setTesting(null); }}
                  className="text-xs h-8 px-2.5 rounded-md hover:bg-surface inline-flex items-center gap-1.5"
                >
                  {isTesting ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  Testar
                </button>
                <button onClick={() => setEditing(i)} className="size-8 grid place-items-center rounded-md hover:bg-surface text-muted-foreground">
                  <Edit2 className="size-3.5" />
                </button>
                <button onClick={() => { confirm("Excluir esta caixa?").then((ok) => { if (ok) remove.mutate(i.id); }); }} className="size-8 grid place-items-center rounded-md hover:bg-red-500/10 text-red-500">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
          {inboxes.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">Nenhuma caixa configurada ainda.</div>
          )}
        </div>
        {testMsg && <div className="mt-3 text-xs px-3 py-2 rounded-md bg-emerald-500/10 text-emerald-700">{testMsg}</div>}
      </div>
    </ModalShell>
  );
}

function InboxForm({ shops, initial, onCancel, onSave, saving }: { shops: any[]; initial: any; onCancel: () => void; onSave: (v: any) => void; saving: boolean }) {
  const [f, setF] = useState<any>({
    id: initial.id,
    shop_id: initial.shop_id || shops[0]?.id,
    email_address: initial.email_address || "",
    display_name: initial.display_name || "",
    imap_host: initial.imap_host || "",
    imap_port: initial.imap_port || 993,
    imap_user: initial.imap_user || "",
    imap_password: "",
    imap_ssl: initial.imap_ssl ?? true,
    smtp_host: initial.smtp_host || "",
    smtp_port: initial.smtp_port || 465,
    smtp_user: initial.smtp_user || "",
    smtp_password: "",
    smtp_ssl: initial.smtp_ssl ?? true,
    sla_warning_hours: initial.sla_warning_hours ?? 2,
    sla_critical_hours: initial.sla_critical_hours ?? 12,
  });
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loja">
          <select value={f.shop_id} onChange={(e) => setF({ ...f, shop_id: e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm">
            {shops.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Email profissional">
          <input value={f.email_address} onChange={(e) => setF({ ...f, email_address: e.target.value })} placeholder="suporte@sualoja.com" className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
        </Field>
        <Field label="Nome de exibição">
          <input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} placeholder="Suporte Loja" className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
        </Field>
      </div>

      <button type="button" onClick={() => setShowHelp((v) => !v)} className="text-xs text-primary hover:underline">
        {showHelp ? "Ocultar" : "Como encontrar essas informações?"}
      </button>
      {showHelp && (
        <div className="rounded-md border border-border bg-surface/40 p-3 text-xs space-y-2 text-foreground/80">
          <p><b>Gmail / Google Workspace:</b> IMAP <code>imap.gmail.com:993</code> · SMTP <code>smtp.gmail.com:465</code>. Habilite IMAP em Gmail → Configurações → Encaminhamento e POP/IMAP. Gere uma <a className="text-primary underline" href="https://myaccount.google.com/apppasswords" target="_blank">senha de app</a> (não use a senha normal).</p>
          <p><b>Outlook / Microsoft 365:</b> IMAP <code>outlook.office365.com:993</code> · SMTP <code>smtp.office365.com:587</code> (STARTTLS).</p>
          <p><b>Zoho Mail:</b> IMAP <code>imap.zoho.com:993</code> · SMTP <code>smtp.zoho.com:465</code>. Gere senha de app no painel Zoho.</p>
          <p><b>cPanel / hospedagem:</b> verifique no painel da hospedagem em "Contas de e-mail → Configurar dispositivo".</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recebimento (IMAP)</div>
          <Field label="Host">
            <input value={f.imap_host} onChange={(e) => setF({ ...f, imap_host: e.target.value })} placeholder="imap.gmail.com" className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <Field label="Porta">
            <input type="number" value={f.imap_port} onChange={(e) => setF({ ...f, imap_port: +e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <Field label="Usuário">
            <input value={f.imap_user} onChange={(e) => setF({ ...f, imap_user: e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <Field label={initial.id ? "Nova senha (deixe vazio para manter)" : "Senha / Senha de app"}>
            <input type="password" value={f.imap_password} onChange={(e) => setF({ ...f, imap_password: e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={f.imap_ssl} onChange={(e) => setF({ ...f, imap_ssl: e.target.checked })} /> Usar SSL/TLS
          </label>
        </div>
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Envio (SMTP)</div>
          <Field label="Host">
            <input value={f.smtp_host} onChange={(e) => setF({ ...f, smtp_host: e.target.value })} placeholder="smtp.gmail.com" className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <Field label="Porta">
            <input type="number" value={f.smtp_port} onChange={(e) => setF({ ...f, smtp_port: +e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <Field label="Usuário">
            <input value={f.smtp_user} onChange={(e) => setF({ ...f, smtp_user: e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <Field label={initial.id ? "Nova senha (deixe vazio para manter)" : "Senha / Senha de app"}>
            <input type="password" value={f.smtp_password} onChange={(e) => setF({ ...f, smtp_password: e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={f.smtp_ssl} onChange={(e) => setF({ ...f, smtp_ssl: e.target.checked })} /> Usar SSL/TLS
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="SLA atenção (horas sem resposta)">
          <input type="number" value={f.sla_warning_hours} onChange={(e) => setF({ ...f, sla_warning_hours: +e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
        </Field>
        <Field label="SLA crítico (horas sem resposta)">
          <input type="number" value={f.sla_critical_hours} onChange={(e) => setF({ ...f, sla_critical_hours: +e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
        </Field>
      </div>

      <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
        <b>Como funciona:</b> a Hardya conecta a sua caixa via IMAP (recebimento) e SMTP (envio) através de um worker dedicado. Após salvar, clique em <b>Testar</b> para validar as credenciais — emails recebidos começam a aparecer aqui automaticamente.
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <button onClick={onCancel} className="h-9 px-3 rounded-md text-sm hover:bg-surface">Cancelar</button>
        <button
          onClick={() => onSave(f)}
          disabled={!f.email_address || !f.shop_id || saving}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="block text-xs">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}

function StatusesModal({ onClose, statuses }: { onClose: () => void; statuses: any[] }) {
  const qc = useQueryClient();
  const _upsert = useServerFn(upsertStatus);
  const _delete = useServerFn(deleteStatus);
  const save = useMutation({ mutationFn: (v: any) => _upsert({ data: v }), onSuccess: () => qc.invalidateQueries({ queryKey: ["support"] }) });
  const remove = useMutation({ mutationFn: (id: string) => _delete({ data: { id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["support"] }) });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", color: "oklch(0.6 0.15 200)" });

  return (
    <ModalShell title="Status de tickets" onClose={onClose}>
      <div className="p-5 space-y-2">
        {statuses.map((s: any) => (
          <div key={s.id} className="flex items-center gap-2 border border-border rounded-md px-3 py-2">
            <input
              type="color"
              defaultValue="#888"
              onBlur={(e) => save.mutate({ id: s.id, name: s.name, color: e.target.value })}
              className="size-6 rounded cursor-pointer border-none"
              style={{ background: s.color }}
            />
            <input
              defaultValue={s.name}
              onBlur={(e) => e.target.value !== s.name && save.mutate({ id: s.id, name: e.target.value, color: s.color })}
              className="flex-1 h-8 px-2 rounded-md border border-border bg-surface text-sm"
            />
            {s.is_system && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sistema</span>}
            {!s.is_system && (
              <button onClick={() => remove.mutate(s.id)} className="size-7 grid place-items-center rounded-md hover:bg-red-500/10 text-red-500">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        {adding ? (
          <div className="flex items-center gap-2 border border-primary/30 rounded-md px-3 py-2">
            <input type="color" value="#3b82f6" onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="size-6 cursor-pointer" />
            <input autoFocus placeholder="Nome do status" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="flex-1 h-8 px-2 rounded-md border border-border bg-surface text-sm" />
            <button onClick={() => { if (draft.name.trim()) { save.mutate({ name: draft.name, color: draft.color }); setAdding(false); setDraft({ name: "", color: "oklch(0.6 0.15 200)" }); } }} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium">Adicionar</button>
            <button onClick={() => setAdding(false)} className="size-8 grid place-items-center rounded-md hover:bg-surface"><X className="size-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="w-full h-9 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:bg-surface/40 inline-flex items-center justify-center gap-1.5">
            <Plus className="size-3.5" /> Adicionar status
          </button>
        )}
      </div>
    </ModalShell>
  );
}

function TemplatesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const _list = useServerFn(listTemplates);
  const _upsert = useServerFn(upsertTemplate);
  const _delete = useServerFn(deleteTemplate);
  const tpls = useQuery({ queryKey: ["support", "templates"], queryFn: () => _list() });
  const save = useMutation({ mutationFn: (v: any) => _upsert({ data: v }), onSuccess: () => qc.invalidateQueries({ queryKey: ["support", "templates"] }) });
  const remove = useMutation({ mutationFn: (id: string) => _delete({ data: { id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["support", "templates"] }) });
  const [editing, setEditing] = useState<any | null>(null);

  if (editing) {
    return (
      <ModalShell title={editing.id ? "Editar template" : "Novo template"} onClose={() => setEditing(null)}>
        <div className="p-5 space-y-3">
          <Field label="Título">
            <input value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <Field label="Atalho (opcional, ex: /rastreio)">
            <input value={editing.shortcut || ""} onChange={(e) => setEditing({ ...editing, shortcut: e.target.value })} className="w-full h-9 px-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <Field label="Conteúdo">
            <textarea value={editing.body || ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={6} className="w-full px-2 py-2 rounded-md border border-border bg-surface text-sm" />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={() => setEditing(null)} className="h-9 px-3 rounded-md text-sm hover:bg-surface">Cancelar</button>
            <button onClick={() => { save.mutate(editing); setEditing(null); }} disabled={!editing.title?.trim() || !editing.body?.trim()} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">Salvar</button>
          </div>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Templates de resposta" onClose={onClose}>
      <div className="p-5">
        <button onClick={() => setEditing({})} className="w-full h-9 mb-3 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center justify-center gap-1.5">
          <Plus className="size-3.5" /> Novo template
        </button>
        <div className="space-y-2">
          {(tpls.data?.templates ?? []).map((t: any) => (
            <div key={t.id} className="border border-border rounded-md p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="font-medium text-sm">{t.title}</div>
                {t.shortcut && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-muted-foreground font-mono">{t.shortcut}</span>}
                <div className="ml-auto flex gap-1">
                  <button onClick={() => setEditing(t)} className="size-7 grid place-items-center rounded-md hover:bg-surface text-muted-foreground"><Edit2 className="size-3.5" /></button>
                  <button onClick={() => remove.mutate(t.id)} className="size-7 grid place-items-center rounded-md hover:bg-red-500/10 text-red-500"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{t.body}</div>
            </div>
          ))}
          {(tpls.data?.templates ?? []).length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">Nenhum template ainda.</div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

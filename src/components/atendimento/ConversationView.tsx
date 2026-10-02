import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Check, ChevronDown, Download, Languages, Loader2, MailOpen, MoreVertical, Paperclip, ShieldAlert, Star, Tag, Trash2,
  Bot, Sparkles,
} from "lucide-react";
import {
  deleteSupportConversations, getSupportConversation, getSupportCustomer, markConversationRead, sendSupportReply, translateSupportMessage, updateSupportConversations,
  SUPPORT_STATUSES, type SupportConversation, type SupportMessage, type SupportStatus,
} from "@/lib/atendimento.functions";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmailFrame, QuotedText } from "./EmailFrame";
import { Composer, type SendMode } from "./Composer";
import { TagEditor } from "./CustomerPanel";
import { Avatar, STATUS_META, displayName, formatBytes, fullTime } from "./utils";
import { useSupportFn, useIsDemo } from "./demo";

export function ConversationView({ id, allTags, onBack, onChanged, onDeleted }: {
  id: string; allTags: string[]; onBack: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const confirm = useConfirm();
  const deleteFn = useSupportFn(deleteSupportConversations, "deleteSupportConversations");
  const askDelete = async () => {
    if (!(await confirm({
      title: "Excluir esta conversa?",
      description: "Os e-mails dela (do cliente e as respostas) vão para a Lixeira do Zoho, onde ficam recuperáveis por 30 dias.",
      confirmText: "Excluir", variant: "destructive",
    }))) return;
    try {
      await deleteFn({ data: { ids: [id] } });
      toast.success("Conversa excluída");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir");
    }
  };
  // Spam: e-mail que não é atendimento (aviso de sistema, propaganda…). Vai pra
  // Lixeira do Zoho e sai daqui — e dos contadores/KPIs. Novos e-mails do mesmo
  // remetente continuam entrando normalmente.
  const askSpam = async () => {
    if (!(await confirm({
      title: "Marcar como spam?",
      description: "A conversa sai do Atendimento (e dos indicadores) e os e-mails dela vão para a Lixeira do Zoho, onde ficam recuperáveis por 30 dias.",
      confirmText: "Mover para o lixo", variant: "destructive",
    }))) return;
    try {
      await deleteFn({ data: { ids: [id] } });
      toast.success("Movido para o lixo");
      onDeleted();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao mover para o lixo");
    }
  };
  const qc = useQueryClient();
  const getFn = useSupportFn(getSupportConversation, "getSupportConversation");
  const customerFn = useSupportFn(getSupportCustomer, "getSupportCustomer");
  const readFn = useSupportFn(markConversationRead, "markConversationRead");
  const updateFn = useSupportFn(updateSupportConversations, "updateSupportConversations");
  const replyFn = useSupportFn(sendSupportReply, "sendSupportReply");

  const q = useQuery({ queryKey: ["support-conv", id], queryFn: () => getFn({ data: { id } }), staleTime: 30_000 });
  const conv = q.data?.conversation;
  const customer = useQuery({
    queryKey: ["support-customer", conv?.customer_email, conv?.id],
    queryFn: () => customerFn({ data: { email: conv!.customer_email, conversationId: conv!.id } }),
    enabled: !!conv, staleTime: 5 * 60_000,
  });

  // Abriu com mensagem não lida → marca como lida (aqui e no Zoho).
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conv || conv.unread_count === 0 || markedRef.current === conv.id) return;
    markedRef.current = conv.id;
    readFn({ data: { ids: [conv.id], read: true } }).then(onChanged).catch(() => {});
  }, [conv, readFn, onChanged]);

  const patchLocal = (patch: Partial<SupportConversation>) =>
    qc.setQueryData(["support-conv", id], (old: any) => (old ? { ...old, conversation: { ...old.conversation, ...patch } } : old));

  const update = useMutation({
    mutationFn: (patch: { status?: SupportStatus; favorite?: boolean; tags?: string[]; note?: string | null }) =>
      updateFn({ data: { ids: [id], patch } }),
    onMutate: (patch) => patchLocal(patch as Partial<SupportConversation>),
    onError: (e: any) => { toast.error(e.message ?? "Erro ao salvar"); q.refetch(); },
    onSettled: onChanged,
  });

  const [sending, setSending] = useState(false);
  // "Usar" na sugestão da IA: joga o texto na caixa de resposta.
  const [inject, setInject] = useState<{ text: string; n: number } | null>(null);
  const onSend = async (text: string, attachments: any[], mode: SendMode) => {
    setSending(true);
    try {
      await replyFn({ data: { conversationId: id, text, attachments, status: mode } });
      toast.success("Resposta enviada");
      await q.refetch();
      onChanged();
      return true;
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao enviar");
      return false;
    } finally {
      setSending(false);
    }
  };

  // Sempre abre no fim da conversa.
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgCount = q.data?.messages.length ?? 0;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [id, msgCount]);

  // Cor do texto dentro do iframe do e-mail acompanha o tema.
  const [fg, setFg] = useState("#111");
  useEffect(() => {
    if (scrollRef.current) setFg(getComputedStyle(scrollRef.current).color);
  }, [q.data]);

  if (q.isLoading || !conv) {
    return (
      <div className="flex-1 grid place-items-center text-muted-foreground">
        {q.isError ? <p className="text-sm text-destructive">{(q.error as any)?.message ?? "Erro ao abrir"}</p> : <Loader2 className="size-5 animate-spin" />}
      </div>
    );
  }

  const name = displayName(conv.customer_name ?? customer.data?.name, conv.customer_email);
  const status = STATUS_META[conv.status];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button onClick={onBack} className="lg:hidden size-8 -ml-1 rounded-lg grid place-items-center hover:bg-muted" aria-label="Voltar">
          <ArrowLeft className="size-4" />
        </button>
        <Avatar name={name} email={conv.customer_email} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold truncate">{name}</p>
          </div>
          <p className="text-xs text-muted-foreground truncate">{conv.customer_email}</p>
        </div>

        <button
          onClick={askSpam}
          title="Spam — não é atendimento (vai para o lixo)"
          className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 text-muted-foreground text-xs font-medium"
        >
          <ShieldAlert className="size-4" /><span className="hidden sm:inline">Spam</span>
        </button>
        <button
          onClick={() => update.mutate({ favorite: !conv.favorite })}
          title={conv.favorite ? "Tirar dos favoritos" : "Favoritar"}
          className="size-8 rounded-lg grid place-items-center border border-border hover:bg-muted"
        >
          <Star className={`size-4 ${conv.favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button title="Tags" className="hidden sm:grid size-8 rounded-lg place-items-center border border-border hover:bg-muted text-muted-foreground">
              <Tag className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <TagEditor tags={conv.tags} aiTags={conv.ai_tags} suggestions={allTags} onChange={(tags) => update.mutate({ tags })} />
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="size-8 rounded-lg grid place-items-center border border-border hover:bg-muted text-muted-foreground" aria-label="Mais ações">
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => readFn({ data: { ids: [id], read: false } }).then(() => { markedRef.current = id; onChanged(); toast.success("Marcada como não lida"); })}>
              <MailOpen className="size-3.5 mr-2" />Marcar como não lida
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={askDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="size-3.5 mr-2" />Excluir conversa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`h-8 pl-3 pr-2 rounded-lg text-xs font-medium flex items-center gap-1 shrink-0 ${status.cls}`}>
              <span className="hidden sm:inline">{status.label}</span>
              <span className={`sm:hidden size-2 rounded-full ${status.dot}`} />
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {SUPPORT_STATUSES.map((s) => (
              <DropdownMenuItem key={s} onClick={() => update.mutate({ status: s })}>
                <span className={`size-2 rounded-full mr-2.5 ${STATUS_META[s].dot}`} />
                {STATUS_META[s].label}
                {s === conv.status && <Check className="size-3.5 ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mensagens */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4 text-foreground">
        {conv.message_count > q.data!.messages.length && (
          <p className="text-center text-[11px] text-muted-foreground">Mostrando as últimas {q.data!.messages.length} mensagens</p>
        )}
        {q.data!.messages.map((m, i, all) => (
          <Bubble key={m.id} m={m} fg={fg} isLastIn={!all.slice(i + 1).some((x) => x.direction === "in")}
            onUseDraft={(text) => setInject((p) => ({ text, n: (p?.n ?? 0) + 1 }))} />
        ))}
      </div>

      <Composer customerName={name.split(" ")[0]} customerEmail={conv.customer_email} conversationId={conv.id} onSend={onSend} sending={sending} inject={inject} />
    </div>
  );
}

function Bubble({ m, fg, isLastIn, onUseDraft }: { m: SupportMessage; fg: string; isLastIn?: boolean; onUseDraft?: (text: string) => void }) {
  const out = m.direction === "out";
  const translateFn = useSupportFn(translateSupportMessage, "translateSupportMessage");
  // Todo e-mail abre em português — do cliente e os nossos já enviados
  // (tradução feita na sincronização ou, se ainda não tiver, pedida agora e
  // guardada); o 🌐 alterna com o original em inglês.
  const [pt, setPt] = useState<string | null>(m.content_pt ?? null);
  const [mode, setMode] = useState<"pt" | "orig">("pt");
  const [translating, setTranslating] = useState(false);
  const [failed, setFailed] = useState(false);

  const translate = async (silent: boolean) => {
    setTranslating(true);
    try {
      const r = await translateFn({ data: { id: m.id } });
      setPt(r.text);
    } catch (e: any) {
      setFailed(true);
      if (!silent) toast.error(e.message ?? "Erro ao traduzir");
      else setMode("orig");
    } finally {
      setTranslating(false);
    }
  };
  useEffect(() => {
    if (pt == null && !failed) translate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  const toggle = () => {
    if (mode === "pt") return setMode("orig");
    setMode("pt");
    if (pt == null && !translating) { setFailed(false); translate(false); }
  };
  const showPt = mode === "pt" && !!pt;

  return (
    // Ocupa a largura toda; o recuo do lado oposto ainda mostra quem mandou.
    <div className={out ? "pl-1.5 sm:pl-3" : "pr-1.5 sm:pr-3"}>
      <div className={`relative w-full rounded-2xl px-4 py-3 ${out ? "bg-primary/10 rounded-br-md" : "bg-muted rounded-bl-md"}`}>
        <div className="flex items-start gap-2 mb-1.5">
          <p className="flex-1 min-w-0 text-[11px] font-semibold text-muted-foreground truncate">{m.subject}</p>
          {mode === "pt" && translating && <span className="text-[10px] text-muted-foreground shrink-0">Traduzindo…</span>}
          <button
            onClick={toggle}
            disabled={translating}
            title={showPt ? "Ver original (inglês)" : "Traduzir para português"}
            className={`-mt-1 -mr-2 h-6 px-1.5 rounded-md flex items-center gap-1 text-[10px] font-medium shrink-0 transition-colors ${
              showPt ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-background/70"
            }`}
          >
            {translating ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
            {showPt ? "PT" : "EN"}
          </button>
        </div>
        {showPt ? (
          <QuotedText text={pt!} />
        ) : m.content_html != null
          ? <EmailFrame html={m.content_html} color={fg} />
          : <p className="text-sm whitespace-pre-wrap">{m.summary}</p>}
        {m.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {m.attachments.map((a) => <AttachmentLink key={a.id} messageId={m.id} att={a} />)}
          </div>
        )}
        <p className={`text-[10px] text-muted-foreground mt-1.5 ${out ? "text-right" : ""}`}>
          {fullTime(m.sent_at)}{out ? " · enviado" : ""}
        </p>
        {!out && m.auto_reply && !m.auto_reply.startsWith("fora:") && (
          m.auto_reply === "enviado" ? (
            <p className="text-[11px] mt-1 text-success font-medium flex items-center gap-1"><Bot className="size-3.5" /> Respondido automaticamente{m.auto_reply_at ? ` · ${fullTime(m.auto_reply_at)}` : ""}</p>
          ) : (
            <p className="text-[11px] mt-1 text-warning font-medium flex items-center gap-1"><Bot className="size-3.5" /> Ficou pra equipe: {m.auto_reply.replace(/^pulado:\s*/, "")}</p>
          )
        )}
        {!out && m.ai_draft && <DraftCard m={m} defaultOpen={!!isLastIn && !!m.ai_draft_eval?.pendente} onUse={onUseDraft} />}
      </div>
    </div>
  );
}

function AttachmentLink({ messageId, att }: { messageId: string; att: { id: string; name: string; size: number } }) {
  const [busy, setBusy] = useState(false);
  const demo = useIsDemo();
  const download = async () => {
    if (demo) return toast.info("Modo demonstração — anexo fictício");
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`/api/atendimento/attachment?message=${messageId}&attachment=${encodeURIComponent(att.id)}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = att.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      toast.error(`Não foi possível baixar: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={download} disabled={busy}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-background/70 border border-border text-xs hover:border-primary max-w-[240px]">
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3 text-muted-foreground" />}
      <span className="truncate">{att.name}</span>
      {att.size > 0 && <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>}
      <Download className="size-3 text-muted-foreground shrink-0" />
    </button>
  );
}

// Treino da IA: o que a IA responderia a este e-mail (nada é enviado). Antes da
// resposta da equipe: "Usar" joga o texto (inglês) na caixa de resposta. Depois:
// como a sugestão se saiu comparada com o que a equipe mandou.
const EVAL_META: Record<string, { label: string; cls: string }> = {
  igual: { label: "IA acertou", cls: "text-success" },
  parecida: { label: "IA chegou perto", cls: "text-primary" },
  diferente: { label: "IA respondeu diferente", cls: "text-warning" },
};
function DraftCard({ m, defaultOpen, onUse }: { m: SupportMessage; defaultOpen: boolean; onUse?: (text: string) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const [lang, setLang] = useState<"pt" | "en">("pt");
  const e = m.ai_draft_eval ?? {};
  const done = e.semelhanca ? EVAL_META[e.semelhanca] : null;
  const text = lang === "pt" && m.ai_draft_pt ? m.ai_draft_pt : m.ai_draft!;
  return (
    <div className="mt-2 rounded-xl border border-primary/25 bg-background/70">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-left">
        <Sparkles className="size-3.5 text-primary shrink-0" />
        <span className="text-primary">Sugestão da IA</span>
        {e.pendente && e.confianca && <span className="text-muted-foreground font-normal">· confiança {e.confianca}</span>}
        {done && <span className={`${done.cls} font-normal truncate`}>· {done.label}{e.o_que_mudou ? `: ${e.o_que_mudou}` : ""}</span>}
        <ChevronDown className={`size-3.5 ml-auto shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {e.pendente && e.observacao && <p className="text-[11px] text-warning">{e.observacao}</p>}
          <p className="text-sm whitespace-pre-wrap">{text}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setLang(lang === "pt" ? "en" : "pt")} className="h-7 px-2 rounded-md text-[11px] text-muted-foreground hover:bg-muted flex items-center gap-1">
              <Languages className="size-3.5" /> {lang === "pt" ? "Ver em inglês" : "Ver em português"}
            </button>
            {e.pendente && onUse && (
              <button onClick={() => { onUse(m.ai_draft!); toast.success("Sugestão na caixa de resposta — revise e envie"); }}
                className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11px] font-medium ml-auto">Usar</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

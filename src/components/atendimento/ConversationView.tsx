import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Check, ChevronDown, Copy, Download, ExternalLink, Loader2, MailOpen, MoreVertical, Paperclip, Star, Tag,
} from "lucide-react";
import {
  getSupportConversation, getSupportCustomer, markConversationRead, sendSupportReply, updateSupportConversations,
  SUPPORT_STATUSES, type SupportConversation, type SupportMessage, type SupportStatus,
} from "@/lib/atendimento.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmailFrame } from "./EmailFrame";
import { Composer, type SendMode } from "./Composer";
import { TagEditor, customerType } from "./CustomerPanel";
import { Avatar, STATUS_META, displayName, formatBytes, fullTime } from "./utils";
import { useSupportFn, useIsDemo } from "./demo";

export function ConversationView({ id, allTags, mailWebBase, onBack, onChanged }: {
  id: string; allTags: string[]; mailWebBase: string; onBack: () => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const getFn = useSupportFn(getSupportConversation, "getSupportConversation");
  const customerFn = useSupportFn(getSupportCustomer, "getSupportCustomer");
  const readFn = useSupportFn(markConversationRead, "markConversationRead");
  const updateFn = useSupportFn(updateSupportConversations, "updateSupportConversations");
  const replyFn = useSupportFn(sendSupportReply, "sendSupportReply");

  const q = useQuery({ queryKey: ["support-conv", id], queryFn: () => getFn({ data: { id } }), staleTime: 30_000 });
  const conv = q.data?.conversation;
  const customer = useQuery({
    queryKey: ["support-customer", conv?.customer_email],
    queryFn: () => customerFn({ data: { email: conv!.customer_email } }),
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
  const onSend = async (text: string, attachments: any[], mode: SendMode, signature: boolean) => {
    setSending(true);
    try {
      await replyFn({ data: { conversationId: id, text, attachments, status: mode, signature } });
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
  const type = customer.data ? customerType(customer.data.ordersCount) : null;
  const lastMsg = q.data!.messages[q.data!.messages.length - 1];
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
            {type && <span className={`hidden sm:inline text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${type.cls}`}>{type.label}</span>}
          </div>
          <p className="text-xs text-muted-foreground truncate">{conv.customer_email}</p>
        </div>

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
            <TagEditor tags={conv.tags} suggestions={allTags} onChange={(tags) => update.mutate({ tags })} />
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
            <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(conv.customer_email); toast.success("E-mail copiado"); }}>
              <Copy className="size-3.5 mr-2" />Copiar e-mail
            </DropdownMenuItem>
            {lastMsg && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href={`${mailWebBase}/zm/#mail/folder/${lastMsg.direction === "in" ? "inbox" : "sent"}/p/${lastMsg.message_id}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5 mr-2" />Abrir no Zoho
                  </a>
                </DropdownMenuItem>
              </>
            )}
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
        {q.data!.messages.map((m) => <Bubble key={m.id} m={m} fg={fg} />)}
      </div>

      <Composer customerName={name.split(" ")[0]} onSend={onSend} sending={sending} />
    </div>
  );
}

function Bubble({ m, fg }: { m: SupportMessage; fg: string }) {
  const out = m.direction === "out";
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${out ? "bg-primary/10 rounded-br-md" : "bg-muted rounded-bl-md"}`}>
        {m.subject && <p className="text-[11px] font-semibold text-muted-foreground mb-1.5 truncate">{m.subject}</p>}
        {m.content_html != null
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

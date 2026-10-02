import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Languages, Truck, Loader2, MessageSquareText, Paperclip, Pencil, Plus, Save, Search, Send, Trash2, Undo2, X } from "lucide-react";
import {
  translateSupportReply, uploadSupportAttachment, listSupportTemplates, saveSupportTemplate, deleteSupportTemplate, getSupportCustomer,
  type SupportTemplate,
} from "@/lib/atendimento.functions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatBytes } from "./utils";
import { useSupportFn } from "./demo";

export type UploadedAttachment = { storeName: string; attachmentPath: string; attachmentName: string; size: number };

// A Vercel aceita no máximo 4,5 MB por requisição (o arquivo vai em base64, +33%).
const MAX_FILE = 3 * 1024 * 1024;

export function useAttachments() {
  const uploadFn = useSupportFn(uploadSupportAttachment, "uploadSupportAttachment");
  const [files, setFiles] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(0);

  const add = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      if (file.size > MAX_FILE) { toast.error(`${file.name}: máximo 3 MB por arquivo`); continue; }
      setUploading((n) => n + 1);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        const ref = await uploadFn({ data: { fileName: file.name, base64 } });
        setFiles((f) => [...f, { ...ref, size: file.size }]);
      } catch (e: any) {
        toast.error(`${file.name}: ${e.message ?? "falha no envio"}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const remove = (i: number) => setFiles((f) => f.filter((_, j) => j !== i));
  const clear = () => setFiles([]);
  const refs = files.map(({ storeName, attachmentPath, attachmentName }) => ({ storeName, attachmentPath, attachmentName }));
  return { files, uploading: uploading > 0, add, remove, clear, refs };
}

export function AttachmentChips({ files, onRemove }: { files: UploadedAttachment[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span key={`${f.attachmentName}-${i}`} className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-lg bg-muted text-xs max-w-[220px]">
          <Paperclip className="size-3 text-muted-foreground shrink-0" />
          <span className="truncate">{f.attachmentName}</span>
          <span className="text-muted-foreground shrink-0">{formatBytes(f.size)}</span>
          <button type="button" onClick={() => onRemove(i)} className="size-5 rounded grid place-items-center hover:bg-background" aria-label="Remover anexo">
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

// Escreve em português → botão troca o texto pela versão em inglês; "Desfazer"
// volta o português. O envio continua manual.
// Link de rastreio do pedido na caixa de resposta, numa linha só — no envio vira
// o texto clicável "Track your order here". Vários pedidos: escolhe qual.
function TrackingLinkButton({ text, setText, customerEmail, conversationId }: {
  text: string; setText: (t: string) => void; customerEmail?: string | null; conversationId?: string | null;
}) {
  const customerFn = useSupportFn(getSupportCustomer, "getSupportCustomer");
  const email = (customerEmail ?? "").trim().toLowerCase();
  const q = useQuery({
    queryKey: conversationId ? ["support-customer", email, conversationId] : ["support-customer", email],
    queryFn: () => customerFn({ data: conversationId ? { email, conversationId } : { email } }),
    enabled: email.includes("@"), staleTime: 60_000,
  });
  const orders = (q.data?.orders ?? []).filter((o) => !o.cancelled && o.trackingUrl);
  const insert = (url: string) => {
    const t = text.replace(/\s+$/, "");
    setText(t ? `${t}\n\n${url}\n` : `${url}\n`);
  };
  const cls = "h-8 px-2 rounded-lg flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50";
  const label = <><Truck className="size-3.5" /> Link de rastreio</>;
  if (orders.length > 1) return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className={cls}>{label}</button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {orders.map((o) => <DropdownMenuItem key={o.id} onClick={() => insert(o.trackingUrl!)}>{o.number}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <button type="button" className={cls} disabled={q.isLoading}
      title={orders.length ? "Coloca o link de rastreio no texto (vai como “Track your order here”)" : "Sem pedido com rastreio para este cliente"}
      onClick={() => orders[0] ? insert(orders[0].trackingUrl!) : toast.warning("Nenhum pedido deste cliente tem rastreio ainda.")}>
      {label}
    </button>
  );
}

export function TranslateToEnglish({ text, setText }: { text: string; setText: (t: string) => void }) {
  const translateFn = useSupportFn(translateSupportReply, "translateSupportReply");
  const [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState<{ pt: string; en: string } | null>(null);
  // Texto apagado/enviado: some o "Desfazer".
  const undoable = original && text.trim() !== "";

  const translate = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await translateFn({ data: { text } });
      setOriginal({ pt: text, en: r.text });
      setText(r.text);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao traduzir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={translate} disabled={!text.trim() || busy} title="Traduz o que você escreveu para inglês (você revisa antes de enviar)"
        className="h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
        <span className="hidden sm:inline">{busy ? "Traduzindo…" : "Traduzir para inglês"}</span>
      </button>
      {undoable && !busy && (
        <button type="button" onClick={() => { setText(original.pt); setOriginal(null); }} title="Voltar ao texto em português"
          className="h-8 px-2 rounded-lg text-xs flex items-center gap-1 text-primary hover:bg-primary/10">
          <Undo2 className="size-3.5" /> Desfazer
        </button>
      )}
    </>
  );
}

export type TemplateDraft = { id?: string; title: string; body: string };

// Formulário de uma mensagem salva (botão "Mensagens salvas" e Configurações).
export function TemplateEditor({ value, onChange, onSave, onCancel, saving, rows = 8 }: {
  value: TemplateDraft; onChange: (v: TemplateDraft) => void; onSave: () => void; onCancel: () => void; saving: boolean; rows?: number;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{value.id ? "Editar mensagem" : "Nova mensagem salva"}</p>
      <input value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} placeholder="Nome (ex.: Prazo de entrega)" autoFocus
        className="w-full h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary" />
      <textarea value={value.body} onChange={(e) => onChange({ ...value, body: e.target.value })} rows={rows} placeholder="Texto da mensagem"
        className="w-full resize-y rounded-lg bg-background border border-border p-3 text-sm outline-none focus:border-primary" />
      <p className="text-[11px] text-muted-foreground">
        Use <code className="px-1 rounded bg-muted">{"{nome}"}</code> para o primeiro nome do cliente
        e <code className="px-1 rounded bg-muted">{"{rastreio}"}</code> para o link de rastreio do pedido.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 px-3 rounded-lg text-xs hover:bg-muted">Cancelar</button>
        <button type="button" onClick={onSave} disabled={!value.title.trim() || !value.body.trim() || saving}
          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-50">
          {saving && <Loader2 className="size-3.5 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  );
}

type TemplateContext = { customerName?: string | null; customerEmail?: string | null; orderNumber?: string | null; conversationId?: string | null };

// Texto final de uma mensagem salva: {nome} → primeiro nome do cliente,
// {rastreio} → link de rastreio (do pedido buscado, ou o mais recente do cliente).
function useTemplateFill({ customerName, customerEmail, orderNumber, conversationId }: TemplateContext) {
  const qc = useQueryClient();
  const customerFn = useSupportFn(getSupportCustomer, "getSupportCustomer");
  const [filling, setFilling] = useState(false);
  const fill = async (t: SupportTemplate) => {
    let body = t.body;
    const needsTracking = /\{rastreio\}/i.test(body);
    let first = (customerName ?? "").trim().split(/\s+/)[0] ?? "";
    const email = (customerEmail ?? "").trim().toLowerCase();
    // Pedidos do cliente (mesmo cache do painel do cliente).
    let customer: Awaited<ReturnType<typeof getSupportCustomer>> | null = null;
    if (email.includes("@") && (needsTracking || (!first && /\{nome\}/i.test(body)))) {
      setFilling(true);
      try {
        // Mesma chave do painel do cliente (com a conversa: pedidos citados nela também).
        customer = await qc.fetchQuery({
          queryKey: conversationId ? ["support-customer", email, conversationId] : ["support-customer", email],
          queryFn: () => customerFn({ data: conversationId ? { email, conversationId } : { email } }),
        });
      } catch { /* sem pedido: segue sem preencher */ }
      setFilling(false);
    }
    if (!first) first = (customer?.name ?? "").trim().split(/\s+/)[0] ?? "";
    body = body.replace(/\{nome\}/gi, first);
    if (needsTracking) {
      const orders = (customer?.orders ?? []).filter((o) => !o.cancelled);
      const num = (orderNumber ?? "").trim().replace(/^#/, "").toLowerCase();
      const wanted = num
        ? orders.find((o) => { const n = String(o.number ?? "").replace(/^#/, "").toLowerCase(); return n === num || (/^\d+$/.test(num) && new RegExp(`(^|[^0-9])${num}$`).test(n)); })
        : undefined;
      const link = (wanted ?? orders.find((o) => o.trackingUrl))?.trackingUrl ?? "";
      if (!link) toast.warning(email ? "Esse pedido ainda não tem código de rastreio — o {rastreio} ficou vazio." : "Preencha o e-mail do cliente para puxar o link de rastreio.");
      body = body.replace(/\{rastreio\}/gi, link);
    }
    return body;
  };
  return { fill, filling };
}

// Caixa de texto com atalho "/": digitar "/" (no começo ou depois de espaço)
// abre as mensagens salvas filtradas pelo que vem depois; ↑↓ escolhe,
// Enter/Tab insere no lugar do "/…", Esc fecha.
export function TemplateTextarea({ value, onChange, onKeyDown, customerName, customerEmail, orderNumber, conversationId, className, ...rest }:
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & TemplateContext & { value: string; onChange: (v: string) => void }) {
  const listFn = useSupportFn(listSupportTemplates, "listSupportTemplates");
  const { fill } = useTemplateFill({ customerName, customerEmail, orderNumber, conversationId });
  const ref = useRef<HTMLTextAreaElement>(null);
  // Onde está o "/" e o que foi digitado depois dele (null = menu fechado).
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const list = useQuery({ queryKey: ["support-templates"], queryFn: () => listFn() as Promise<SupportTemplate[]>, enabled: !!slash });

  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = before.match(/(^|\s)\/([^\n/]{0,40})$/);
    setSlash(m ? { start: caret - m[2].length - 1, query: m[2] } : null);
    setActive(0);
  };
  const matches = slash
    ? (list.data ?? []).filter((t) => !slash.query.trim() || `${t.title} ${t.body}`.toLowerCase().includes(slash.query.trim().toLowerCase())).slice(0, 8)
    : [];
  const menuOpen = !!slash && (list.isLoading || matches.length > 0);

  const pick = async (t: SupportTemplate) => {
    if (!slash) return;
    const { start, query } = slash;
    setSlash(null);
    const body = await fill(t);
    const end = start + 1 + query.length;
    const next = value.slice(0, start) + body + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + body.length, start + body.length);
    });
  };

  return (
    <div className="relative">
      {menuOpen && (
        <div className="absolute left-2 right-2 bottom-full mb-1 z-50 rounded-xl border border-border bg-popover shadow-lg p-1 max-h-64 overflow-y-auto">
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Mensagens salvas · ↑↓ escolhe · Enter insere · Esc fecha</p>
          {list.isLoading && <div className="py-3 grid place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
          {matches.map((t, i) => (
            <button key={t.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(t); }} onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg ${i === active ? "bg-primary/10" : "hover:bg-muted"}`}>
              <p className={`text-[13px] font-medium truncate ${i === active ? "text-primary" : ""}`}>{t.title}</p>
              <p className="text-[11px] text-muted-foreground truncate">{t.body.replace(/\s+/g, " ")}</p>
            </button>
          ))}
        </div>
      )}
      <textarea
        {...rest}
        ref={ref}
        value={value}
        className={className}
        // A janela em volta (Nova mensagem) lê isso pra não fechar no Esc do menu.
        data-slash-open={slash ? "1" : undefined}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
        onClick={(e) => detect(value, e.currentTarget.selectionStart ?? value.length)}
        onBlur={() => setSlash(null)}
        onKeyDown={(e) => {
          if (menuOpen && matches.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
            if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); pick(matches[active] ?? matches[0]); return; }
          }
          if (slash && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSlash(null); return; }
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}

// Mensagens salvas (respostas prontas do workspace). Clicar coloca o texto na
// caixa (vazia: substitui; com texto: acrescenta no fim). {nome} vira o
// primeiro nome do cliente e {rastreio} o link de rastreio do pedido
// (o buscado na Nova mensagem, ou o mais recente do cliente).
export function SavedReplies({ text, setText, customerName, customerEmail, orderNumber, conversationId }: {
  text: string; setText: (t: string) => void;
} & TemplateContext) {
  const qc = useQueryClient();
  const listFn = useSupportFn(listSupportTemplates, "listSupportTemplates");
  const saveFn = useSupportFn(saveSupportTemplate, "saveSupportTemplate");
  const deleteFn = useSupportFn(deleteSupportTemplate, "deleteSupportTemplate");
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id?: string; title: string; body: string } | null>(null);

  const list = useQuery({ queryKey: ["support-templates"], queryFn: () => listFn() as Promise<SupportTemplate[]>, enabled: open });
  const refresh = () => qc.invalidateQueries({ queryKey: ["support-templates"] });
  const save = useMutation({
    mutationFn: (t: { id?: string; title: string; body: string }) => saveFn({ data: t }),
    onSuccess: () => { toast.success("Mensagem salva"); setEditing(null); refresh(); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir"),
  });

  const { fill, filling } = useTemplateFill({ customerName, customerEmail, orderNumber, conversationId });
  const use = async (t: SupportTemplate) => {
    setOpen(false);
    const body = await fill(t);
    setText(text.trim() ? `${text.replace(/\s+$/, "")}\n\n${body}` : body);
  };
  const filtered = (list.data ?? []).filter((t) => !q.trim() || `${t.title} ${t.body}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setQ(""); } }}>
      <PopoverTrigger asChild>
        <button type="button" title="Mensagens salvas"
          className="h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted">
          {filling ? <Loader2 className="size-3.5 animate-spin" /> : <MessageSquareText className="size-3.5" />}
          <span className="hidden sm:inline">Mensagens salvas</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[380px] p-0">
        {editing ? (
          <div className="p-3">
            <TemplateEditor value={editing} onChange={setEditing} saving={save.isPending}
              onSave={() => save.mutate({ id: editing.id, title: editing.title.trim(), body: editing.body.trim() })}
              onCancel={() => setEditing(null)} />
          </div>
        ) : (
          <>
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar mensagem…" autoFocus
                  className="w-full h-8 pl-8 pr-2 rounded-lg bg-background border border-border text-xs outline-none focus:border-primary" />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {list.isLoading && <div className="py-6 grid place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
              {!list.isLoading && filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6 px-4">
                  {list.data?.length ? "Nenhuma mensagem encontrada." : "Nenhuma mensagem salva ainda. Crie a primeira abaixo."}
                </p>
              )}
              {filtered.map((t) => (
                <div key={t.id} className="group flex items-start gap-1 rounded-lg hover:bg-muted">
                  <button type="button" onClick={() => use(t)} className="flex-1 min-w-0 text-left px-2.5 py-2">
                    <p className="text-[13px] font-medium truncate">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 whitespace-pre-line">{t.body}</p>
                  </button>
                  <div className="flex shrink-0 pt-1.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" onClick={() => setEditing({ id: t.id, title: t.title, body: t.body })} title="Editar"
                      className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-background">
                      <Pencil className="size-3.5" />
                    </button>
                    <button type="button" title="Excluir"
                      onClick={() => confirm(`Excluir a mensagem "${t.title}"?`).then((ok) => { if (ok) remove.mutate(t.id); })}
                      className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-destructive hover:bg-background">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1 p-2 border-t border-border">
              <button type="button" onClick={() => setEditing({ title: "", body: "" })}
                className="h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5 text-primary hover:bg-primary/10">
                <Plus className="size-3.5" /> Nova
              </button>
              {text.trim() && (
                <button type="button" onClick={() => setEditing({ title: "", body: text.trim() })} title="Salvar o que está escrito agora como mensagem salva"
                  className="h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted">
                  <Save className="size-3.5" /> Salvar texto atual
                </button>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export type SendMode = "em_atendimento" | "resolvido";

export function Composer({ customerName, customerEmail, conversationId, onSend, sending, inject }: {
  inject?: { text: string; n: number } | null;   // "Usar" na sugestão da IA
  customerName: string;
  customerEmail?: string | null;
  conversationId?: string | null;
  sending: boolean;
  onSend: (text: string, attachments: ReturnType<typeof useAttachments>["refs"], mode: SendMode) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  useEffect(() => { if (inject) setText(inject.text); }, [inject?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const att = useAttachments();
  const fileRef = useRef<HTMLInputElement>(null);

  const send = async (mode: SendMode) => {
    if (!text.trim() || sending || att.uploading) return;
    if (await onSend(text, att.refs, mode)) { setText(""); att.clear(); }
  };

  return (
    <div className="border-t border-border p-3 space-y-2">
      <AttachmentChips files={att.files} onRemove={att.remove} />
      {/https?:\/\/\S*track/i.test(text) && (
        <p className="text-[11px] text-muted-foreground px-1">O link de rastreio vai no e-mail como o texto clicável <span className="text-primary font-semibold underline">Track your order here</span> — o cliente não vê a URL.</p>
      )}
      {/* Caixa ocupa a largura toda; anexar, assinatura e Enviar ficam na barra de baixo. */}
      <div className="rounded-xl border border-border bg-background focus-within:border-primary transition-colors">
        <TemplateTextarea
          value={text}
          onChange={setText}
          customerName={customerName}
          customerEmail={customerEmail}
          conversationId={conversationId}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send("em_atendimento"); } }}
          placeholder={`Responder ${customerName}… pode escrever em português e traduzir  (/ = mensagens salvas · Ctrl+Enter envia)`}
          rows={4}
          className="w-full resize-y min-h-[88px] max-h-80 bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button type="button" onClick={() => fileRef.current?.click()} title="Anexar arquivo (até 3 MB)"
            className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
            {att.uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </button>
          <SavedReplies text={text} setText={setText} customerName={customerName} customerEmail={customerEmail} conversationId={conversationId} />
          <TranslateToEnglish text={text} setText={setText} />
          <TrackingLinkButton text={text} setText={setText} customerEmail={customerEmail} conversationId={conversationId} />
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { att.add(e.target.files); e.target.value = ""; }} />
          <div className="flex-1" />
          <div className="flex shrink-0">
            <button
              onClick={() => send("em_atendimento")}
              disabled={!text.trim() || sending || att.uploading}
              className="h-8 pl-3.5 pr-3 rounded-l-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Enviar
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button disabled={!text.trim() || sending || att.uploading} aria-label="Mais opções de envio"
                  className="h-8 px-1.5 rounded-r-lg bg-primary text-primary-foreground border-l border-primary-foreground/20 disabled:opacity-50">
                  <ChevronDown className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={() => send("em_atendimento")}>Enviar</DropdownMenuItem>
                <DropdownMenuItem onClick={() => send("resolvido")}>Enviar e marcar como resolvido</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

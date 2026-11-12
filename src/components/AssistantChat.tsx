import { useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, X, Send, Loader2, Sparkles, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { askAssistantFn } from "@/lib/assistant.functions";
import { saveSupplierReply } from "@/lib/supplier-replies.functions";
import type { SupplierProposal } from "@/lib/assistant.server";

// Bolinha no canto inferior direito: chat com o sistema (assistant.server.ts).
// A conversa fica no navegador (localStorage) só pra não sumir ao trocar de página.

type Msg = {
  role: "user" | "assistant"; content: string; error?: boolean;
  // Resposta do fornecedor preparada pela IA: só grava no botão.
  proposal?: SupplierProposal; proposalStatus?: "saved" | "cancelled";
};
const KEY = "srx-assistant-chat";
const SUGGESTIONS = [
  "Quanto faturei hoje?",
  "Quantos pedidos estão sem postar há mais de 5 dias?",
  "Quais chargebacks estão abertos e quando vence o prazo?",
  "Qual produto mais vendeu esse mês?",
  "Colar resposta do fornecedor (ex.: sem estoque) com os pedidos",
];

function load(): Msg[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Msg[]; } catch { return []; }
}
function save(m: Msg[]) {
  try { localStorage.setItem(KEY, JSON.stringify(m.slice(-40))); } catch { /* sem storage */ }
}

// Markdown mínimo: **negrito** e listas "- ".
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p);
}
function Rich({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split("\n").map((line, i) => {
        const t = line.trimStart();
        if (/^[-•*] /.test(t)) return <div key={i} className="flex gap-1.5 pl-1"><span>•</span><span>{inline(t.slice(2))}</span></div>;
        if (/^#{1,4} /.test(t)) return <div key={i} className="font-semibold">{inline(t.replace(/^#+ /, ""))}</div>;
        return t ? <div key={i}>{inline(line)}</div> : <div key={i} className="h-1" />;
      })}
    </div>
  );
}

function ProposalCard({ p, status, onSave, onCancel }: {
  p: SupplierProposal; status?: "saved" | "cancelled"; onSave: () => Promise<void>; onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const replacing = p.orders.filter((o) => o.current);
  return (
    <div className="mt-2 rounded-xl border border-border bg-background p-3 space-y-2">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Resposta do fornecedor</p>
        <p className="font-semibold">{p.label}</p>
        {p.note && <p className="text-xs text-muted-foreground">{p.note}</p>}
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {p.orders.map((o) => (
          <div key={o.id} className="flex items-baseline gap-2 text-xs">
            <span className="font-medium">{o.number}</span>
            <span className="text-muted-foreground truncate">{o.shop}{o.code ? ` · ${o.code}` : ""}</span>
            {o.current && <span className="ml-auto shrink-0 text-amber-600" title={o.current.note ?? ""}>substitui "{o.current.title}"</span>}
          </div>
        ))}
      </div>
      {p.notFound.length > 0 && <p className="text-xs text-red-500">Não achei: {p.notFound.join(", ")}</p>}
      {status === "saved" ? (
        <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1"><Check className="size-3.5" /> Gravado — já está nos alertas do Gerencial</p>
      ) : status === "cancelled" ? (
        <p className="text-xs text-muted-foreground">Cancelado</p>
      ) : (
        <div className="flex gap-2 pt-1">
          <button disabled={saving} onClick={async () => { setSaving(true); try { await onSave(); } finally { setSaving(false); } }}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Gravar {p.orders.length} pedido{p.orders.length === 1 ? "" : "s"}{replacing.length ? ` (${replacing.length} substitui)` : ""}
          </button>
          <button disabled={saving} onClick={onCancel} className="h-8 px-3 rounded-lg bg-muted text-xs font-medium hover:bg-muted/70">Cancelar</button>
        </div>
      )}
    </div>
  );
}

export function AssistantChat() {
  const ask = useServerFn(askAssistantFn);
  const saveReply = useServerFn(saveSupplierReply);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMsgs(load()); }, []);
  useEffect(() => { save(msgs); endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const history = next.filter((m) => !m.error).map(({ role, content }) => ({ role, content: content.slice(0, 20_000) }));
      const r = await ask({ data: { messages: history } });
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, proposal: r.proposal ?? undefined }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: String(e?.message ?? "Erro ao consultar"), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  // Marca o cartão e deixa registrado na conversa (a IA vê no histórico).
  const settle = (i: number, status: "saved" | "cancelled", text: string) =>
    setMsgs((m) => m.map((x, j) => (j === i ? { ...x, proposalStatus: status, content: `${x.content}\n\n[${text}]` } : x)));
  const saveProposal = async (i: number, p: SupplierProposal) => {
    try {
      const r = await saveReply({ data: { orderIds: p.orders.map((o) => o.id), kind: p.kind, title: p.title, note: p.note } });
      settle(i, "saved", `Gravado pelo usuário: "${p.label}" em ${r.saved} pedido(s)`);
      toast.success(`Resposta registrada em ${r.saved} pedido${r.saved === 1 ? "" : "s"} — já está nos alertas`);
      qc.invalidateQueries({ queryKey: ["gerencial"] });
      qc.invalidateQueries({ queryKey: ["alert-orders"] });
      qc.invalidateQueries({ queryKey: ["nav-badges"] });
    } catch (e: any) {
      toast.error(String(e?.message ?? "Erro ao gravar"));
    }
  };

  return (
    <>
      {open && (
        <div className="fixed z-50 bottom-20 right-4 left-4 sm:left-auto sm:w-[400px] h-[min(600px,calc(100dvh-7rem))] flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-12 border-b border-border shrink-0">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-semibold flex-1">Pergunte ao sistema</span>
            {msgs.length > 0 && (
              <button onClick={() => setMsgs([])} disabled={busy} title="Limpar conversa"
                className="size-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40">
                <Trash2 className="size-4" />
              </button>
            )}
            <button onClick={() => setOpen(false)} title="Fechar"
              className="size-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {msgs.length === 0 && (
              <div className="pt-2">
                <p className="text-muted-foreground mb-3">Pergunte qualquer coisa sobre pedidos, rastreio, atendimento, chargebacks, Caixa, tarefas, produtos…</p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => (s.startsWith("Colar") ? (setInput(""), inputRef.current?.focus(), toast.info("Cole a mensagem do fornecedor na caixa de texto e envie")) : send(s))}
                      className="text-left px-3 py-2 rounded-xl border border-border hover:bg-muted transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
                <div className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3 py-2 whitespace-pre-wrap"
                    : m.error
                      ? "max-w-[90%] rounded-2xl rounded-bl-md bg-destructive/10 text-destructive px-3 py-2"
                      : "max-w-[90%] rounded-2xl rounded-bl-md bg-muted px-3 py-2"
                }>
                  {m.role === "assistant" && !m.error ? <Rich text={m.content.replace(/\n\n\[(Gravado|Cancelado) pelo usuário[^\]]*\]$/, "")} /> : m.content}
                  {m.proposal && (
                    <ProposalCard p={m.proposal} status={m.proposalStatus}
                      onSave={() => saveProposal(i, m.proposal!)}
                      onCancel={() => settle(i, "cancelled", "Cancelado pelo usuário — não gravou")} />
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex">
                <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Consultando o sistema…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-border p-2 flex items-end gap-2 shrink-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              rows={1}
              placeholder="Escreva sua pergunta…"
              className="flex-1 resize-none max-h-32 rounded-xl border border-border bg-background px-3 py-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button type="submit" disabled={busy || !input.trim()} title="Enviar"
              className="size-9 grid place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 shrink-0">
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? "Fechar assistente" : "Pergunte ao sistema"}
        aria-label="Assistente"
        className="fixed z-50 bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 size-12 sm:size-13 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 active:scale-95 transition-transform grid place-items-center"
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-6" />}
      </button>
    </>
  );
}

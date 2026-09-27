import { useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Languages, Loader2, Paperclip, Send, Undo2, X } from "lucide-react";
import { translateSupportReply, uploadSupportAttachment } from "@/lib/atendimento.functions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

export type SendMode = "em_atendimento" | "resolvido";

export function Composer({ customerName, onSend, sending }: {
  customerName: string;
  sending: boolean;
  onSend: (text: string, attachments: ReturnType<typeof useAttachments>["refs"], mode: SendMode) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const att = useAttachments();
  const fileRef = useRef<HTMLInputElement>(null);

  const send = async (mode: SendMode) => {
    if (!text.trim() || sending || att.uploading) return;
    if (await onSend(text, att.refs, mode)) { setText(""); att.clear(); }
  };

  return (
    <div className="border-t border-border p-3 space-y-2">
      <AttachmentChips files={att.files} onRemove={att.remove} />
      {/* Caixa ocupa a largura toda; anexar, assinatura e Enviar ficam na barra de baixo. */}
      <div className="rounded-xl border border-border bg-background focus-within:border-primary transition-colors">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send("em_atendimento"); } }}
          placeholder={`Responder ${customerName}… pode escrever em português e traduzir  (Ctrl+Enter envia)`}
          rows={4}
          className="w-full resize-y min-h-[88px] max-h-80 bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button type="button" onClick={() => fileRef.current?.click()} title="Anexar arquivo (até 3 MB)"
            className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
            {att.uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </button>
          <TranslateToEnglish text={text} setText={setText} />
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

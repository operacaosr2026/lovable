import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Loader2, Paperclip, Send, X } from "lucide-react";
import { uploadSupportAttachment } from "@/lib/atendimento.functions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatBytes } from "./utils";

export type UploadedAttachment = { storeName: string; attachmentPath: string; attachmentName: string; size: number };

// A Vercel aceita no máximo 4,5 MB por requisição (o arquivo vai em base64, +33%).
const MAX_FILE = 3 * 1024 * 1024;

export function useAttachments() {
  const uploadFn = useServerFn(uploadSupportAttachment);
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

export type SendMode = "aguardando_cliente" | "resolvido" | "em_atendimento";

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
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0 rounded-xl border border-border bg-background focus-within:border-primary transition-colors">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send("aguardando_cliente"); } }}
            placeholder={`Responder ${customerName}…  (Ctrl+Enter envia)`}
            rows={3}
            className="w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground/70 max-h-60"
          />
          <div className="flex items-center justify-between px-2 pb-1.5">
            <button type="button" onClick={() => fileRef.current?.click()} title="Anexar arquivo (até 3 MB)"
              className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
              {att.uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { att.add(e.target.files); e.target.value = ""; }} />
          </div>
        </div>
        <div className="flex shrink-0">
          <button
            onClick={() => send("aguardando_cliente")}
            disabled={!text.trim() || sending || att.uploading}
            className="h-10 pl-4 pr-3 rounded-l-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Enviar
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button disabled={!text.trim() || sending || att.uploading} aria-label="Mais opções de envio"
                className="h-10 px-2 rounded-r-xl bg-primary text-primary-foreground border-l border-primary-foreground/20 disabled:opacity-50">
                <ChevronDown className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={() => send("aguardando_cliente")}>Enviar e aguardar cliente</DropdownMenuItem>
              <DropdownMenuItem onClick={() => send("resolvido")}>Enviar e marcar como resolvido</DropdownMenuItem>
              <DropdownMenuItem onClick={() => send("em_atendimento")}>Enviar e manter em atendimento</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

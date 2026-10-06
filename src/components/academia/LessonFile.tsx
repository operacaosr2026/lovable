import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { LessonDoc } from "./LessonDoc";
import { trainingFileUrl, uploadTrainingFile } from "./files";

export type FileContent = { path?: string; name?: string; size?: number; mime?: string | null; blocks?: unknown };

function formatSize(n = 0) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function LessonFile({ content, editable, onChange }: {
  content: FileContent;
  editable: boolean;
  onChange: (c: FileContent) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPdf = content.mime === "application/pdf" || /\.pdf$/i.test(content.name ?? "");
  const isImage = (content.mime ?? "").startsWith("image/");

  useEffect(() => {
    setUrl(null);
    if (content.path && (isPdf || isImage)) trainingFileUrl(content.path).then(setUrl).catch((e) => toast.error(e.message));
  }, [content.path, isPdf, isImage]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadTrainingFile(file);
      onChange({ ...content, path, name: file.name, size: file.size, mime: file.type || null });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao enviar o arquivo");
    } finally {
      setUploading(false);
    }
  };

  const download = async () => {
    if (!content.path) return;
    try {
      window.open(await trainingFileUrl(content.path, content.name), "_blank");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
          <FileText className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{content.name ?? "Nenhum arquivo"}</div>
          {content.path && <div className="text-xs text-muted-foreground">{formatSize(content.size)}</div>}
        </div>
        {content.path && (
          <button onClick={download} className="h-9 px-3 rounded-xl border border-border text-sm flex items-center gap-2 hover:bg-muted">
            <Download className="size-4" /> Baixar
          </button>
        )}
        {editable && (
          <>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="h-9 px-3 rounded-xl bg-primary text-primary-foreground text-sm flex items-center gap-2 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {content.path ? "Trocar" : "Enviar arquivo"}
            </button>
            <input ref={inputRef} type="file" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </>
        )}
      </div>

      {content.path && isPdf && (
        <div className="w-full h-[75vh] rounded-2xl overflow-hidden border border-border bg-muted">
          {url ? <iframe src={url} className="size-full" title={content.name} /> : <div className="size-full grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
        </div>
      )}
      {content.path && isImage && url && (
        <img src={url} alt={content.name} className="max-w-full rounded-2xl border border-border" />
      )}

      {(editable || (Array.isArray(content.blocks) && content.blocks.length > 0)) && (
        <div className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Instruções</p>
          <LessonDoc blocks={content.blocks} editable={editable} onChange={(blocks) => onChange({ ...content, blocks })} />
        </div>
      )}
    </div>
  );
}

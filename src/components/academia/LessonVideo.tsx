import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Video, X } from "lucide-react";
import { toast } from "sonner";
import { LessonDoc } from "./LessonDoc";
import { trainingFileUrl, uploadTrainingFile } from "./files";

export type VideoContent = { url?: string; path?: string; name?: string; blocks?: unknown };

// Link de página → link de player embutido (YouTube, Vimeo, Loom, Google Drive).
// Aceita também o código de incorporação (<iframe src="...">) colado inteiro.
export function embedUrl(raw: string): { kind: "iframe" | "video"; src: string } | null {
  const url = (raw.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i)?.[1] ?? raw).trim();
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return { kind: "iframe", src: `https://www.youtube.com/embed/${u.pathname.slice(1)}` };
  if (host.endsWith("youtube.com")) {
    const id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
    if (id) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}` };
  }
  if (host === "vimeo.com") {
    const id = u.pathname.match(/^\/(\d+)/)?.[1];
    if (id) return { kind: "iframe", src: `https://player.vimeo.com/video/${id}` };
  }
  if (host.endsWith("loom.com")) {
    const id = u.pathname.match(/\/(?:share|embed)\/([^/?]+)/)?.[1];
    if (id) return { kind: "iframe", src: `https://www.loom.com/embed/${id}` };
  }
  if (host === "drive.google.com") {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? u.searchParams.get("id");
    if (id) return { kind: "iframe", src: `https://drive.google.com/file/d/${id}/preview` };
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: "video", src: url };
  return { kind: "iframe", src: url };
}

export function LessonVideo({ content, editable, onChange }: {
  content: VideoContent;
  editable: boolean;
  onChange: (c: VideoContent) => void;
}) {
  const [draft, setDraft] = useState(content.url ?? "");
  const [uploading, setUploading] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFileUrl(null);
    if (content.path) trainingFileUrl(content.path).then(setFileUrl).catch((e) => toast.error(e.message));
  }, [content.path]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadTrainingFile(file);
      onChange({ ...content, url: "", path, name: file.name });
      setDraft("");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao enviar o vídeo");
    } finally {
      setUploading(false);
    }
  };

  const embed = content.path ? (fileUrl ? { kind: "video" as const, src: fileUrl } : null) : embedUrl(content.url ?? "");

  return (
    <div className="space-y-5">
      {editable && (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== (content.url ?? "") && onChange({ ...content, url: draft.trim(), path: undefined, name: undefined })}
            placeholder="Cole o link ou o código de incorporação (YouTube, Vimeo, Loom, Drive)"
            className="flex-1 h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="h-10 px-4 rounded-xl border border-border text-sm flex items-center justify-center gap-2 hover:bg-muted disabled:opacity-60"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Enviar vídeo
          </button>
          <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      )}

      {embed ? (
        <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-border">
          {embed.kind === "video" ? (
            <video src={embed.src} controls className="absolute inset-0 size-full" />
          ) : (
            <iframe
              src={embed.src}
              className="absolute inset-0 size-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          )}
          {editable && content.path && (
            <button
              onClick={() => onChange({ ...content, path: undefined, name: undefined })}
              title="Remover vídeo"
              className="absolute top-2 right-2 size-8 rounded-lg bg-black/60 text-white grid place-items-center hover:bg-black/80"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="w-full aspect-video rounded-2xl border border-dashed border-border grid place-items-center text-muted-foreground">
          <div className="flex flex-col items-center gap-2 text-sm">
            {content.path ? <Loader2 className="size-6 animate-spin" /> : <Video className="size-8 opacity-50" />}
            {!content.path && (editable ? "Cole um link ou envie um vídeo" : "Vídeo ainda não adicionado")}
          </div>
        </div>
      )}

      {(editable || (Array.isArray(content.blocks) && content.blocks.length > 0)) && (
        <div className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Anotações da aula</p>
          <LessonDoc blocks={content.blocks} editable={editable} onChange={(blocks) => onChange({ ...content, blocks })} />
        </div>
      )}
    </div>
  );
}

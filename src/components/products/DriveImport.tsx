import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronRight, Film, Folder, FolderOpen, ImageIcon, Info, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { importDriveFiles, listDriveFolder, type DriveEntry } from "@/lib/drive.functions";
import { cn } from "@/lib/utils";

// Importar criativos de uma pasta do Google Drive compartilhada como
// "Qualquer pessoa com o link". Navega nas subpastas; cada arquivo marcado vira um criativo.

type Listing = Awaited<ReturnType<typeof listDriveFolder>>;
const LAST_KEY = (productId: string) => `drive-folder:${productId}`;
const BATCH = 5;

const fmtSize = (b: number | null) => (b == null ? "" : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const fmtDur = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export function DriveImportDialog({ productId, folderId, open, onClose, onImported }: {
  productId: string; folderId?: string | null; open: boolean; onClose: () => void; onImported: () => void;
}) {
  const listFn = useServerFn(listDriveFolder);
  const importFn = useServerFn(importDriveFiles);

  const [link, setLink] = useState(() => (typeof window !== "undefined" ? localStorage.getItem(LAST_KEY(productId)) ?? "" : ""));
  const [stack, setStack] = useState<Listing[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const current = stack[stack.length - 1];

  const open_ = useMutation({
    mutationFn: (l: string) => listFn({ data: { product_id: productId, link: l } }),
    onError: (e: any) => toast.error(e.message),
  });

  const openRoot = () => {
    const l = link.trim();
    if (!l) return;
    open_.mutate(l, {
      onSuccess: (r) => {
        localStorage.setItem(LAST_KEY(productId), l);
        setStack([r]);
        setSelected(new Set());
      },
    });
  };
  const openFolder = (id: string) => open_.mutate(`https://drive.google.com/drive/folders/${id}`, {
    onSuccess: (r) => { setStack((s) => [...s, r]); setSelected(new Set()); },
  });
  const back = () => { setStack((s) => s.slice(0, -1)); setSelected(new Set()); };

  const available = (current?.files ?? []).filter((f) => !f.imported);
  const allMarked = available.length > 0 && available.every((f) => selected.has(f.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const runImport = async () => {
    const files = (current?.files ?? []).filter((f) => selected.has(f.id));
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    let created = 0;
    const errors: string[] = [];
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const r = await importFn({ data: { product_id: productId, files: batch.map((f) => ({ id: f.id, name: f.name, kind: f.kind })), folder_id: folderId ?? null } });
        created += r.created;
        errors.push(...r.errors.map((e) => `${e.name}: ${e.error}`));
        setProgress({ done: Math.min(files.length, i + batch.length), total: files.length });
        onImported();
      }
      if (created) toast.success(`${created} criativo(s) importado(s) do Drive`);
      if (errors.length) toast.error(`Não importei ${errors.length}: ${errors[0]}`);
      // Marca como importados sem buscar a pasta de novo.
      setStack((s) => s.map((l, idx) => idx === s.length - 1 ? { ...l, files: l.files.map((f) => selected.has(f.id) ? { ...f, imported: true } : f) } : l));
      setSelected(new Set());
      if (!errors.length) onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProgress(null);
    }
  };

  const busy = open_.isPending || !!progress;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !progress && onClose()}>
      <DialogContent className="max-w-4xl w-[min(96vw,64rem)] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-border space-y-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0"><FolderOpen className="size-5" /></div>
            <div className="min-w-0">
              <DialogTitle className="text-base">Importar do Google Drive</DialogTitle>
              <p className="text-xs text-muted-foreground">O arquivo continua no Drive. Aqui fica só a miniatura, e a Meta baixa direto de lá ao publicar.</p>
            </div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); openRoot(); }} className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Cole o link da pasta do Drive"
              disabled={busy}
              className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50"
            />
            <button type="submit" disabled={busy || !link.trim()} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
              {open_.isPending && stack.length === 0 ? <Loader2 className="size-3.5 animate-spin" /> : null} Abrir
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-[280px]">
          {!current && !open_.isPending && (
            <div className="h-full grid place-items-center text-center py-10">
              <div className="max-w-sm space-y-2">
                <Info className="size-6 text-muted-foreground mx-auto" />
                <p className="text-sm font-medium">A pasta precisa estar compartilhada como "Qualquer pessoa com o link"</p>
                <p className="text-xs text-muted-foreground">No Drive: botão direito na pasta › Compartilhar › Acesso geral › Qualquer pessoa com o link (Leitor) › Copiar link.</p>
              </div>
            </div>
          )}
          {open_.isPending && <div className="py-16 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}

          {current && !open_.isPending && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-sm min-w-0">
                {stack.length > 1 && (
                  <button onClick={back} disabled={busy} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground shrink-0" title="Voltar">
                    <ArrowLeft className="size-4" />
                  </button>
                )}
                {stack.map((l, i) => (
                  <span key={l.folder.id} className="flex items-center gap-1.5 min-w-0">
                    {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />}
                    <span className={cn("truncate", i === stack.length - 1 ? "font-medium" : "text-muted-foreground")}>{l.folder.name}</span>
                  </span>
                ))}
              </div>

              {current.folders.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {current.folders.map((f) => (
                    <button key={f.id} onClick={() => openFolder(f.id)} disabled={busy} className="h-8 px-2.5 rounded-lg border border-border bg-background text-xs font-medium inline-flex items-center gap-1.5 hover:border-primary/40 hover:bg-primary/5">
                      <Folder className="size-3.5 text-muted-foreground" /> {f.name}
                    </button>
                  ))}
                </div>
              )}

              {current.files.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  Nenhum vídeo ou imagem nesta pasta{current.folders.length ? " — abra uma das subpastas acima" : ""}.
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                  {current.files.map((f) => <FileTile key={f.id} f={f} on={selected.has(f.id)} onClick={() => !f.imported && !busy && toggle(f.id)} />)}
                </div>
              )}
              {current.others > 0 && <p className="text-xs text-muted-foreground">{current.others} arquivo(s) que não são vídeo nem imagem foram ignorados.</p>}
            </div>
          )}
        </div>

        {current && (
          <div className="px-5 py-3 border-t border-border flex items-center gap-3 bg-background/40">
            {available.length > 0 && (
              <button onClick={() => setSelected(allMarked ? new Set() : new Set(available.map((f) => f.id)))} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground">
                {allMarked ? "Desmarcar todos" : `Marcar todos (${available.length})`}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {progress && <span className="text-xs text-muted-foreground">Importando {progress.done} de {progress.total}…</span>}
              <button onClick={onClose} disabled={!!progress} className="h-9 px-4 rounded-lg text-sm hover:bg-muted disabled:opacity-50">Fechar</button>
              <button onClick={runImport} disabled={!selected.size || busy} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
                {progress && <Loader2 className="size-3.5 animate-spin" />}
                Importar {selected.size || ""}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileTile({ f, on, onClick }: { f: DriveEntry; on: boolean; onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={f.imported ? "Já importado neste produto" : f.name}
      className={cn(
        "text-left rounded-xl border overflow-hidden bg-background transition-all",
        f.imported ? "opacity-55 cursor-default border-border" : on ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/40",
      )}
    >
      <div className="relative aspect-[9/16] bg-muted/50">
        {!broken ? (
          <img src={f.thumb} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">{f.kind === "video" ? <Film className="size-6" /> : <ImageIcon className="size-6" />}</div>
        )}
        {!f.imported && (
          <span className={cn("absolute top-1.5 left-1.5 size-5 rounded-md border grid place-items-center", on ? "bg-primary border-primary text-primary-foreground" : "border-white/80 bg-black/25")}>
            {on && <Check className="size-3" />}
          </span>
        )}
        {f.imported && <span className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white font-medium">Já importado</span>}
        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white font-medium">
          {f.kind === "video" ? <Film className="size-2.5" /> : <ImageIcon className="size-2.5" />}
          {f.kind === "video" ? fmtDur(f.duration) || "Vídeo" : "Imagem"}
        </span>
      </div>
      <div className="px-2 py-1.5">
        <div className="text-xs font-medium truncate">{f.name}</div>
        <div className="text-[11px] text-muted-foreground">{fmtSize(f.size)}</div>
      </div>
    </button>
  );
}

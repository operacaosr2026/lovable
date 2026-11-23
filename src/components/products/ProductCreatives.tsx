import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, X, Upload, Film, ImageIcon, Copy, List, Download, Check, FolderOpen, ExternalLink, Columns3, MoreVertical, Maximize2, Minimize2 } from "lucide-react";
import { listCreatives, updateCreative, deleteCreative, duplicateCreative, createCreative } from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";
import { upscaleCreative } from "@/lib/creative-media";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DriveImportDialog } from "@/components/products/DriveImport";
import { TrafficBoard } from "@/components/products/TrafficBoard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

async function uploadCreativeMedia(productId: string, original: File, onProgress?: (p: number) => void) {
  const { file, failed } = await upscaleCreative(original, onProgress);
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Não autenticado");
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${u.user.id}/products/${productId}/creatives/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from("project-attachments").upload(path, file);
  if (error) throw error;
  const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  return {
    media_url: signed?.signedUrl ?? null,
    media_path: path,
    media_kind: (file.type.startsWith("video/") ? "video" : "image") as "video" | "image",
    upscaleFailed: !!failed,
  };
}

const uploadErrorMessage = (e: any) => `Erro ao enviar: ${e.message}${e.status ? ` (status ${e.status}${e.statusCode ? `, ${e.statusCode}` : ""})` : ""}`;

// URL assinada com Content-Disposition: attachment — o navegador baixa direto, sem carregar o vídeo na memória.
// Do Drive: link público de download do próprio Drive.
async function downloadCreatives(creatives: any[]) {
  const withMedia = creatives.filter((c) => c.media_path || c.drive_file_id);
  for (const [i, c] of withMedia.entries()) {
    if (!c.media_path) {
      const a = document.createElement("a");
      a.href = `https://drive.usercontent.google.com/download?id=${c.drive_file_id}&export=download&confirm=t`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (i < withMedia.length - 1) await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    const ext = c.media_path.match(/\.[^./]+$/)?.[0] ?? (c.media_kind === "video" ? ".mp4" : ".jpg");
    const filename = `${creativeName(c).replace(/[\\/:*?"<>|]+/g, "_")}${ext}`;
    const { data, error } = await supabase.storage.from("project-attachments").createSignedUrl(c.media_path, 300, { download: filename });
    if (error || !data) throw error ?? new Error("Falha ao gerar link de download");
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (i < withMedia.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
}

export function ProductCreatives({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listCreatives);
  const createFn = useServerFn(createCreative);
  const updateFn = useServerFn(updateCreative);
  const deleteFn = useServerFn(deleteCreative);
  const duplicateFn = useServerFn(duplicateCreative);
  const confirm = useConfirm();

  const [view, setView] = useState<"esteira" | "lista">("esteira");
  // Esteira: fechado = só o nome; expandido = miniatura grande. Lembra a escolha.
  const [expanded, setExpanded] = useState(() => typeof window !== "undefined" && localStorage.getItem("creatives-board-expanded") === "1");
  const toggleExpanded = () => setExpanded((v) => { localStorage.setItem("creatives-board-expanded", v ? "0" : "1"); return !v; });
  const [editing, setEditing] = useState<any | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState<{ current: number; total: number; progress: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({ queryKey: ["creatives", productId], queryFn: () => list({ data: { product_id: productId } }) });
  const items = (data?.creatives ?? []) as any[];
  const boardItems = useMemo(() => items.map((c) => ({ ...c, column_id: c.board_column_id ?? null, position: c.board_position ?? 0 })), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const selecting = selected.size > 0;
  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));

  const refresh = () => qc.invalidateQueries({ queryKey: ["creatives", productId] });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });
  const duplicate = useMutation({ mutationFn: (id: string) => duplicateFn({ data: { id } }), onSuccess: refresh });

  const askDelete = (id: string) => {
    confirm("Excluir criativo?").then((ok) => {
      if (!ok) return;
      remove.mutate(id);
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    });
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((c) => c.id)));

  const download = async (creatives: any[]) => {
    setDownloading(true);
    try {
      await downloadCreatives(creatives);
    } catch (e: any) {
      console.error("Erro ao baixar criativos", e);
      alert(`Erro ao baixar: ${e.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/"));
    if (!arr.length) return;
    const failed: string[] = [];
    let ok = false;
    try {
      for (const [i, file] of arr.entries()) {
        setUploading({ current: i + 1, total: arr.length, progress: 0 });
        const { upscaleFailed, ...media } = await uploadCreativeMedia(productId, file, (progress) => setUploading({ current: i + 1, total: arr.length, progress }));
        if (upscaleFailed) failed.push(file.name);
        await createFn({ data: { product_id: productId, name: file.name.replace(/\.[^.]+$/, ""), ...media } });
        refresh();
      }
      ok = true;
      if (failed.length) alert(`Não deu pra converter para 1080 (subiu o original):\n${failed.join("\n")}`);
    } catch (e: any) {
      console.error("Erro ao enviar criativo do produto", e);
      alert(uploadErrorMessage(e));
    } finally {
      setUploading(null);
      if (ok) setShowUpload(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toolbarBtn = "h-8 px-3 rounded-lg border border-border bg-surface text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button onClick={toggleAll} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <Checkbox checked={allSelected} />
              {selecting ? `${selected.size} de ${items.length} selecionado(s)` : `${items.length} criativo(s)`}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selecting ? (
            <>
              <button onClick={() => setSelected(new Set())} className="h-8 px-3 rounded-lg text-xs font-medium hover:bg-muted">Limpar</button>
              <button disabled={downloading} onClick={() => download(items.filter((c) => selected.has(c.id)))} className={toolbarBtn}>
                <Download className="size-3.5" /> {downloading ? "Baixando..." : `Baixar selecionados (${selected.size})`}
              </button>
            </>
          ) : items.length > 0 && (
            <button disabled={downloading} onClick={() => download(items)} className={toolbarBtn}>
              <Download className="size-3.5" /> {downloading ? "Baixando..." : "Baixar todos"}
            </button>
          )}
          {view === "esteira" && items.length > 0 && (
            <button onClick={toggleExpanded} className={`${toolbarBtn} ${expanded ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : ""}`} title={expanded ? "Mostrar só os nomes" : "Mostrar as miniaturas"}>
              {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />} {expanded ? "Recolher" : "Expandir"}
            </button>
          )}
          <button onClick={() => setShowDrive(true)} className={toolbarBtn}>
            <FolderOpen className="size-3.5" /> Importar do Drive
          </button>
          <button onClick={() => setShowUpload(true)} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5">
            <Plus className="size-3.5" /> Criativo
          </button>
          <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
            <button onClick={() => setView("esteira")} className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${view === "esteira" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Columns3 className="size-3.5" /> Esteira
            </button>
            <button onClick={() => setView("lista")} className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${view === "lista" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <List className="size-3.5" /> Lista
            </button>
          </div>
        </div>
      </div>

      {showUpload && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!uploading) handleFiles(e.dataTransfer.files); }}
          onClick={() => !uploading && fileRef.current?.click()}
          className={`relative rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
        >
          {!uploading && (
            <button onClick={(e) => { e.stopPropagation(); setShowUpload(false); }} title="Fechar" className="absolute top-2 right-2 size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
          )}
          <Upload className="size-8 text-muted-foreground mx-auto mb-2" />
          <div className="text-sm font-medium">{uploading
            ? `${uploading.progress > 0 && uploading.progress < 1 ? `Convertendo para 1080 · ${Math.round(uploading.progress * 100)}%` : "Enviando"} · ${uploading.current} de ${uploading.total}`
            : "Arraste vídeos ou imagens aqui ou clique para selecionar"}</div>
          <div className="text-xs text-muted-foreground mt-1">Múltiplos arquivos · MP4, MOV, JPG, PNG, WEBP · abaixo de 1080 de largura é ampliado automaticamente</div>
          <input ref={fileRef} type="file" accept="video/*,image/*" multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} className="hidden" />
        </div>
      )}

      {view === "esteira" ? (
        <TrafficBoard
          board="creatives"
          items={boardItems}
          onMoved={refresh}
          addLabel="Adicionar criativo"
          emptyText="Arraste um criativo para cá."
          columnSubtitle={(n) => `${n} criativo(s)`}
          renderCard={(c, { tone, dragging }) => (
            <CreativeBoardCard
              expanded={expanded}
              c={c} stripe={tone.stripe} dragging={dragging} selected={selected.has(c.id)}
              onClick={() => (selecting ? toggle(c.id) : setEditing(c))} onToggle={() => toggle(c.id)}
              onDownload={() => download([c])} onDuplicate={() => duplicate.mutate(c.id)} onDelete={() => askDelete(c.id)}
            />
          )}
        />
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground"><Film className="size-8 mx-auto mb-2 opacity-50" /> Nenhum criativo ainda.</div>
      ) : (
        <div className="rounded-2xl border border-border bg-card soft-shadow-sm divide-y divide-border overflow-hidden">
          {items.map((c) => (
            <CreativeRow
              key={c.id} c={c} selected={selected.has(c.id)}
              onClick={() => (selecting ? toggle(c.id) : setEditing(c))} onToggle={() => toggle(c.id)}
              onDownload={() => download([c])} onDuplicate={() => duplicate.mutate(c.id)} onDelete={() => askDelete(c.id)}
            />
          ))}
        </div>
      )}

      {showDrive && <DriveImportDialog productId={productId} open={showDrive} onClose={() => setShowDrive(false)} onImported={refresh} />}

      {editing && (
        <CreativeEditor
          creative={editing}
          productId={productId}
          onClose={() => setEditing(null)}
          onSave={async (id: string, patch: any) => { await update.mutateAsync({ id, patch }); setEditing(null); }}
          onDelete={async () => { await remove.mutateAsync(editing.id); setEditing(null); }}
        />
      )}
    </div>
  );
}

function creativeName(c: any) {
  const titles: string[] = Array.isArray(c.titles) ? c.titles : [];
  return c.name || titles[0] || c.title || "Sem nome";
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span className={`size-4 rounded border grid place-items-center shrink-0 ${checked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/50 bg-background"}`}>
      {checked && <Check className="size-3" />}
    </span>
  );
}

// Criativo do Drive: só a miniatura (o vídeo fica no Drive).
function MediaThumb({ c, className }: { c: any; className: string }) {
  if (!c.media_path && c.drive_file_id) {
    return c.thumb_url
      ? <img src={c.thumb_url} alt={creativeName(c)} className={`${className} object-cover`} />
      : <div className={`${className} bg-muted/40 grid place-items-center`}><Film className="size-6 text-muted-foreground" /></div>;
  }
  if (!c.media_url) return <div className={`${className} bg-muted/40 grid place-items-center`}><Film className="size-6 text-muted-foreground" /></div>;
  return c.media_kind === "video"
    ? <video src={`${c.media_url}#t=0.1`} preload="metadata" muted playsInline className={`${className} object-cover bg-black`} />
    : <img src={c.media_url} alt={creativeName(c)} className={`${className} object-cover`} />;
}

// Card da esteira: miniatura em pé + nome + selos. Clique abre o criativo.
// Card da esteira. Fechado: só o nome (com ícone de vídeo/imagem e Drive).
// Expandido: miniatura pequena ao lado do nome, selos e data. Clique abre o criativo.
function CreativeBoardCard({ c, expanded, stripe, dragging, selected, onClick, onToggle, onDownload, onDuplicate, onDelete }: any) {
  const kindIcon = c.media_kind === "video" ? <Film className="size-3.5" /> : c.media_kind === "image" ? <ImageIcon className="size-3.5" /> : null;
  const fromDrive = c.drive_file_id && !c.media_path;

  const select = !dragging && (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title="Selecionar"
      className={`shrink-0 transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
    >
      <Checkbox checked={selected} />
    </button>
  );

  const menu = !dragging && (
    <div className="shrink-0 -mr-1" onPointerDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button onClick={(e) => e.stopPropagation()} title="Mais opções" className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
            <MoreVertical className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {(c.media_path || c.drive_file_id) && <DropdownMenuItem onSelect={onDownload}><Download className="size-3.5" /> Baixar</DropdownMenuItem>}
          <DropdownMenuItem onSelect={onDuplicate}><Copy className="size-3.5" /> Duplicar</DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="size-3.5" /> Excluir</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const frame = `group rounded-xl bg-card border border-l-4 ${stripe} shadow-sm hover:shadow-md transition-shadow ${selected ? "border-primary ring-2 ring-primary/30" : "border-border"} ${dragging ? "shadow-xl" : ""}`;

  if (!expanded) {
    return (
      <div onClick={dragging ? undefined : onClick} className={`${frame} flex items-center gap-2 px-2.5 py-2`}>
        {select}
        <span className="text-muted-foreground shrink-0" title={c.media_kind === "video" ? "Vídeo" : "Imagem"}>{kindIcon}</span>
        <span className="flex-1 min-w-0 text-sm font-medium truncate" title={creativeName(c)}>{creativeName(c)}</span>
        {fromDrive && <span title="Do Google Drive"><FolderOpen className="size-3.5 text-muted-foreground shrink-0" /></span>}
        {menu}
      </div>
    );
  }

  return (
    <div onClick={dragging ? undefined : onClick} className={`${frame} p-2`}>
      <div className="flex gap-2.5">
        <div className="relative w-14 aspect-[9/16] rounded-lg overflow-hidden bg-muted/40 shrink-0">
          <MediaThumb c={c} className="absolute inset-0 w-full h-full" />
          {!dragging && <div className="absolute top-1 left-1 p-0.5 rounded bg-background/90">{select}</div>}
        </div>
        <div className="flex-1 min-w-0 py-0.5">
          <div className="text-sm font-semibold leading-tight line-clamp-2 break-words">{creativeName(c)}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
              {c.media_kind === "video" ? <><Film className="size-2.5" /> Vídeo</> : c.media_kind === "image" ? <><ImageIcon className="size-2.5" /> Imagem</> : "Sem mídia"}
            </span>
            {fromDrive && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium"><FolderOpen className="size-2.5" /> Drive</span>}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">{new Date(c.created_at).toLocaleDateString("pt-BR")}</div>
        </div>
        {menu}
      </div>
    </div>
  );
}

function CreativeRow({ c, selected, onClick, onToggle, onDownload, onDuplicate, onDelete }: any) {
  const titles: string[] = Array.isArray(c.titles) ? c.titles : [];
  const descriptions: string[] = Array.isArray(c.descriptions) ? c.descriptions : [];
  return (
    <div onClick={onClick} className={`group flex items-center gap-3 px-3 py-2 cursor-pointer ${selected ? "bg-primary/5" : "hover:bg-muted/30"}`}>
      <button onClick={(e) => { e.stopPropagation(); onToggle(); }} title="Selecionar" className="p-1 -m-1">
        <Checkbox checked={selected} />
      </button>
      <div className="relative size-12 rounded-lg overflow-hidden border border-border shrink-0">
        <MediaThumb c={c} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{creativeName(c)}</div>
        <div className="text-xs text-muted-foreground">
          {c.media_kind === "video" ? "Vídeo" : c.media_kind === "image" ? "Imagem" : "Sem mídia"}{c.drive_file_id && !c.media_path ? " do Drive" : ""}
        </div>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums shrink-0 hidden sm:block">{new Date(c.created_at).toLocaleDateString("pt-BR")}</div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100">
        {(c.media_path || c.drive_file_id) && <button onClick={(e) => { e.stopPropagation(); onDownload(); }} title="Baixar" className="size-7 rounded-md hover:bg-muted grid place-items-center text-muted-foreground"><Download className="size-3.5" /></button>}
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplicar" className="size-7 rounded-md hover:bg-muted grid place-items-center text-muted-foreground"><Copy className="size-3.5" /></button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Excluir" className="size-7 rounded-md hover:bg-muted grid place-items-center text-destructive"><Trash2 className="size-3.5" /></button>
      </div>
    </div>
  );
}

function CreativeEditor({ creative, productId, onClose, onSave, onDelete }: any) {
  const [name, setName] = useState<string>(creative?.name ?? "");
  const [mediaUrl, setMediaUrl] = useState(creative?.media_url ?? "");
  const [mediaPath, setMediaPath] = useState(creative?.media_path ?? "");
  const [mediaKind, setMediaKind] = useState<"video" | "image" | null>(creative?.media_kind ?? null);
  // Do Drive enquanto não trocar a mídia por um upload.
  const [fromDrive, setFromDrive] = useState<boolean>(!!creative?.drive_file_id && !creative?.media_path);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEscapeToClose(onClose);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const media = await uploadCreativeMedia(productId, file);
      if (media.upscaleFailed) alert("Não deu pra converter para 1080 — subiu o arquivo original.");
      setMediaUrl(media.media_url ?? "");
      setMediaPath(media.media_path);
      setMediaKind(media.media_kind);
      setFromDrive(false);
    } catch (err: any) {
      console.error("Erro ao enviar criativo do produto", err);
      alert(uploadErrorMessage(err));
    } finally { setUploading(false); }
  };

  const submit = async () => {
    const cardName = name.trim() || "Sem nome";
    const payload = {
      name: cardName,
      media_url: mediaUrl || null,
      media_path: mediaPath || null,
      media_kind: mediaKind,
      ...(creative?.drive_file_id && !fromDrive ? { drive_file_id: null, drive_url: null, thumb_url: null, thumb_path: null } : {}),
    };
    await onSave(creative.id, payload);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-popover z-10">
          <div className="text-base font-semibold">Editar criativo</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="relative aspect-video rounded-xl bg-muted grid place-items-center overflow-hidden border border-border">
            {fromDrive ? (
              <>
                {creative.thumb_url ? <img src={creative.thumb_url} alt="" className="w-full h-full object-contain" /> : <Film className="size-10 text-muted-foreground" />}
                <a href={creative.drive_url} target="_blank" rel="noopener noreferrer" className="absolute bottom-2 right-2 h-7 px-2.5 rounded-md bg-background/95 text-xs font-medium inline-flex items-center gap-1.5 shadow-sm hover:bg-background">
                  <FolderOpen className="size-3" /> Abrir no Drive <ExternalLink className="size-3" />
                </a>
              </>
            ) : mediaUrl ? (
              mediaKind === "video" ? <video src={mediaUrl} className="w-full h-full object-cover" controls /> : <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="text-center"><ImageIcon className="size-10 text-muted-foreground mx-auto mb-1" /><div className="text-xs text-muted-foreground">Sem mídia</div></div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="video/*,image/*" onChange={onPick} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full h-9 rounded-lg border border-border bg-surface text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Upload className="size-3.5" /> {uploading ? "Convertendo e enviando..." : fromDrive ? "Trocar por um arquivo do computador" : "Vídeo ou imagem"}
          </button>

          <div>
            <div className="text-xs text-muted-foreground font-medium mb-1.5">Nome do card</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Criativo VSL principal" className="w-full px-3 h-9 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50" />
          </div>

          <p className="text-xs text-muted-foreground">Títulos e descrições ficam na aba <strong className="text-foreground font-medium">Títulos e Descrições</strong>. Na hora de lançar você escolhe quais vão com este criativo.</p>
        </div>
        <div className="flex justify-between items-center px-5 py-3 border-t border-border sticky bottom-0 bg-popover">
          {onDelete ? <button onClick={onDelete} className="text-sm text-destructive hover:underline">Excluir</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
            <button onClick={submit} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

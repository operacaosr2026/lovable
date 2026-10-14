import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, X, Upload, Film, ImageIcon, Copy, LayoutGrid, List, Download, Check } from "lucide-react";
import { listCreatives, updateCreative, deleteCreative, duplicateCreative, createCreative } from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";
import { upscaleCreative } from "@/lib/creative-media";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
async function downloadCreatives(creatives: any[]) {
  const withMedia = creatives.filter((c) => c.media_path);
  for (const [i, c] of withMedia.entries()) {
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

  const [view, setView] = useState<"grade" | "lista">("grade");
  const [editing, setEditing] = useState<any | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState<{ current: number; total: number; progress: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({ queryKey: ["creatives", productId], queryFn: () => list({ data: { product_id: productId } }) });
  const items = (data?.creatives ?? []) as any[];
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
          <button onClick={() => setShowUpload(true)} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium inline-flex items-center gap-1.5">
            <Plus className="size-3.5" /> Criativo
          </button>
          <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
            <button onClick={() => setView("grade")} className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${view === "grade" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutGrid className="size-3.5" /> Grade
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

      {items.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground"><Film className="size-8 mx-auto mb-2 opacity-50" /> Nenhum criativo ainda.</div>
      ) : view === "grade" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {items.map((c) => (
            <CreativeCard
              key={c.id} c={c} selected={selected.has(c.id)} selecting={selecting}
              onClick={() => (selecting ? toggle(c.id) : setEditing(c))} onToggle={() => toggle(c.id)}
              onDownload={() => download([c])} onDuplicate={() => duplicate.mutate(c.id)} onDelete={() => askDelete(c.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface divide-y divide-border overflow-hidden">
          {items.map((c) => (
            <CreativeRow
              key={c.id} c={c} selected={selected.has(c.id)}
              onClick={() => (selecting ? toggle(c.id) : setEditing(c))} onToggle={() => toggle(c.id)}
              onDownload={() => download([c])} onDuplicate={() => duplicate.mutate(c.id)} onDelete={() => askDelete(c.id)}
            />
          ))}
        </div>
      )}

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

function MediaThumb({ c, className }: { c: any; className: string }) {
  if (!c.media_url) return <div className={`${className} bg-muted/40 grid place-items-center`}><Film className="size-6 text-muted-foreground" /></div>;
  return c.media_kind === "video"
    ? <video src={`${c.media_url}#t=0.1`} preload="metadata" muted playsInline className={`${className} object-cover bg-black`} />
    : <img src={c.media_url} alt={creativeName(c)} className={`${className} object-cover`} />;
}

function CreativeCard({ c, selected, selecting, onClick, onToggle, onDownload, onDuplicate, onDelete }: any) {
  return (
    <div onClick={onClick} className={`group relative rounded-xl border bg-surface overflow-hidden cursor-pointer transition-colors ${selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/40"}`}>
      <div className="relative aspect-[9/16] bg-muted/40">
        <MediaThumb c={c} className="absolute inset-0 w-full h-full" />
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          title="Selecionar"
          className={`absolute top-1.5 left-1.5 p-1 rounded-md bg-background/90 transition-opacity ${selected || selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <Checkbox checked={selected} />
        </button>
        {c.media_kind === "video" && (
          <div className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white font-medium">
            <Film className="size-2.5" /> Vídeo
          </div>
        )}
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {c.media_path && <button onClick={(e) => { e.stopPropagation(); onDownload(); }} title="Baixar" className="size-7 rounded-md bg-background/90 grid place-items-center"><Download className="size-3" /></button>}
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplicar" className="size-7 rounded-md bg-background/90 grid place-items-center"><Copy className="size-3" /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Excluir" className="size-7 rounded-md bg-background/90 grid place-items-center text-destructive"><Trash2 className="size-3" /></button>
        </div>
      </div>
      <div className="px-2.5 py-2 text-sm font-medium truncate">{creativeName(c)}</div>
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
        <div className="text-[11px] text-muted-foreground">
          {c.media_kind === "video" ? "Vídeo" : c.media_kind === "image" ? "Imagem" : "Sem mídia"} · {titles.length} título(s) · {descriptions.length} descrição(ões)
        </div>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums shrink-0 hidden sm:block">{new Date(c.created_at).toLocaleDateString("pt-BR")}</div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100">
        {c.media_path && <button onClick={(e) => { e.stopPropagation(); onDownload(); }} title="Baixar" className="size-7 rounded-md hover:bg-muted grid place-items-center text-muted-foreground"><Download className="size-3.5" /></button>}
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplicar" className="size-7 rounded-md hover:bg-muted grid place-items-center text-muted-foreground"><Copy className="size-3.5" /></button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Excluir" className="size-7 rounded-md hover:bg-muted grid place-items-center text-destructive"><Trash2 className="size-3.5" /></button>
      </div>
    </div>
  );
}

function CreativeEditor({ creative, productId, onClose, onSave, onDelete }: any) {
  const initialTitles: string[] = (() => {
    if (Array.isArray(creative?.titles) && creative.titles.length > 0) return creative.titles;
    if (creative?.title) return [creative.title];
    return [];
  })();
  const initialDescriptions: string[] = (() => {
    if (Array.isArray(creative?.descriptions) && creative.descriptions.length > 0) return creative.descriptions;
    if (creative?.description) return [creative.description];
    return [];
  })();
  const [name, setName] = useState<string>(creative?.name ?? "");
  const [titles, setTitles] = useState<string[]>(initialTitles);
  const [descriptions, setDescriptions] = useState<string[]>(initialDescriptions);
  const [mediaUrl, setMediaUrl] = useState(creative?.media_url ?? "");
  const [mediaPath, setMediaPath] = useState(creative?.media_path ?? "");
  const [mediaKind, setMediaKind] = useState<"video" | "image" | null>(creative?.media_kind ?? null);
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
    } catch (err: any) {
      console.error("Erro ao enviar criativo do produto", err);
      alert(uploadErrorMessage(err));
    } finally { setUploading(false); }
  };

  const submit = async () => {
    const cleanTitles = titles.map((t) => (t ?? "").trim()).filter(Boolean);
    const cleanDescs = descriptions.map((d) => (d ?? "").trim()).filter(Boolean);
    const cardName = name.trim() || cleanTitles[0] || "Sem nome";
    const payload = {
      name: cardName,
      title: cleanTitles[0] ?? "",
      description: cleanDescs[0] ?? null,
      titles: cleanTitles,
      descriptions: cleanDescs,
      media_url: mediaUrl || null,
      media_path: mediaPath || null,
      media_kind: mediaKind,
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
          <div className="aspect-video rounded-xl bg-muted grid place-items-center overflow-hidden border border-border">
            {mediaUrl ? (
              mediaKind === "video" ? <video src={mediaUrl} className="w-full h-full object-cover" controls /> : <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="text-center"><ImageIcon className="size-10 text-muted-foreground mx-auto mb-1" /><div className="text-xs text-muted-foreground">Sem mídia</div></div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="video/*,image/*" onChange={onPick} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full h-9 rounded-lg border border-border bg-surface text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Upload className="size-3.5" /> {uploading ? "Convertendo e enviando..." : "Vídeo ou imagem"}
          </button>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Nome do card</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Criativo VSL principal" className="w-full px-3 h-9 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50" />
          </div>

          <ListField
            label="Títulos"
            placeholder="Novo título"
            values={titles}
            setValues={setTitles}
          />

          <ListField
            label="Descrições"
            placeholder="Nova descrição"
            values={descriptions}
            setValues={setDescriptions}
            multiline
          />
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

function ListField({ label, placeholder, values, setValues, multiline }: { label: string; placeholder: string; values: string[]; setValues: (v: string[]) => void; multiline?: boolean }) {
  const update = (i: number, v: string) => setValues(values.map((x, idx) => (idx === i ? v : x)));
  const remove = (i: number) => setValues(values.filter((_, idx) => idx !== i));
  const add = () => setValues([...values, ""]);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
        <span className="text-[10px] text-muted-foreground tabular-nums">{values.length}</span>
      </div>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex gap-1.5 items-start">
            {multiline ? (
              <textarea value={v} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} rows={2} className="flex-1 px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none resize-none" />
            ) : (
              <input value={v} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} className="flex-1 px-3 h-9 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50" />
            )}
            <button onClick={() => remove(i)} className="mt-1 text-muted-foreground hover:text-destructive shrink-0"><X className="size-3.5" /></button>
          </div>
        ))}
        <button onClick={add} className="w-full text-xs text-muted-foreground py-2 hover:text-foreground rounded-lg border border-dashed border-border inline-flex items-center justify-center gap-1">
          <Plus className="size-3.5" /> Adicionar {label.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    </div>
  );
}

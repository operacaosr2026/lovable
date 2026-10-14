import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Star, Trash2, ImageIcon, Film } from "lucide-react";
import { listProductImages, addProductImage, setMainImage, deleteProductImage } from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isVideoMime } from "@/lib/product-page";

export function ProductImages({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProductImages);
  const addFn = useServerFn(addProductImage);
  const setMainFn = useServerFn(setMainImage);
  const deleteFn = useServerFn(deleteProductImage);
  const confirm = useConfirm();

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const { data } = useQuery({ queryKey: ["product-images", productId], queryFn: () => list({ data: { product_id: productId } }) });
  const images = (data?.images ?? []) as any[];

  const refresh = () => qc.invalidateQueries({ queryKey: ["product-images", productId] });
  const setMain = useMutation({ mutationFn: (id: string) => setMainFn({ data: { id } }), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["product", productId] }); } });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["product", productId] }); } });

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!arr.length) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      for (const file of arr) {
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${u.user.id}/products/${productId}/${Date.now()}_${safe}`;
        const { error } = await supabase.storage.from("project-attachments").upload(path, file);
        if (error) throw error;
        const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        await addFn({ data: {
          product_id: productId,
          file_path: path,
          file_url: signed?.signedUrl ?? null,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        } });
      }
      refresh();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product", productId] });
    } catch (e: any) {
      console.error("Erro ao enviar imagem do produto", e);
      alert(`Erro ao enviar: ${e.message}${e.status ? ` (status ${e.status}${e.statusCode ? `, ${e.statusCode}` : ""})` : ""}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
      >
        <Upload className="size-8 text-muted-foreground mx-auto mb-2" />
        <div className="text-sm font-medium">{uploading ? "Enviando..." : "Arraste imagens ou vídeos aqui ou clique para selecionar"}</div>
        <div className="text-xs text-muted-foreground mt-1">Múltiplos arquivos · JPG, PNG, WEBP, MP4 · vídeos vão pro carrossel da Página</div>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} className="hidden" />
      </div>

      {images.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground"><ImageIcon className="size-8 mx-auto mb-2 opacity-50" /> Nenhuma imagem ainda.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {images.map((img) => (
            <div key={img.id} className="group relative rounded-xl border border-border bg-surface overflow-hidden aspect-square">
              {img.file_url && (isVideoMime(img.mime_type)
                ? <video src={`${img.file_url}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover bg-black" />
                : <img src={img.file_url} alt={img.file_name ?? ""} className="w-full h-full object-cover" />)}
              {isVideoMime(img.mime_type) && (
                <div className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white font-medium">
                  <Film className="size-2.5" /> Vídeo
                </div>
              )}
              {img.is_main && (
                <div className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-medium">
                  <Star className="size-2.5 fill-current" /> Principal
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 p-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/70 to-transparent">
                {!img.is_main && !isVideoMime(img.mime_type) && (
                  <button onClick={() => setMain.mutate(img.id)} className="flex-1 h-7 rounded-md bg-background/90 text-xs font-medium inline-flex items-center justify-center gap-1">
                    <Star className="size-3" /> Principal
                  </button>
                )}
                <button onClick={() => { confirm(isVideoMime(img.mime_type) ? "Excluir vídeo?" : "Excluir imagem?").then((ok) => { if (ok) remove.mutate(img.id); }); }} className="size-7 rounded-md bg-background/90 grid place-items-center text-destructive">
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

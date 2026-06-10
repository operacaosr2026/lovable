import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Trash2, FileText, Link2, ExternalLink } from "lucide-react";
import { listProductTemplates, addProductTemplate, deleteProductTemplate } from "@/lib/products.functions";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function ProductTemplates({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProductTemplates);
  const addFn = useServerFn(addProductTemplate);
  const deleteFn = useServerFn(deleteProductTemplate);
  const confirm = useConfirm();

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pageflyUrl, setPageflyUrl] = useState("");
  const [notes, setNotes] = useState("");

  const { data } = useQuery({ queryKey: ["product-templates", productId], queryFn: () => list({ data: { product_id: productId } }) });
  const templates = (data?.templates ?? []) as any[];

  const refresh = () => qc.invalidateQueries({ queryKey: ["product-templates", productId] });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });

  const detectKind = (name: string): "zip" | "html" | "json" | "file" => {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "zip") return "zip";
    if (ext === "html" || ext === "htm") return "html";
    if (ext === "json") return "json";
    return "file";
  };

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      for (const file of arr) {
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${u.user.id}/products/${productId}/templates/${Date.now()}_${safe}`;
        const { error } = await supabase.storage.from("project-attachments").upload(path, file);
        if (error) throw error;
        const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        await addFn({ data: {
          product_id: productId,
          kind: detectKind(file.name),
          file_path: path,
          file_url: signed?.signedUrl ?? null,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        } });
      }
      refresh();
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveLink = async () => {
    const url = pageflyUrl.trim();
    if (!url) return;
    await addFn({ data: { product_id: productId, kind: "link", pagefly_url: url, notes: notes.trim() || null } });
    setPageflyUrl(""); setNotes(""); refresh();
  };

  return (
    <div className="space-y-4">
      <div
        onClick={() => fileRef.current?.click()}
        className="rounded-2xl border-2 border-dashed border-border p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
      >
        <Upload className="size-7 text-muted-foreground mx-auto mb-2" />
        <div className="text-sm font-medium">{uploading ? "Enviando..." : "Upload de template (ZIP, HTML, JSON)"}</div>
        <input ref={fileRef} type="file" accept=".zip,.html,.htm,.json,application/zip,text/html,application/json" multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} className="hidden" />
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5"><Link2 className="size-3" /> Link PageFly (opcional)</div>
        <div className="flex gap-2">
          <input value={pageflyUrl} onChange={(e) => setPageflyUrl(e.target.value)} placeholder="https://pagefly.io/..." className="flex-1 px-3 h-9 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary/50" />
          <button onClick={saveLink} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional)" className="w-full px-3 h-9 rounded-lg bg-background border border-border text-sm outline-none" />
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Nenhum template ainda.</div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface">
              <div className="size-9 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                {t.kind === "link" ? <Link2 className="size-4" /> : <FileText className="size-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t.file_name ?? t.pagefly_url ?? "Template"}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{t.kind}{t.notes ? ` · ${t.notes}` : ""}</div>
              </div>
              {(t.file_url || t.pagefly_url) && (
                <a href={t.file_url ?? t.pagefly_url} target="_blank" rel="noreferrer" className="size-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
                  <ExternalLink className="size-4" />
                </a>
              )}
              <button onClick={() => { confirm("Excluir template?").then((ok) => { if (ok) remove.mutate(t.id); }); }} className="size-8 rounded-md grid place-items-center text-muted-foreground hover:text-destructive hover:bg-muted">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

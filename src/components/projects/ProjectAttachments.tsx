import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload, FileText, Trash2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listProjectAttachments, registerProjectAttachment, deleteProjectAttachment,
} from "@/lib/project-attachments.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function ProjectAttachments({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProjectAttachments);
  const registerFn = useServerFn(registerProjectAttachment);
  const deleteFn = useServerFn(deleteProjectAttachment);
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data } = useQuery({
    queryKey: ["project-attachments", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const files = data?.attachments ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ["project-attachments", projectId] });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${u.user.id}/${projectId}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from("project-attachments").upload(path, file, { upsert: false });
      if (error) throw error;
      await registerFn({ data: {
        project_id: projectId,
        file_name: file.name,
        file_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
      }});
      refresh();
    } catch (err: any) {
      alert("Erro ao enviar: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <input ref={fileRef} type="file" onChange={onPick} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Upload className="size-4" /> {uploading ? "Enviando..." : "Enviar arquivo"}
        </button>
      </div>

      {files.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Nenhum anexo ainda.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {files.map((f: any) => (
            <div key={f.id} className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
              <div className="size-10 rounded-lg bg-muted grid place-items-center shrink-0">
                <FileText className="size-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{f.file_name}</div>
                <div className="text-[11px] text-muted-foreground">{formatSize(f.size_bytes)}</div>
              </div>
              {f.url && (
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="size-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
                  <Download className="size-4" />
                </a>
              )}
              <button onClick={() => { confirm("Remover anexo?").then((ok) => { if (ok) remove.mutate(f.id); }); }} className="size-8 rounded-md grid place-items-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

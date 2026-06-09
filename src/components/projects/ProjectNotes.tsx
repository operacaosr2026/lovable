import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { listProjectNotes, createProjectNote, deleteProjectNote } from "@/lib/project-notes.functions";

export function ProjectNotes({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProjectNotes);
  const createFn = useServerFn(createProjectNote);
  const deleteFn = useServerFn(deleteProjectNote);

  const { data } = useQuery({
    queryKey: ["project-notes", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const notes = data?.notes ?? [];

  const [content, setContent] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["project-notes", projectId] });
  const create = useMutation({
    mutationFn: (c: string) => createFn({ data: { project_id: projectId, content: c } }),
    onSuccess: () => { setContent(""); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });

  return (
    <div className="space-y-4 max-w-2xl">
      <form
        onSubmit={(e) => { e.preventDefault(); if (content.trim()) create.mutate(content.trim()); }}
        className="rounded-2xl border border-border bg-surface p-3"
      >
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Adicionar nota ou comentário..."
          rows={3}
          className="w-full bg-transparent text-sm outline-none resize-none"
        />
        <div className="flex justify-end">
          <button type="submit" disabled={!content.trim()} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            Adicionar
          </button>
        </div>
      </form>

      {notes.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">Nenhuma nota ainda.</div>
      ) : (
        <div className="space-y-2">
          {notes.map((n: any) => (
            <div key={n.id} className="group rounded-xl border border-border bg-surface p-3">
              <div className="flex items-start gap-2">
                <div className="text-sm whitespace-pre-wrap flex-1">{n.content}</div>
                <button onClick={() => remove.mutate(n.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground mt-2">
                {new Date(n.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

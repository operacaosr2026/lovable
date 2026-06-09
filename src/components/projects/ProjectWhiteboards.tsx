import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, PenTool, Star } from "lucide-react";
import { listWhiteboards, createWhiteboard } from "@/lib/whiteboards.functions";

export function ProjectWhiteboards({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listWhiteboards);
  const createFn = useServerFn(createWhiteboard);

  const { data, isLoading } = useQuery({
    queryKey: ["whiteboards", "project", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const boards: any[] = (data as any)?.boards ?? [];

  const mCreate = useMutation({
    mutationFn: () => createFn({ data: { name: "Novo mapa mental", project_id: projectId } }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["whiteboards"] });
      navigate({ to: "/whiteboard/$boardId", params: { boardId: res.board.id } });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <PenTool className="size-4 text-primary" /> Mapas mentais
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Quadros criados aqui também aparecem em <span className="text-foreground">Quadro Branco</span>.
          </p>
        </div>
        <button
          onClick={() => mCreate.mutate()}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium"
        >
          <Plus className="size-4" /> Novo mapa
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : boards.length === 0 ? (
        <button
          onClick={() => mCreate.mutate()}
          className="w-full border-2 border-dashed border-border rounded-2xl p-12 text-center hover:border-primary hover:bg-surface/40 transition-colors"
        >
          <PenTool className="size-8 mx-auto mb-2 text-muted-foreground" />
          <div className="text-sm font-medium">Crie o primeiro mapa mental deste projeto</div>
          <div className="text-xs text-muted-foreground mt-1">
            Abre um canvas livre vinculado a este projeto.
          </div>
        </button>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {boards.map((b) => (
            <Link
              key={b.id}
              to="/whiteboard/$boardId"
              params={{ boardId: b.id }}
              className="group relative aspect-[4/3] rounded-2xl border border-border bg-surface overflow-hidden hover:border-primary transition-all hover:scale-[1.02]"
            >
              <div
                className="absolute inset-0 opacity-20 group-hover:opacity-30 transition-opacity"
                style={{ background: `radial-gradient(circle at 30% 30%, ${b.color}, transparent 70%)` }}
              />
              <div className="absolute inset-0 p-4 flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <span className="size-3 rounded-full" style={{ background: b.color }} />
                  {b.is_favorite && <Star className="size-4 text-amber-400" fill="currentColor" />}
                </div>
                <div>
                  <div className="font-semibold truncate">{b.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {b.node_count} {b.node_count === 1 ? "bloco" : "blocos"}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

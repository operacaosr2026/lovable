import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, PenTool, Star, Trash2 } from "lucide-react";
import { listWhiteboards, createWhiteboard, deleteWhiteboard } from "@/lib/whiteboards.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";

export const Route = createFileRoute("/whiteboard/")({
  component: WhiteboardDashboard,
});

function WhiteboardDashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listWhiteboards);
  const createFn = useServerFn(createWhiteboard);
  const deleteFn = useServerFn(deleteWhiteboard);
  const confirm = useConfirm();

  const { data } = useQuery({ queryKey: ["whiteboards"], queryFn: () => listFn() });
  const boards: any[] = (data as any)?.boards ?? [];

  const mCreate = useMutation({
    mutationFn: (d: any) => createFn({ data: d }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["whiteboards"] });
      navigate({ to: "/whiteboard/$boardId", params: { boardId: res.board.id } });
    },
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whiteboards"] }),
  });

  const handleDelete = async (e: React.MouseEvent, board: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (!(await confirm(`Excluir o quadro "${board.name}"? Essa ação não pode ser desfeita.`))) return;
    mDelete.mutate(board.id);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PenTool className="size-6 text-primary" /> Quadro Branco
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Canvas livre para organizar ideias, mapas mentais e planejamento visual.
          </p>
        </div>
        <button
          onClick={() => mCreate.mutate({ name: "Novo quadro" })}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium"
        >
          <Plus className="size-4" /> Novo quadro
        </button>
      </div>

      {boards.length === 0 ? (
        <button
          onClick={() => mCreate.mutate({ name: "Meu primeiro quadro" })}
          className="w-full border-2 border-dashed border-border rounded-2xl p-16 text-center hover:border-primary hover:bg-surface/40 transition-colors"
        >
          <PenTool className="size-10 mx-auto mb-3 text-muted-foreground" />
          <div className="text-lg font-medium">Crie seu primeiro quadro</div>
          <div className="text-sm text-muted-foreground mt-1">
            Comece com um canvas em branco e construa do seu jeito.
          </div>
        </button>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
                  <div className="flex items-center gap-1">
                    {b.is_favorite && <Star className="size-4 text-amber-400" fill="currentColor" />}
                    <button
                      onClick={(e) => handleDelete(e, b)}
                      title="Excluir quadro"
                      className="opacity-0 group-hover:opacity-100 size-7 grid place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-surface transition-all"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
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

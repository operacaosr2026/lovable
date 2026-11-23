import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSopProcess, saveSopDiagram, updateSopProcess } from "@/lib/sops.functions";
import { FlowEditor } from "@/components/flow/FlowEditor";
import type { Diagram, Direction } from "@/components/flow/model";

export const Route = createFileRoute("/shops/sops/$processId")({
  component: SopDetail,
});

function SopDetail() {
  const { processId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getSopProcess);
  const saveFn = useServerFn(saveSopDiagram);
  const updFn = useServerFn(updateSopProcess);

  const { data, isLoading } = useQuery({
    queryKey: ["sop-process", processId],
    queryFn: () => getFn({ data: { id: processId } }),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const proc = (data as any)?.process;

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>;
  if (!proc) {
    return (
      <div className="p-8">
        <Link to="/shops/sops" className="text-sm text-primary">← Voltar</Link>
        <div className="mt-3 text-sm text-muted-foreground">Processo não encontrado.</div>
      </div>
    );
  }

  const direction: Direction = proc.layout_type === "vertical" ? "vertical" : "horizontal";

  return (
    <div className="h-[calc(100dvh-3.5rem)] md:h-dvh min-h-[480px]">
      <FlowEditor
        key={proc.id}
        name={proc.name}
        accent={proc.color}
        direction={direction}
        diagram={(proc.diagram as Diagram | null) ?? null}
        legacySteps={(data as any)?.steps ?? []}
        legacyEdges={(data as any)?.edges ?? []}
        onSave={(diagram) => saveFn({ data: { id: proc.id, diagram } })}
        onRename={(name) => {
          updFn({ data: { id: proc.id, patch: { name } } }).then(() => qc.invalidateQueries({ queryKey: ["sop-processes"] }));
        }}
        onDirectionChange={(d) => {
          qc.setQueryData(["sop-process", processId], (old: any) => (old ? { ...old, process: { ...old.process, layout_type: d } } : old));
          updFn({ data: { id: proc.id, patch: { layout_type: d } } });
        }}
        onBack={() => {
          qc.invalidateQueries({ queryKey: ["sop-processes"] });
          navigate({ to: "/shops/sops" });
        }}
      />
    </div>
  );
}

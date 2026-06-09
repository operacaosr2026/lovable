import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/PageHeader";
import { ArrowLeft, KanbanSquare, NotebookPen, Paperclip, Calendar as CalIcon, Pencil, PenTool } from "lucide-react";
import { getProject, updateProject } from "@/lib/projects.functions";
import { ProjectEditor } from "@/components/projects/ProjectEditor";
import { ProjectKanban } from "@/components/projects/ProjectKanban";
import { ProjectNotes } from "@/components/projects/ProjectNotes";
import { ProjectAttachments } from "@/components/projects/ProjectAttachments";
import { ProjectCalendar } from "@/components/projects/ProjectCalendar";
import { ProjectWhiteboards } from "@/components/projects/ProjectWhiteboards";
import { CATEGORY_META, STATUS_META, PRIORITY_META } from "@/components/projects/meta";


export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectDetail,
});

type Tab = "kanban" | "notes" | "files" | "calendar" | "mindmaps";

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getProject);
  const update = useServerFn(updateProject);
  const [tab, setTab] = useState<Tab>("kanban");
  const [editorOpen, setEditorOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => get({ data: { id: projectId } }),
  });
  const p = data?.project as any;

  const updateMut = useMutation({
    mutationFn: (patch: any) => update({ data: { id: projectId, patch } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (isLoading) {
    return <PageShell><div className="text-sm text-muted-foreground">Carregando...</div></PageShell>;
  }
  if (!p) {
    return (
      <PageShell>
        <div className="text-sm text-muted-foreground">Projeto não encontrado.</div>
        <Link to="/projects" className="text-sm text-primary mt-3 inline-block">← Voltar</Link>
      </PageShell>
    );
  }

  const cat = CATEGORY_META[p.category as keyof typeof CATEGORY_META] ?? CATEGORY_META.outros;
  const st = STATUS_META[p.status as keyof typeof STATUS_META] ?? STATUS_META.planejando;
  const prio = PRIORITY_META[p.priority as keyof typeof PRIORITY_META] ?? PRIORITY_META.media;

  return (
    <PageShell>
      <Link to="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="size-4" /> Projetos
      </Link>

      <div className="rounded-2xl border border-border bg-surface p-5 mb-5">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-xl grid place-items-center shrink-0" style={{ background: cat.tint, color: cat.accent }}>
            <cat.icon className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
              <button onClick={() => setEditorOpen(true)} className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
                <Pencil className="size-3.5" />
              </button>
            </div>
            {p.description && <p className="text-sm text-muted-foreground mt-1">{p.description}</p>}
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              <Pill bg={cat.tint} fg={cat.accent}>{cat.label}</Pill>
              <Pill bg={st.tint} fg={st.accent}>{st.label}</Pill>
              <Pill bg={prio.tint} fg={prio.accent}>Prioridade {prio.label}</Pill>
              {p.due_date && (
                <Pill bg="oklch(0.95 0.005 250)" fg="oklch(0.45 0.015 260)">
                  Prazo: {new Date(p.due_date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                </Pill>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-border overflow-x-auto">
        <TabBtn active={tab === "kanban"} onClick={() => setTab("kanban")} icon={KanbanSquare}>Tarefas</TabBtn>
        <TabBtn active={tab === "notes"} onClick={() => setTab("notes")} icon={NotebookPen}>Notas</TabBtn>
        <TabBtn active={tab === "mindmaps"} onClick={() => setTab("mindmaps")} icon={PenTool}>Mapas mentais</TabBtn>
        <TabBtn active={tab === "files"} onClick={() => setTab("files")} icon={Paperclip}>Anexos</TabBtn>
        <TabBtn active={tab === "calendar"} onClick={() => setTab("calendar")} icon={CalIcon}>Calendário</TabBtn>
      </div>

      {tab === "kanban" && <ProjectKanban projectId={projectId} />}
      {tab === "notes" && <ProjectNotes projectId={projectId} />}
      {tab === "mindmaps" && <ProjectWhiteboards projectId={projectId} />}
      {tab === "files" && <ProjectAttachments projectId={projectId} />}
      {tab === "calendar" && <ProjectCalendar projectId={projectId} />}


      {editorOpen && (
        <ProjectEditor
          project={p}
          onClose={() => setEditorOpen(false)}
          onSave={async (patch) => { await updateMut.mutateAsync(patch); setEditorOpen(false); }}
        />
      )}
    </PageShell>
  );
}

function Pill({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium" style={{ background: bg, color: fg }}>{children}</span>;
}

function TabBtn({ active, onClick, icon: Icon, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 h-9 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className="size-4" /> {children}
    </button>
  );
}

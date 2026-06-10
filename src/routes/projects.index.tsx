import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import {
  Plus, Search, Filter, MoreVertical, Calendar as CalIcon, Flame, Archive,
  Copy, Pencil, Trash2, ArchiveRestore,
} from "lucide-react";
import {
  listProjects, createProject, updateProject, deleteProject, duplicateProject,
  CATEGORIES, STATUSES, PRIORITIES,
} from "@/lib/projects.functions";
import { ProjectEditor } from "@/components/projects/ProjectEditor";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CATEGORY_META, STATUS_META, PRIORITY_META } from "@/components/projects/meta";

export const Route = createFileRoute("/projects/")({
  component: ProjectsDashboard,
});

type Project = {
  id: string; name: string; description: string | null;
  category: string; status: string; priority: string;
  due_date: string | null; color: string; archived: boolean;
  taskCount: number; doneCount: number; progress: number;
  created_at: string;
};

function ProjectsDashboard() {
  const qc = useQueryClient();
  const list = useServerFn(listProjects);
  const createFn = useServerFn(createProject);
  const updateFn = useServerFn(updateProject);
  const deleteFn = useServerFn(deleteProject);
  const dupFn = useServerFn(duplicateProject);
  const confirm = useConfirm();

  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [fCat, setFCat] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fPrio, setFPrio] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"due" | "priority" | "created">("created");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const { data } = useQuery({
    queryKey: ["projects", showArchived],
    queryFn: () => list({ data: { includeArchived: showArchived } }),
  });
  const projects = (data?.projects ?? []) as Project[];

  const filtered = useMemo(() => {
    let arr = projects.filter((p) => {
      if (fCat !== "all" && p.category !== fCat) return false;
      if (fStatus !== "all" && p.status !== fStatus) return false;
      if (fPrio !== "all" && p.priority !== fPrio) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const prioRank: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
    arr = [...arr].sort((a, b) => {
      if (sortBy === "due") {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      }
      if (sortBy === "priority") return (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9);
      return b.created_at.localeCompare(a.created_at);
    });
    return arr;
  }, [projects, fCat, fStatus, fPrio, search, sortBy]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["projects"] });

  const create = useMutation({
    mutationFn: (input: any) => createFn({ data: input }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: refresh,
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => dupFn({ data: { id } }),
    onSuccess: refresh,
  });

  return (
    <PageShell>
      <PageHeader
        title="Projetos"
        subtitle={`${filtered.length} ${filtered.length === 1 ? "projeto" : "projetos"}`}
        actions={
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Novo projeto
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface border border-border flex-1 min-w-[220px]">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar projeto..."
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
          />
        </div>
        <Select value={fCat} onChange={setFCat} options={[{ v: "all", l: "Categoria" }, ...CATEGORIES.map(c => ({ v: c, l: CATEGORY_META[c].label }))]} />
        <Select value={fStatus} onChange={setFStatus} options={[{ v: "all", l: "Status" }, ...STATUSES.map(s => ({ v: s, l: STATUS_META[s].label }))]} />
        <Select value={fPrio} onChange={setFPrio} options={[{ v: "all", l: "Prioridade" }, ...PRIORITIES.map(p => ({ v: p, l: PRIORITY_META[p].label }))]} />
        <Select value={sortBy} onChange={(v) => setSortBy(v as any)} options={[
          { v: "created", l: "Mais recentes" },
          { v: "due", l: "Prazo" },
          { v: "priority", l: "Prioridade" },
        ]} />
        <button
          onClick={() => setShowArchived(v => !v)}
          className={`h-9 px-3 rounded-lg border text-sm flex items-center gap-1.5 ${showArchived ? "bg-primary/10 border-primary/40 text-primary" : "border-border bg-surface text-muted-foreground"}`}
        >
          <Archive className="size-3.5" /> Arquivados
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">Nenhum projeto por aqui ainda.</p>
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Criar primeiro projeto
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              onEdit={() => { setEditing(p); setEditorOpen(true); }}
              onDuplicate={() => duplicate.mutate(p.id)}
              onArchive={() => update.mutate({ id: p.id, patch: { archived: !p.archived } })}
              onDelete={() => { confirm(`Excluir "${p.name}"? Essa ação remove o projeto e tudo dentro dele.`).then((ok) => { if (ok) remove.mutate(p.id); }); }}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <ProjectEditor
          project={editing}
          onClose={() => setEditorOpen(false)}
          onSave={async (patch) => {
            if (editing) await update.mutateAsync({ id: editing.id, patch });
            else await create.mutateAsync(patch);
            setEditorOpen(false);
          }}
        />
      )}
    </PageShell>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer"
    >
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function ProjectCard({ p, onEdit, onDuplicate, onArchive, onDelete }: {
  p: Project;
  onEdit: () => void; onDuplicate: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const cat = CATEGORY_META[p.category as keyof typeof CATEGORY_META] ?? CATEGORY_META.outros;
  const st = STATUS_META[p.status as keyof typeof STATUS_META] ?? STATUS_META.planejando;
  const prio = PRIORITY_META[p.priority as keyof typeof PRIORITY_META] ?? PRIORITY_META.media;

  const dueLabel = (() => {
    if (!p.due_date) return null;
    const d = new Date(p.due_date + "T00:00:00");
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
    const fmt = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    const overdue = diff < 0 && p.status !== "finalizado";
    return { label: fmt, overdue, diff };
  })();

  return (
    <div className="glass-card group relative rounded-2xl border border-border bg-surface hover:border-primary/40 transition-colors overflow-hidden">
      <Link to="/projects/$projectId" params={{ projectId: p.id }} className="block p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="size-10 rounded-xl grid place-items-center shrink-0" style={{ background: `${cat.tint}`, color: cat.accent }}>
            <cat.icon className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold leading-tight truncate">{p.name}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{cat.label}</div>
          </div>
        </div>

        {p.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[2rem]">{p.description}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium" style={{ background: st.tint, color: st.accent }}>
            {st.label}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium" style={{ background: prio.tint, color: prio.accent }}>
            <Flame className="size-3" /> {prio.label}
          </span>
          {dueLabel && (
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md tabular-nums ${dueLabel.overdue ? "bg-destructive/15 text-destructive font-medium" : "bg-muted text-muted-foreground"}`}>
              <CalIcon className="size-3" /> {dueLabel.label}
            </span>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-muted-foreground">{p.doneCount}/{p.taskCount} tarefas</span>
            <span className="font-medium tabular-nums">{p.progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${p.progress}%`, background: cat.accent }} />
          </div>
        </div>
      </Link>

      <div className="absolute top-3 right-3">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu(v => !v); }}
          className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Menu"
        >
          <MoreVertical className="size-4" />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={(e) => { e.preventDefault(); setMenu(false); }} />
            <div className="absolute right-0 top-8 z-20 w-44 rounded-xl border border-border bg-popover shadow-lg p-1 text-sm">
              <MenuItem icon={Pencil} onClick={() => { setMenu(false); onEdit(); }}>Editar</MenuItem>
              <MenuItem icon={Copy} onClick={() => { setMenu(false); onDuplicate(); }}>Duplicar</MenuItem>
              <MenuItem icon={p.archived ? ArchiveRestore : Archive} onClick={() => { setMenu(false); onArchive(); }}>
                {p.archived ? "Desarquivar" : "Arquivar"}
              </MenuItem>
              <div className="h-px bg-border my-1" />
              <MenuItem icon={Trash2} danger onClick={() => { setMenu(false); onDelete(); }}>Excluir</MenuItem>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: any; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className={`w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-left ${danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted"}`}
    >
      <Icon className="size-3.5" /> {children}
    </button>
  );
}

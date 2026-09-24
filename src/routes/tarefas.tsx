import { useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckSquare, Plus, ListTodo, CircleCheck, Clock, CirclePause, CircleAlert, Search, SlidersHorizontal,
  MoreVertical, Pencil, Trash2, ShoppingCart, Megaphone, Store, Truck, BarChart3, Package, MessageCircle,
  Settings, Target, FileText, ArrowUp, ArrowDown, Minus, Loader2, X, Check,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";
import { isoTodayUS } from "@/lib/timezone";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listTasks, listTaskAssignees, createTask, updateTask, deleteTask,
  TASK_AREAS, TASK_PRIORITIES, TASK_STATUSES,
  type Task, type TaskArea, type TaskPriority, type TaskStatus,
} from "@/lib/tasks.functions";

export const Route = createFileRoute("/tarefas")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Tarefas — SRX Growth" }] }),
  component: TasksPage,
});

// ─── Configuração visual ──────────────────────────────────────────────────────

const AREA_META: Record<TaskArea, { label: string; icon: typeof Store; cls: string }> = {
  pedidos:      { label: "Pedidos",      icon: ShoppingCart,  cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  marketing:    { label: "Marketing",    icon: Megaphone,     cls: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  lojas:        { label: "Lojas",        icon: Store,         cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  fornecedores: { label: "Fornecedores", icon: Truck,         cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  analise:      { label: "Análise",      icon: BarChart3,     cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  produtos:     { label: "Produtos",     icon: Package,       cls: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  atendimento:  { label: "Atendimento",  icon: MessageCircle, cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  sistema:      { label: "Sistema",      icon: Settings,      cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  gestao:       { label: "Gestão",       icon: Target,        cls: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  processos:    { label: "Processos",    icon: FileText,      cls: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
};

const PRIORITY_META: Record<TaskPriority, { label: string; icon: typeof ArrowUp; cls: string }> = {
  alta:  { label: "Alta",  icon: ArrowUp,   cls: "bg-destructive/10 text-destructive" },
  media: { label: "Média", icon: Minus,     cls: "bg-warning/15 text-warning" },
  baixa: { label: "Baixa", icon: ArrowDown, cls: "bg-success/15 text-success" },
};

const STATUS_META: Record<TaskStatus, { label: string; dot: string; cls: string }> = {
  pendente:     { label: "Pendente",     dot: "bg-warning",     cls: "bg-warning/15 text-warning" },
  em_andamento: { label: "Em andamento", dot: "bg-info",        cls: "bg-info/10 text-info" },
  concluida:    { label: "Concluída",    dot: "bg-success",     cls: "bg-success/15 text-success" },
};

type Tab = "todas" | "pendente" | "em_andamento" | "concluida" | "atrasada";
const TABS: { key: Tab; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "pendente", label: "Pendentes" },
  { key: "em_andamento", label: "Em andamento" },
  { key: "concluida", label: "Concluídas" },
  { key: "atrasada", label: "Atrasadas" },
];

type Assignee = { id: string; name: string; avatar_url: string | null };

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

const isOverdue = (t: Task, today: string) => t.status !== "concluida" && !!t.due_date && t.due_date < today;

// ─── Pequenos componentes ─────────────────────────────────────────────────────

function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

function AreaChip({ area }: { area: TaskArea }) {
  const m = AREA_META[area] ?? AREA_META.gestao;
  const Icon = m.icon;
  return <Chip cls={m.cls}><Icon className="size-3" />{m.label}</Chip>;
}

function PriorityChip({ priority }: { priority: TaskPriority }) {
  const m = PRIORITY_META[priority] ?? PRIORITY_META.media;
  const Icon = m.icon;
  return <Chip cls={m.cls}><Icon className="size-3" />{m.label}</Chip>;
}

function StatusChip({ status }: { status: TaskStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.pendente;
  return <Chip cls={m.cls}><span className={`size-1.5 rounded-full ${m.dot}`} />{m.label}</Chip>;
}

function AssigneeAvatar({ person }: { person: Assignee | undefined }) {
  if (!person) return <span className="text-xs text-muted-foreground">—</span>;
  return person.avatar_url ? (
    <img src={person.avatar_url} alt={person.name} title={person.name} className="size-7 rounded-full object-cover" />
  ) : (
    <span title={person.name} className="size-7 rounded-full gradient-primary text-white text-[10px] font-semibold grid place-items-center">
      {initials(person.name)}
    </span>
  );
}

function KpiCard({ icon: Icon, cls, label, value, hint }: { icon: typeof ListTodo; cls: string; label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3.5">
      <div className={`size-11 rounded-xl grid place-items-center shrink-0 ${cls}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tracking-tight leading-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

const pct = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(1).replace(".", ",")}%` : "0%");

// Resumo do celular: total, % concluídas, barra por status e os 4 números.
function MobileTaskSummary({ counts }: { counts: { todas: number; pendente: number; em_andamento: number; concluida: number; atrasada: number } }) {
  const total = counts.todas;
  const share = (n: number) => (total ? (n / total) * 100 : 0);
  const items = [
    { label: "Concluídas", value: counts.concluida, dot: "bg-success" },
    { label: "Em andamento", value: counts.em_andamento, dot: "bg-info" },
    { label: "Pendentes", value: counts.pendente, dot: "bg-warning" },
    { label: "Atrasadas", value: counts.atrasada, dot: "bg-destructive" },
  ];
  return (
    <div className="sm:hidden rounded-2xl border border-border bg-card p-4 mb-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl grid place-items-center shrink-0 bg-primary/10 text-primary">
          <ListTodo className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Total de tarefas</p>
          <p className="text-2xl font-bold tracking-tight leading-tight">{total}</p>
        </div>
        <p className="text-xs text-muted-foreground self-end mb-1">{pct(counts.concluida, total)} concluídas</p>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="bg-success" style={{ width: `${share(counts.concluida)}%` }} />
        <div className="bg-info" style={{ width: `${share(counts.em_andamento)}%` }} />
        <div className="bg-warning" style={{ width: `${share(counts.pendente)}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1">
        {items.map((it) => (
          <div key={it.label} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full shrink-0 ${it.dot}`} />
              <span className="text-base font-bold leading-none">{it.value}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 truncate">{it.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Página ───────────────────────────────────────────────────────────────────

function TasksPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listFn = useServerFn(listTasks);
  const assigneesFn = useServerFn(listTaskAssignees);
  const updateFn = useServerFn(updateTask);
  const deleteFn = useServerFn(deleteTask);

  const { data: tasks = [], isLoading } = useQuery({ queryKey: ["tasks"], queryFn: () => listFn() });
  const { data: assignees = [] } = useQuery({ queryKey: ["task-assignees"], queryFn: () => assigneesFn(), staleTime: 5 * 60_000 });
  const assigneeById = useMemo(() => new Map(assignees.map((a) => [a.id, a])), [assignees]);

  const [tab, setTab] = useState<Tab>("todas");
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<TaskArea | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");
  const [editing, setEditing] = useState<Task | "new" | null>(null);

  const today = isoTodayUS();

  const counts = useMemo(() => ({
    todas: tasks.length,
    pendente: tasks.filter((t) => t.status === "pendente").length,
    em_andamento: tasks.filter((t) => t.status === "em_andamento").length,
    concluida: tasks.filter((t) => t.status === "concluida").length,
    atrasada: tasks.filter((t) => isOverdue(t, today)).length,
  }), [tasks, today]);

  const activeFilters = [areaFilter, priorityFilter, assigneeFilter].filter(Boolean).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks
      .filter((t) => tab === "todas" ? true : tab === "atrasada" ? isOverdue(t, today) : t.status === tab)
      .filter((t) => !q || t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q))
      .filter((t) => !areaFilter || t.area === areaFilter)
      .filter((t) => !priorityFilter || t.priority === priorityFilter)
      .filter((t) => !assigneeFilter || t.assignee_id === assigneeFilter)
      // Abertas primeiro, por vencimento (sem data no fim); concluídas no fim.
      .sort((a, b) => {
        const da = a.status === "concluida" ? 1 : 0, db = b.status === "concluida" ? 1 : 0;
        if (da !== db) return da - db;
        return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || b.created_at.localeCompare(a.created_at);
      });
  }, [tasks, tab, search, areaFilter, priorityFilter, assigneeFilter, today]);

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: TaskStatus }) => updateFn({ data: { id: v.id, patch: { status: v.status } } }),
    onMutate: (v) => {
      const prev = qc.getQueryData<Task[]>(["tasks"]);
      qc.setQueryData<Task[]>(["tasks"], (list) => (list ?? []).map((t) => (t.id === v.id ? { ...t, status: v.status } : t)));
      return { prev };
    },
    onError: (e: any, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["tasks"], ctx.prev); toast.error(e.message ?? "Erro ao atualizar"); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Tarefa excluída"); qc.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir"),
  });

  const toggleDone = (t: Task) => setStatus.mutate({ id: t.id, status: t.status === "concluida" ? "pendente" : "concluida" });
  const askDelete = async (t: Task) => {
    if (await confirm({ title: "Excluir tarefa?", description: `"${t.title}" será excluída.`, confirmText: "Excluir", variant: "destructive" })) {
      remove.mutate(t.id);
    }
  };

  const RowMenu = ({ t }: { t: Task }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Ações" className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted" onClick={(e) => e.stopPropagation()}>
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => setEditing(t)}><Pencil className="size-3.5 mr-2" />Editar</DropdownMenuItem>
        <DropdownMenuSeparator />
        {TASK_STATUSES.filter((s) => s !== t.status).map((s) => (
          <DropdownMenuItem key={s} onClick={() => setStatus.mutate({ id: t.id, status: s })}>
            <span className={`size-2 rounded-full mr-2.5 ${STATUS_META[s].dot}`} />Marcar como {STATUS_META[s].label.toLowerCase()}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => askDelete(t)} className="text-destructive focus:text-destructive"><Trash2 className="size-3.5 mr-2" />Excluir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const DoneBox = ({ t }: { t: Task }) => (
    <button
      role="checkbox"
      aria-checked={t.status === "concluida"}
      aria-label={t.status === "concluida" ? "Reabrir tarefa" : "Concluir tarefa"}
      onClick={(e) => { e.stopPropagation(); toggleDone(t); }}
      className={`size-[18px] rounded-[5px] border grid place-items-center shrink-0 transition-colors ${
        t.status === "concluida" ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary bg-background"
      }`}
    >
      {t.status === "concluida" && <Check className="size-3" strokeWidth={3.5} />}
    </button>
  );

  return (
    <PageShell>
      {/* Celular: título + botão na mesma linha e um card só de resumo. */}
      <div className="sm:hidden flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight leading-tight">Tarefas</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Organize e acompanhe suas atividades</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="h-10 px-4 shrink-0 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="size-4" /> Nova tarefa
        </button>
      </div>
      <MobileTaskSummary counts={counts} />

      <div className="hidden sm:block">
        <PageHeader
          title="Tarefas"
          actions={
            <button
              onClick={() => setEditing("new")}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
            >
              <Plus className="size-4" /> Nova tarefa
            </button>
          }
        />
      </div>

      {/* ── Indicadores ── */}
      <div className="hidden sm:grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <KpiCard icon={ListTodo} cls="bg-primary/10 text-primary" label="Total" value={counts.todas} hint="tarefas" />
        <KpiCard icon={CircleCheck} cls="bg-success/15 text-success" label="Concluídas" value={counts.concluida} hint={pct(counts.concluida, counts.todas)} />
        <KpiCard icon={Clock} cls="bg-info/10 text-info" label="Em andamento" value={counts.em_andamento} hint={pct(counts.em_andamento, counts.todas)} />
        <KpiCard icon={CirclePause} cls="bg-warning/15 text-warning" label="Pendentes" value={counts.pendente} hint={pct(counts.pendente, counts.todas)} />
        <KpiCard icon={CircleAlert} cls="bg-destructive/10 text-destructive" label="Atrasadas" value={counts.atrasada} hint={pct(counts.atrasada, counts.todas)} />
      </div>

      {/* ── Lista ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 pt-3 border-b border-border">
          <div className="flex gap-1 overflow-x-auto -mb-px scrollbar-thin">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3 pb-3 pt-1 text-sm whitespace-nowrap border-b-2 transition-colors ${
                  tab === key ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                <span className={`min-w-5 h-5 px-1.5 rounded-md text-[11px] font-semibold grid place-items-center ${
                  tab === key ? "bg-primary/10 text-primary" : key === "atrasada" && counts.atrasada ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                }`}>{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-3">
            <div className="relative flex-1 lg:w-64">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar tarefas..."
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button className={`h-9 px-3 rounded-xl border text-sm flex items-center gap-1.5 shrink-0 ${activeFilters ? "border-primary text-primary bg-primary/5" : "border-border hover:bg-muted"}`}>
                  <SlidersHorizontal className="size-4" /> Filtros{activeFilters ? ` (${activeFilters})` : ""}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-3">
                <FilterSelect label="Área" value={areaFilter} onChange={(v) => setAreaFilter(v as TaskArea | "")}
                  options={TASK_AREAS.map((a) => [a, AREA_META[a].label])} />
                <FilterSelect label="Prioridade" value={priorityFilter} onChange={(v) => setPriorityFilter(v as TaskPriority | "")}
                  options={TASK_PRIORITIES.map((p) => [p, PRIORITY_META[p].label])} />
                <FilterSelect label="Responsável" value={assigneeFilter} onChange={setAssigneeFilter}
                  options={assignees.map((a) => [a.id, a.name])} />
                {activeFilters > 0 && (
                  <button onClick={() => { setAreaFilter(""); setPriorityFilter(""); setAssigneeFilter(""); }}
                    className="w-full h-8 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center gap-1">
                    <X className="size-3.5" /> Limpar filtros
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : visible.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-center px-4">
            <CheckSquare className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {tasks.length === 0 ? "Nenhuma tarefa ainda." : "Nenhuma tarefa encontrada com esses filtros."}
            </p>
            {tasks.length === 0 && (
              <button onClick={() => setEditing("new")} className="mt-1 text-sm font-medium text-primary hover:underline">Criar a primeira tarefa</button>
            )}
          </div>
        ) : (
          <>
            {/* Computador: tabela */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground bg-muted/40">
                    <th className="w-12 pl-4 py-2.5 font-medium" />
                    <th className="py-2.5 pr-4 font-medium">Tarefa</th>
                    <th className="py-2.5 pr-4 font-medium">Projeto/Área</th>
                    <th className="py-2.5 pr-4 font-medium">Prioridade</th>
                    <th className="py-2.5 pr-4 font-medium">Vencimento</th>
                    <th className="py-2.5 pr-4 font-medium">Responsável</th>
                    <th className="py-2.5 pr-4 font-medium">Status</th>
                    <th className="w-12 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => {
                    const overdue = isOverdue(t, today);
                    const done = t.status === "concluida";
                    return (
                      <tr key={t.id} onClick={() => setEditing(t)} className="border-t border-border hover:bg-surface-hover cursor-pointer transition-colors">
                        <td className="pl-4 py-3"><DoneBox t={t} /></td>
                        <td className="py-3 pr-4 max-w-[320px]">
                          <p className={`font-semibold truncate ${done ? "text-muted-foreground line-through" : ""}`}>{t.title}</p>
                          {t.description && <p className="text-xs text-muted-foreground truncate">{t.description}</p>}
                        </td>
                        <td className="py-3 pr-4"><AreaChip area={t.area} /></td>
                        <td className="py-3 pr-4"><PriorityChip priority={t.priority} /></td>
                        <td className={`py-3 pr-4 whitespace-nowrap ${overdue ? "text-destructive font-medium" : ""}`}>
                          {fmtDate(t.due_date)}{overdue && <span className="block text-[10px] font-semibold uppercase tracking-wide">Atrasada</span>}
                        </td>
                        <td className="py-3 pr-4"><AssigneeAvatar person={t.assignee_id ? assigneeById.get(t.assignee_id) : undefined} /></td>
                        <td className="py-3 pr-4"><StatusChip status={t.status} /></td>
                        <td className="py-3 pr-2"><RowMenu t={t} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Celular: cards */}
            <div className="md:hidden divide-y divide-border">
              {visible.map((t) => {
                const overdue = isOverdue(t, today);
                const done = t.status === "concluida";
                return (
                  <div key={t.id} onClick={() => setEditing(t)} className="flex gap-3 px-4 py-3.5 active:bg-surface-hover">
                    <div className="pt-0.5"><DoneBox t={t} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-semibold leading-snug ${done ? "text-muted-foreground line-through" : ""}`}>{t.title}</p>
                        <div className="-mt-1 -mr-2"><RowMenu t={t} /></div>
                      </div>
                      {t.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{t.description}</p>}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <StatusChip status={t.status} />
                        <PriorityChip priority={t.priority} />
                        <AreaChip area={t.area} />
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className={`text-xs ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          {t.due_date ? `Vence ${fmtDate(t.due_date)}${overdue ? " · atrasada" : ""}` : "Sem vencimento"}
                        </span>
                        <AssigneeAvatar person={t.assignee_id ? assigneeById.get(t.assignee_id) : undefined} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <TaskDialog
        task={editing}
        assignees={assignees}
        onClose={() => setEditing(null)}
        onDelete={(t) => { setEditing(null); askDelete(t); }}
      />
    </PageShell>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-9 px-2.5 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary">
        <option value="">Todos</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// ─── Criar / editar ───────────────────────────────────────────────────────────

function TaskDialog({ task, assignees, onClose, onDelete }: {
  task: Task | "new" | null;
  assignees: Assignee[];
  onClose: () => void;
  onDelete: (t: Task) => void;
}) {
  const open = task !== null;
  const existing = task && task !== "new" ? task : null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
        </DialogHeader>
        {open && <TaskForm key={existing?.id ?? "new"} existing={existing} assignees={assignees} onDone={onClose} onDelete={onDelete} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ existing, assignees, onDone, onDelete }: {
  existing: Task | null; assignees: Assignee[]; onDone: () => void; onDelete: (t: Task) => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createTask);
  const updateFn = useServerFn(updateTask);
  const [form, setForm] = useState({
    title: existing?.title ?? "",
    description: existing?.description ?? "",
    area: (existing?.area ?? "gestao") as TaskArea,
    priority: (existing?.priority ?? "media") as TaskPriority,
    status: (existing?.status ?? "pendente") as TaskStatus,
    due_date: existing?.due_date ?? "",
    assignee_id: existing?.assignee_id ?? "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        title: form.title.trim(),
        description: form.description.trim() || null,
        due_date: form.due_date || null,
        assignee_id: form.assignee_id || null,
      };
      return existing ? updateFn({ data: { id: existing.id, patch: payload } }) : createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success(existing ? "Tarefa atualizada" : "Tarefa criada");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onDone();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Informe o título");
    save.mutate();
  };

  const field = "w-full h-10 px-3 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary";
  return (
    <form onSubmit={submit} className="space-y-3">
      <Labeled label="Título">
        <input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={200}
          placeholder="Ex.: Separar pedidos da loja US" className={field} />
      </Labeled>
      <Labeled label="Descrição">
        <textarea value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} rows={2}
          placeholder="Detalhes (opcional)" className={`${field} h-auto py-2 resize-none`} />
      </Labeled>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Projeto/Área">
          <select value={form.area} onChange={(e) => set("area", e.target.value as TaskArea)} className={field}>
            {TASK_AREAS.map((a) => <option key={a} value={a}>{AREA_META[a].label}</option>)}
          </select>
        </Labeled>
        <Labeled label="Prioridade">
          <select value={form.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)} className={field}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
        </Labeled>
        <Labeled label="Vencimento">
          <input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} className={field} />
        </Labeled>
        <Labeled label="Status">
          <select value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)} className={field}>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </Labeled>
      </div>
      <Labeled label="Responsável">
        <select value={form.assignee_id} onChange={(e) => set("assignee_id", e.target.value)} className={field}>
          <option value="">Sem responsável</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Labeled>
      <div className="flex items-center gap-2 pt-2">
        {existing && (
          <button type="button" onClick={() => onDelete(existing)}
            className="h-10 px-3 rounded-xl text-sm text-destructive hover:bg-destructive/10 flex items-center gap-1.5">
            <Trash2 className="size-4" /> Excluir
          </button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={onDone} className="h-10 px-4 rounded-xl border border-border text-sm hover:bg-muted">Cancelar</button>
        <button type="submit" disabled={save.isPending}
          className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2 disabled:opacity-60">
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          {existing ? "Salvar" : "Criar tarefa"}
        </button>
      </div>
    </form>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground block mb-1">{label}</span>
      {children}
    </label>
  );
}

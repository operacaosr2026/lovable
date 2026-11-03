import { useMemo, useRef, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, GripVertical, Loader2, Megaphone, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  METRICS, METRIC_LABEL, STATUS_COLORS,
  createExperiment, deleteExperiment, listProductExperiments, saveCampaignKinds, saveCampaignStatuses, updateExperiment,
  kindName, type CampaignKind, type CampaignStatus, type Experiment, type Metric, type StatusColor,
} from "@/lib/experiments.functions";
import { CampaignView } from "@/components/products/CampaignView";
import { ProductDiary } from "@/components/products/ProductDiary";
import { ProductClarityBar } from "@/components/products/ProductClarityBar";
import { ProductTestPipeline } from "@/components/products/ProductTestPipeline";
import { BASELINE_METRICS, FORMAT_UNIT, SOURCE_LABEL, type MetricSource } from "@/lib/experiment-metrics";

// Aba Inteligência › Campanhas do produto (substitui Diário e Testes): listas
// por status (editáveis no ⋯ ao lado do nome), como no ClickUp, com tags e busca.
// Arrastar a linha pra outra lista muda o status.
// Cada campanha é ligada a uma campanha da Meta e tem resumo, métricas e
// diário próprios (CampaignView). O Diário do produto fica na outra chave e
// mostra os registros do produto e de todas as campanhas.

const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";
const areaCls = "px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 resize-y";

export const STATUS_STYLE: Record<StatusColor, { pill: string; dot: string }> = {
  slate: { pill: "bg-slate-400 text-white dark:bg-slate-500", dot: "border-slate-400 bg-transparent" },
  sky: { pill: "bg-sky-500 text-white", dot: "border-sky-500 bg-sky-500" },
  violet: { pill: "bg-violet-500 text-white", dot: "border-violet-500 bg-violet-500" },
  amber: { pill: "bg-amber-500 text-white", dot: "border-amber-500 bg-amber-500" },
  orange: { pill: "bg-orange-500 text-white", dot: "border-orange-500 bg-orange-500" },
  emerald: { pill: "bg-emerald-500 text-white", dot: "border-emerald-500 bg-emerald-500" },
  rose: { pill: "bg-rose-500 text-white", dot: "border-rose-500 bg-rose-500" },
};
// Status que sumiu do template (ex.: excluído em outra aba) aparece cinza.
const UNKNOWN_STATUS: CampaignStatus = { id: "", name: "Sem status", color: "slate" };
export const findStatus = (statuses: CampaignStatus[], id: string) => statuses.find((s) => s.id === id) ?? { ...UNKNOWN_STATUS, id };

export function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
export function daysLive(e: Pick<Experiment, "started_at" | "ended_at">) {
  if (!e.started_at) return null;
  return daysBetween(e.started_at, e.ended_at ?? nyToday()) + 1;
}

// Cor fixa por tag (mesma tag, mesma cor em qualquer produto).
const TAG_COLORS = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300", "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300", "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  "bg-orange-500/15 text-orange-700 dark:text-orange-300", "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
];
function tagColor(tag: string) {
  let h = 0;
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}
export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[11px] font-medium whitespace-nowrap ${tagColor(tag)}`}>
      {tag}
      {onRemove && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Tirar tag" className="opacity-60 hover:opacity-100">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

type Opt = { id: string; name: string };
type Editing = Experiment | { status: string };

export function ProductCampaigns({ productId }: { productId: string }) {
  const [view, setView] = useState<"campanhas" | "diario" | "esteira">("campanhas");
  return (
    <div>
      <ProductClarityBar productId={productId} />
      <div className="flex items-center rounded-lg border border-border p-0.5 w-fit mb-4">
        {([["campanhas", "Campanhas"], ["diario", "Diário do produto"], ["esteira", "Esteira de Testes"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className={`h-8 px-3 rounded-md text-xs font-medium ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>
      {view === "campanhas" ? <CampaignLists productId={productId} />
        : view === "diario" ? <ProductDiary productId={productId} />
        : <ProductTestPipeline productId={productId} />}
    </div>
  );
}

function CampaignLists({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const QK = ["product-experiments", productId];
  const getFn = useServerFn(listProductExperiments);
  const updateFn = useServerFn(updateExperiment);
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: () => getFn({ data: { product_id: productId } }) });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  // Arrasto só começa depois de mexer 5px: clique simples continua abrindo a campanha.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // Soltar no mesmo lugar dispara um clique; ele não deve abrir a campanha.
  const draggedAt = useRef(0);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: QK });
    qc.invalidateQueries({ queryKey: ["product-diary", productId] });
    qc.invalidateQueries({ queryKey: ["learnings"] });
  };
  type Data = Awaited<ReturnType<typeof getFn>>;
  // Muda na tela na hora; o servidor confirma depois (e se recusar, volta).
  const patch = useMutation({
    mutationFn: (v: { id: string; status?: string; tags?: string[] }) => updateFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: QK });
      qc.setQueryData<Data>(QK, (d) => d && { ...d, experiments: d.experiments.map((e) => (e.id === v.id ? { ...e, ...v } : e)) });
    },
    onSettled: refresh,
    onError: (e: any) => toast.error(e.message),
  });

  const experiments = data?.experiments ?? [];
  const productTags = useMemo(() => [...new Set(experiments.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b)), [experiments]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return experiments.filter((e) => tagFilter.every((t) => e.tags.includes(t))
      && (!term || [e.title, e.campaign_name ?? "", e.hypothesis, ...e.tags].some((s) => s.toLowerCase().includes(term))));
  }, [experiments, q, tagFilter]);

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Não foi possível carregar as campanhas."}</p>;

  const statuses = data.statuses;
  // Mais recente primeiro: pela data de início; sem início, pela criação.
  const sortIn = (list: Experiment[]) => [...list].sort((a, b) =>
    (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at));
  const changeStatus = (e: Experiment, status: string) => {
    if (status !== e.status) patch.mutate({ id: e.id, status });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragId(null);
    draggedAt.current = Date.now();
    const e = experiments.find((x) => x.id === active.id);
    if (e && over) changeStatus(e, String(over.id));
  };
  const dragging = dragId ? experiments.find((e) => e.id === dragId) : undefined;
  // Campanha em status excluído (até o servidor mover) fica no primeiro.
  const listOf = (st: CampaignStatus, i: number) => filtered.filter((e) => e.status === st.id || (i === 0 && !statuses.some((s) => s.id === e.status)));
  const viewing = viewingId ? experiments.find((e) => e.id === viewingId) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar campanha" className={`${inputCls} pl-8 w-56`} />
        </div>
        {productTags.map((t) => {
          const on = tagFilter.includes(t);
          return (
            <button key={t} onClick={() => setTagFilter((f) => (on ? f.filter((x) => x !== t) : [...f, t]))}
              className={`rounded ${on ? "ring-2 ring-primary/50" : "opacity-70 hover:opacity-100"}`} title={on ? "Tirar filtro" : "Filtrar por tag"}>
              <TagChip tag={t} />
            </button>
          );
        })}
        {tagFilter.length > 0 && <button onClick={() => setTagFilter([])} className="text-xs text-muted-foreground hover:text-foreground">Limpar</button>}
        <button onClick={() => setEditing({ status: statuses[0].id })}
          className="ml-auto h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5">
          <Plus className="size-3.5" /> Nova campanha
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={pointerWithin}
        onDragStart={({ active }) => setDragId(String(active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
      <div className="space-y-5">
        {statuses.map((st, i) => {
          const status = st.id;
          const items = sortIn(listOf(st, i));
          const isCollapsed = collapsed.includes(status);
          return (
            <StatusDrop key={status} id={status} dragging={!!dragging && dragging.status !== status}>
              <div className="flex items-center gap-2 mb-1.5">
                <button onClick={() => setCollapsed((c) => (isCollapsed ? c.filter((x) => x !== status) : [...c, status]))}
                  className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-muted" title={isCollapsed ? "Abrir" : "Recolher"}>
                  {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[st.color].pill}`}>{st.name}</span>
                <StatusEditor statuses={statuses} experiments={experiments} onSaved={refresh} />
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
              </div>
              {!isCollapsed && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="hidden md:grid grid-cols-[minmax(0,1fr)_220px_200px_80px_56px] gap-3 px-3 h-8 items-center border-b border-border bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span className="pl-6">Nome</span><span>Campanha Meta</span><span>Tags</span><span>Início</span><span>Dias</span>
                  </div>
                  {items.map((e) => (
                    <CampaignRow key={e.id} e={e} statuses={statuses} kinds={data.kinds} allTags={data.allTags}
                      onOpen={() => { if (Date.now() - draggedAt.current > 250) setViewingId(e.id); }} onStatus={(s) => changeStatus(e, s)} onTags={(tags) => patch.mutate({ id: e.id, tags })} />
                  ))}
                  <button onClick={() => setEditing({ status })}
                    className="w-full flex items-center gap-1.5 px-3 h-9 text-[13px] text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                    <Plus className="size-3.5 ml-6" /> Nova campanha
                  </button>
                </div>
              )}
            </StatusDrop>
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {dragging && (
          <div className="rounded-lg border border-primary/40 bg-background shadow-xl px-3 py-2 flex items-center gap-2 text-sm font-medium cursor-grabbing max-w-md rotate-[0.6deg]">
            <span className={`size-3 rounded-full border-2 shrink-0 ${STATUS_STYLE[findStatus(statuses, dragging.status).color].dot}`} />
            <span className="truncate">{dragging.title}</span>
          </div>
        )}
      </DragOverlay>
      </DndContext>
      <p className="text-[11px] text-muted-foreground mt-3">Arraste uma campanha para outra lista para mudar o status. Ao preencher a data de início, um registro entra sozinho no diário dela, nessa data.</p>

      {viewing && (
        <CampaignView experiment={viewing} statuses={statuses} kinds={data.kinds} productId={productId} allTags={data.allTags}
          onEdit={() => setEditing(viewing)} onTags={(tags) => patch.mutate({ id: viewing.id, tags })} onClose={() => setViewingId(null)} />
      )}
      {editing && (
        <CampaignDialog key={"id" in editing ? editing.id : "new"} productId={productId} initial={editing} statuses={statuses} kinds={data.kinds} shops={data.shops} campaigns={data.campaigns}
          allTags={data.allTags} onSaved={(row, created) => { refresh(); if (created) setViewingId(row.id); }} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// Lista de um status: recebe a campanha arrastada (a lista inteira, até recolhida).
function StatusDrop({ id, dragging, children }: { id: string; dragging: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef}
      className={`rounded-xl -m-1.5 p-1.5 transition-colors ${dragging && isOver ? "bg-primary/10 ring-2 ring-primary/40" : dragging ? "ring-1 ring-dashed ring-border" : ""}`}>
      {children}
    </section>
  );
}

function CampaignRow({ e, statuses, kinds, allTags, onOpen, onStatus, onTags }: {
  e: Experiment; statuses: CampaignStatus[]; kinds: CampaignKind[]; allTags: string[]; onOpen: () => void; onStatus: (s: string) => void; onTags: (tags: string[]) => void;
}) {
  const days = daysLive(e);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: e.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={onOpen} title={kindName(kinds, e.kind)}
      className={`group grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_220px_200px_80px_56px] gap-3 px-3 py-2 items-center border-b border-border/60 cursor-pointer hover:bg-muted/40 touch-none select-none ${isDragging ? "opacity-30" : ""}`}>
      <div className="flex items-center gap-2 min-w-0 relative">
        <GripVertical className="size-3.5 absolute -left-3.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 cursor-grab" />
        <span onPointerDown={(ev) => ev.stopPropagation()} className="contents"><StatusMenu status={e.status} statuses={statuses} onChange={onStatus} /></span>
        <span className="text-sm font-medium truncate" title={e.title}>{e.title}</span>
      </div>
      <span className="hidden md:flex items-center gap-1 text-[12.5px] text-muted-foreground min-w-0">
        {e.campaign_name ? <><Megaphone className="size-3 shrink-0" /><span className="truncate" title={e.campaign_name}>{e.campaign_name}</span></> : <span className="text-muted-foreground/50">—</span>}
      </span>
      <div className="hidden md:block min-w-0" onClick={(ev) => ev.stopPropagation()} onPointerDown={(ev) => ev.stopPropagation()}>
        <TagsPopover tags={e.tags} allTags={allTags} onChange={onTags} />
      </div>
      <span className="hidden md:block text-[12.5px] text-muted-foreground tabular-nums">{e.started_at ? fmtDate(e.started_at) : "—"}</span>
      <span className="hidden md:block text-[12.5px] text-muted-foreground tabular-nums">{days ?? "—"}</span>
    </div>
  );
}

function StatusMenu({ status, statuses, onChange }: { status: string; statuses: CampaignStatus[]; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button onClick={(e) => e.stopPropagation()} title="Mudar status" className="size-4 shrink-0 grid place-items-center">
          <span className={`size-3 rounded-full border-2 ${STATUS_STYLE[findStatus(statuses, status).color].dot}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1" onClick={(e) => e.stopPropagation()}>
        {statuses.map((s) => (
          <button key={s.id} onClick={() => { setOpen(false); onChange(s.id); }}
            className="w-full flex items-center gap-2 px-2 h-8 rounded-md text-sm hover:bg-muted">
            <span className={`size-3 rounded-full border-2 shrink-0 ${STATUS_STYLE[s.color].dot}`} />
            <span className="truncate">{s.name}</span>
            {s.id === status && <Check className="size-3.5 ml-auto text-muted-foreground" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ⋯ ao lado do nome do status: edita todos os status (nome, cor, ordem).
// Vale pra todos os produtos.
function StatusEditor({ statuses, experiments, onSaved }: { statuses: CampaignStatus[]; experiments: Experiment[]; onSaved: () => void }) {
  const saveFn = useServerFn(saveCampaignStatuses);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CampaignStatus[]>(statuses);
  const save = useMutation({
    mutationFn: () => saveFn({ data: { statuses: list.map((s) => ({ ...s, name: s.name.trim() })) } }),
    onSuccess: () => { toast.success("Status salvos"); setOpen(false); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });
  const edit = (i: number, p: Partial<CampaignStatus>) => setList((l) => l.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => setList((l) => {
    const n = [...l];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const nextColor = (c: StatusColor) => STATUS_COLORS[(STATUS_COLORS.indexOf(c) + 1) % STATUS_COLORS.length];
  const removedCount = experiments.filter((e) => !list.some((s) => s.id === e.status)).length;
  const canSave = list.length > 0 && list.every((s) => s.name.trim());

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setList(statuses); }}>
      <PopoverTrigger asChild>
        <button className="size-6 rounded-md grid place-items-center text-muted-foreground hover:bg-muted" title="Editar status">
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] max-w-[calc(100vw-32px)] p-3">
        <p className="text-sm font-semibold">Status das campanhas</p>
        <p className="text-[11px] text-muted-foreground mb-2">Valem para todos os produtos. Clique na bolinha para trocar a cor.</p>
        <div className="space-y-1.5">
          {list.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5">
              <button type="button" onClick={() => edit(i, { color: nextColor(s.color) })} title="Trocar cor" className="size-6 grid place-items-center shrink-0">
                <span className={`size-3.5 rounded-full border-2 ${STATUS_STYLE[s.color].dot}`} />
              </button>
              <input value={s.name} maxLength={40} onChange={(e) => edit(i, { name: e.target.value })}
                className={`${inputCls} h-8 flex-1 min-w-0 ${s.name.trim() ? "" : "border-destructive"}`} />
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Subir" className="size-6 grid place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30">
                <ArrowUp className="size-3.5" />
              </button>
              <button type="button" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Descer" className="size-6 grid place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30">
                <ArrowDown className="size-3.5" />
              </button>
              <button type="button" disabled={list.length === 1} onClick={() => setList((l) => l.filter((_, j) => j !== i))} title="Excluir status"
                className="size-6 grid place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" disabled={list.length >= 20}
          onClick={() => setList((l) => [...l, { id: `s${Date.now().toString(36)}`, name: "", color: "violet" }])}
          className="mt-2 h-8 px-2 rounded-md text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5">
          <Plus className="size-3.5" /> Adicionar status
        </button>
        {removedCount > 0 && list[0] && (
          <p className="text-[11px] text-amber-600 mt-2">
            {removedCount} {removedCount === 1 ? "campanha deste produto está" : "campanhas deste produto estão"} em status excluído e
            {removedCount === 1 ? " vai" : " vão"} para "{list[0].name.trim() || "o primeiro"}" (o mesmo vale para os outros produtos).
          </p>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" onClick={() => setOpen(false)} className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted">Cancelar</button>
          <button type="button" disabled={!canSave || save.isPending} onClick={() => save.mutate()}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
            {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TagsPopover({ tags, allTags, onChange }: { tags: string[]; allTags: string[]; onChange: (tags: string[]) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex flex-wrap items-center gap-1 min-h-6 w-full text-left rounded-md hover:bg-muted/60 px-1 -mx-1" title="Editar tags">
          {tags.length ? tags.map((t) => <TagChip key={t} tag={t} />) : <span className="text-[12px] text-muted-foreground/60">+ tag</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <TagInput value={tags} allTags={allTags} onChange={onChange} autoFocus />
      </PopoverContent>
    </Popover>
  );
}

// Tags: Enter ou vírgula adiciona; sugere as já usadas no workspace.
function TagInput({ value, allTags, onChange, autoFocus }: { value: string[]; allTags: string[]; onChange: (tags: string[]) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const term = text.trim().toLowerCase();
  const suggestions = allTags.filter((t) => !value.includes(t) && (!term || t.toLowerCase().includes(term))).slice(0, 8);
  const add = (raw: string) => {
    const t = raw.trim().slice(0, 40);
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase()) && value.length < 20) onChange([...value, t]);
    setText("");
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 min-h-9">
        {value.map((t) => <TagChip key={t} tag={t} onRemove={() => onChange(value.filter((x) => x !== t))} />)}
        <input autoFocus={autoFocus} value={text} onChange={(e) => setText(e.target.value)} placeholder={value.length ? "" : "Ex.: ADV+, UGC, oferta 2un"}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && text.trim()) { e.preventDefault(); add(text); }
            if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => { if (text.trim()) add(text); }}
          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none" />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {suggestions.map((t) => (
            <button key={t} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(t)} className="opacity-70 hover:opacity-100">
              <TagChip tag={t} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Form = {
  campaign_id: string | null; baseline: Record<string, string>; tags: string[]; kind: string; title: string; hypothesis: string; control: string; variant: string; shop_id: string | null;
  metric: Metric; stop_rule: string; budget: string; status: string; learning: string;
  started_at: string; ended_at: string;
};

function CampaignDialog({ productId, initial, statuses, kinds, shops, campaigns, allTags, onSaved, onClose }: {
  productId: string; initial: Editing; statuses: CampaignStatus[]; kinds: CampaignKind[]; shops: Opt[]; campaigns: Opt[]; allTags: string[];
  onSaved: (row: Experiment, created: boolean) => void; onClose: () => void;
}) {
  const confirm = useConfirm();
  const createFn = useServerFn(createExperiment);
  const updateFn = useServerFn(updateExperiment);
  const deleteFn = useServerFn(deleteExperiment);
  const existing = "id" in initial ? initial : null;
  const [f, setF] = useState<Form>(() => existing ? {
    ...existing, budget: existing.budget?.toString() ?? "", started_at: existing.started_at ?? "", ended_at: existing.ended_at ?? "",
    baseline: Object.fromEntries(Object.entries(existing.baseline ?? {}).map(([k, v]) => [k, String(v)])),
  } : {
    campaign_id: null, baseline: {}, tags: [], kind: kinds[0]?.id ?? "other", title: "", hypothesis: "", control: "", variant: "", shop_id: null, metric: "cpa",
    stop_rule: "", budget: "", status: initial.status, learning: "", started_at: "", ended_at: "",
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const num = (v: string) => Number(v.trim().replace(",", "."));
  const budget = f.budget.trim() ? num(f.budget) : null;
  const budgetOk = budget === null || Number.isFinite(budget);
  const baselineEntries = Object.entries(f.baseline).filter(([, v]) => v.trim());
  const baselineOk = baselineEntries.every(([, v]) => Number.isFinite(num(v)));
  const [showBase, setShowBase] = useState(baselineEntries.length > 0);
  // Campanha nova com data de início já nasce ligada à da Meta (sem início pode ficar sem).
  const needsCampaign = !existing && !!f.started_at && !f.campaign_id;
  const canSave = f.title.trim() && budgetOk && baselineOk && !needsCampaign && statuses.some((s) => s.id === f.status);
  const payload = () => ({
    ...f, title: f.title.trim(), budget,
    baseline: Object.fromEntries(baselineEntries.map(([k, v]) => [k, num(v)])),
    started_at: f.started_at || null, ended_at: f.ended_at || null,
  });
  const save = useMutation({
    mutationFn: () => existing
      ? updateFn({ data: { id: existing.id, ...payload() } })
      : createFn({ data: { product_id: productId, ...payload(), summary: {} } }),
    onSuccess: (row) => { toast.success(existing ? "Campanha salva" : "Campanha criada"); onSaved(row, !existing); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: existing!.id } }),
    onSuccess: () => { onSaved(existing!, false); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  // Escolher a campanha da Meta preenche o nome, se ainda estiver vazio.
  const pickCampaign = (id: string | null) => setF((p) => ({
    ...p, campaign_id: id, title: p.title.trim() || !id ? p.title : campaigns.find((c) => c.id === id)?.name ?? p.title,
  }));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Campanha" : "Nova campanha"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Campanha da Meta" full>
            <select autoFocus={!existing} value={f.campaign_id ?? ""} onChange={(e) => pickCampaign(e.target.value || null)} className={`${inputCls} w-full ${needsCampaign ? "border-amber-500/60" : ""}`}>
              <option value="">{campaigns.length ? "Escolha a campanha" : "Nenhuma campanha ligada ao produto"}</option>
              {f.campaign_id && !campaigns.some((c) => c.id === f.campaign_id) && (
                <option value={f.campaign_id}>{existing?.campaign_name ?? f.campaign_id} (desligada do produto)</option>
              )}
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!campaigns.length
              ? <p className="text-[11px] text-muted-foreground mt-1">Ligue as campanhas do produto em Inteligência › Vendas.</p>
              : needsCampaign && <p className="text-[11px] text-muted-foreground mt-1">Escolha a campanha da Meta (só pode ficar sem enquanto não tem data de início).</p>}
          </Field>
          <Field label="Nome" full>
            <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: CBO vídeo UGC, ADV+ ligado" className={`${inputCls} w-full`} />
          </Field>
          <div className="sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Tags</span>
            <div className="mt-1"><TagInput value={f.tags} allTags={allTags} onChange={(tags) => set("tags", tags)} /></div>
          </div>
          <Field label="Status">
            <select value={f.status} onChange={(e) => set("status", e.target.value)} className={`${inputCls} w-full`}>
              {!statuses.some((s) => s.id === f.status) && <option value={f.status}>Escolha o status</option>}
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="O que está testando">
            <div className="flex items-center gap-1.5">
              <select value={f.kind} onChange={(e) => set("kind", e.target.value)} className={`${inputCls} w-full min-w-0`}>
                {!kinds.some((k) => k.id === f.kind) && <option value={f.kind}>— (opção excluída)</option>}
                {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              <KindEditor kinds={kinds} productId={productId} onCreated={(id) => set("kind", id)} />
            </div>
          </Field>
          <Field label="Hipótese" full>
            <textarea rows={2} value={f.hypothesis} onChange={(e) => set("hypothesis", e.target.value)} placeholder="Ex.: vídeo curto vai baixar o custo por compra" className={`${areaCls} w-full`} />
          </Field>
          <Field label="Controle (versão atual)">
            <input value={f.control} onChange={(e) => set("control", e.target.value)} placeholder="Ex.: imagem estática" className={`${inputCls} w-full`} />
          </Field>
          <Field label="Variação (o que muda)">
            <input value={f.variant} onChange={(e) => set("variant", e.target.value)} placeholder="Ex.: vídeo UGC 15s" className={`${inputCls} w-full`} />
          </Field>
          <Field label="Métrica que decide">
            <select value={f.metric} onChange={(e) => set("metric", e.target.value as Metric)} className={`${inputCls} w-full`}>
              {METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Verba (US$)">
            <input inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} placeholder="Ex.: 150" className={`${inputCls} w-full ${budgetOk ? "" : "border-destructive"}`} />
          </Field>
          <Field label="Regra de parada" full>
            <input value={f.stop_rule} onChange={(e) => set("stop_rule", e.target.value)} placeholder="Ex.: gastou 2x o CPA alvo sem venda, mata" className={`${inputCls} w-full`} />
          </Field>
          <Field label="Loja (opcional)">
            <select value={f.shop_id ?? ""} onChange={(e) => set("shop_id", e.target.value || null)} className={`${inputCls} w-full`}>
              <option value="">Todas / nenhuma</option>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início">
              <input type="date" value={f.started_at} onChange={(e) => set("started_at", e.target.value)} className={`${inputCls} w-full px-2`} />
            </Field>
            <Field label="Fim">
              <input type="date" value={f.ended_at} onChange={(e) => set("ended_at", e.target.value)} className={`${inputCls} w-full px-2`} />
            </Field>
          </div>
          <div className="sm:col-span-2 rounded-xl border border-border">
            <button type="button" onClick={() => setShowBase((v) => !v)} className="w-full flex items-center gap-2 px-3 h-10 text-sm font-medium">
              <ChevronDown className={`size-4 transition-transform ${showBase ? "" : "-rotate-90"}`} />
              Base para comparar
              <span className="text-xs font-normal text-muted-foreground">{baselineEntries.length ? `${baselineEntries.length} preenchidas` : "opcional"}</span>
            </button>
            {showBase && (
              <div className="px-3 pb-3 space-y-3">
                <p className="text-xs text-muted-foreground">Os números de referência (ex.: os da campanha atual). As métricas da campanha são comparadas com eles. Preencha só os que importam.</p>
                {(["meta", "shopify", "clarity"] as MetricSource[]).map((src) => (
                  <div key={src}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{SOURCE_LABEL[src]}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {BASELINE_METRICS.filter((m) => m.source === src).map((m) => {
                        const v = f.baseline[m.key] ?? "";
                        const bad = v.trim() !== "" && !Number.isFinite(num(v));
                        return (
                          <label key={m.key} className="block" title={m.hint}>
                            <span className="text-[11px] text-muted-foreground line-clamp-1">{m.label}{FORMAT_UNIT[m.format] && ` (${FORMAT_UNIT[m.format]})`}</span>
                            <input inputMode="decimal" value={v} onChange={(e) => set("baseline", { ...f.baseline, [m.key]: e.target.value })}
                              className={`${inputCls} w-full mt-0.5 ${bad ? "border-destructive" : ""}`} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Field label="O que você aprendeu (opcional)" full>
            <textarea rows={3} value={f.learning} onChange={(e) => set("learning", e.target.value)}
              placeholder="Ex.: vídeo UGC baixou o CPA de $32 para $21; usar nos outros produtos de casa" className={`${areaCls} w-full`} />
            <p className="text-[11px] text-muted-foreground mt-1">Com isso preenchido, a campanha aparece em Produtos › Aprendizados.</p>
          </Field>
          <div className="sm:col-span-2 flex items-center gap-2 pt-1">
            {existing && (
              <button type="button"
                onClick={() => confirm({ title: `Excluir a campanha "${existing.title}"?`, description: "O diário interno dela também é apagado. A campanha na Meta não muda." }).then((ok) => { if (ok) remove.mutate(); })}
                className="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex items-center gap-1.5">
                <Trash2 className="size-3.5" /> Excluir
              </button>
            )}
            <button type="button" onClick={onClose} className="ml-auto h-9 px-3 rounded-lg border border-border text-sm hover:bg-muted">Cancelar</button>
            <button type="submit" disabled={!canSave || save.isPending} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Botão ao lado de "O que está testando": adicionar, renomear e excluir
// opções. Vale para todas as campanhas.
function KindEditor({ kinds, productId, onCreated }: { kinds: CampaignKind[]; productId: string; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveCampaignKinds);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CampaignKind[]>(kinds);
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: (next: CampaignKind[]) => saveFn({ data: { kinds: next.map((k) => ({ ...k, name: k.name.trim() })) } }),
    onSuccess: () => {
      toast.success("Opções salvas");
      setOpen(false);
      const added = list.find((k) => !kinds.some((o) => o.id === k.id));
      if (added) onCreated(added.id);
      qc.invalidateQueries({ queryKey: ["product-experiments", productId] });
      qc.invalidateQueries({ queryKey: ["learnings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const add = () => {
    const name = text.trim().slice(0, 40);
    if (name) setList((l) => [...l, { id: `k${Date.now().toString(36)}`, name }]);
    setText("");
  };
  const canSave = list.length > 0 && list.every((k) => k.name.trim());
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setList(kinds); setText(""); } }}>
      <PopoverTrigger asChild>
        <button type="button" title="Editar opções" className="size-9 shrink-0 rounded-lg border border-border grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground">
          <Pencil className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="text-sm font-semibold">O que está testando</p>
        <p className="text-[11px] text-muted-foreground mb-2">Opções para todas as campanhas.</p>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {list.map((k, i) => (
            <div key={k.id} className="flex items-center gap-1.5">
              <input value={k.name} maxLength={40} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className={`${inputCls} h-8 flex-1 min-w-0 ${k.name.trim() ? "" : "border-destructive"}`} />
              <button type="button" disabled={list.length === 1} onClick={() => setList((l) => l.filter((_, j) => j !== i))} title="Excluir opção"
                className="size-7 grid place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <input value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder="Nova opção"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            className={`${inputCls} h-8 flex-1 min-w-0`} />
          <button type="button" onClick={add} disabled={!text.trim() || list.length >= 40} title="Adicionar"
            className="size-8 grid place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40">
            <Plus className="size-3.5" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">Excluir não muda as campanhas que já usam a opção.</p>
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" onClick={() => setOpen(false)} className="h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted">Cancelar</button>
          <button type="button" disabled={!canSave || save.isPending} onClick={() => save.mutate(list)}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
            {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

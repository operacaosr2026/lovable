import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronRight, Plus, Trash2, FileText, Star,
  ChevronLeft, GripVertical, Search, BookOpen, Copy, Check,
} from "lucide-react";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  DragOverlay, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  listJournalPages, getJournalPage, createJournalPage,
  updateJournalPage, deleteJournalPage,
  toggleJournalFavorite, moveJournalPage,
} from "@/lib/journal.functions";
import { NotionEditor } from "@/components/journal/NotionEditor";

type PageRow = {
  id: string; parent_id: string | null; title: string;
  icon: string | null; position: number; updated_at: string;
  is_favorite?: boolean; last_opened_at?: string | null;
};

export function ShopWiki({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listJournalPages);
  const getOne = useServerFn(getJournalPage);
  const createFn = useServerFn(createJournalPage);
  const updateFn = useServerFn(updateJournalPage);
  const deleteFn = useServerFn(deleteJournalPage);
  const favFn = useServerFn(toggleJournalFavorite);
  const moveFn = useServerFn(moveJournalPage);

  const queryKey = ["shop-wiki", shopId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => list({ data: { shop_id: shopId } }),
  });

  const pages: PageRow[] = (data?.pages ?? []) as PageRow[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeDrag, setActiveDrag] = useState<PageRow | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!selectedId && pages.length > 0) setSelectedId(pages[0].id);
  }, [pages, selectedId]);

  const pageById = useMemo(() => {
    const m: Record<string, PageRow> = {};
    for (const p of pages) m[p.id] = p;
    return m;
  }, [pages]);

  const childrenMap = useMemo(() => {
    const m: Record<string, PageRow[]> = {};
    for (const p of pages) {
      const k = p.parent_id ?? "root";
      (m[k] ??= []).push(p);
    }
    return m;
  }, [pages]);

  const favorites = useMemo(() => pages.filter((p) => p.is_favorite).slice(0, 20), [pages]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return pages.filter((p) => (p.title || "").toLowerCase().includes(q)).slice(0, 30);
  }, [search, pages]);

  const breadcrumbs = useMemo(() => {
    const chain: PageRow[] = [];
    let cur = selectedId ? pageById[selectedId] : null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id ? pageById[cur.parent_id] : null;
    }
    return chain;
  }, [selectedId, pageById]);

  const inv = () => qc.invalidateQueries({ queryKey });
  const create = useMutation({
    mutationFn: (parent_id: string | null) =>
      createFn({ data: { parent_id, shop_id: shopId } }),
    onSuccess: ({ page }: any) => {
      inv();
      if (page.parent_id) setExpanded((e) => ({ ...e, [page.parent_id!]: true }));
      setSelectedId(page.id);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (_r, id) => { inv(); if (selectedId === id) setSelectedId(null); },
  });
  const toggleFav = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => favFn({ data: { id, value } }),
    onSuccess: inv,
  });
  const move = useMutation({
    mutationFn: (v: { id: string; parent_id: string | null }) => moveFn({ data: v }),
    onSuccess: inv,
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragStart = (e: DragStartEvent) => {
    setActiveDrag(pageById[String(e.active.id)] ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    const activeId = String(e.active.id);
    if (!overId || overId === activeId) return;
    const targetParent = overId === "wiki-root" ? null : overId;
    const current = pageById[activeId];
    if (!current) return;
    if (current.parent_id === targetParent) return;
    move.mutate({ id: activeId, parent_id: targetParent });
    if (targetParent) setExpanded((e) => ({ ...e, [targetParent]: true }));
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex flex-col md:flex-row gap-4 min-h-[calc(100vh-16rem)]">
        <aside className="w-full md:w-72 shrink-0 rounded-2xl border border-border bg-surface p-3 flex flex-col gap-4">
          <div className="flex items-center justify-between px-2 py-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="size-4 text-primary" /> Central da Loja
            </div>
            <button
              onClick={() => create.mutate(null)}
              title="Nova página"
              className="size-7 rounded-md hover:bg-muted grid place-items-center text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="relative px-1">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="w-full bg-background/60 border border-border rounded-md pl-8 pr-2 py-1.5 text-sm outline-none focus:border-primary/50"
            />
          </div>

          {searchResults ? (
            <Section icon={<Search className="size-3.5 text-muted-foreground" />} label={`Resultados (${searchResults.length})`}>
              {searchResults.length === 0 ? (
                <div className="text-xs text-muted-foreground px-2 py-3">Nada encontrado.</div>
              ) : (
                searchResults.map((p) => (
                  <SidebarLeaf key={p.id} page={p} active={selectedId === p.id} onSelect={() => setSelectedId(p.id)} />
                ))
              )}
            </Section>
          ) : (
            <>
              {favorites.length > 0 && (
                <Section icon={<Star className="size-3.5 text-amber-400" />} label="Fixados">
                  {favorites.map((p) => (
                    <SidebarLeaf key={p.id} page={p} active={selectedId === p.id} onSelect={() => setSelectedId(p.id)} />
                  ))}
                </Section>
              )}

              <Section icon={<FileText className="size-3.5 text-muted-foreground" />} label="Páginas">
                {isLoading ? (
                  <div className="text-xs text-muted-foreground px-2 py-4">Carregando…</div>
                ) : (
                  <RootDroppable>
                    {(childrenMap["root"]?.length ?? 0) === 0 ? (
                      <button
                        onClick={() => create.mutate(null)}
                        className="w-full text-left text-xs text-muted-foreground px-2 py-3 rounded-md hover:bg-muted"
                      >
                        + Criar primeira página
                      </button>
                    ) : (
                      <Tree
                        parentId={null}
                        childrenMap={childrenMap}
                        expanded={expanded}
                        setExpanded={setExpanded}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onCreateChild={(pid) => create.mutate(pid)}
                        onDelete={(id) => { if (confirm("Excluir esta página e todas as subpáginas?")) remove.mutate(id); }}
                        depth={0}
                      />
                    )}
                  </RootDroppable>
                )}
              </Section>
            </>
          )}
        </aside>

        <section className="flex-1 min-w-0 rounded-2xl border border-border bg-surface">
          {selectedId ? (
            <WikiEditor
              key={selectedId}
              pageId={selectedId}
              breadcrumbs={breadcrumbs}
              subpages={childrenMap[selectedId] ?? []}
              fetchPage={getOne}
              save={updateFn}
              onChangedTitle={inv}
              onNavigate={setSelectedId}
              onCreateSub={() => create.mutate(selectedId)}
              onToggleFav={(v) => toggleFav.mutate({ id: selectedId, value: v })}
              isFavorite={!!pageById[selectedId]?.is_favorite}
            />
          ) : (
            <div className="grid place-items-center h-full p-12 text-center text-sm text-muted-foreground">
              <div>
                <FileText className="size-8 mx-auto mb-2 opacity-50" />
                Crie a primeira página da central desta loja.
              </div>
            </div>
          )}
        </section>
      </div>

      <DragOverlay>
        {activeDrag && (
          <div className="px-2 py-1 rounded-md bg-popover border border-border shadow-lg text-sm flex items-center gap-1.5 max-w-[240px]">
            <span>{activeDrag.icon ?? "📄"}</span>
            <span className="truncate">{activeDrag.title || "Sem título"}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 mb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon} {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SidebarLeaf({ page, active, onSelect }: { page: PageRow; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-left ${active ? "bg-muted" : "hover:bg-muted/60"}`}
    >
      <span className="text-base leading-none">{page.icon ?? "📄"}</span>
      <span className="truncate">{page.title || "Sem título"}</span>
    </button>
  );
}

function RootDroppable({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "wiki-root" });
  return (
    <div ref={setNodeRef} className={`rounded-md ${isOver ? "ring-2 ring-primary/40" : ""}`}>
      {children}
    </div>
  );
}

function Tree(props: {
  parentId: string | null;
  childrenMap: Record<string, PageRow[]>;
  expanded: Record<string, boolean>;
  setExpanded: (fn: (e: Record<string, boolean>) => Record<string, boolean>) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  depth: number;
}) {
  const items = props.childrenMap[props.parentId ?? "root"] ?? [];
  return (
    <ul className="space-y-0.5">
      {items.map((p) => (
        <TreeItem key={p.id} page={p} {...props} />
      ))}
    </ul>
  );
}

function TreeItem({
  page: p, childrenMap, expanded, setExpanded,
  selectedId, onSelect, onCreateChild, onDelete, depth,
}: {
  page: PageRow;
  childrenMap: Record<string, PageRow[]>;
  expanded: Record<string, boolean>;
  setExpanded: (fn: (e: Record<string, boolean>) => Record<string, boolean>) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  depth: number;
}) {
  const kids = childrenMap[p.id] ?? [];
  const isOpen = !!expanded[p.id];
  const isActive = selectedId === p.id;
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: p.id });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: p.id });

  return (
    <li>
      <div
        ref={(el) => { dragRef(el); dropRef(el); }}
        className={`group flex items-center gap-1 rounded-md pr-1 ${isActive ? "bg-muted" : "hover:bg-muted/60"} ${isOver ? "ring-2 ring-primary/40" : ""} ${isDragging ? "opacity-40" : ""}`}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          {...attributes}
          {...listeners}
          className="size-5 grid place-items-center text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0 opacity-0 group-hover:opacity-100"
          title="Arrastar"
        >
          <GripVertical className="size-3.5" />
        </button>
        <button
          onClick={() => setExpanded((e) => ({ ...e, [p.id]: !isOpen }))}
          className={`size-5 grid place-items-center text-muted-foreground shrink-0 ${kids.length === 0 ? "opacity-30 pointer-events-none" : ""}`}
        >
          <ChevronRight className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        </button>
        <button
          onClick={() => onSelect(p.id)}
          className="flex-1 min-w-0 text-left text-sm py-1 truncate flex items-center gap-1.5"
        >
          <span className="text-base leading-none">{p.icon ?? "📄"}</span>
          <span className="truncate">{p.title || "Sem título"}</span>
          {p.is_favorite && <Star className="size-3 text-amber-400 fill-amber-400 shrink-0" />}
        </button>
        <button
          onClick={() => onCreateChild(p.id)}
          title="Adicionar subpágina"
          className="opacity-0 group-hover:opacity-100 size-6 rounded grid place-items-center hover:bg-background text-muted-foreground"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          onClick={() => onDelete(p.id)}
          title="Excluir"
          className="opacity-0 group-hover:opacity-100 size-6 rounded grid place-items-center hover:bg-background text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {isOpen && kids.length > 0 && (
        <Tree
          parentId={p.id}
          childrenMap={childrenMap}
          expanded={expanded}
          setExpanded={setExpanded}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreateChild={onCreateChild}
          onDelete={onDelete}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

function WikiEditor({
  pageId, breadcrumbs, subpages, fetchPage, save, onChangedTitle,
  onNavigate, onCreateSub, onToggleFav, isFavorite,
}: {
  pageId: string;
  breadcrumbs: PageRow[];
  subpages: PageRow[];
  fetchPage: (a: { data: { id: string } }) => Promise<{ page: any }>;
  save: (a: { data: { id: string; title?: string; content?: string; icon?: string | null } }) => Promise<unknown>;
  onChangedTitle: () => void;
  onNavigate: (id: string) => void;
  onCreateSub: () => void;
  onToggleFav: (v: boolean) => void;
  isFavorite: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["shop-wiki-page", pageId],
    queryFn: () => fetchPage({ data: { id: pageId } }),
  });

  const [title, setTitle] = useState("");
  const [, setContent] = useState("");
  const [icon, setIcon] = useState<string>("📄");
  const loadedRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (data?.page && loadedRef.current !== pageId) {
      setTitle(data.page.title ?? "");
      setContent(data.page.content ?? "");
      setIcon(data.page.icon ?? "📄");
      loadedRef.current = pageId;
    }
  }, [data, pageId]);

  const scheduleSave = (next: { title?: string; content?: string; icon?: string | null }) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await save({ data: { id: pageId, ...next } });
      setSavedAt(new Date());
      if (next.title !== undefined || next.icon !== undefined) onChangedTitle();
    }, 500);
  };

  const copyPagePlainText = async () => {
    try {
      const raw = data?.page?.content ?? "";
      let text = "";
      try {
        const parsed = JSON.parse(raw);
        const walk = (nodes: any[]): string =>
          nodes.map((b) => {
            const inner = Array.isArray(b.content)
              ? b.content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("")
              : "";
            const kids = Array.isArray(b.children) ? walk(b.children) : "";
            return [inner, kids].filter(Boolean).join("\n");
          }).join("\n");
        text = Array.isArray(parsed) ? walk(parsed) : String(raw);
      } catch {
        text = String(raw);
      }
      await navigator.clipboard.writeText(`${title}\n\n${text}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {/* noop */}
  };

  if (isLoading) {
    return <div className="grid place-items-center h-full p-12"><div className="size-6 rounded-full border-2 border-border border-t-primary animate-spin" /></div>;
  }

  const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;

  return (
    <div className="p-6 sm:p-10 max-w-3xl mx-auto">
      <div className="flex items-center gap-1 mb-4 text-xs text-muted-foreground flex-wrap">
        {parent && (
          <button
            onClick={() => onNavigate(parent.id)}
            className="flex items-center gap-1 hover:text-foreground rounded px-1 py-0.5 hover:bg-muted mr-1"
            title="Voltar"
          >
            <ChevronLeft className="size-3.5" />
          </button>
        )}
        {breadcrumbs.map((b, i) => (
          <div key={b.id} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight className="size-3 shrink-0" />}
            <button
              onClick={() => onNavigate(b.id)}
              className={`truncate max-w-[200px] hover:text-foreground hover:bg-muted rounded px-1 py-0.5 ${i === breadcrumbs.length - 1 ? "text-foreground font-medium" : ""}`}
            >
              <span className="mr-1">{b.icon ?? "📄"}</span>
              {b.title || "Sem título"}
            </button>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={copyPagePlainText}
            title="Copiar conteúdo"
            className="size-7 rounded-md hover:bg-muted grid place-items-center text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          </button>
          <button
            onClick={() => onToggleFav(!isFavorite)}
            title={isFavorite ? "Desafixar" : "Fixar"}
            className="size-7 rounded-md hover:bg-muted grid place-items-center text-muted-foreground hover:text-foreground"
          >
            <Star className={`size-4 ${isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
          </button>
          <div className="text-[11px]">
            {savedAt ? `Salvo ${savedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Salvamento automático"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => {
            const next = prompt("Emoji do ícone (1 caractere):", icon) ?? icon;
            const v = next.slice(0, 4);
            setIcon(v);
            scheduleSave({ icon: v });
          }}
          className="text-4xl leading-none hover:bg-muted rounded-md p-1"
          title="Mudar ícone"
        >{icon}</button>
      </div>

      <input
        value={title}
        onChange={(e) => { setTitle(e.target.value); scheduleSave({ title: e.target.value }); }}
        placeholder="Sem título"
        className="w-full bg-transparent text-3xl sm:text-4xl font-bold outline-none placeholder:text-muted-foreground/40 mb-4"
      />

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Subpáginas
          </div>
          <button
            onClick={onCreateSub}
            className="text-xs flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" /> Nova subpágina
          </button>
        </div>
        {subpages.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {subpages.map((s) => (
              <button
                key={s.id}
                onClick={() => onNavigate(s.id)}
                className="group flex items-start gap-2 text-left rounded-lg border border-border bg-background/40 hover:bg-muted/60 hover:border-primary/40 px-3 py-3 transition"
              >
                <span className="text-xl leading-none mt-0.5">{s.icon ?? "📄"}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate group-hover:text-primary">
                    {s.title || "Sem título"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Subpágina</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={onCreateSub}
            className="w-full text-left text-sm text-muted-foreground rounded-lg border border-dashed border-border px-4 py-4 hover:bg-muted/40 hover:text-foreground transition"
          >
            + Adicionar uma subpágina
          </button>
        )}
      </div>

      <NotionEditor
        initialContent={data?.page?.content ?? ""}
        onChange={(json: string) => { setContent(json); scheduleSave({ content: json }); }}
      />
    </div>
  );
}

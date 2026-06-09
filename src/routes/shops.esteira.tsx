import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { Store, MapPin, GripVertical } from "lucide-react";
import { listShops, updateShop, PIPELINE_STAGES } from "@/lib/shops.functions";
import { getCountry } from "./shops.index";
import { useKanbanColumns, useColumnDnD, ColumnControls, AddColumnButton } from "@/components/kanban/useKanbanColumns";

export const Route = createFileRoute("/shops/esteira")({
  component: EsteiraPage,
  head: () => ({
    meta: [
      { title: "Esteira de Lojas — Orbit" },
      { name: "description", content: "Pipeline kanban das suas lojas." },
    ],
  }),
});

const STAGE_META: Record<(typeof PIPELINE_STAGES)[number], { label: string; tint: string; accent: string }> = {
  para_criar:        { label: "Para Criar",          tint: "oklch(0.96 0.01 260)", accent: "oklch(0.45 0.02 260)" },
  criando:           { label: "Criando",             tint: "oklch(0.96 0.04 75)",  accent: "oklch(0.55 0.16 65)" },
  prontas:           { label: "Prontas",             tint: "oklch(0.96 0.04 195)", accent: "oklch(0.5 0.14 215)" },
  aquecimento:       { label: "Aquecimento",         tint: "oklch(0.95 0.05 35)",  accent: "oklch(0.55 0.18 35)" },
  validacao_produto: { label: "Validação de Produto", tint: "oklch(0.96 0.04 285)", accent: "oklch(0.5 0.18 285)" },
  escalando:         { label: "Escalando",           tint: "oklch(0.96 0.05 155)", accent: "oklch(0.5 0.14 155)" },
  congelada:         { label: "Congelada",           tint: "oklch(0.96 0.02 230)", accent: "oklch(0.5 0.06 230)" },
};

const DEFAULT_COLUMNS = PIPELINE_STAGES.map((stage) => ({
  id: stage,
  label: STAGE_META[stage].label,
  tint: STAGE_META[stage].tint,
  accent: STAGE_META[stage].accent,
}));

function EsteiraPage() {
  const qc = useQueryClient();
  const list = useServerFn(listShops);
  const updateFn = useServerFn(updateShop);

  const { data } = useQuery({ queryKey: ["shops"], queryFn: () => list() });
  const shops = (data?.shops ?? []) as any[];

  const cols = useKanbanColumns({
    boardType: "shop_pipeline",
    boardId: "global",
    defaults: DEFAULT_COLUMNS,
  });
  const dnd = useColumnDnD(cols.columns, cols.reorder);

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const c of cols.columns) g[c.id] = [];
    for (const s of shops) {
      const st = (s.pipeline_stage as string) || cols.columns[0]?.id || "para_criar";
      (g[st] ??= []).push(s);
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => (a.pipeline_position ?? 0) - (b.pipeline_position ?? 0));
    }
    return g;
  }, [shops, cols.columns]);

  const update = useMutation({
    mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }),
    onMutate: async ({ id, patch }: any) => {
      await qc.cancelQueries({ queryKey: ["shops"] });
      const prev = qc.getQueryData<any>(["shops"]);
      qc.setQueryData<any>(["shops"], (old: any) => {
        if (!old?.shops) return old;
        return { ...old, shops: old.shops.map((s: any) => (s.id === id ? { ...s, ...patch } : s)) };
      });
      return { prev };
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) qc.setQueryData(["shops"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["shops"] }),
  });

  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const onDrop = (stage: string) => {
    if (!dragId) return;
    const s = shops.find((x) => x.id === dragId);
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    if (!s || s.pipeline_stage === stage) return;
    update.mutate({ id, patch: { pipeline_stage: stage } });
  };

  return (
    <PageShell>
      <PageHeader
        title="Esteira de Lojas"
        subtitle={`${shops.length} ${shops.length === 1 ? "loja" : "lojas"} no pipeline`}
      />

      {shops.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Store className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-3">
            Nenhuma loja ainda. Cadastre lojas em <Link to="/shops" className="text-primary underline">Lojas</Link> para vê-las aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {cols.columns.map((col) => {
            const stage = col.id;
            const items = grouped[stage] ?? [];
            const isCardOver = overStage === stage;
            const isColOver = dnd.overKey === stage;
            const isDragging = dnd.draggingKey === stage;
            const headerProps = dnd.headerDragProps(col);
            return (
              <div
                key={stage}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/x-kanban-col")) return;
                  e.preventDefault();
                  setOverStage(stage);
                }}
                onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                onDrop={() => onDrop(stage)}
                className={`rounded-2xl border bg-surface/40 transition-all ${isCardOver ? "border-primary/60 bg-primary/5" : isColOver ? "border-primary/60 ring-2 ring-primary/30" : "border-border"} ${isDragging ? "opacity-50" : ""}`}
              >
                <div
                  {...headerProps}
                  className="px-3 py-2.5 flex items-center justify-between border-b border-border select-none active:cursor-grabbing"
                  title="Arraste para reordenar"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GripVertical className="size-3.5 text-muted-foreground/60 shrink-0" />
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold truncate" style={{ background: col.tint, color: col.accent }}>
                      {col.label}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                  </div>
                  <ColumnControls
                    col={col}
                    itemCount={items.length}
                    onRename={(label) => cols.rename(col, label)}
                    onRecolor={(c) => cols.recolor(col, c)}
                    onDelete={() => cols.remove(col)}
                  />
                </div>

                <div className="p-2 min-h-[64px]">
                  {items.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground text-center py-4 italic">
                      Arraste lojas para cá
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {items.map((s) => {
                        const c = getCountry(s.country);
                        return (
                          <div
                            key={s.id}
                            draggable
                            onDragStart={(e) => {
                              setDragId(s.id);
                              e.dataTransfer.effectAllowed = "move";
                              const el = e.currentTarget as HTMLElement;
                              const rect = el.getBoundingClientRect();
                              e.dataTransfer.setDragImage(el, e.clientX - rect.left, e.clientY - rect.top);
                            }}
                            onDragEnd={() => { setDragId(null); setOverStage(null); }}
                            className={`group w-full sm:w-64 rounded-xl border border-border bg-background p-3 cursor-grab active:cursor-grabbing transition-all ${dragId === s.id ? "opacity-40 scale-[0.98]" : "hover:border-primary/40 hover:shadow-sm"}`}
                          >
                            <Link
                              to="/shops/$shopId"
                              params={{ shopId: s.id }}
                              draggable={false}
                              onDragStart={(e) => e.preventDefault()}
                              className="flex items-start gap-2.5 select-none"
                            >
                              {s.logo_url ? (
                                <img src={s.logo_url} alt={s.name} draggable={false} className="size-9 rounded-lg object-cover shrink-0 border border-border pointer-events-none" />
                              ) : (
                                <div className="size-9 rounded-lg grid place-items-center shrink-0 bg-primary/10 text-primary">
                                  <Store className="size-4" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium leading-tight truncate flex items-center gap-1.5">
                                  <span className="truncate">{s.name}</span>
                                  {s.tag && (
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 truncate max-w-[100px]">
                                      {s.tag}
                                    </span>
                                  )}
                                </div>
                                {c ? (
                                  <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                                    <span className="text-sm leading-none">{c.flag}</span> {c.label}
                                  </div>
                                ) : s.country ? (
                                  <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                                    <MapPin className="size-3" /> {s.country}
                                  </div>
                                ) : null}
                              </div>
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <AddColumnButton onAdd={cols.add} className="!w-full" />
        </div>
      )}
    </PageShell>
  );
}

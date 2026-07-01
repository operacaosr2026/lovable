import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from "recharts";
import {
  Megaphone, ShoppingCart, TrendingUp, Wallet,
  Target, TrendingDown, Minus, StickyNote, Lightbulb, Plus, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getLgOverviewMetrics,
  getLgAccumulatedLucro,
  getLgCardGoal,
  createLgCardGoal,
  updateLgCardGoal,
  finalizeLgCardGoal,
  listLgCardGoalHistory,
} from "@/lib/lg-overview.functions";
import { LgNotesSection } from "@/components/lojas-grupos/LgNotesSection";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToday() {
  return new Date().toLocaleDateString("en-CA");
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function daysBetween(from: string, to: string) {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400_000);
}

function addDaysIso(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDatePt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function ProgressTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const real = payload.find((p: any) => p.dataKey === "lucroAcumulado" && p.value != null);
  const projetado = payload.find((p: any) => p.dataKey === "lucroProjetado" && p.value != null);
  return (
    <div className="rounded-xl bg-card border border-border p-2.5 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1 font-medium">{label}</p>
      {real && <p className="font-semibold text-foreground">{fmtMoney(real.value)} <span className="text-muted-foreground font-normal">(real)</span></p>}
      {projetado && <p className="font-semibold text-primary/70">{fmtMoney(projetado.value)} <span className="text-muted-foreground font-normal">(projeção)</span></p>}
    </div>
  );
}

// Compara o ritmo dos últimos 7 dias com a média geral do período da meta
function tendenciaKind(mediaUltimos7?: number, mediaGeral?: number): "up" | "down" | "flat" | null {
  if (mediaUltimos7 == null || mediaGeral == null || mediaGeral === 0) return null;
  const variacao = (mediaUltimos7 - mediaGeral) / Math.abs(mediaGeral);
  if (variacao > 0.1) return "up";
  if (variacao < -0.1) return "down";
  return "flat";
}

function tendenciaLabel(mediaUltimos7?: number, mediaGeral?: number) {
  const kind = tendenciaKind(mediaUltimos7, mediaGeral);
  if (kind === "up") return "Acelerando";
  if (kind === "down") return "Desacelerando";
  if (kind === "flat") return "Estável";
  return "—";
}

function tendenciaVariacaoPct(mediaUltimos7?: number, mediaGeral?: number) {
  if (mediaUltimos7 == null || mediaGeral == null || mediaGeral === 0) return 0;
  return ((mediaUltimos7 - mediaGeral) / Math.abs(mediaGeral)) * 100;
}

function TendenciaIcon({ mediaUltimos7, mediaGeral }: { mediaUltimos7?: number; mediaGeral?: number }) {
  const kind = tendenciaKind(mediaUltimos7, mediaGeral);
  if (kind === "up") return <TrendingUp className="size-3 text-success" />;
  if (kind === "down") return <TrendingDown className="size-3 text-destructive" />;
  return <Minus className="size-3" />;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

// ─── Sub-tab button ─────────────────────────────────────────────────────────────

function SubTabBtn({
  active, onClick, icon, children,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Section container ────────────────────────────────────────────────────────

function Section({
  title, icon, children, badge,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center">
            {icon}
          </div>
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

// ─── Stat card (top row do dashboard de Meta) ──────────────────────────────────

const ACCENTS = {
  primary: "bg-primary/10 text-primary",
  blue:    "bg-blue-500/10 text-blue-600",
  success: "bg-success/10 text-success",
} as const;

function StatCard({
  icon, accent, label, value, sub, loading,
}: {
  icon: React.ReactNode; accent: keyof typeof ACCENTS; label: string; value: string; sub?: string; loading?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
      <div className={cn("size-9 rounded-xl grid place-items-center", ACCENTS[accent])}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
        {loading
          ? <Skeleton className="h-6 w-24" />
          : <p className="text-xl font-bold text-foreground">{value}</p>
        }
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Summary row (card "Resumo da meta") ───────────────────────────────────────

function SummaryRow({
  label, value, valueClass = "text-foreground",
}: {
  label: string; value: string; valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", valueClass)}>{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LgOverview({ card, shopIds }: { card: any; shopIds: string[] }) {
  const queryClient = useQueryClient();
  const hasShops = shopIds.length > 0;

  const getMetricsFn   = useServerFn(getLgOverviewMetrics);
  const getAccFn       = useServerFn(getLgAccumulatedLucro);
  const getGoalFn      = useServerFn(getLgCardGoal);
  const createGoalFn   = useServerFn(createLgCardGoal);
  const updateGoalFn   = useServerFn(updateLgCardGoal);
  const finalizeGoalFn = useServerFn(finalizeLgCardGoal);
  const getHistoryFn   = useServerFn(listLgCardGoalHistory);

  // ── Main metrics query (mês, usado só pelo cálculo da Meta) ──────────────
  const { data: metricsData, isLoading: loadingMetrics } = useQuery({
    queryKey: ["lg-overview-metrics", shopIds.join(",")],
    queryFn: () => getMetricsFn({ data: { shop_ids: shopIds } }),
    enabled: hasShops,
    staleTime: 3 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: true,
  });

  // ── Goal query (meta ativa) ────────────────────────────────────────────────
  const { data: goalData, isLoading: loadingGoal } = useQuery({
    queryKey: ["lg-card-goal", card.id],
    queryFn: () => getGoalFn({ data: { card_id: card.id } }),
    staleTime: 60_000,
  });

  const savedGoal = goalData?.goal as any ?? null;

  // ── Accumulated lucro (from goal start_date) ──────────────────────────────
  const { data: accData, isLoading: loadingAcc } = useQuery({
    queryKey: ["lg-acc-lucro", shopIds.join(","), savedGoal?.start_date],
    queryFn: () => getAccFn({ data: { shop_ids: shopIds, start_date: savedGoal.start_date } }),
    enabled: hasShops && !!savedGoal,
    staleTime: 3 * 60_000,
  });

  // ── Histórico de metas (todas, ativa + encerradas) ─────────────────────────
  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: ["lg-goal-history", card.id, shopIds.join(",")],
    queryFn: () => getHistoryFn({ data: { card_id: card.id, shop_ids: shopIds } }),
    enabled: hasShops,
    staleTime: 60_000,
  });

  // ── Subabas: Definir Meta / Histórico / Diário de Operação ────────────────
  const [subTab, setSubTab] = useState<"definir" | "historico" | "diario">("definir");

  // ── Nova meta (widget do canto) ─────────────────────────────────────────────
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [newMetaInput, setNewMetaInput] = useState("");
  const [newStartInput, setNewStartInput] = useState(isoToday());
  const [newPrazoInput, setNewPrazoInput] = useState("");
  const [newLucroPorVendaInput, setNewLucroPorVendaInput] = useState("");
  const [creatingGoal, setCreatingGoal] = useState(false);

  // ── Editar meta ativa (clicando no pill do canto) ───────────────────────────
  const [editGoalOpen, setEditGoalOpen] = useState(false);
  const [editMetaInput, setEditMetaInput] = useState("");
  const [editStartInput, setEditStartInput] = useState("");
  const [editPrazoInput, setEditPrazoInput] = useState("");
  const [editLucroPorVendaInput, setEditLucroPorVendaInput] = useState("");
  const [savingEditGoal, setSavingEditGoal] = useState(false);

  function openEditGoal() {
    if (!savedGoal) return;
    setEditMetaInput(String(savedGoal.meta ?? ""));
    setEditStartInput(savedGoal.start_date ?? "");
    setEditPrazoInput(savedGoal.prazo ?? "");
    setEditLucroPorVendaInput(String(savedGoal.lucro_por_venda ?? ""));
    setEditGoalOpen(true);
  }

  async function refreshGoalQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lg-card-goal", card.id] }),
      queryClient.invalidateQueries({ queryKey: ["lg-acc-lucro"] }),
      queryClient.invalidateQueries({ queryKey: ["lg-goal-history", card.id] }),
    ]);
  }

  async function handleCreateGoal() {
    const meta = parseFloat(newMetaInput);
    const lucroPorVenda = parseFloat(newLucroPorVendaInput);
    if (!meta || meta <= 0) { toast.error("Informe um valor de meta válido"); return; }
    if (!newStartInput || !newPrazoInput) { toast.error("Informe início e fim"); return; }
    if (!lucroPorVenda || lucroPorVenda <= 0) { toast.error("Informe o lucro previsto por venda"); return; }
    setCreatingGoal(true);
    try {
      await createGoalFn({ data: { card_id: card.id, meta, start_date: newStartInput, prazo: newPrazoInput, lucro_por_venda: lucroPorVenda } });
      await refreshGoalQueries();
      toast.success("Meta criada");
      setNewGoalOpen(false);
      setNewMetaInput("");
      setNewPrazoInput("");
      setNewLucroPorVendaInput("");
      setSubTab("historico");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar meta");
    } finally {
      setCreatingGoal(false);
    }
  }

  async function handleUpdateGoal() {
    if (!savedGoal) return;
    const meta = parseFloat(editMetaInput);
    const lucroPorVenda = parseFloat(editLucroPorVendaInput);
    if (!meta || meta <= 0) { toast.error("Informe um valor de meta válido"); return; }
    if (!editStartInput || !editPrazoInput) { toast.error("Informe início e fim"); return; }
    if (!lucroPorVenda || lucroPorVenda <= 0) { toast.error("Informe o lucro previsto por venda"); return; }
    setSavingEditGoal(true);
    try {
      await updateGoalFn({ data: { id: savedGoal.id, meta, start_date: editStartInput, prazo: editPrazoInput, lucro_por_venda: lucroPorVenda } });
      await refreshGoalQueries();
      toast.success("Meta atualizada");
      setEditGoalOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao atualizar meta");
    } finally {
      setSavingEditGoal(false);
    }
  }

  async function handleFinalizeGoal() {
    if (!savedGoal) return;
    if (!window.confirm("Finalizar a meta atual agora? O resultado (batida ou não) fica registrado no histórico e não pode ser desfeito.")) return;
    try {
      await finalizeGoalFn({ data: { id: savedGoal.id } });
      await refreshGoalQueries();
      toast.success("Meta finalizada");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao finalizar meta");
    }
  }

  // ── Derived meta calculations ─────────────────────────────────────────────
  // Vendas/dia = (falta pra meta ÷ dias restantes) ÷ lucro previsto por venda,
  // definido junto com a meta (em vez de derivado de dados históricos).
  const derived = useMemo(() => {
    if (!savedGoal || !metricsData || !accData) return null;

    const meta = Number(savedGoal.meta ?? 0);
    const lucroAcumulado = accData.lucro ?? 0;
    const lucroRestante = meta - lucroAcumulado;
    const percentAtingida = meta > 0 ? (lucroAcumulado / meta) * 100 : 0;
    const batida = lucroAcumulado >= meta;

    const today = isoToday();
    const diasRestantes = Math.max(0, daysBetween(today, savedGoal.prazo));
    const vencida = daysBetween(today, savedGoal.prazo) <= 0 && !batida;

    const projecaoFinal = lucroAcumulado + (accData.mediaUltimos7 ?? 0) * diasRestantes;
    const percentProjecao = meta > 0 ? (projecaoFinal / meta) * 100 : 0;
    const lucroNecessarioPorDia = diasRestantes > 0 ? lucroRestante / diasRestantes : 0;

    const lucroPorVenda = Number(savedGoal.lucro_por_venda ?? 0);
    const cpaEfetivo = (metricsData.month.cpa ?? 0) > 0 ? metricsData.month.cpa : (accData.cpa ?? 0);
    const semLucroPorVenda = lucroPorVenda <= 0;

    let vendasPorDia = 0, investimentoPorDia = 0;
    if (!semLucroPorVenda && diasRestantes > 0) {
      vendasPorDia = Math.round(lucroNecessarioPorDia / lucroPorVenda);
      investimentoPorDia = vendasPorDia * cpaEfetivo;
    }

    return {
      lucroAcumulado,
      vendasPorDia,
      investimentoPorDia,
      lucroNecessarioPorDia,
      projecaoFinal,
      percentProjecao,
      percentAtingida,
      diasRestantes,
      meta,
      batida,
      vencida,
      semLucroPorVenda,
    };
  }, [savedGoal, metricsData, accData]);

  // ── Gráfico: dados reais + projeção futura até o prazo ────────────────────
  const d: any = derived;

  const chartData = useMemo(() => {
    const real = (accData?.chartData ?? []) as { date: string; lucroAcumulado: number }[];
    if (!real.length || !d || !savedGoal) return real.map((p) => ({ ...p, lucroProjetado: null }));

    const points = real.map((p) => ({ ...p, lucroProjetado: null as number | null }));
    const lastValue = real[real.length - 1].lucroAcumulado;
    // ponte: repete o último valor real como início da linha projetada, pra elas se conectarem
    points[points.length - 1] = { ...points[points.length - 1], lucroProjetado: lastValue };

    if (!d.vencida && !d.batida && d.diasRestantes > 0) {
      const mediaDia = accData?.mediaUltimos7 ?? 0;
      let cum = lastValue;
      let cur = isoToday();
      for (let i = 1; i <= d.diasRestantes; i++) {
        cur = addDaysIso(cur, 1);
        cum += mediaDia;
        points.push({
          date: `${cur.slice(8, 10)}/${cur.slice(5, 7)}`,
          lucroAcumulado: null as any,
          lucroProjetado: Math.round(cum * 100) / 100,
        });
      }
    }
    return points;
  }, [accData, d, savedGoal]);

  // Segmento reto ligando o ponto de hoje ao ponto final projetado, no mesmo
  // formato usado pela linha da Meta (ReferenceLine com segment).
  const projectionSegment = useMemo(() => {
    if (chartData.length < 2) return null;
    const last = chartData[chartData.length - 1];
    const bridge = chartData.find((p) => p.lucroProjetado != null);
    if (!bridge || !last || bridge === last || last.lucroProjetado == null) return null;
    return [
      { x: bridge.date, y: bridge.lucroProjetado as number },
      { x: last.date, y: last.lucroProjetado as number },
    ];
  }, [chartData]);

  return (
    <div className="space-y-4">
      {!hasShops ? (
        <p className="text-xs text-muted-foreground">Nenhuma loja vinculada a este card.</p>
      ) : (
        <>
          {/* ── Subabas ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between flex-wrap gap-3 border-b border-border">
            <div className="flex items-center gap-1">
              <SubTabBtn active={subTab === "definir"} onClick={() => setSubTab("definir")} icon={<Target className="size-3.5" />}>
                Atual
              </SubTabBtn>
              <SubTabBtn active={subTab === "historico"} onClick={() => setSubTab("historico")} icon={<TrendingUp className="size-3.5" />}>
                Histórico
              </SubTabBtn>
              <SubTabBtn active={subTab === "diario"} onClick={() => setSubTab("diario")} icon={<StickyNote className="size-3.5" />}>
                Diário de Operação
              </SubTabBtn>
            </div>
            {/* Widget do canto: meta ativa (com botão finalizar) ou criar nova meta */}
            <div className="flex items-center gap-2 mb-2">
              {savedGoal ? (
                <div className="flex items-center gap-2">
                  <Popover open={editGoalOpen} onOpenChange={(o) => (o ? openEditGoal() : setEditGoalOpen(false))}>
                    <PopoverTrigger asChild>
                      <button className="text-xs px-3 py-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                        {fmtMoney(Number(savedGoal.meta))} · {fmtDatePt(savedGoal.start_date)} → {fmtDatePt(savedGoal.prazo)}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-3">
                      <p className="text-sm font-semibold text-foreground">Editar meta</p>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">Início</label>
                        <input
                          type="date"
                          value={editStartInput}
                          onChange={e => setEditStartInput(e.target.value)}
                          className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">Fim</label>
                        <input
                          type="date"
                          value={editPrazoInput}
                          min={editStartInput}
                          onChange={e => setEditPrazoInput(e.target.value)}
                          className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">Valor (USD)</label>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={editMetaInput}
                          onChange={e => setEditMetaInput(e.target.value)}
                          className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">Lucro previsto por venda (USD)</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="ex: 30"
                          value={editLucroPorVendaInput}
                          onChange={e => setEditLucroPorVendaInput(e.target.value)}
                          className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <button
                        onClick={handleUpdateGoal}
                        disabled={savingEditGoal}
                        className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {savingEditGoal ? "Salvando..." : "Salvar alterações"}
                      </button>
                    </PopoverContent>
                  </Popover>
                  <button
                    onClick={handleFinalizeGoal}
                    title="Finalizar meta"
                    className="size-8 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 grid place-items-center transition-colors"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <Popover open={newGoalOpen} onOpenChange={setNewGoalOpen}>
                  <PopoverTrigger asChild>
                    <button className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 hover:bg-primary/90 transition-colors">
                      <Plus className="size-3.5" /> Nova meta
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 space-y-3">
                    <p className="text-sm font-semibold text-foreground">Definir nova meta</p>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">Início</label>
                      <input
                        type="date"
                        value={newStartInput}
                        onChange={e => setNewStartInput(e.target.value)}
                        className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">Fim</label>
                      <input
                        type="date"
                        value={newPrazoInput}
                        min={newStartInput}
                        onChange={e => setNewPrazoInput(e.target.value)}
                        className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">Valor (USD)</label>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        placeholder="ex: 5000"
                        value={newMetaInput}
                        onChange={e => setNewMetaInput(e.target.value)}
                        className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">Lucro previsto por venda (USD)</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="ex: 30"
                        value={newLucroPorVendaInput}
                        onChange={e => setNewLucroPorVendaInput(e.target.value)}
                        className="h-9 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <button
                      onClick={handleCreateGoal}
                      disabled={creatingGoal}
                      className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {creatingGoal ? "Criando..." : "Criar meta"}
                    </button>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          {/* ── Histórico: detalhes (leitura) da meta ativa + metas anteriores */}
          {subTab === "historico" && (
            <>
            <Section title="Meta ativa" icon={<Target className="size-4" />}>
              {loadingGoal ? (
                <Skeleton className="h-24 w-full rounded-xl" />
              ) : !savedGoal ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma meta ativa no momento. Use o botão "Nova meta" no canto superior direito para começar uma.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-2xl font-bold text-foreground">{fmtMoney(Number(savedGoal.meta))}</p>
                      <p className="text-xs text-muted-foreground">meta de lucro ativa</p>
                    </div>
                    <button
                      onClick={handleFinalizeGoal}
                      className="h-9 px-4 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
                    >
                      Finalizar meta
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <SummaryRow label="Início" value={fmtDatePt(savedGoal.start_date)} />
                    <SummaryRow label="Fim" value={fmtDatePt(savedGoal.prazo)} />
                    <SummaryRow label="Dias decorridos" value={String(Math.max(0, daysBetween(savedGoal.start_date, isoToday())))} />
                    <SummaryRow label="Dias restantes" value={String(Math.max(0, daysBetween(isoToday(), savedGoal.prazo)))} />
                  </div>
                </div>
              )}
            </Section>

            {/* Metas anteriores */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Metas anteriores</p>
              {loadingHistory ? (
                <div className="space-y-2">
                  {[0, 1].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
                </div>
              ) : !(historyData as any)?.goals?.length ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma meta registrada ainda.</p>
              ) : (
                <div className="space-y-2">
                  {(historyData as any).goals.map((g: any) => (
                    <div key={g.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{fmtMoney(g.meta)}</p>
                        <p className="text-xs text-muted-foreground">{fmtDatePt(g.start_date)} → {fmtDatePt(g.prazo)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">{fmtMoney(g.lucro)}</p>
                        <span className={cn(
                          "text-[10px] font-medium rounded-full px-2 py-0.5",
                          g.status === "ativa" ? "bg-primary/10 text-primary"
                          : g.status === "batida" ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive"
                        )}>
                          {g.status === "ativa" ? "Em andamento" : g.status === "batida" ? "Batida" : "Não batida"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
          )}

          {/* ── Definir Meta: dashboard rico da meta ativa ──────────────────── */}
          {subTab === "definir" && (
            <>
            {loadingGoal ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[150px] rounded-2xl" />)}
              </div>
            ) : !savedGoal ? (
              <div className="bg-card border border-border rounded-2xl p-6 text-center">
                <p className="text-sm text-muted-foreground">Nenhuma meta ativa no momento.</p>
              </div>
            ) : (loadingAcc && !accData) || loadingMetrics ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[150px] rounded-2xl" />)}
              </div>
            ) : d && (
              <>
                {/* Top row: 4 cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Progresso da meta */}
                  <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Progresso da meta</span>
                      {d.batida && <span className="text-[10px] font-medium text-success bg-success/10 rounded-full px-2 py-0.5">Batida!</span>}
                      {d.vencida && <span className="text-[10px] font-medium text-destructive bg-destructive/10 rounded-full px-2 py-0.5">Vencida</span>}
                    </div>
                    <div>
                      <p className={cn("text-3xl font-bold leading-tight", d.percentAtingida >= 100 ? "text-success" : "text-primary")}>
                        {Math.max(0, d.percentAtingida).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground">da meta atingida</p>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", d.percentAtingida >= 100 ? "bg-success" : "bg-primary")}
                        style={{ width: `${Math.min(100, Math.max(0, d.percentAtingida))}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{fmtMoney(d.lucroAcumulado)} <span className="block">Lucro acumulado</span></span>
                      <span className="text-right">{fmtMoney(d.meta)} <span className="block">Meta definida</span></span>
                    </div>
                  </div>

                  <StatCard
                    icon={<ShoppingCart className="size-4" />}
                    accent="primary"
                    label="Vendas por dia"
                    value={d.vencida || d.batida ? "—" : String(d.vendasPorDia)}
                    sub={d.semLucroPorVenda && !d.vencida && !d.batida ? "Defina o lucro por venda" : "Média diária"}
                  />
                  <StatCard
                    icon={<Megaphone className="size-4" />}
                    accent="blue"
                    label="Investimento/dia"
                    value={d.vencida || d.batida ? "—" : fmtMoney(d.investimentoPorDia)}
                    sub={d.semLucroPorVenda && !d.vencida && !d.batida ? "Defina o lucro por venda" : "Média diária"}
                  />
                  <StatCard
                    icon={<Wallet className="size-4" />}
                    accent="success"
                    label="Lucro necessário/dia"
                    value={d.vencida || d.batida ? "—" : fmtMoney(d.lucroNecessarioPorDia)}
                    sub="Para bater a meta"
                  />
                </div>

                {/* Chart + coluna lateral */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                  {/* Projeção de lucro acumulado */}
                  <div className="bg-card border border-border rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="size-1.5 rounded-full bg-primary" />
                      <span className="text-xs font-semibold text-foreground">Projeção de lucro acumulado</span>
                    </div>
                    {chartData.length > 0 ? (
                      <>
                        <div className="flex items-center gap-3 mb-2 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block" style={{ background: "#6b7280" }} /> Real</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block" style={{ borderTop: `1px dashed ${d.projecaoFinal >= d.meta ? "var(--color-success)" : "var(--color-destructive)"}` }} /> Projeção</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-success inline-block" style={{ borderTop: "1px dashed var(--color-success)" }} /> Meta</span>
                        </div>
                        <ResponsiveContainer width="100%" height={240}>
                          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                            <defs>
                              <linearGradient id="lg-goal-progress-grad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="var(--color-primary)" stopOpacity={0.25} />
                                <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                            <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis
                              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false}
                              tickFormatter={v => `$${v}`}
                              domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(max, d.meta)]}
                            />
                            <Tooltip content={<ProgressTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
                            <ReferenceLine y={d.meta} stroke="var(--color-success)" strokeDasharray="4 4"
                              label={{ value: "Meta", position: "insideTopRight", fill: "var(--color-success)", fontSize: 10 }} />
                            <Area type="monotone" dataKey="lucroAcumulado" stroke="#6b7280" strokeWidth={2}
                              fill="url(#lg-goal-progress-grad)" dot={{ r: 3, fill: "#6b7280" }} activeDot={{ r: 4, fill: "#6b7280" }} connectNulls={false} />
                            {projectionSegment && (
                              <ReferenceLine
                                segment={projectionSegment}
                                stroke={d.projecaoFinal >= d.meta ? "var(--color-success)" : "var(--color-destructive)"}
                                strokeWidth={2}
                                strokeDasharray="6 4"
                              />
                            )}
                            {chartData[chartData.length - 1]?.lucroProjetado != null && (
                              <ReferenceDot
                                x={chartData[chartData.length - 1].date}
                                y={chartData[chartData.length - 1].lucroProjetado as number}
                                r={4}
                                fill={d.projecaoFinal >= d.meta ? "var(--color-success)" : "var(--color-destructive)"}
                                stroke="var(--color-card)"
                                strokeWidth={2}
                                label={{
                                  value: fmtMoney(chartData[chartData.length - 1].lucroProjetado as number),
                                  position: "top",
                                  fill: d.projecaoFinal >= d.meta ? "var(--color-success)" : "var(--color-destructive)",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              />
                            )}
                          </AreaChart>
                        </ResponsiveContainer>
                        {!d.vencida && !d.batida && (
                          <div className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2 flex items-start gap-2 text-xs text-muted-foreground">
                            <Target className="size-3.5 text-primary shrink-0 mt-0.5" />
                            <span>
                              Se mantiver a média dos últimos 7 dias, a projeção é de{" "}
                              <span className="font-semibold text-foreground">{fmtMoney(d.projecaoFinal)}</span>{" "}
                              ({d.percentProjecao.toFixed(1)}% da meta)
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground py-16 text-center">Ainda não há dados para o gráfico.</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-4">
                    {/* Tendência */}
                    <div className="bg-card border border-border rounded-2xl p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tendência (últimos 7 dias)</p>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "size-10 rounded-full grid place-items-center shrink-0",
                          tendenciaKind(accData?.mediaUltimos7, accData?.mediaGeral) === "up" ? "bg-success/10"
                          : tendenciaKind(accData?.mediaUltimos7, accData?.mediaGeral) === "down" ? "bg-destructive/10"
                          : "bg-muted"
                        )}>
                          <TendenciaIcon mediaUltimos7={accData?.mediaUltimos7} mediaGeral={accData?.mediaGeral} />
                        </div>
                        <p className="text-base font-bold text-foreground">{tendenciaLabel(accData?.mediaUltimos7, accData?.mediaGeral)}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Sua média dos últimos 7 dias está{" "}
                        <span className="font-semibold text-foreground">
                          {Math.abs(tendenciaVariacaoPct(accData?.mediaUltimos7, accData?.mediaGeral)).toFixed(1)}%
                        </span>{" "}
                        {tendenciaVariacaoPct(accData?.mediaUltimos7, accData?.mediaGeral) >= 0 ? "acima" : "abaixo"} da média geral.
                      </p>
                    </div>

                    {/* Resumo da meta */}
                    <div className="bg-card border border-border rounded-2xl p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Resumo da meta</p>
                      <div className="flex flex-col">
                        <SummaryRow label="Dias decorridos" value={`${daysBetween(savedGoal.start_date, isoToday())} / ${daysBetween(savedGoal.start_date, savedGoal.prazo)}`} />
                        <SummaryRow label="Dias restantes" value={String(Math.max(0, daysBetween(isoToday(), savedGoal.prazo)))} />
                        <SummaryRow label="Lucro acumulado" value={fmtMoney(d.lucroAcumulado)} valueClass="text-primary" />
                        <SummaryRow label="Meta" value={fmtMoney(d.meta)} valueClass="text-success" />
                        <SummaryRow label="Falta para a meta" value={fmtMoney(Math.max(0, d.meta - d.lucroAcumulado))} valueClass="text-amber-600" />
                        <SummaryRow label="% da meta" value={`${d.percentAtingida.toFixed(1)}%`} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Banner final */}
                <div className={cn(
                  "rounded-2xl border p-4 flex items-center gap-3",
                  d.batida ? "border-success/30 bg-success/5" : d.vencida ? "border-destructive/30 bg-destructive/5" : "border-primary/20 bg-primary/5"
                )}>
                  <div className={cn(
                    "size-8 rounded-lg grid place-items-center shrink-0",
                    d.batida ? "bg-success/15 text-success" : d.vencida ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"
                  )}>
                    <Lightbulb className="size-4" />
                  </div>
                  <p className="text-sm text-foreground">
                    {d.batida ? (
                      <>Meta batida! Você acumulou <span className="font-semibold">{fmtMoney(d.lucroAcumulado)}</span> de lucro.</>
                    ) : d.vencida ? (
                      <>Meta vencida. Faltou <span className="font-semibold">{fmtMoney(Math.max(0, d.meta - d.lucroAcumulado))}</span> para bater a meta.</>
                    ) : (
                      <>Mantenha o ritmo! Você precisa de <span className="font-semibold">{fmtMoney(d.lucroNecessarioPorDia)}</span> de lucro por dia para bater a meta.</>
                    )}
                  </p>
                </div>
              </>
            )}
            </>
          )}

          {/* ── Diário de Operação ───────────────────────────────────────────── */}
          {subTab === "diario" && (
            <LgNotesSection cardId={card.id} shopIds={shopIds} matrizShopId={card.matriz_shop_id ?? null} />
          )}
        </>
      )}
    </div>
  );
}

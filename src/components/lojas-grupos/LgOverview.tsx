import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from "recharts";
import {
  ShoppingCart, TrendingUp, Wallet, BarChart3, DollarSign, Flag, CheckCircle2, AlertTriangle,
  Target, TrendingDown, Minus, StickyNote, Plus, X, Calendar, CalendarCheck, CalendarClock, ChevronRight,
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

// Badge (pill) preso ao ponto final da projeção no gráfico
function ProjectionEndLabel(props: any) {
  const x = props.viewBox?.x ?? props.viewBox?.cx ?? props.cx ?? props.x;
  const y = props.viewBox?.y ?? props.viewBox?.cy ?? props.cy ?? props.y;
  if (x == null || y == null || Number.isNaN(x) || Number.isNaN(y)) return null;
  const text = String(props.value);
  const width = text.length * 6.5 + 18;
  return (
    <g>
      <rect x={x - width / 2} y={y - 32} width={width} height={22} rx={11} fill={props.fill} />
      <text x={x} y={y - 17} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{text}</text>
    </g>
  );
}

// Compara o ritmo dos últimos 3 dias com a média geral do período da meta
function tendenciaKind(mediaUltimos3?: number, mediaGeral?: number): "up" | "down" | "flat" | null {
  if (mediaUltimos3 == null || mediaGeral == null || mediaGeral === 0) return null;
  const variacao = (mediaUltimos3 - mediaGeral) / Math.abs(mediaGeral);
  if (variacao > 0.1) return "up";
  if (variacao < -0.1) return "down";
  return "flat";
}

function tendenciaLabel(mediaUltimos3?: number, mediaGeral?: number) {
  const kind = tendenciaKind(mediaUltimos3, mediaGeral);
  if (kind === "up") return "Acelerando";
  if (kind === "down") return "Desacelerando";
  if (kind === "flat") return "Estável";
  return "—";
}

function tendenciaVariacaoPct(mediaUltimos3?: number, mediaGeral?: number) {
  if (mediaUltimos3 == null || mediaGeral == null || mediaGeral === 0) return 0;
  return ((mediaUltimos3 - mediaGeral) / Math.abs(mediaGeral)) * 100;
}

function TendenciaIcon({ mediaUltimos3, mediaGeral }: { mediaUltimos3?: number; mediaGeral?: number }) {
  const kind = tendenciaKind(mediaUltimos3, mediaGeral);
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

// ─── Stat card (top row do dashboard de Meta) ──────────────────────────────────

const ACCENTS = {
  primary: "bg-primary/10 text-primary",
  blue:    "bg-blue-500/10 text-blue-600",
  success: "bg-success/10 text-success",
} as const;

const ACCENT_CARD = {
  primary: "border-primary/15 bg-primary/[0.04]",
  blue:    "border-blue-500/15 bg-blue-500/[0.04]",
  success: "border-success/15 bg-success/[0.04]",
} as const;

const ACCENT_TEXT = {
  primary: "text-primary",
  blue:    "text-blue-600",
  success: "text-success",
} as const;

const ACCENT_PILL = {
  primary: "bg-primary/10",
  blue:    "bg-blue-500/10",
  success: "bg-success/10",
} as const;

const ACCENT_SOLID = {
  primary: "bg-primary",
  blue:    "bg-blue-600",
  success: "bg-success",
} as const;

function StatCard({
  icon, accent, label, value, sub, trendIcon, footer, footerIcon, loading,
}: {
  icon: React.ReactNode; accent: keyof typeof ACCENTS; label: string; value: string; sub?: string;
  trendIcon?: React.ReactNode; footer?: React.ReactNode; footerIcon?: React.ReactNode; loading?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-3xl border p-5 flex flex-col gap-3", ACCENT_CARD[accent])}>
      <div className={cn("pointer-events-none absolute -right-8 -bottom-10 size-32 rounded-full blur-2xl opacity-30", ACCENT_SOLID[accent])} />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn("size-9 rounded-2xl grid place-items-center shrink-0", ACCENTS[accent])}>
            {icon}
          </div>
          <span className="text-xs font-bold text-foreground">{label}</span>
        </div>
        {trendIcon && (
          <div className={cn("size-7 rounded-xl grid place-items-center shrink-0", ACCENTS[accent])}>
            {trendIcon}
          </div>
        )}
      </div>
      <div className="relative">
        {loading
          ? <Skeleton className="h-10 w-28" />
          : <p className={cn("text-4xl font-extrabold leading-none", ACCENT_TEXT[accent])}>{value}</p>
        }
        {sub && <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>}
      </div>
      {footer && (
        <div className={cn("relative flex items-center gap-2 rounded-xl px-2.5 py-2", ACCENT_PILL[accent])}>
          {footerIcon && (
            <span className={cn("size-5 rounded-full grid place-items-center text-white shrink-0", ACCENT_SOLID[accent])}>
              {footerIcon}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{footer}</span>
        </div>
      )}
    </div>
  );
}

// ─── Summary row (card "Resumo da meta") ───────────────────────────────────────

function SummaryRow({
  icon, iconCls, label, value, valueClass = "text-foreground",
}: {
  icon: React.ReactNode; iconCls: string; label: string; value: string; valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className={cn("size-7 rounded-lg grid place-items-center shrink-0", iconCls)}>
          {icon}
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={cn("text-sm font-bold", valueClass)}>{value}</span>
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

    const projecaoFinal = lucroAcumulado + (accData.mediaUltimos3 ?? 0) * diasRestantes;
    const percentProjecao = meta > 0 ? (projecaoFinal / meta) * 100 : 0;
    const lucroNecessarioPorDia = diasRestantes > 0 ? lucroRestante / diasRestantes : 0;

    const lucroPorVenda = Number(savedGoal.lucro_por_venda ?? 0);
    const semLucroPorVenda = lucroPorVenda <= 0;

    let vendasPorDia = 0;
    if (!semLucroPorVenda && diasRestantes > 0) {
      vendasPorDia = Math.round(lucroNecessarioPorDia / lucroPorVenda);
    }

    return {
      lucroAcumulado,
      vendasPorDia,
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
      const mediaDia = accData?.mediaUltimos3 ?? 0;
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
            {/* Meta ativa */}
            <div className="bg-card border border-border rounded-3xl p-5 flex flex-col gap-4">
              {loadingGoal ? (
                <Skeleton className="h-24 w-full rounded-xl" />
              ) : !savedGoal ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma meta ativa no momento. Use o botão "Nova meta" no canto superior direito para começar uma.
                </p>
              ) : (() => {
                const diasDecorridos = Math.max(0, daysBetween(savedGoal.start_date, isoToday()));
                const diasRestantes = Math.max(0, daysBetween(isoToday(), savedGoal.prazo));
                const totalDias = Math.max(1, daysBetween(savedGoal.start_date, savedGoal.prazo));
                const pctTempo = Math.min(100, (diasDecorridos / totalDias) * 100);
                return (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                          <Target className="size-4" />
                        </div>
                        <span className="text-sm font-bold text-foreground">Meta ativa</span>
                        <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-primary/10 text-primary">Em andamento</span>
                      </div>
                      <button
                        onClick={handleFinalizeGoal}
                        className="h-9 px-4 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors flex items-center gap-1.5"
                      >
                        <Flag className="size-3.5" /> Finalizar meta
                      </button>
                    </div>

                    <div className="border-t border-border" />

                    <div className="flex items-center gap-6 flex-wrap">
                      <div className="flex-1 flex items-center justify-center text-center">
                        <div>
                          <p className="text-4xl font-extrabold text-foreground leading-none">{fmtMoney(Number(savedGoal.meta))}</p>
                          <p className="text-sm text-muted-foreground mt-1.5">meta de lucro ativa</p>
                        </div>
                      </div>
                      <div className="w-px h-10 bg-border hidden sm:block" />
                      <div className="flex-1 flex items-center justify-center gap-3">
                        <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                          <Calendar className="size-4" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Período da meta</p>
                          <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                            {fmtDatePt(savedGoal.start_date)} <span className="text-muted-foreground font-normal">→</span> {fmtDatePt(savedGoal.prazo)}
                          </p>
                          <div className="flex items-center gap-8 mt-0.5 text-[10px] text-muted-foreground">
                            <span>Início</span><span>Fim</span>
                          </div>
                        </div>
                      </div>
                      <div className="w-px h-10 bg-border hidden sm:block" />
                      <div className="flex-1 flex items-center justify-center gap-3">
                        <div className="size-10 rounded-xl bg-success/10 text-success grid place-items-center shrink-0">
                          <CalendarClock className="size-4" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Progresso</p>
                          <div className="flex items-center gap-4">
                            <div>
                              <p className="text-sm font-bold text-success">{diasDecorridos}</p>
                              <p className="text-[10px] text-muted-foreground whitespace-nowrap">{diasDecorridos === 1 ? "Dia decorrido" : "Dias decorridos"}</p>
                            </div>
                            <div className="w-px h-8 bg-border" />
                            <div>
                              <p className="text-sm font-bold text-foreground">{diasRestantes}</p>
                              <p className="text-[10px] text-muted-foreground whitespace-nowrap">Dias restantes</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-primary shrink-0">{pctTempo.toFixed(1)}%</span>
                        <div className="h-2 rounded-full bg-muted overflow-hidden flex-1">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pctTempo}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">{diasDecorridos} de {totalDias} dias</span>
                      </div>
                      {d && (
                        <div className="flex items-center gap-3">
                          <span className={cn("text-sm font-bold shrink-0", d.percentAtingida >= 100 ? "text-success" : "text-primary")}>
                            {Math.max(0, d.percentAtingida).toFixed(1)}%
                          </span>
                          <div className="h-2 rounded-full bg-muted overflow-hidden flex-1">
                            <div
                              className={cn("h-full rounded-full", d.percentAtingida >= 100 ? "bg-success" : "bg-primary")}
                              style={{ width: `${Math.min(100, Math.max(0, d.percentAtingida))}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">{fmtMoney(d.lucroAcumulado)} de {fmtMoney(d.meta)}</span>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Metas anteriores */}
            <div className="bg-card border border-border rounded-3xl p-5">
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
                    <div key={g.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3.5">
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                          <TrendingUp className="size-4" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">{fmtMoney(g.meta)}</p>
                          <p className="text-xs text-muted-foreground">{fmtDatePt(g.start_date)} → {fmtDatePt(g.prazo)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold text-foreground">{fmtMoney(g.lucro)}</p>
                          <span className={cn(
                            "text-[10px] font-semibold rounded-full px-2 py-0.5",
                            g.status === "ativa" ? "bg-primary/10 text-primary"
                            : g.status === "batida" ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive"
                          )}>
                            {g.status === "ativa" ? "Em andamento" : g.status === "batida" ? "Batida" : "Não batida"}
                          </span>
                        </div>
                        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-[150px] rounded-2xl" />)}
              </div>
            ) : d && (
              <>
                {/* Top row: 3 cards na mesma linha */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Progresso da meta */}
                  {(() => {
                    const clampedPercent = Math.min(100, Math.max(0, d.percentAtingida));
                    const stateColor: "success" | "destructive" | "primary" = d.batida ? "success" : d.vencida ? "destructive" : "primary";
                    const textCls = stateColor === "success" ? "text-success" : stateColor === "destructive" ? "text-destructive" : "text-primary";
                    const bgSoftCls = stateColor === "success" ? "bg-success/10" : stateColor === "destructive" ? "bg-destructive/10" : "bg-primary/10";
                    const bgSolidCls = stateColor === "success" ? "bg-success" : stateColor === "destructive" ? "bg-destructive" : "bg-primary";
                    const badgeIcon = d.batida ? <CheckCircle2 className="size-3.5" /> : d.vencida ? <AlertTriangle className="size-3.5" /> : <TrendingUp className="size-3.5" />;
                    const badgeLabel = d.batida ? "Batida!" : d.vencida ? "Vencida" : "Em andamento";

                    return (
                      <div className={cn("rounded-3xl border bg-card p-4 flex flex-col gap-2.5", stateColor === "success" ? "border-success/15" : stateColor === "destructive" ? "border-destructive/15" : "border-primary/15")}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className={cn("size-7 rounded-xl grid place-items-center shrink-0", bgSoftCls, textCls)}>
                              <Target className="size-3.5" />
                            </div>
                            <span className="text-[10px] font-bold text-foreground uppercase tracking-wide">Progresso da meta</span>
                          </div>
                          <span className={cn("flex items-center gap-1 rounded-full text-[11px] font-semibold px-2 py-0.5 shrink-0", bgSoftCls, textCls)}>
                            {badgeIcon}
                            {badgeLabel}
                          </span>
                        </div>

                        <div>
                          <p className={cn("text-3xl font-extrabold leading-none", textCls)}>
                            {clampedPercent.toFixed(1)}%
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">da meta atingida</p>
                        </div>

                        <div className="relative pt-4">
                          <div
                            className={cn("absolute top-0 -translate-x-1/2 rounded-full text-white text-[10px] font-bold px-2 py-0.5 whitespace-nowrap", bgSolidCls)}
                            style={{ left: `${clampedPercent}%` }}
                          >
                            {clampedPercent.toFixed(1)}%
                            <span className={cn("absolute left-1/2 -bottom-1 -translate-x-1/2 size-1.5 rotate-45", bgSolidCls)} />
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all", bgSolidCls)}
                              style={{ width: `${clampedPercent}%` }}
                            />
                          </div>
                        </div>

                        <div className="border-t border-border" />

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className={cn("size-7 rounded-lg grid place-items-center shrink-0", bgSoftCls, textCls)}>
                              <Wallet className="size-3" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-foreground">{fmtMoney(d.lucroAcumulado)}</p>
                              <p className="text-[10px] text-muted-foreground">Lucro acumulado</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className={cn("size-7 rounded-lg grid place-items-center shrink-0", bgSoftCls, textCls)}>
                              <Flag className="size-3" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-foreground">{fmtMoney(d.meta)}</p>
                              <p className="text-[10px] text-muted-foreground">Meta definida</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <StatCard
                    icon={<ShoppingCart className="size-5" />}
                    accent="primary"
                    label="Vendas por dia"
                    value={d.vencida || d.batida ? "—" : String(d.vendasPorDia)}
                    sub={d.semLucroPorVenda && !d.vencida && !d.batida ? "Defina o lucro por venda" : "Média diária"}
                    trendIcon={<TrendingUp className="size-4" />}
                    footerIcon={<BarChart3 className="size-3.5" />}
                    footer={<><span className="font-bold text-primary">{accData?.pedidosOntem ?? 0}</span> vendas ontem</>}
                  />
                  <StatCard
                    icon={<Wallet className="size-5" />}
                    accent="success"
                    label="Lucro necessário/dia"
                    value={d.vencida || d.batida ? "—" : fmtMoney(d.lucroNecessarioPorDia)}
                    sub="Para bater a meta"
                    trendIcon={<Target className="size-4" />}
                    footerIcon={<DollarSign className="size-3.5" />}
                    footer={<><span className="font-bold text-success">{fmtMoney(accData?.lucroOntem ?? 0)}</span> ontem</>}
                  />
                </div>

                {/* Chart + coluna lateral */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                  {/* Projeção de lucro acumulado */}
                  {(() => {
                    const acimaDaMeta = d.projecaoFinal >= d.meta;
                    const projColor = acimaDaMeta ? "var(--color-success)" : "var(--color-destructive)";
                    return (
                      <div className="bg-card border border-border rounded-2xl p-5">
                        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                          <div className="flex items-center gap-3">
                            <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                              <BarChart3 className="size-4" />
                            </div>
                            <span className="text-sm font-bold text-foreground">Projeção de lucro acumulado</span>
                          </div>
                          {chartData.length > 0 && (
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block" style={{ background: "#6b7280" }} /> Real</span>
                              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block" style={{ borderTop: `1px dashed ${projColor}` }} /> Projeção</span>
                              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded bg-success inline-block" style={{ borderTop: "1px dashed var(--color-success)" }} /> Meta</span>
                            </div>
                          )}
                        </div>
                        {chartData.length > 0 ? (
                          <>
                            <div className="group relative">
                              <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={chartData} margin={{ top: 8, right: 46, left: -16, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="lg-goal-progress-grad" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%"  stopColor="var(--color-primary)" stopOpacity={0.25} />
                                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="lg-projection-grad" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%"  stopColor={projColor} stopOpacity={0.3} />
                                      <stop offset="95%" stopColor={projColor} stopOpacity={0} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                  <XAxis dataKey="date" tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                                  <YAxis
                                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false}
                                    tickFormatter={v => `$${v}`}
                                    domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(max, d.meta, d.projecaoFinal)]}
                                  />
                                  <Tooltip content={<ProgressTooltip />} cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }} />
                                  <ReferenceLine y={d.meta} stroke="var(--color-success)" strokeDasharray="4 4"
                                    label={{ value: "Meta", position: "insideTopRight", fill: "var(--color-success)", fontSize: 10 }} />
                                  <Area type="monotone" dataKey="lucroAcumulado" stroke="#6b7280" strokeWidth={2}
                                    fill="url(#lg-goal-progress-grad)" dot={{ r: 3, fill: "#6b7280" }} activeDot={{ r: 4, fill: "#6b7280" }} connectNulls={false} />
                                  <Area type="linear" dataKey="lucroProjetado" stroke={projColor} strokeWidth={2} strokeDasharray="6 4"
                                    fill="url(#lg-projection-grad)" dot={false} activeDot={{ r: 4, fill: projColor }} connectNulls={true} />
                                  {chartData[chartData.length - 1]?.lucroProjetado != null && (
                                    <ReferenceDot
                                      x={chartData[chartData.length - 1].date}
                                      y={chartData[chartData.length - 1].lucroProjetado as number}
                                      r={4}
                                      fill={projColor}
                                      stroke="var(--color-card)"
                                      strokeWidth={2}
                                      label={<ProjectionEndLabel value={fmtMoney(chartData[chartData.length - 1].lucroProjetado as number)} fill={projColor} />}
                                    />
                                  )}
                                </AreaChart>
                              </ResponsiveContainer>
                              {!d.vencida && !d.batida && (
                                <div className={cn(
                                  "pointer-events-none absolute top-2 right-2 max-w-[210px] rounded-xl border p-3 shadow-sm text-xs opacity-0 transition-opacity group-hover:opacity-100",
                                  acimaDaMeta ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"
                                )}>
                                  <p className={cn("flex items-center gap-1 font-bold mb-1", acimaDaMeta ? "text-success" : "text-destructive")}>
                                    {acimaDaMeta ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                                    {acimaDaMeta ? "Acima da meta" : "Abaixo da meta"}
                                  </p>
                                  <p className="text-muted-foreground leading-snug">
                                    {acimaDaMeta ? (
                                      <>Vai superar a meta em{" "}
                                        <span className="font-semibold text-foreground">{fmtMoney(d.projecaoFinal - d.meta)}</span>{" "}
                                        ({(d.percentProjecao - 100).toFixed(1)}%)</>
                                    ) : (
                                      <>Faltam{" "}
                                        <span className="font-semibold text-foreground">{fmtMoney(d.meta - d.projecaoFinal)}</span>{" "}
                                        ({(100 - d.percentProjecao).toFixed(1)}%) para alcançar a meta</>
                                    )}
                                  </p>
                                </div>
                              )}
                            </div>
                            {!d.vencida && !d.batida && (
                              <div className={cn(
                                "mt-3 rounded-xl border px-3 py-2.5 flex items-center gap-2.5 text-xs",
                                acimaDaMeta ? "border-success/20 bg-success/5" : "border-destructive/20 bg-destructive/5"
                              )}>
                                <div className={cn("size-7 rounded-full grid place-items-center shrink-0", acimaDaMeta ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                                  <Target className="size-3.5" />
                                </div>
                                <span className="text-muted-foreground">
                                  Se mantiver a média dos últimos 3 dias, a projeção é de{" "}
                                  <span className={cn("font-semibold", acimaDaMeta ? "text-success" : "text-destructive")}>{fmtMoney(d.projecaoFinal)}</span>{" "}
                                  ({d.percentProjecao.toFixed(1)}% da meta)
                                </span>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground py-16 text-center">Ainda não há dados para o gráfico.</p>
                        )}
                      </div>
                    );
                  })()}

                  <div className="flex flex-col gap-4 h-full">
                    {/* Tendência */}
                    <div className="bg-card border border-border rounded-2xl p-4 flex-1 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tendência (últimos 3 dias)</p>
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "size-10 rounded-full grid place-items-center shrink-0",
                              tendenciaKind(accData?.mediaUltimos3, accData?.mediaGeral) === "up" ? "bg-success/10"
                              : tendenciaKind(accData?.mediaUltimos3, accData?.mediaGeral) === "down" ? "bg-destructive/10"
                              : "bg-muted"
                            )}>
                              <TendenciaIcon mediaUltimos3={accData?.mediaUltimos3} mediaGeral={accData?.mediaGeral} />
                            </div>
                            <p className="text-lg font-bold text-foreground">{tendenciaLabel(accData?.mediaUltimos3, accData?.mediaGeral)}</p>
                          </div>
                        </div>
                        {(accData?.chartData?.length ?? 0) > 1 && (
                          <div className="w-16 h-9 shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={accData!.chartData.slice(-7)} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="lg-spark-grad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <Area type="monotone" dataKey="lucroAcumulado" stroke="var(--color-primary)" strokeWidth={1.5}
                                  fill="url(#lg-spark-grad)" dot={false} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        Sua média dos últimos 3 dias está{" "}
                        <span className="font-semibold text-foreground">
                          {Math.abs(tendenciaVariacaoPct(accData?.mediaUltimos3, accData?.mediaGeral)).toFixed(1)}%
                        </span>{" "}
                        {tendenciaVariacaoPct(accData?.mediaUltimos3, accData?.mediaGeral) >= 0 ? "acima" : "abaixo"} da média geral.
                      </p>
                    </div>

                    {/* Resumo da meta */}
                    <div className="bg-card border border-border rounded-2xl p-4 flex-1 flex flex-col">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
                          <Target className="size-3.5" />
                        </div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Resumo da meta</p>
                      </div>
                      <div className="flex flex-col flex-1">
                        <SummaryRow icon={<Calendar className="size-3.5" />} iconCls="bg-blue-500/10 text-blue-600"
                          label="Dias decorridos" value={`${daysBetween(savedGoal.start_date, isoToday())} / ${daysBetween(savedGoal.start_date, savedGoal.prazo)}`} />
                        <SummaryRow icon={<CalendarCheck className="size-3.5" />} iconCls="bg-success/10 text-success"
                          label="Dias restantes" value={String(Math.max(0, daysBetween(isoToday(), savedGoal.prazo)))} />
                        <SummaryRow icon={<Wallet className="size-3.5" />} iconCls="bg-primary/10 text-primary"
                          label="Lucro acumulado" value={fmtMoney(d.lucroAcumulado)} valueClass="text-primary" />
                        <SummaryRow icon={<Flag className="size-3.5" />} iconCls="bg-success/10 text-success"
                          label="Meta" value={fmtMoney(d.meta)} valueClass="text-success" />
                        <SummaryRow icon={<Target className="size-3.5" />} iconCls="bg-amber-500/10 text-amber-600"
                          label="Falta para a meta" value={fmtMoney(Math.max(0, d.meta - d.lucroAcumulado))} valueClass="text-amber-600" />
                      </div>
                    </div>
                  </div>
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

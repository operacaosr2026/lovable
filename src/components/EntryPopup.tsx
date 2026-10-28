import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getTodayProfit } from "@/lib/profit-popup.functions";
import { listMyOverdueTasks, updateTask } from "@/lib/tasks.functions";

// Aviso ao entrar no sistema — e quando volta pra aba/app depois de um tempo
// fora (no app instalado, "abrir" de novo não recarrega a página). Um aviso só:
//  - lucro de hoje: só no celular, pra quem pode ver o lucro;
//  - tarefas atrasadas em que a pessoa é a responsável (celular e computador).
const MOBILE_MAX_WIDTH = 767;
const RESUME_AFTER_MS = 5 * 60_000;

type Profit = { lucro: number; pedidos: number; date: string };
type Overdue = Awaited<ReturnType<typeof listMyOverdueTasks>>[number];

const usd = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

const PRIORITY: Record<string, { label: string; cls: string }> = {
  alta: { label: "Alta", cls: "bg-rose-500/10 text-rose-600" },
  media: { label: "Média", cls: "bg-amber-500/10 text-amber-600" },
  baixa: { label: "Baixa", cls: "bg-muted text-muted-foreground" },
};

export function EntryPopup() {
  const fetchProfit = useServerFn(getTodayProfit);
  const fetchOverdue = useServerFn(listMyOverdueTasks);
  const saveTask = useServerFn(updateTask);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [profit, setProfit] = useState<Profit | null>(null);
  const [tasks, setTasks] = useState<Overdue[]>([]);
  const [open, setOpen] = useState(false);
  const [doing, setDoing] = useState<string | null>(null);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const isMobile = () => window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
    const show = async () => {
      // Cada parte falha sozinha: sem lucro agora, ainda mostra as tarefas (e vice-versa).
      const [p, t] = await Promise.all([
        isMobile() ? fetchProfit().catch(() => null) : Promise.resolve(null),
        fetchOverdue().catch(() => [] as Overdue[]),
      ]);
      setProfit(p);
      setTasks(t);
      if (p || t.length) setOpen(true);
    };
    show();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenAt.current = Date.now(); return; }
      if (hiddenAt.current && Date.now() - hiddenAt.current >= RESUME_AFTER_MS) show();
      hiddenAt.current = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const complete = async (id: string) => {
    setDoing(id);
    try {
      await saveTask({ data: { id, patch: { status: "concluida" } } });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      const rest = tasks.filter((t) => t.id !== id);
      setTasks(rest);
      toast.success("Tarefa concluída");
      if (!rest.length && !profit) setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao concluir");
    } finally {
      setDoing(null);
    }
  };

  if (!profit && !tasks.length) return null;
  const n = tasks.length;
  const negative = !!profit && profit.lucro < 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
        {profit && (
          <>
            <DialogHeader>
              <DialogTitle>💰 Lucro de hoje</DialogTitle>
              <DialogDescription>
                {profit.pedidos} pedido{profit.pedidos === 1 ? "" : "s"} até agora · {profit.date.slice(8, 10)}/{profit.date.slice(5, 7)}
              </DialogDescription>
            </DialogHeader>
            <div className={`py-1 text-center text-4xl font-bold tracking-tight tabular-nums ${negative ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {usd(profit.lucro)}
            </div>
          </>
        )}

        {n > 0 && (
          <div className={profit ? "border-t border-border pt-4 space-y-3" : "space-y-3"}>
            {profit ? (
              <p className="text-sm font-semibold flex items-center gap-2">
                <span className="size-7 rounded-lg bg-destructive/10 text-destructive grid place-items-center"><AlarmClock className="size-3.5" /></span>
                {n === 1 ? "1 tarefa atrasada" : `${n} tarefas atrasadas`}
              </p>
            ) : (
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="size-8 rounded-lg bg-destructive/10 text-destructive grid place-items-center"><AlarmClock className="size-4" /></span>
                  {n === 1 ? "Você tem 1 tarefa atrasada" : `Você tem ${n} tarefas atrasadas`}
                </DialogTitle>
                <DialogDescription>O prazo já passou. Conclua ou ajuste a data na aba Tarefas.</DialogDescription>
              </DialogHeader>
            )}
            <div className="max-h-[40vh] overflow-y-auto -mx-1 px-1 space-y-2">
              {tasks.map((t) => {
                const pr = PRIORITY[t.priority] ?? PRIORITY.media;
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 font-medium ${pr.cls}`}>{pr.label}</span>
                        <span className="text-destructive font-medium">
                          venceu {t.due_date!.slice(8, 10)}/{t.due_date!.slice(5, 7)} · {t.daysLate === 1 ? "há 1 dia" : `há ${t.daysLate} dias`}
                        </span>
                      </p>
                    </div>
                    <button onClick={() => complete(t.id)} disabled={!!doing}
                      className="h-8 px-2.5 rounded-lg border border-border text-xs font-medium flex items-center gap-1 hover:border-emerald-500/50 hover:text-emerald-600 disabled:opacity-50 shrink-0">
                      {doing === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Concluir
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {n > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
            <Button onClick={() => { setOpen(false); navigate({ to: "/tarefas" }); }}>Ver tarefas</Button>
          </div>
        ) : (
          <Button onClick={() => setOpen(false)} className="w-full">Fechar</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

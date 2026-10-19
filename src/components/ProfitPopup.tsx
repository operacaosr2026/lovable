import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getTodayProfit } from "@/lib/profit-popup.functions";

// Celular: toda vez que o app abre — e quando volta pra frente depois de um
// tempo em segundo plano (no app instalado, "abrir" de novo não recarrega a
// página) — mostra o lucro de hoje.
const MOBILE_MAX_WIDTH = 767;
const RESUME_AFTER_MS = 5 * 60_000;

const usd = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

type Profit = { lucro: number; pedidos: number; date: string };

export function ProfitPopup() {
  const fetchProfit = useServerFn(getTodayProfit);
  const [profit, setProfit] = useState<Profit | null>(null);
  const [open, setOpen] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const isMobile = () => window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
    const show = async () => {
      if (!isMobile()) return;
      try {
        const r = await fetchProfit();
        if (!r) return;   // sem acesso ao lucro
        setProfit(r);
        setOpen(true);
      } catch { /* sem lucro agora: não atrapalha a abertura do app */ }
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

  if (!profit) return null;
  const negative = profit.lucro < 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>💰 Lucro de hoje</DialogTitle>
          <DialogDescription>
            {profit.pedidos} pedido{profit.pedidos === 1 ? "" : "s"} até agora · {profit.date.slice(8, 10)}/{profit.date.slice(5, 7)}
          </DialogDescription>
        </DialogHeader>
        <div className={`py-2 text-center text-4xl font-bold tracking-tight tabular-nums ${negative ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {usd(profit.lucro)}
        </div>
        <Button onClick={() => setOpen(false)} className="w-full">Fechar</Button>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Consultas que dependem de pedidos (Dashboard, card "Lucro mês", Pedidos,
// Rastreamento, Caixa, Metas...). Recarregadas quando chega o sinal "orders".
const ORDER_QUERY_KEYS = [
  "dashboard-overview", "lg-dashboard", "lg-dashboard-hourly", "lg-dashboard-chart", "lg-dash-breakdown",
  "lg-card-metrics", "lg-orders", "lg-logistics", "lg-acc-lucro", "lg-card-goal", "lg-goal-history",
  "lg-note-metrics", "shop-cash", "shop-cash-standalone", "shop-cash-pending", "shop-cash-last-synced", "shop-group-cash-pending", "caixa-simulation",
  "product-sales", "store-avg-orders", "goals-history-overview",
];
const KEYS_BY_EVENT: Record<string, string[]> = {
  orders: ORDER_QUERY_KEYS,
  tasks: ["tasks"],
  notifications: ["notifications"],
};

// Pedido pode gerar vários sinais seguidos (criado, pago, enviado...): recarrega
// no máximo a cada 30s pra não multiplicar o tráfego do banco.
const MIN_INTERVAL_MS: Record<string, number> = { orders: 30_000, tasks: 1_000, notifications: 1_000 };

// Escuta o canal de tempo real do workspace (ver realtime.server.ts) e
// recarrega só as telas afetadas. Aba em segundo plano: só marca como
// desatualizado — recarrega quando a pessoa voltar pra aba.
export function useRealtimeSync(ownerId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!ownerId) return;
    const lastRun: Record<string, number> = {};
    const timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

    const run = (event: string) => {
      timers[event] = undefined;
      lastRun[event] = Date.now();
      const keys = KEYS_BY_EVENT[event] ?? [];
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      qc.invalidateQueries({
        predicate: (q) => keys.includes(String(q.queryKey[0])),
        refetchType: visible ? "active" : "none",
      });
    };

    const schedule = (event: string) => {
      if (!KEYS_BY_EVENT[event] || timers[event]) return;
      const wait = Math.max(500, (lastRun[event] ?? 0) + (MIN_INTERVAL_MS[event] ?? 1_000) - Date.now());
      timers[event] = setTimeout(() => run(event), wait);
    };

    const channel = supabase
      .channel(`ws-${ownerId}`)
      .on("broadcast", { event: "*" }, (msg) => schedule(String(msg.event)))
      .subscribe();

    return () => {
      Object.values(timers).forEach((t) => t && clearTimeout(t));
      supabase.removeChannel(channel);
    };
  }, [ownerId, qc]);
}

import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";
import { InteligenciaPage } from "@/components/inteligencia/Inteligencia";

export const Route = createFileRoute("/inteligencia")({
  beforeLoad: requireAuth,
  // ?dica=<índice>: abre a gaveta dessa dica.
  validateSearch: (s: Record<string, unknown>): { dica?: number } => {
    const n = Number(s.dica);
    return Number.isInteger(n) && n >= 0 ? { dica: n } : {};
  },
  component: InteligenciaPage,
});

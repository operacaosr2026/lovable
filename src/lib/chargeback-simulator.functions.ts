import { createServerFn } from "@tanstack/react-start";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { getCaixaShops } from "@/lib/lg-cards.functions";
import { ESTORNO_WINDOW_DAYS, getEstornoStats } from "@/lib/estorno-daily.server";

// Caixa Geral > Simulador Chargeback: por loja (as mesmas do Caixa Geral), a
// taxa de estorno de 90 dias — chargebacks ÷ pedidos pagos, igual à Shopify e
// ao card de Lojas e Grupos. A tela faz a conta do limite e do "e se…".
export const getChargebackSimulatorData = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const shops = (await getCaixaShops(context.ownerId)) as { id: string; name: string }[];
    const stats = await getEstornoStats(context.ownerId, shops.map((s) => s.id));
    return {
      windowDays: ESTORNO_WINDOW_DAYS,
      shops: shops.map((s) => {
        const st = stats.get(s.id);
        return { id: s.id, name: s.name, pedidos: st?.pedidos ?? 0, chargebacks: st?.estornos ?? 0 };
      }),
    };
  });

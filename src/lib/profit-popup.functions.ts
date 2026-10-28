import { createServerFn } from "@tanstack/react-start";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isoTodayUS } from "@/lib/timezone";
import { companyShopIdsForMonth, monthStartOf } from "@/lib/company-goals.server";
import { computeAccumulatedLucroServer } from "@/lib/lg-overview.functions";
import { allowedCategories } from "@/lib/notification-categories";

// Popup do lucro de hoje ao abrir o app no celular. Mesma conta e mesmas lojas
// do push "Lucro do dia" (goal-events.server.ts) e do Dashboard em Hoje
// (reembolso/chargeback diluído no mês, hoje sem desconto), e só pra quem pode receber
// esse push (admin ou membro com nt_lucro). Sem acesso: null, e nada aparece.
export const getTodayProfit = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    if (!allowedCategories(context.role, context.permissions).has("nt_lucro")) return null;
    const today = isoTodayUS();
    const shops = await companyShopIdsForMonth(context.ownerId, monthStartOf(today));
    const r = shops.length
      ? await computeAccumulatedLucroServer(supabaseAdmin, context.ownerId, shops, today, today, { panelRefunds: true })
      : { lucro: 0, pedidos: 0 };
    return { lucro: r.lucro, pedidos: r.pedidos, date: today };
  });

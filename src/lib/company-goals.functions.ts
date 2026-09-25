import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isoTodayUS } from "@/lib/timezone";
import {
  companyShopIdsForMonth, listCompanyGoalsFor, monthEndOf, monthStartOf,
} from "@/lib/company-goals.server";

// Meta do mês atual + lojas que contam nela (a aba "Atual" da página Metas
// calcula o acumulado com getLgAccumulatedLucro, igual à aba Metas antiga).
export const getCompanyGoalCurrent = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const monthStart = monthStartOf(isoTodayUS());
    const [{ data: row }, shopIds] = await Promise.all([
      supabaseAdmin.from("company_goals").select("meta,lucro_por_venda")
        .eq("user_id", context.ownerId).eq("month", monthStart).maybeSingle(),
      companyShopIdsForMonth(context.ownerId, monthStart),
    ]);
    return {
      monthStart,
      monthEnd: monthEndOf(monthStart),
      goal: row ? { meta: Number(row.meta), lucro_por_venda: row.lucro_por_venda != null ? Number(row.lucro_por_venda) : null } : null,
      shopIds,
    };
  });

// Todas as metas (passadas congeladas, a do mês ao vivo, futuras sem realizado).
export const listCompanyGoals = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => ({ goals: await listCompanyGoalsFor(context.ownerId) }));

const MonthInput = z.string().regex(/^\d{4}-\d{2}$/);

// Planejamento: só o mês atual e os próximos — mês fechado tem o realizado
// congelado e não muda mais.
function assertNotPast(month: string) {
  if (`${month}-01` < monthStartOf(isoTodayUS())) throw new Error("Mês já fechado — não dá pra alterar a meta.");
}

export const upsertCompanyGoal = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    month: MonthInput,
    meta: z.number().positive(),
    lucro_por_venda: z.number().positive().nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    assertNotPast(data.month);
    const { error } = await supabaseAdmin.from("company_goals").upsert({
      user_id: context.ownerId, month: `${data.month}-01`,
      meta: data.meta, lucro_por_venda: data.lucro_por_venda, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,month" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCompanyGoal = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ month: MonthInput }).parse(d))
  .handler(async ({ context, data }) => {
    assertNotPast(data.month);
    const { error } = await supabaseAdmin.from("company_goals").delete()
      .eq("user_id", context.ownerId).eq("month", `${data.month}-01`);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

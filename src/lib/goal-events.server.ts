import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isoTodayUS } from "@/lib/timezone";
import { companyShopIdsForMonth, monthEndOf, monthStartOf } from "@/lib/company-goals.server";
import { computeAccumulatedLucroServer } from "@/lib/lg-overview.functions";
import { emitEvent } from "@/lib/notify.server";

// Push de Metas (tipo nt_metas), checado a cada 10 min pelo notifications-refresh:
//  - meta do mês atingida: lucro do mês (mesma conta da página Metas) ≥ meta;
//  - meta do dia atingida: lucro de hoje ≥ meta do mês ÷ dias do mês.
// Cada uma avisa uma vez (emitEvent); se as duas de hoje já foram avisadas, nem calcula.

const usd = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(v);

export async function checkGoalEvents(ownerId: string) {
  const today = isoTodayUS();
  const month = monthStartOf(today);
  const { data: goal } = await supabaseAdmin.from("company_goals").select("meta")
    .eq("user_id", ownerId).eq("month", month).maybeSingle();
  const meta = Number(goal?.meta ?? 0);
  if (!(meta > 0)) return;

  const monthKey = `goal_month:${month}`;
  const dayKey = `goal_day:${today}`;
  const { data: done } = await supabaseAdmin.from("notification_events").select("key")
    .eq("owner_id", ownerId).in("key", [monthKey, dayKey]);
  const doneKeys = new Set((done ?? []).map((d) => d.key));
  if (doneKeys.has(monthKey) && doneKeys.has(dayKey)) return;

  const shops = await companyShopIdsForMonth(ownerId, month);
  if (!shops.length) return;

  if (!doneKeys.has(monthKey)) {
    const acc = await computeAccumulatedLucroServer(supabaseAdmin, ownerId, shops, month, today);
    if (acc.lucro >= meta) {
      await emitEvent(ownerId, {
        key: monthKey, title: "🎯 Meta do mês atingida!",
        body: `Lucro de ${usd(acc.lucro)} — meta de ${usd(meta)}`, link: "/metas",
      });
    }
  }
  if (!doneKeys.has(dayKey)) {
    const days = Number(monthEndOf(month).slice(8, 10));
    const metaDia = meta / days;
    const hoje = await computeAccumulatedLucroServer(supabaseAdmin, ownerId, shops, today, today);
    if (hoje.lucro >= metaDia) {
      await emitEvent(ownerId, {
        key: dayKey, title: "🎯 Meta do dia atingida",
        body: `Lucro hoje de ${usd(hoje.lucro)} — meta do dia ${usd(metaDia)}`, link: "/metas",
      });
    }
  }
}

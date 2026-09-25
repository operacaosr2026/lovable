import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isoTodayUS } from "@/lib/timezone";
import { computeAccumulatedLucroServer } from "@/lib/lg-overview.functions";

// Metas da empresa: uma por mês (company_goals.month = dia 1), medindo o lucro
// das lojas dos grupos ativos — a mesma conta de lucro da aba Metas antiga
// (computeAccumulatedLucro). Mês fechado tem o realizado congelado
// (realizado_final + shop_ids_final): arquivar um grupo depois não muda o histórico.

export function monthStartOf(iso: string) { return `${iso.slice(0, 7)}-01`; }
export function monthEndOf(monthStart: string) {
  const d = new Date(`${monthStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

// Lojas que contam no mês: grupos ativos + grupos que deixaram de ser ativos
// durante (ou depois de) esse mês — o que o grupo já somou no mês não some.
export async function companyShopIdsForMonth(ownerId: string, monthStart: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from("lg_card_shops")
    .select("shop_id,lg_cards!inner(user_id,status,inactive_since)")
    .eq("lg_cards.user_id", ownerId);
  if (error) throw new Error(error.message);
  const ids = new Set<string>();
  for (const r of (data ?? []) as any[]) {
    const c = r.lg_cards;
    if (c.status === "ativo" || (c.inactive_since && String(c.inactive_since).slice(0, 10) >= monthStart)) ids.add(r.shop_id);
  }
  return [...ids];
}

async function lucroDoMes(ownerId: string, shopIds: string[], monthStart: string, today: string) {
  if (!shopIds.length || monthStart > today) return 0;
  const end = monthEndOf(monthStart) < today ? monthEndOf(monthStart) : today;
  const r = await computeAccumulatedLucroServer(supabaseAdmin, ownerId, shopIds, monthStart, end);
  return r.lucro;
}

// Congela o realizado dos meses já fechados que ainda não foram congelados.
// Roda na leitura do histórico e todo dia à meia-noite (estorno-daily), então
// na virada do mês o realizado fica gravado antes de alguém arquivar um grupo.
export async function freezeClosedCompanyGoals(ownerId: string) {
  const today = isoTodayUS();
  const current = monthStartOf(today);
  const { data: rows } = await supabaseAdmin.from("company_goals")
    .select("id,month,shop_ids_final")
    .eq("user_id", ownerId).lt("month", current).is("realizado_final", null);
  for (const r of (rows ?? []) as any[]) {
    const shops = (r.shop_ids_final as string[] | null) ?? await companyShopIdsForMonth(ownerId, r.month);
    const realizado = await lucroDoMes(ownerId, shops, r.month, today);
    await supabaseAdmin.from("company_goals")
      .update({ realizado_final: realizado, shop_ids_final: shops, frozen_at: new Date().toISOString() })
      .eq("id", r.id).eq("user_id", ownerId);
  }
}

export type CompanyGoalRow = {
  month: string;            // YYYY-MM-01
  meta: number;
  lucro_por_venda: number | null;
  realizado: number | null; // null = mês futuro
  // Só no mês atual: lucro previsto no fim do mês no ritmo atual — mesma conta da
  // aba Atual (lucro até hoje + média dos últimos 3 dias fechados × dias restantes).
  projecao: number | null;
  status: "futura" | "em_andamento" | "batida" | "nao_batida";
};

export async function listCompanyGoalsFor(ownerId: string): Promise<CompanyGoalRow[]> {
  await freezeClosedCompanyGoals(ownerId);
  const today = isoTodayUS();
  const current = monthStartOf(today);
  const { data: rows, error } = await supabaseAdmin.from("company_goals")
    .select("month,meta,lucro_por_venda,realizado_final")
    .eq("user_id", ownerId).order("month", { ascending: true });
  if (error) throw new Error(error.message);

  return Promise.all(((rows ?? []) as any[]).map(async (r) => {
    const meta = Number(r.meta);
    let realizado: number | null = null;
    let projecao: number | null = null;
    if (r.month < current) realizado = Number(r.realizado_final ?? 0);
    else if (r.month === current) {
      const shops = await companyShopIdsForMonth(ownerId, current);
      if (shops.length) {
        const acc = await computeAccumulatedLucroServer(supabaseAdmin, ownerId, shops, current, today);
        const end = monthEndOf(current);
        const diasRestantes = Math.max(0, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000));
        realizado = acc.lucro;
        projecao = acc.lucro + (acc.mediaUltimos3 ?? 0) * diasRestantes;
      } else {
        realizado = 0;
        projecao = 0;
      }
    }
    const status: CompanyGoalRow["status"] = realizado == null ? "futura"
      : r.month === current ? "em_andamento"
      : realizado >= meta ? "batida" : "nao_batida";
    return { month: r.month, meta, lucro_por_venda: r.lucro_por_venda != null ? Number(r.lucro_por_venda) : null, realizado, projecao, status };
  }));
}

// Todos os donos com meta — usado pelo job diário.
export async function freezeAllCompanyGoals() {
  const { data } = await supabaseAdmin.from("company_goals").select("user_id").is("realizado_final", null);
  const owners = [...new Set(((data ?? []) as any[]).map((r) => r.user_id as string))];
  for (const o of owners) {
    try { await freezeClosedCompanyGoals(o); } catch (e) { console.error("company-goals freeze fail", o, e); }
  }
  return { owners: owners.length };
}

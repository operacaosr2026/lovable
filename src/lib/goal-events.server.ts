import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isoTodayUS } from "@/lib/timezone";
import { companyShopIdsForMonth, monthStartOf } from "@/lib/company-goals.server";
import { computeAccumulatedLucroServer } from "@/lib/lg-overview.functions";
import { resolveWorkspaceAccess } from "@/integrations/supabase/workspace-middleware";
import { canReceive, emitEvent, getUserNotificationPrefs, DEFAULT_PROFIT_TIMES } from "@/lib/notify.server";

// Pushes que dependem do lucro, checados pelo notifications-refresh (5 em 5 min):
//  - Metas (nt_metas): meta do mês atingida — lucro do mês (mesma conta da
//    página Metas) ≥ meta. Uma vez por mês (emitEvent).
//  - Lucro do dia (nt_lucro): nos horários que cada pessoa escolheu (até 3,
//    no fuso dela), o lucro de hoje até aquele momento. Uma vez por horário/dia.
// O dia do lucro é o do negócio (Nova York), igual ao Dashboard.

const usd = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(v);

export async function checkGoalEvents(ownerId: string) {
  const today = isoTodayUS();
  const month = monthStartOf(today);
  const { data: goal } = await supabaseAdmin.from("company_goals").select("meta")
    .eq("user_id", ownerId).eq("month", month).maybeSingle();
  const meta = Number(goal?.meta ?? 0);
  if (!(meta > 0)) return;

  const monthKey = `goal_month:${month}`;
  const { data: done } = await supabaseAdmin.from("notification_events").select("key")
    .eq("owner_id", ownerId).eq("key", monthKey).maybeSingle();
  if (done) return;   // já avisado este mês — nem calcula

  const shops = await companyShopIdsForMonth(ownerId, month);
  if (!shops.length) return;
  const acc = await computeAccumulatedLucroServer(supabaseAdmin, ownerId, shops, month, today);
  if (acc.lucro >= meta) {
    await emitEvent(ownerId, {
      key: monthKey, title: "🎯 Meta do mês atingida!",
      body: `Lucro de ${usd(acc.lucro)} — meta de ${usd(meta)}`, link: "/metas",
    });
  }
}

// Hora e data (HH:MM / YYYY-MM-DD) agora no fuso da pessoa.
function localNow(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hhmm: `${g("hour")}:${g("minute")}` };
}
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Janela pra disparar depois do horário: o cron roda de 5 em 5 min; se uma
// rodada falhar, a seguinte ainda manda (até 60 min depois).
const PROFIT_WINDOW_MIN = 60;

export async function checkProfitReports(ownerId: string) {
  const { data: members } = await supabaseAdmin.from("workspace_members").select("member_id").eq("owner_id", ownerId);
  const people = [ownerId, ...((members ?? []) as { member_id: string }[]).map((m) => m.member_id)];
  const { data: settings } = await supabaseAdmin.from("notification_settings")
    .select("user_id,profit_times,timezone").in("user_id", people);

  // Quem ainda não tem configuração salva recebe nos horários padrão.
  type Row = { user_id: string; profit_times: string[]; timezone: string };
  const saved = new Map(((settings ?? []) as Row[]).map((r) => [r.user_id, r]));
  const rows: Row[] = people.map((id) => saved.get(id) ?? { user_id: id, profit_times: DEFAULT_PROFIT_TIMES, timezone: "America/Sao_Paulo" });

  let lucroHoje: { lucro: number; pedidos: number } | null = null;
  for (const st of rows) {
    if (!st.profit_times?.length) continue;
    let local: { date: string; hhmm: string };
    try { local = localNow(st.timezone); } catch { continue; }
    const now = minutes(local.hhmm);
    const due = st.profit_times.filter((t) => now >= minutes(t) && now - minutes(t) < PROFIT_WINDOW_MIN);
    if (!due.length) continue;

    const [access, prefs] = await Promise.all([resolveWorkspaceAccess(supabaseAdmin, st.user_id), getUserNotificationPrefs(st.user_id)]);
    if (access.ownerId !== ownerId || !canReceive("nt_lucro", access, prefs.muted)) continue;

    for (const t of due) {
      const key = `profit:${st.user_id}:${local.date}:${t}`;
      const { data: done } = await supabaseAdmin.from("notification_events").select("key")
        .eq("owner_id", ownerId).eq("key", key).maybeSingle();
      if (done) continue;
      if (!lucroHoje) {
        const today = isoTodayUS();
        const shops = await companyShopIdsForMonth(ownerId, monthStartOf(today));
        lucroHoje = shops.length
          ? await computeAccumulatedLucroServer(supabaseAdmin, ownerId, shops, today, today)
          : { lucro: 0, pedidos: 0 };
      }
      await emitEvent(ownerId, {
        key, targetUserId: st.user_id, ignoreDnd: true,
        title: `💰 Lucro até ${t}: ${usd(lucroHoje.lucro)}`,
        body: `${lucroHoje.pedidos} pedido${lucroHoje.pedidos === 1 ? "" : "s"} hoje`,
        link: "/",
      });
    }
  }
}

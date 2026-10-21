import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";

// Gasto de anúncios é do card (lg_card_ad_spend), com as campanhas escolhidas
// no próprio card (lg_card_meta_accounts). O token é o da conexão Meta de
// qualquer loja do dono que enxergue a conta de anúncios.
export const META_GRAPH = "https://graph.facebook.com/v21.0";
const db = (table: string) => (supabaseAdmin as any).from(table);

export async function metaTokenForAccount(ownerId: string, adAccountId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("shop_meta_tokens")
    .select("access_token, ad_accounts, updated_at").eq("user_id", ownerId)
    .order("updated_at", { ascending: false });
  const rows = ((data ?? []) as any[]).filter((r) => r.access_token);
  const sees = (r: any) => ((r.ad_accounts ?? []) as any[])
    .some((a) => a.id === adAccountId || `act_${a.account_id}` === adAccountId);
  return (rows.find(sees) ?? rows[0])?.access_token ?? null;
}

export async function syncCardAdSpend(
  ownerId: string,
  cardId: string,
  range: { from_date?: string; to_date?: string; since_days?: number },
) {
  const { data: accounts } = await db("lg_card_meta_accounts")
    .select("ad_account_id, selected_campaign_ids")
    .eq("user_id", ownerId).eq("card_id", cardId).eq("enabled", true);
  if (!accounts?.length) return { synced: 0, totalSpend: 0, configured: false };

  const today = range.to_date ?? isoTodayUS();
  const since = range.from_date ?? addDaysIso(today, -(range.since_days ?? 30));
  const timeRange = encodeURIComponent(JSON.stringify({ since, until: today }));
  const spendByDate = new Map<string, number>();
  const errors: string[] = [];

  for (const account of accounts as any[]) {
    const setStatus = (patch: Record<string, unknown>) => db("lg_card_meta_accounts").update(patch)
      .eq("user_id", ownerId).eq("card_id", cardId).eq("ad_account_id", account.ad_account_id);
    try {
      const token = await metaTokenForAccount(ownerId, account.ad_account_id);
      if (!token) throw new Error("Meta não conectada em nenhuma loja");
      const ids = (account.selected_campaign_ids ?? []) as string[];
      const filtering = ids.length
        ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: ids }]))}`
        : "";
      let url: string | null = `${META_GRAPH}/${account.ad_account_id}/insights?level=account&fields=spend,account_currency&time_increment=1&time_range=${timeRange}${filtering}&limit=500&access_token=${encodeURIComponent(token)}`;
      const accountSpend = new Map<string, number>();
      while (url) {
        const r = await fetchWithRetry(url);
        const json: any = await r.json();
        if (!r.ok || json.error) throw new Error(json?.error?.message || `Falha (${r.status})`);
        // O lucro é em USD e o gasto não é convertido: conta em BRL somaria reais como dólares.
        const cur = (json.data ?? []).find((d: any) => d.account_currency)?.account_currency;
        if (cur && cur !== "USD") throw new Error(`Conta de anúncios em ${cur}: só contas em USD entram no lucro — gasto não importado`);
        for (const d of (json.data ?? []) as any[]) {
          if (d.date_start) accountSpend.set(d.date_start, (accountSpend.get(d.date_start) ?? 0) + Number(d.spend ?? 0));
        }
        url = json.paging?.next ?? null;
      }
      for (const [date, v] of accountSpend) spendByDate.set(date, (spendByDate.get(date) ?? 0) + v);
      await setStatus({ last_sync_at: new Date().toISOString(), last_sync_status: "ok", last_sync_error: null });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      errors.push(`${account.ad_account_id}: ${msg}`);
      await setStatus({ last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: msg.slice(0, 500) });
    }
  }

  // Conta com erro deixaria o dia só com as outras — mantém o último valor completo.
  if (errors.length) throw new Error(`Gasto de Ads não atualizado (mantido o último valor completo) — ${errors.join("; ")}`);

  // A Meta omite dias sem gasto: dia do período que não voltou é 0. O último
  // dia fica como está se não voltou (dados dele podem ainda não estar prontos).
  const stale: string[] = [];
  for (let d = since; d < today; d = addDaysIso(d, 1)) if (!spendByDate.has(d)) stale.push(d);
  if (stale.length) {
    const { error } = await db("lg_card_ad_spend").delete().eq("card_id", cardId).in("date", stale);
    if (error) throw new Error(error.message);
  }
  const rows = [...spendByDate].map(([date, amount]) => ({
    card_id: cardId, user_id: ownerId, date, amount: Math.round(amount * 100) / 100, synced_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await db("lg_card_ad_spend").upsert(rows, { onConflict: "card_id,date" });
    if (error) throw new Error(error.message);
  }
  return { synced: rows.length, totalSpend: rows.reduce((s, r) => s + r.amount, 0), configured: true };
}

export async function adSpendForCards(ownerId: string, cardIds: string[], from: string, to: string) {
  if (!cardIds.length) return [] as { card_id: string; date: string; amount: number }[];
  // Sem coluna id (chave é card_id+date), então não dá pra usar selectAll —
  // pagina ordenando pela chave.
  const out: { card_id: string; date: string; amount: number }[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db("lg_card_ad_spend").select("card_id, date, amount")
      .eq("user_id", ownerId).in("card_id", cardIds).gte("date", from).lte("date", to)
      .order("card_id").order("date").range(start, start + 999);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as any[]) out.push({ card_id: r.card_id, date: r.date, amount: Number(r.amount ?? 0) });
    if ((data ?? []).length < 1000) return out;
  }
}

// Telas que recebem uma lista de lojas (Dashboard do card, Metas, consultor):
// o gasto é o dos cards não arquivados que contêm alguma dessas lojas.
export async function adSpendForShops(ownerId: string, shopIds: string[], from: string, to: string) {
  if (!shopIds.length) return [];
  const { data, error } = await supabaseAdmin.from("lg_card_shops")
    .select("card_id, lg_cards!inner(user_id,status)")
    .eq("lg_cards.user_id", ownerId).neq("lg_cards.status", "arquivado").in("shop_id", shopIds);
  if (error) throw new Error(error.message);
  const cardIds = [...new Set(((data ?? []) as any[]).map((r) => r.card_id as string))];
  return adSpendForCards(ownerId, cardIds, from, to);
}

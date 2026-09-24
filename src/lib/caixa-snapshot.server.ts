import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { isoTodayUS } from "@/lib/timezone";
import { computeShopsReceivable } from "@/lib/shop-orders.functions";

// Foto diária do caixa de cada loja (saldo atual + a receber), gravada uma vez
// por dia no fim do dia (pg_cron, ver *_caixa_daily_snapshots.sql). O "a
// receber" de dias passados não dá pra recalcular depois, então é só assim que
// o gráfico do "Saldo total" do Caixa tem o valor real de cada dia.
//
// Saldo = mesma regra do card "Saldo atual" (LgCashflowView): saldo inicial +
// lançamentos conciliados, fora taxas Shopify, sync automático e o gasto
// diário de anúncio (que não é saída de caixa).
export async function runCaixaSnapshots() {
  const date = isoTodayUS();
  const { data: cardShops } = await supabaseAdmin.from("lg_card_shops").select("shop_id");
  const shopIds = [...new Set(((cardShops ?? []) as any[]).map((r) => r.shop_id as string))];
  if (!shopIds.length) return { date, saved: 0 };

  const { data: shops } = await supabaseAdmin.from("shops").select("id,user_id,opening_balance").in("id", shopIds);
  const byOwner = new Map<string, any[]>();
  for (const s of (shops ?? []) as any[]) {
    if (!byOwner.has(s.user_id)) byOwner.set(s.user_id, []);
    byOwner.get(s.user_id)!.push(s);
  }

  const rows: any[] = [];
  for (const [ownerId, ownerShops] of byOwner) {
    const ids = ownerShops.map((s) => s.id as string);
    const [{ data: entries }, receivable] = await Promise.all([
      selectAll(supabaseAdmin.from("shop_cash_entries").select("shop_id,kind,amount,auto_kind")
        .eq("user_id", ownerId).in("shop_id", ids).eq("reconciled", true)
        .neq("source", "shopify_fees_sync").neq("source", "shopify_auto_sync")),
      computeShopsReceivable(supabaseAdmin, ownerId, ids).catch((e) => {
        console.error("caixa-snapshot: a receber falhou", ownerId, e);
        return null;
      }),
    ]);
    // Sem o "a receber" a foto sairia errada — pula o dono e loga.
    if (!receivable) continue;
    const saldo = new Map<string, number>(ownerShops.map((s) => [s.id, Number(s.opening_balance ?? 0)]));
    for (const e of (entries ?? []) as any[]) {
      if (e.auto_kind === "meta_ads_spend") continue;
      const v = e.kind === "income" ? Number(e.amount) : -Number(e.amount);
      saldo.set(e.shop_id, (saldo.get(e.shop_id) ?? 0) + v);
    }
    const recvByShop = new Map(receivable.perShop.map((p: any) => [p.shop_id as string, Number(p.amount ?? 0)]));
    for (const id of ids) {
      rows.push({ user_id: ownerId, shop_id: id, date, saldo: saldo.get(id) ?? 0, receivable: recvByShop.get(id) ?? 0 });
    }
  }

  if (rows.length) {
    const { error } = await supabaseAdmin.from("caixa_daily_snapshots").upsert(rows, { onConflict: "shop_id,date" });
    if (error) throw new Error(error.message);
  }
  return { date, saved: rows.length };
}

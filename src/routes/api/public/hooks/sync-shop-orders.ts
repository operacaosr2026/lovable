import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronApiKey } from "@/lib/cron-auth";
import { recomputePayoutLag, costProductsFor } from "@/lib/shop-orders.functions";
import { orderLineItemsCost } from "@/lib/product-cost-match";
import { selectAll } from "@/lib/select-all";

import { fetchWithRetry } from "@/lib/http";
import { getPausedShopifyStoreIds } from "@/lib/sync-pause.server";
const PROCESSING_DELAY_DAYS = 7;

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}

// Loga (sem lançar) quando um fetch paginado bate no teto de páginas antes de
// esgotar a Shopify (`url` ainda não-vazio) — sem isso, uma loja de alto
// volume tinha dado mais antigo do período silenciosamente descartado.
function warnPaginationCap(fnName: string, domain: string, url: string) {
  if (url) console.error(`[sync-shop-orders] ${fnName}(${domain}): atingiu o teto de páginas antes de esgotar a listagem — dado do período pode estar incompleto.`);
}

async function fetchOrders(domain: string, token: string, sinceISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(sinceISO)}`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`Shopify ${res.status}`);
    const json: any = await res.json();
    out.push(...(json.orders ?? []));
    const link = res.headers.get("link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  warnPaginationCap("fetchOrders", domain, url);
  return out;
}

async function unitCostFor(shopId: string, userId: string, date: string, fallback: number) {
  const { data } = await supabaseAdmin.from("shop_product_cost_history")
    .select("unit_cost,valid_from,valid_to")
    .eq("user_id", userId).eq("shop_id", shopId);
  for (const r of (data ?? []).sort((a: any, b: any) => (b.valid_from ?? "").localeCompare(a.valid_from ?? ""))) {
    const okFrom = !r.valid_from || r.valid_from <= date;
    const okTo = !r.valid_to || r.valid_to >= date;
    if (okFrom && okTo) return Number(r.unit_cost);
  }
  return Number(fallback ?? 0);
}

const PAYOUT_CATEGORY = "Depósito Shopify";
const PAYOUT_STATUS_LABEL: Record<string, string> = {
  paid: "depositado",
  in_transit: "em trânsito",
  scheduled: "agendado",
  pending: "previsto",
};

async function fetchPayouts(domain: string, token: string, sinceISO: string) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/payouts.json?limit=250&date_min=${encodeURIComponent(sinceISO.slice(0, 10))}`;
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify payouts ${res.status}`);
    }
    const json: any = await res.json();
    out.push(...(json.payouts ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  warnPaginationCap("fetchPayouts", domain, url);
  return out;
}

async function fetchBalanceTransactions(domain: string, token: string, maxPages: number) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/balance/transactions.json?limit=250`;
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return [];
      throw new Error(`Shopify balance transactions ${res.status}`);
    }
    const json: any = await res.json();
    out.push(...(json.transactions ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  warnPaginationCap("fetchBalanceTransactions", domain, url);
  return out;
}

// Disputas reais (chargeback/inquiry), fonte usada pelo relatório "Taxa de
// estorno" do próprio Shopify. Não confundir com balance transactions: lá o
// type nunca vem como "dispute" nesse endpoint, então filtrar por isso deixa
// a taxa sempre em 0%.
async function fetchDisputes(domain: string, token: string, maxPages: number) {
  const out: any[] = [];
  let url = `https://${domain}/admin/api/2024-10/shopify_payments/disputes.json?limit=250`;
  for (let i = 0; i < maxPages && url; i++) {
    const res = await fetchWithRetry(url, { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } });
    if (!res.ok) {
      if (res.status === 403) { console.warn(`disputes 403 (escopo read_shopify_payments_disputes ausente?) — ${domain}`); return []; }
      if (res.status === 404) return [];
      throw new Error(`Shopify disputes ${res.status}`);
    }
    const json: any = await res.json();
    out.push(...(json.disputes ?? []));
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : "";
  }
  warnPaginationCap("fetchDisputes", domain, url);
  return out;
}

// Tempo médio de repasse: para cada venda já incluída em um payout, mede os dias
// entre o processamento da venda e a data do depósito. Compartilhado com o botão
// "Sincronizar" (src/lib/shop-orders.functions.ts) — não é mais exclusivo do cron.
async function updatePayoutLag(shopId: string, _userId: string, domain: string, token: string) {
  await recomputePayoutLag(shopId, domain, token);
}

async function syncPayoutsForShop(shopId: string, userId: string, domain: string, token: string, cutoff: string | null) {
  const floor = "2026-06-15";
  const sinceISO = cutoff && cutoff > floor ? `${cutoff}T00:00:00Z` : `${floor}T00:00:00Z`;
  const payouts = await fetchPayouts(domain, token, sinceISO);
  // Depósitos que o usuário apagou manualmente ficam registrados aqui (ver
  // deleteCashEntry em shop-cash.functions.ts) — sem esse filtro eles voltam
  // a cada rodada do cron (roda 3x/dia), já que o cron não sabe que foram
  // descartados.
  const { data: dismissedRows } = await supabaseAdmin.from("shop_cash_dismissed_payouts")
    .select("shopify_payout_id").eq("user_id", userId).eq("shop_id", shopId);
  const dismissedIds = new Set((dismissedRows ?? []).map((r: any) => r.shopify_payout_id));
  const relevant = payouts.filter((p: any) =>
    p.id != null && !dismissedIds.has(String(p.id)) && ["paid", "in_transit", "scheduled", "pending"].includes(p.status));
  if (!relevant.length) return 0;

  const { data: existing } = await selectAll(supabaseAdmin.from("shop_cash_entries")
    .select("id,shopify_payout_id")
    .eq("user_id", userId).eq("shop_id", shopId)
    .in("shopify_payout_id", relevant.map((p: any) => String(p.id))));
  const existingById = new Map((existing ?? []).map((r: any) => [r.shopify_payout_id, r.id]));

  const toInsert = relevant.filter((p: any) => !existingById.has(String(p.id))).map((p: any) => ({
    user_id: userId, shop_id: shopId,
    kind: "income" as const,
    amount: Number(p.amount ?? 0),
    date: p.date,
    category: PAYOUT_CATEGORY,
    description: `Payout Shopify · ${PAYOUT_STATUS_LABEL[p.status] ?? p.status}`,
    source: "shopify_sync",
    shopify_payout_id: String(p.id),
  }));
  if (toInsert.length) await supabaseAdmin.from("shop_cash_entries").insert(toInsert);

  for (const p of relevant) {
    const id = existingById.get(String(p.id));
    if (!id) continue;
    await supabaseAdmin.from("shop_cash_entries").update({
      amount: Number(p.amount ?? 0),
      date: p.date,
      description: `Payout Shopify · ${PAYOUT_STATUS_LABEL[p.status] ?? p.status}`,
    }).eq("id", id);
  }

  return relevant.length;
}

async function syncRefundsAndChargebacks(shopId: string, userId: string, domain: string, token: string) {
  const transactions = await fetchBalanceTransactions(domain, token, 10);
  const refunds = transactions.filter((t: any) => t.type === "refund" && t.amount != null && t.id != null);

  const disputes = await fetchDisputes(domain, token, 10);
  const chargebacks = disputes.filter((d: any) => d.type === "chargeback" && d.amount != null && d.id != null);

  const cashRows = [
    ...refunds.map((t: any) => ({
      user_id: userId, shop_id: shopId,
      kind: "expense" as const,
      amount: Math.abs(Number(t.amount)),
      date: String(t.processed_at).slice(0, 10),
      category: "Reembolso",
      description: "Reembolso Shopify",
      source: "shopify_auto_sync",
      shopify_transaction_id: String(t.id),
    })),
    ...chargebacks.map((d: any) => ({
      user_id: userId, shop_id: shopId,
      kind: "expense" as const,
      amount: Math.abs(Number(d.amount)),
      date: String(d.initiated_at).slice(0, 10),
      category: "Chargeback",
      description: "Chargeback Shopify",
      source: "shopify_auto_sync",
      shopify_transaction_id: `dispute_${d.id}`,
    })),
  ];
  if (cashRows.length) {
    await supabaseAdmin.from("shop_cash_entries")
      .upsert(cashRows as any[], { onConflict: "shop_id,shopify_transaction_id" });
  }

  // Grava toda disputa (chargeback e inquiry) vinculada ao pedido, pra calcular
  // a taxa de estorno do mesmo jeito que o relatório do Shopify: pedidos com
  // chargeback ÷ total de pedidos na janela.
  if (disputes.length) {
    const disputeRows = disputes.filter((d: any) => d.id != null).map((d: any) => ({
      user_id: userId, shop_id: shopId,
      shopify_dispute_id: String(d.id),
      order_external_id: d.order_id != null ? String(d.order_id) : null,
      type: String(d.type ?? "unknown"),
      status: d.status ?? null,
      reason: d.reason ?? null,
      amount: Math.abs(Number(d.amount ?? 0)),
      currency: d.currency ?? null,
      initiated_at: String(d.initiated_at).slice(0, 10),
      finalized_on: d.finalized_on ? String(d.finalized_on).slice(0, 10) : null,
    }));
    await supabaseAdmin.from("shop_order_disputes")
      .upsert(disputeRows as any[], { onConflict: "shop_id,shopify_dispute_id" });
  }
}

async function syncPendingTransactionsForShop(shopId: string, userId: string, domain: string, token: string, lagDays: number) {
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 14);
  const payouts = await fetchPayouts(domain, token, since.toISOString());
  const payoutDateById = new Map(payouts.map((p: any) => [String(p.id), p.date as string]));

  const transactions = await fetchBalanceTransactions(domain, token, 3);
  const pendingTx = transactions.filter((t: any) =>
    t.payout_status === "pending" &&
    (t.payout_id == null || !payoutDateById.has(String(t.payout_id)))
  );

  await supabaseAdmin.from("shop_cash_entries").delete()
    .eq("user_id", userId).eq("shop_id", shopId).eq("source", "shopify_pending_sync");

  if (!pendingTx.length) return 0;

  const byDate = new Map<string, number>();
  for (const t of pendingTx) {
    const realDate = t.payout_id ? payoutDateById.get(String(t.payout_id)) : null;
    let key: string;
    if (realDate) {
      key = realDate;
    } else {
      const d = new Date(t.processed_at);
      d.setUTCDate(d.getUTCDate() + lagDays);
      key = d.toISOString().slice(0, 10);
    }
    byDate.set(key, (byDate.get(key) ?? 0) + Number(t.net ?? 0));
  }
  const provisionals = Array.from(byDate.entries()).map(([date, amount]) => ({
    user_id: userId, shop_id: shopId,
    kind: "income" as const,
    amount, date,
    category: PAYOUT_CATEGORY,
    description: `Payout Shopify · previsto`,
    source: "shopify_pending_sync",
  }));
  await supabaseAdmin.from("shop_cash_entries").insert(provisionals);
  return pendingTx.length;
}

// Sincronização leve: só busca pedidos novos e grava em shop_orders (sem
// payouts/payout_lag/refunds, que são pesados e já rodam separadamente).
async function syncOrdersOnlyForShop(s: any, today: string) {
  if (!s.shopify_store_id) return;
  const cutoff: string | null = s.cashflow_start_date ?? null;
  // cashflow_start_date é o início do controle financeiro (Caixa), não deve
  // limitar a sincronização de pedidos em si — senão qualquer loja com o
  // corte configurado há menos de 30 dias fica com shop_orders incompleto
  // pros últimos 30 dias (Rastreamento, Dashboard etc. leem essa tabela
  // direto). Sempre busca pelo menos os últimos 30 dias; cutoff só estende
  // pra mais longe no passado.
  const rolling30 = addDays(today, -30);
  const sinceDate = cutoff && cutoff < rolling30 ? cutoff : rolling30;
  const { data: store } = await supabaseAdmin.from("shopify_stores").select("*")
    .eq("id", s.shopify_store_id).maybeSingle();
  if (!store?.access_token || !store?.shop_domain) return;
  try {
    const orders = await fetchOrders(store.shop_domain, store.access_token, `${sinceDate}T00:00:00Z`);
    if (orders.length) {
      const rows = orders.map((o: any) => ({
        user_id: s.user_id, shop_id: s.shop_id, source: "shopify",
        external_id: String(o.id), order_number: o.name ?? null,
        created_at_shopify: o.created_at,
        order_date: (o.created_at as string).slice(0, 10),
        items_count: (o.line_items ?? []).reduce((x: number, li: any) => x + Number(li.quantity ?? 0), 0),
        revenue: Number(o.total_price ?? 0), currency: o.currency ?? null, raw: o,
        shopify_financial_status: o.financial_status ?? null,
      }));
      await supabaseAdmin.from("shop_orders").upsert(rows, { onConflict: "shop_id,source,external_id" });

      // Espelha transportadora/código/link de rastreio do Shopify em shop_orders
      // (lido pela aba Rastreamento) — igual ao processShop completo. Sem isso,
      // um pedido só ganha código de rastreio na sincronização completa (2x/dia),
      // não nesse ciclo leve que roda a cada poucos minutos.
      const { data: dbOrders } = await selectAll(supabaseAdmin.from("shop_orders")
        .select("id,external_id,carrier,tracking_code,tracking_url,delivery_status")
        .eq("user_id", s.user_id).eq("shop_id", s.shop_id).eq("source", "shopify")
        .in("external_id", orders.map((o: any) => String(o.id))));
      const dbOrderByExt = new Map((dbOrders ?? []).map((r: any) => [r.external_id, r]));

      const { data: track123Integ } = await supabaseAdmin.from("track123_integrations")
        .select("tracking_link_template").eq("shop_id", s.shop_id).maybeSingle();
      const trackingLinkTemplate: string | null = track123Integ?.tracking_link_template ?? null;

      for (const o of orders) {
        const existing = dbOrderByExt.get(String(o.id));
        if (!existing) continue;
        const fulfillments = (o.fulfillments ?? []) as any[];
        const fWithTrack = [...fulfillments].reverse()
          .find((f) => f.tracking_number || (f.tracking_numbers && f.tracking_numbers.length));
        if (!fWithTrack) continue;
        const trackingNumber = fWithTrack.tracking_number ?? fWithTrack.tracking_numbers?.[0] ?? null;
        if (!trackingNumber) continue;
        const patch: { carrier?: string | null; tracking_code?: string; tracking_url?: string; delivery_status?: string; shipped_at?: string } = {};
        if (!existing.carrier) patch.carrier = fWithTrack.tracking_company ?? null;
        if (!existing.tracking_code) patch.tracking_code = String(trackingNumber);
        if (trackingLinkTemplate) {
          patch.tracking_url = trackingLinkTemplate.replace("[CODE]", encodeURIComponent(String(trackingNumber)));
        } else if (!existing.tracking_url) {
          const url = fWithTrack.tracking_url ?? fWithTrack.tracking_urls?.[0] ?? null;
          if (url) patch.tracking_url = url;
        }
        if (!existing.delivery_status || existing.delivery_status === "pending_shipment") {
          patch.delivery_status = "shipped";
          patch.shipped_at = fWithTrack.created_at ? String(fWithTrack.created_at).slice(0, 10) : today;
        }
        if (Object.keys(patch).length) {
          await supabaseAdmin.from("shop_orders").update(patch)
            .eq("id", existing.id).eq("user_id", s.user_id);
        }
      }
    }
  } catch (e: any) {
    console.error("orders-only sync fail", s.shop_id, e);
  }
}

async function processShopPayoutsOnly(s: any) {
  if (!s.shopify_store_id) return;
  const { data: store } = await supabaseAdmin.from("shopify_stores").select("*")
    .eq("id", s.shopify_store_id).maybeSingle();
  if (!store?.access_token || !store?.shop_domain) return;
  const lagDays = s.payout_lag_days != null
    ? Number(s.payout_lag_days)
    : s.payout_lag_avg_days != null ? Math.round(Number(s.payout_lag_avg_days)) : 7;
  await syncPayoutsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token, s.cashflow_start_date ?? null);
  await syncPendingTransactionsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token, lagDays);
}

// Prazo real de pagamento ao fornecedor (D+X), configurável por loja em
// "Lojas e Grupos" (lg_card_shops.payment_days — ver LgOrders.tsx). Lojas
// fora de um card de grupo, ou sem configuração, caem no padrão de 7 dias.
async function getShopPaymentDays(shopId: string): Promise<number> {
  const { data } = await supabaseAdmin.from("lg_card_shops")
    .select("payment_days").eq("shop_id", shopId).limit(1).maybeSingle();
  return data?.payment_days ?? PROCESSING_DELAY_DAYS;
}

async function processShop(s: any, today: string) {
  const cutoff: string | null = s.cashflow_start_date ?? null;
  // Mesmo raciocínio de syncOrdersOnlyForShop: nunca sincronizar pedidos por
  // uma janela menor que 30 dias, mesmo que cashflow_start_date seja mais
  // recente — outras telas (Rastreamento, Dashboard) dependem de shop_orders
  // ter os últimos 30 dias completos.
  const rolling30 = addDays(today, -30);
  const sinceDate = cutoff && cutoff < rolling30 ? cutoff : rolling30;

  // sync orders from the configured cashflow cutoff date (fallback: last 30 days)
  if (s.shopify_store_id) {
    const { data: store } = await supabaseAdmin.from("shopify_stores").select("*")
      .eq("id", s.shopify_store_id).maybeSingle();
    if (store?.access_token && store?.shop_domain) {
      try {
        const orders = await fetchOrders(store.shop_domain, store.access_token, `${sinceDate}T00:00:00Z`);
        if (orders.length) {
          const rows = orders.map((o: any) => ({
            user_id: s.user_id, shop_id: s.shop_id, source: "shopify",
            external_id: String(o.id), order_number: o.name ?? null,
            created_at_shopify: o.created_at,
            order_date: (o.created_at as string).slice(0, 10),
            items_count: (o.line_items ?? []).reduce((x: number, li: any) => x + Number(li.quantity ?? 0), 0),
            revenue: Number(o.total_price ?? 0), currency: o.currency ?? null, raw: o,
            shopify_financial_status: o.financial_status ?? null,
          }));
          await supabaseAdmin.from("shop_orders").upsert(rows, { onConflict: "shop_id,source,external_id" });

          // Espelha transportadora/código/link de rastreio do Shopify em shop_orders
          // (lido pela aba Rastreamento), sem sobrescrever ajustes manuais.
          const { data: dbOrders } = await selectAll(supabaseAdmin.from("shop_orders")
            .select("id,external_id,carrier,tracking_code,tracking_url,delivery_status")
            .eq("user_id", s.user_id).eq("shop_id", s.shop_id).eq("source", "shopify")
            .in("external_id", orders.map((o: any) => String(o.id))));
          const dbOrderByExt = new Map((dbOrders ?? []).map((r: any) => [r.external_id, r]));

          // O tracking_url que a própria Shopify manda no fulfillment pode estar
          // errado (app de rastreio configurado com o domínio de outra loja) —
          // com um template próprio configurado pra loja, ele manda sempre,
          // corrigindo até URLs já salvas erradas em syncs anteriores.
          const { data: track123Integ } = await supabaseAdmin.from("track123_integrations")
            .select("tracking_link_template").eq("shop_id", s.shop_id).maybeSingle();
          const trackingLinkTemplate: string | null = track123Integ?.tracking_link_template ?? null;

          for (const o of orders) {
            const existing = dbOrderByExt.get(String(o.id));
            if (!existing) continue;
            const fulfillments = (o.fulfillments ?? []) as any[];
            const fWithTrack = [...fulfillments].reverse()
              .find((f) => f.tracking_number || (f.tracking_numbers && f.tracking_numbers.length));
            if (!fWithTrack) continue;
            const trackingNumber = fWithTrack.tracking_number ?? fWithTrack.tracking_numbers?.[0] ?? null;
            if (!trackingNumber) continue;
            const patch: { carrier?: string | null; tracking_code?: string; tracking_url?: string; delivery_status?: string; shipped_at?: string } = {};
            if (!existing.carrier) patch.carrier = fWithTrack.tracking_company ?? null;
            if (!existing.tracking_code) patch.tracking_code = String(trackingNumber);
            if (trackingLinkTemplate) {
              patch.tracking_url = trackingLinkTemplate.replace("[CODE]", encodeURIComponent(String(trackingNumber)));
            } else if (!existing.tracking_url) {
              const url = fWithTrack.tracking_url ?? fWithTrack.tracking_urls?.[0] ?? null;
              if (url) patch.tracking_url = url;
            }
            if (!existing.delivery_status || existing.delivery_status === "pending_shipment") {
              patch.delivery_status = "shipped";
              patch.shipped_at = fWithTrack.created_at ? String(fWithTrack.created_at).slice(0, 10) : today;
            }
            if (Object.keys(patch).length) {
              await supabaseAdmin.from("shop_orders").update(patch)
                .eq("id", existing.id).eq("user_id", s.user_id);
            }
          }
        }
        await syncPayoutsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token, cutoff);
        await updatePayoutLag(s.shop_id, s.user_id, store.shop_domain, store.access_token);
        await syncRefundsAndChargebacks(s.shop_id, s.user_id, store.shop_domain, store.access_token);
        const lagDays = s.payout_lag_days != null
          ? Number(s.payout_lag_days)
          : s.payout_lag_avg_days != null ? Math.round(Number(s.payout_lag_avg_days)) : 7;
        await syncPendingTransactionsForShop(s.shop_id, s.user_id, store.shop_domain, store.access_token, lagDays);
        await supabaseAdmin.from("shopify_stores").update({
          last_sync_at: new Date().toISOString(), last_sync_status: "ok", last_sync_error: null,
        }).eq("id", s.shopify_store_id);
      } catch (e: any) {
        await supabaseAdmin.from("shopify_stores").update({
          last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: e.message?.slice(0, 500),
        }).eq("id", s.shopify_store_id);
      }
    }
  }

  // recompute today's processing
  const paymentDays = await getShopPaymentDays(s.shop_id);
  const orderDate = addDays(today, -paymentDays);
  const { data: existing } = await supabaseAdmin.from("shop_cash_entries").select("*")
    .eq("user_id", s.user_id).eq("shop_id", s.shop_id)
    .eq("auto_kind", "order_cost").eq("auto_ref_date", orderDate).maybeSingle();
  if (existing && existing.source === "manual_override") return;

  if (cutoff && orderDate < cutoff) {
    if (existing) await supabaseAdmin.from("shop_cash_entries").delete().eq("id", existing.id);
    return;
  }

  const { data: orders } = await supabaseAdmin.from("shop_orders").select("items_count,raw")
    .eq("user_id", s.user_id).eq("shop_id", s.shop_id).eq("order_date", orderDate);
  const items = (orders ?? []).reduce((x: number, o: any) => x + Number(o.items_count ?? 0), 0);
  const unit = await unitCostFor(s.shop_id, s.user_id, orderDate, s.default_unit_cost);
  const products = await costProductsFor(supabaseAdmin, s.user_id);
  const amount = (orders ?? []).reduce((x: number, o: any) => x + orderLineItemsCost(o.raw?.line_items, products, unit), 0);

  // ensure category
  const { data: cat } = await supabaseAdmin.from("shop_cash_categories").select("id")
    .eq("user_id", s.user_id).eq("shop_id", s.shop_id).eq("kind", "expense").eq("name", "Custo de pedidos").maybeSingle();
  if (!cat) {
    await supabaseAdmin.from("shop_cash_categories").insert({
      user_id: s.user_id, shop_id: s.shop_id, kind: "expense", name: "Custo de pedidos", position: 999,
    });
  }

  if (existing) {
    await supabaseAdmin.from("shop_cash_entries").update({
      amount, date: today, description: `${items} itens`,
    }).eq("id", existing.id);
  } else if (amount > 0) {
    await supabaseAdmin.from("shop_cash_entries").insert({
      user_id: s.user_id, shop_id: s.shop_id,
      kind: "expense", amount, date: today,
      category: "Custo de pedidos",
      description: `${items} itens`,
      source: "auto", auto_kind: "order_cost", auto_ref_date: orderDate,
    });
  }
}

// api/ssr.js tem maxDuration=60s. Processar todas as lojas sequencialmente
// (cada uma com várias chamadas paginadas à Shopify) pode passar disso — e
// quando o Vercel mata a função no meio do loop, isso não é um erro
// capturável pelo try/catch por loja, as lojas restantes simplesmente não
// sincronizam e nada fica registrado. Corta a rodada antes do limite: as
// lojas que sobrarem são pegas na próxima chamada (pg_cron roda a cada
// 10min pro sync leve de pedidos, então o atraso é pequeno).
const TIME_BUDGET_MS = 50_000;

async function runSync(request: Request, opts: { payoutsOnly: boolean; ordersOnly: boolean }) {
  const unauthorized = verifyCronApiKey(request);
  if (unauthorized) return unauthorized;
  const start = Date.now();
  const today = isoDate(new Date());
  const { payoutsOnly, ordersOnly } = opts;
  const { data: settings, error } = await supabaseAdmin
    .from("shop_order_settings").select("*").eq("automation_enabled", true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  let processed = 0;
  let skippedByBudget = 0;
  // Lojas em coluna do Banco de Lojas com "Pausar sincronização" (Em Hold,
  // Com Retenção, Cemitério...) ficam de fora de todos os modos do cron.
  const pausedStores = await getPausedShopifyStoreIds();
  const all = (settings ?? []).filter((s: any) => !s.shopify_store_id || !pausedStores.has(s.shopify_store_id));
  // Rodízio: sem isso, toda rodada começa do índice 0 e, se o orçamento de
  // tempo estourar antes do fim, são sempre as MESMAS lojas do início da
  // lista que rodam e as do fim ficam sem sincronizar pedidos indefinidamente
  // (esse sync leve roda a cada 10min via pg_cron). Muda o ponto de partida
  // a cada janela de 10min pra todo mundo ser coberto ao longo do tempo.
  const startIdx = all.length ? Math.floor(Date.now() / (10 * 60_000)) % all.length : 0;
  for (let step = 0; step < all.length; step++) {
    const idx = (startIdx + step) % all.length;
    if (Date.now() - start > TIME_BUDGET_MS) {
      skippedByBudget = all.length - step;
      console.error(`sync-shop-orders: orçamento de tempo (${TIME_BUDGET_MS}ms) estourado, ${skippedByBudget} loja(s) não processadas nesta rodada — pegas na próxima.`);
      break;
    }
    const s = all[idx];
    try {
      if (payoutsOnly) await processShopPayoutsOnly(s);
      else if (ordersOnly) await syncOrdersOnlyForShop(s, today);
      else await processShop(s, today);
      processed++;
    } catch (e) { console.error("shop fail", s.shop_id, e); }
  }
  return new Response(JSON.stringify({ processed, skippedByBudget, today, payoutsOnly, ordersOnly }), { headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/public/hooks/sync-shop-orders")({
  server: {
    handlers: {
      // Disparado pelo pg_cron (Postgres), que manda POST com o corpo
      // {payouts_only|orders_only}. Ver supabase/migrations/*_sync_cron.sql.
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({})) as any;
        return runSync(request, { payoutsOnly: Boolean(body?.payouts_only), ordersOnly: Boolean(body?.orders_only) });
      },
      // Vercel Cron (ver vercel.json "crons") só sabe chamar via GET, sem
      // corpo — sem esse handler, os 2 agendamentos diários de lá nunca
      // rodavam nada (a rota só aceitava POST). Roda a sincronização
      // completa (sem payouts_only/orders_only) como um resync mais
      // profundo, redundante ao pg_cron mais frequente.
      GET: async ({ request }) => runSync(request, { payoutsOnly: false, ordersOnly: false }),
    },
  },
});

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { companyShopIdsForMonth } from "@/lib/company-goals.server";
import { isoTodayUS } from "@/lib/timezone";
import { fetchWithRetry } from "@/lib/http";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { track123StatusByOrderNumber } from "@/lib/track123-mcp-sync.server";

// Aba Chargebacks: cada disputa (chargeback/inquiry) da Shopify Payments
// cruzada com o pedido (produto, data), o rastreio (situação e último evento),
// os alertas (tags Ethoca/CDRN/RDR) e o Atendimento (cliente falou com a gente?).
// Acesso: admin, ou membro com a permissão "chargebacks".

export type ChargebackRow = {
  id: string; shopId: string; shopName: string; type: string; status: string | null; reason: string | null;
  amount: number; currency: string | null; initiatedAt: string; evidenceDueBy: string | null; finalizedOn: string | null;
  orderExternalId: string | null; orderNumber: string | null; orderDate: string | null; daysToDispute: number | null;
  customerName: string | null; customerEmail: string | null; product: string | null; productImage: string | null;
  // Produto do cadastro (Produtos) que casa com o título — agrupa variações do
  // mesmo produto ("Air 1 Low Georgetown" e "Georgetown"). Sem cadastro: o título.
  productGroup: string | null;
  deliveryStatus: string | null; shippedAt: string | null; deliveredAt: string | null;
  lastEvent: string | null; lastEventAt: string | null; trackingCode: string | null; trackingUrl: string | null;
  alerts: string[]; conversationId: string | null; adminUrl: string | null;
  // De onde vieram os dados do pedido: nosso banco, Shopify (só pra esta aba),
  // Shopify sem acesso (pedido > 60 dias sem read_all_orders) ou disputa sem pedido.
  orderSource: "sistema" | "shopify" | "sem_acesso" | "sem_pedido";
  // Análise de fraude da Shopify do pedido (LOW/MEDIUM/HIGH) e os motivos.
  riskLevel: string | null; riskRecommendation: string | null; riskFacts: { description: string; sentiment: string }[];
};

// Risco de fraude (Shopify) × o que aconteceu com o pedido, por nível.
export type RiskSummary = {
  levels: { level: string; orders: number; chargebacks: number; refunds: number }[];
  total: number; since: string | null; matured: number;   // matured = pedidos com 25+ dias (já deu tempo de virar disputa)
};

// Pedido de disputa que não está em shop_orders (feito antes da loja entrar no
// sistema): buscado na Shopify e guardado SÓ em shop_order_disputes.order_snapshot
// — não entra em pedidos, lucro, caixa nem em nenhuma outra conta.
type OrderSnapshot =
  | { unavailable: true; status: number }
  | {
      unavailable?: false; name: string | null; created_at: string | null; email: string | null;
      first_name: string | null; last_name: string | null; tags: string | null; items: { title: string | null }[];
      tracking_number: string | null; tracking_url: string | null; shipment_status: string | null; fulfilled_at: string | null;
      // Rastreio real do código (Track123), não o status da Shopify.
      track?: { status: string | null; lastLabel: string | null; lastAt: string | null; checkedAt: string; notFound?: boolean };
    };
const SNAPSHOT_RETRY_MS = 86_400_000;   // sem acesso: tenta de novo depois de 1 dia
const SNAPSHOT_MAX_PER_LOAD = 20;
const TRACK_REFRESH_MS = 12 * 3_600_000;   // não entregue: consulta o Track123 de novo depois de 12h
const TRACK_MAX_PER_LOAD = 8;

export async function fetchOrderSnapshot(domain: string, token: string, orderId: string): Promise<OrderSnapshot | null> {
  const res = await fetchWithRetry(
    `https://${domain}/admin/api/2024-10/orders/${orderId}.json?fields=id,name,created_at,email,customer,tags,line_items,fulfillments`,
    { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } },
  );
  if (res.status === 404 || res.status === 403) return { unavailable: true, status: res.status };
  if (!res.ok) return null;   // erro passageiro: não grava, tenta na próxima abertura
  const o: any = (await res.json()).order ?? {};
  const f = ((o.fulfillments ?? []) as any[]).filter((x) => x?.status !== "cancelled").at(-1);
  return {
    name: o.name ?? null, created_at: o.created_at ?? null, email: o.email ?? o.customer?.email ?? null,
    first_name: o.customer?.first_name ?? null, last_name: o.customer?.last_name ?? null, tags: o.tags ?? null,
    items: ((o.line_items ?? []) as any[]).map((li) => ({ title: li?.title ?? null })),
    tracking_number: f?.tracking_number ?? null, tracking_url: f?.tracking_url ?? null,
    shipment_status: f?.shipment_status ?? null, fulfilled_at: f?.created_at ?? null,
  };
}

// Situação da entrega pelo fulfillment da Shopify (mesmos nomes da aba Rastreamento).
function snapshotDelivery(s: Exclude<OrderSnapshot, { unavailable: true }>): string {
  const st = s.shipment_status;
  if (st === "delivered") return "delivered";
  if (st === "failure") return "problem";
  if (st || s.tracking_number || s.fulfilled_at) return "shipped";
  return "pending_shipment";
}

export const getChargebacks = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ scope: z.enum(["ativas", "todas"]) }).parse(d))
  .handler(async ({ data, context }) => {
    if (context.role !== "admin" && !context.permissions.some((p) => p.section === "chargebacks")) {
      throw new Error("Sem acesso a Chargebacks");
    }
    const { ownerId } = context;
    const [shopsRes, activeIds] = await Promise.all([
      supabaseAdmin.from("shops").select("id,name").eq("user_id", ownerId).order("name"),
      // Lojas ativas = as dos grupos ativos de Lojas e Grupos (mesma regra das Metas).
      companyShopIdsForMonth(ownerId, `${isoTodayUS().slice(0, 7)}-01`).catch(() => [] as string[]),
    ]);
    const allShops = (shopsRes.data ?? []) as { id: string; name: string }[];
    const shopIds = data.scope === "ativas" ? activeIds : allShops.map((s) => s.id);
    const shopName = new Map(allShops.map((s) => [s.id, s.name]));
    if (!shopIds.length) return { rows: [] as ChargebackRow[], shops: [] as { id: string; name: string }[], riskSummary: { levels: [], total: 0, since: null, matured: 0 } as RiskSummary };

    const { data: disputes, error } = await selectAll<{
      id: string; shop_id: string; order_external_id: string | null; type: string; status: string | null; reason: string | null;
      amount: number; currency: string | null; initiated_at: string; evidence_due_by: string | null; finalized_on: string | null;
      order_snapshot: OrderSnapshot | null; order_snapshot_at: string | null;
    }>(supabaseAdmin.from("shop_order_disputes")
      .select("id,shop_id,order_external_id,type,status,reason,amount,currency,initiated_at,evidence_due_by,finalized_on,order_snapshot,order_snapshot_at")
      .eq("user_id", ownerId).in("shop_id", shopIds).order("initiated_at", { ascending: false }));
    if (error) throw new Error(error.message);

    // Pedidos das disputas (pedido antigo, de antes da loja entrar no sistema, fica sem).
    const extIds = [...new Set(disputes.map((d) => d.order_external_id).filter(Boolean))] as string[];
    const { data: orders } = extIds.length
      ? await selectAllIn<any>(extIds, (c) => supabaseAdmin.from("shop_orders")
          .select("id,shop_id,external_id,order_number,order_date,delivery_status,shipped_at,delivered_at,tracking_code,tracking_url,email:raw->>email,cust_email:raw->customer->>email,first_name:raw->customer->>first_name,last_name:raw->customer->>last_name,tags:raw->>tags,items:raw->line_items")
          .eq("user_id", ownerId).in("external_id", c))
      : { data: [] as any[] };
    const orderBy = new Map((orders ?? []).map((o: any) => [`${o.shop_id}:${o.external_id}`, o]));

    const orderIds = (orders ?? []).map((o: any) => o.id as string);
    const [{ data: tracking }, { data: settings }] = await Promise.all([
      orderIds.length
        ? selectAllIn<{ order_id: string; last_event_label: string | null; last_event_at: string | null }>(orderIds, (c) =>
            supabaseAdmin.from("shop_order_tracking").select("order_id,last_event_label,last_event_at").in("order_id", c))
        : Promise.resolve({ data: [] as { order_id: string; last_event_label: string | null; last_event_at: string | null }[] }),
      supabaseAdmin.from("shop_order_settings").select("shop_id,shopify_store_id").eq("user_id", ownerId).in("shop_id", shopIds),
    ]);
    const trackBy = new Map((tracking ?? []).map((t) => [t.order_id, t]));

    // Link do pedido no admin da Shopify.
    const storeIds = [...new Set((settings ?? []).map((s: any) => s.shopify_store_id).filter(Boolean))] as string[];
    const { data: stores } = storeIds.length
      ? await supabaseAdmin.from("shopify_stores").select("id,shop_domain,access_token").in("id", storeIds)
      : { data: [] as { id: string; shop_domain: string; access_token: string | null }[] };
    const domainByStore = new Map((stores ?? []).map((s) => [s.id, s.shop_domain]));
    const domainByShop = new Map((settings ?? []).map((s: any) => [s.shop_id as string, domainByStore.get(s.shopify_store_id) ?? null]));
    // Link de rastreio da página da própria loja (Integrações: "URL padrão de
    // rastreio"), igual ao painel do cliente no Atendimento.
    const { data: integs } = await supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds);
    const templateByShop = new Map((integs ?? []).map((i) => [i.shop_id as string, i.tracking_link_template as string | null]));
    const storeByShop = new Map((settings ?? []).map((s: any) => [s.shop_id as string, (stores ?? []).find((x) => x.id === s.shopify_store_id) ?? null]));

    // Pedidos que não estão no banco: busca na Shopify (uma vez; sem acesso,
    // tenta de novo depois de 1 dia) e guarda só na disputa.
    const snapByKey = new Map<string, OrderSnapshot>();
    for (const d of disputes) if (d.order_snapshot && d.order_external_id) snapByKey.set(`${d.shop_id}:${d.order_external_id}`, d.order_snapshot);
    const toFetch = [...new Map(disputes
      .filter((d) => d.order_external_id && !orderBy.has(`${d.shop_id}:${d.order_external_id}`))
      .filter((d) => !d.order_snapshot || (d.order_snapshot.unavailable && (!d.order_snapshot_at || Date.now() - new Date(d.order_snapshot_at).getTime() > SNAPSHOT_RETRY_MS)))
      .map((d) => [`${d.shop_id}:${d.order_external_id}`, d])).values()].slice(0, SNAPSHOT_MAX_PER_LOAD);
    for (let i = 0; i < toFetch.length; i += 3) {
      await Promise.all(toFetch.slice(i, i + 3).map(async (d) => {
        const store = storeByShop.get(d.shop_id);
        if (!store?.access_token || !store.shop_domain) return;
        const snap = await fetchOrderSnapshot(store.shop_domain, store.access_token, d.order_external_id!).catch(() => null);
        if (!snap) return;
        snapByKey.set(`${d.shop_id}:${d.order_external_id}`, snap);
        await supabaseAdmin.from("shop_order_disputes").update({ order_snapshot: snap as any, order_snapshot_at: new Date().toISOString() })
          .eq("user_id", ownerId).eq("shop_id", d.shop_id).eq("order_external_id", d.order_external_id!);
      }));
    }
    // Rastreio real (Track123, pelos eventos do código) dos pedidos do snapshot.
    const needTrack = [...snapByKey.entries()]
      .filter(([k, s]) => !s.unavailable && !orderBy.has(k) && s.name &&
        (!s.track || (s.track.status !== "delivered" && Date.now() - new Date(s.track.checkedAt).getTime() > TRACK_REFRESH_MS)))
      .slice(0, TRACK_MAX_PER_LOAD);
    for (const [key, s] of needTrack) {
      if (s.unavailable) continue;
      const [shopId, ext] = key.split(":");
      const t = await track123StatusByOrderNumber(shopId, s.name!, supabaseAdmin).catch(() => null);
      const next = { ...s, track: { status: t?.status ?? null, lastLabel: t?.lastLabel ?? null, lastAt: t?.lastAt ?? null, checkedAt: new Date().toISOString(), notFound: !t } };
      snapByKey.set(key, next);
      await supabaseAdmin.from("shop_order_disputes").update({ order_snapshot: next as any })
        .eq("user_id", ownerId).eq("shop_id", shopId).eq("order_external_id", ext);
    }

    // Pedido "de mentira" montado do snapshot, no mesmo formato do select de shop_orders.
    for (const [key, s] of snapByKey) {
      if (orderBy.has(key) || s.unavailable) continue;
      orderBy.set(key, {
        id: null, fromShopify: true, order_number: s.name, order_date: s.created_at ? s.created_at.slice(0, 10) : null,
        delivery_status: s.track?.status ?? snapshotDelivery(s), shipped_at: s.fulfilled_at,
        delivered_at: s.track?.status === "delivered" ? s.track.lastAt : null,
        last_event_label: s.track?.lastLabel ?? null, last_event_at: s.track?.lastAt ?? null,
        tracking_code: s.tracking_number, tracking_url: s.tracking_url, email: s.email, cust_email: null,
        first_name: s.first_name, last_name: s.last_name, tags: s.tags, items: s.items,
      });
    }

    // Foto do produto: cadastro de Produtos (nome/palavra-chave no título, a
    // mais específica ganha — mesma regra do custo).
    const { data: products } = await supabaseAdmin.from("products").select("name,keywords,main_image_url").eq("user_id", ownerId);
    const matchProduct = (title: string | null | undefined) => {
      const t = (title ?? "").toLowerCase();
      let best: { name: string; url: string | null; len: number } | null = null;
      for (const p of (products ?? []) as { name: string; keywords: string[] | null; main_image_url: string | null }[]) {
        for (const c of [p.name, ...(p.keywords ?? [])]) {
          const k = (c ?? "").trim().toLowerCase();
          if (k && t.includes(k) && (!best || k.length > best.len)) best = { name: p.name, url: p.main_image_url, len: k.length };
        }
      }
      return best;
    };

    // Conversa no Atendimento com o e-mail do pedido.
    const emailOf = (o: any) => String(o?.email ?? o?.cust_email ?? "").toLowerCase() || null;
    const emails = [...new Set([...orderBy.values()].map(emailOf).filter(Boolean))] as string[];
    const { data: convs } = emails.length
      ? await selectAllIn<{ id: string; customer_email: string; last_message_at: string | null }>(emails, (c) =>
          supabaseAdmin.from("support_conversations").select("id,customer_email,last_message_at").eq("owner_id", ownerId).in("customer_email", c))
      : { data: [] as { id: string; customer_email: string; last_message_at: string | null }[] };
    const convBy = new Map<string, string>();
    for (const c of [...(convs ?? [])].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))) {
      if (!convBy.has(c.customer_email.toLowerCase())) convBy.set(c.customer_email.toLowerCase(), c.id);
    }

    // Risco de fraude: dos pedidos das disputas (pra lista) e de todos (correlação).
    const { data: risks } = await selectAll<{ shop_id: string; order_external_id: string; order_created_at: string | null; risk_level: string | null; recommendation: string | null; facts: any; financial_status: string | null }>(
      supabaseAdmin.from("shop_order_risks").select("shop_id,order_external_id,order_created_at,risk_level,recommendation,facts,financial_status")
        .eq("user_id", ownerId).in("shop_id", shopIds));
    const riskBy = new Map(risks.map((r) => [`${r.shop_id}:${r.order_external_id}`, r]));
    const cbKeys = new Set(disputes.filter((d) => d.type === "chargeback" && d.order_external_id).map((d) => `${d.shop_id}:${d.order_external_id}`));
    const riskExt = [...new Set(risks.map((r) => r.order_external_id))];
    const { data: fin } = riskExt.length
      ? await selectAllIn<{ shop_id: string; external_id: string; shopify_financial_status: string | null }>(riskExt, (c) =>
          supabaseAdmin.from("shop_orders").select("shop_id,external_id,shopify_financial_status").eq("user_id", ownerId).in("external_id", c))
      : { data: [] as { shop_id: string; external_id: string; shopify_financial_status: string | null }[] };
    // Reembolso: status do nosso banco (atualizado pelos webhooks); pedido que não
    // está no banco usa o status da Shopify guardado junto com o risco.
    const inDb = new Set(fin.map((f) => `${f.shop_id}:${f.external_id}`));
    const refunded = new Set(fin.filter((f) => f.shopify_financial_status === "refunded" || f.shopify_financial_status === "partially_refunded").map((f) => `${f.shop_id}:${f.external_id}`));
    for (const r of risks) {
      const key = `${r.shop_id}:${r.order_external_id}`;
      if (!inDb.has(key) && (r.financial_status === "REFUNDED" || r.financial_status === "PARTIALLY_REFUNDED")) refunded.add(key);
    }
    const byLevel = new Map<string, { level: string; orders: number; chargebacks: number; refunds: number }>();
    for (const r of risks) {
      const level = r.risk_level ?? "NONE";
      const g = byLevel.get(level) ?? { level, orders: 0, chargebacks: 0, refunds: 0 };
      const key = `${r.shop_id}:${r.order_external_id}`;
      g.orders++; if (cbKeys.has(key)) g.chargebacks++; if (refunded.has(key)) g.refunds++;
      byLevel.set(level, g);
    }
    const created = risks.map((r) => r.order_created_at).filter(Boolean).sort() as string[];
    const riskSummary: RiskSummary = {
      levels: ["LOW", "MEDIUM", "HIGH", "NONE"].map((l) => byLevel.get(l)).filter(Boolean) as RiskSummary["levels"],
      total: risks.length, since: created[0] ?? null,
      matured: created.filter((c) => Date.now() - new Date(c).getTime() >= 25 * 86_400_000).length,
    };

    const rows: ChargebackRow[] = disputes.map((d) => {
      const o: any = d.order_external_id ? orderBy.get(`${d.shop_id}:${d.order_external_id}`) : null;
      const t = o?.id ? trackBy.get(o.id) : undefined;
      const snap = d.order_external_id ? snapByKey.get(`${d.shop_id}:${d.order_external_id}`) : undefined;
      const risk = d.order_external_id ? riskBy.get(`${d.shop_id}:${d.order_external_id}`) : undefined;
      const email = emailOf(o);
      const domain = domainByShop.get(d.shop_id);
      const days = o?.order_date ? Math.round((new Date(d.initiated_at).getTime() - new Date(`${o.order_date}T12:00:00Z`).getTime()) / 86_400_000) : null;
      return {
        id: d.id, shopId: d.shop_id, shopName: shopName.get(d.shop_id) ?? "—", type: d.type, status: d.status, reason: d.reason,
        amount: Number(d.amount ?? 0), currency: d.currency, initiatedAt: d.initiated_at, evidenceDueBy: d.evidence_due_by, finalizedOn: d.finalized_on,
        orderExternalId: d.order_external_id, orderNumber: o?.order_number ?? null, orderDate: o?.order_date ?? null,
        daysToDispute: days != null && days >= 0 ? days : null,
        customerName: o ? [o.first_name, o.last_name].filter(Boolean).join(" ") || null : null, customerEmail: email,
        product: o ? ((o.items ?? []) as any[]).map((li) => li?.title).filter(Boolean).join(", ") || null : null,
        productImage: o ? matchProduct(((o.items ?? []) as any[])[0]?.title)?.url ?? null : null,
        productGroup: o ? matchProduct(((o.items ?? []) as any[])[0]?.title)?.name ?? (((o.items ?? []) as any[])[0]?.title ?? null) : null,
        deliveryStatus: o?.delivery_status ?? null, shippedAt: o?.shipped_at ?? null, deliveredAt: o?.delivered_at ?? null,
        lastEvent: t?.last_event_label ?? o?.last_event_label ?? null, lastEventAt: t?.last_event_at ?? o?.last_event_at ?? null,
        trackingCode: o?.tracking_code ?? null,
        trackingUrl: (o?.tracking_code ? buildTrackingUrl(templateByShop.get(d.shop_id), o.tracking_code) : null) ?? o?.tracking_url ?? null,
        alerts: [...new Set(String(o?.tags ?? "").split(",").map((x) => x.trim()).filter((x) => /^(ethoca|cdrn|rdr)$/i.test(x)))],
        conversationId: email ? convBy.get(email) ?? null : null,
        adminUrl: domain && d.order_external_id ? `https://${domain}/admin/orders/${d.order_external_id}` : null,
        orderSource: !d.order_external_id ? "sem_pedido" : o ? (o.fromShopify ? "shopify" : "sistema") : snap?.unavailable ? "sem_acesso" : "sem_pedido",
        riskLevel: risk?.risk_level ?? null, riskRecommendation: risk?.recommendation ?? null,
        riskFacts: Array.isArray(risk?.facts) ? risk!.facts : [],
      };
    });
    const shops = allShops.filter((s) => shopIds.includes(s.id));
    return { rows, shops, riskSummary };
  });

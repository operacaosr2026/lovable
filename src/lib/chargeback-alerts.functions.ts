import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { companyShopIdsForMonth } from "@/lib/company-goals.server";
import { isoTodayUS } from "@/lib/timezone";
import { buildTrackingUrl } from "@/lib/tracking-url";

// Chargebacks > Alertas: pedidos reembolsados pelo Disputifier por alerta de
// pré-chargeback (CDRN/Ethoca/RDR). O reembolso evita o chargeback, mas o pedido
// quase sempre foi entregue — então vale contatar o cliente pra reaver o valor.
// Identificação (tudo no pedido guardado, raw->refunds): reembolso feito pelo app
// do Disputifier (transação com source_name do app) ou com a nota do alerta
// ("Ethoca Alert", "cdrn alerts"…), ou tag CDRN/Ethoca/RDR no pedido.

export const ALERT_STATUSES = ["a_contatar", "contatado", "recuperado", "sem_retorno", "nao_recuperavel"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export type AlertRow = {
  shopId: string; shopName: string; orderExternalId: string; orderNumber: string | null; orderDate: string | null;
  network: string; refundedAt: string | null; refundedAmount: number; note: string | null;
  customerName: string | null; customerEmail: string | null; product: string | null;
  deliveryStatus: string | null; deliveredAt: string | null; trackingCode: string | null; trackingUrl: string | null;
  lastEvent: string | null; conversationId: string | null;
  status: AlertStatus; recoveredAmount: number | null; followupNote: string | null; followupAt: string | null;
};

const DISPUTIFIER_APP = "3643375";   // source_name das transações de reembolso feitas pelo app

type Ctx = { role: string; ownerId: string; permissions: { section: string }[] };
function assertAccess(ctx: Ctx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "chargebacks")) throw new Error("Sem acesso a Chargebacks");
}

export const getChargebackAlerts = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ scope: z.enum(["ativas", "todas"]) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { ownerId } = context;
    const [{ data: shops }, activeIds] = await Promise.all([
      supabaseAdmin.from("shops").select("id,name").eq("user_id", ownerId),
      companyShopIdsForMonth(ownerId, `${isoTodayUS().slice(0, 7)}-01`).catch(() => [] as string[]),
    ]);
    const shopName = new Map(((shops ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    const shopIds = data.scope === "ativas" ? activeIds : [...shopName.keys()];
    if (!shopIds.length) return { rows: [] as AlertRow[] };

    // Só pedidos com reembolso (o resto do pedido não interessa aqui).
    const { data: orders, error } = await selectAll<any>(supabaseAdmin.from("shop_orders")
      .select("id,shop_id,external_id,order_number,order_date,delivery_status,delivered_at,tracking_code,tracking_url,tags:raw->>tags,refunds:raw->refunds,email:raw->>email,fn:raw->customer->>first_name,ln:raw->customer->>last_name,items:raw->line_items")
      .eq("user_id", ownerId).in("shop_id", shopIds).not("raw->refunds", "is", null));
    if (error) throw new Error(error.message);

    const found: any[] = [];
    for (const o of orders) {
      const tagNet = String(o.tags ?? "").match(/\b(cdrn|ethoca|rdr)\b/i)?.[1];
      for (const r of (o.refunds ?? []) as any[]) {
        const txs = (r.transactions ?? []) as any[];
        const note = String(r.note ?? "");
        const byApp = txs.some((t) => String(t.source_name) === DISPUTIFIER_APP);
        const noteNet = note.match(/\b(cdrn|ethoca|rdr)\b/i)?.[1];
        if (!byApp && !noteNet && !tagNet) continue;
        const amount = txs.filter((t) => (t.kind ?? "refund") === "refund" && (t.status ?? "success") === "success")
          .reduce((s, t) => s + Number(t.amount ?? 0), 0);
        found.push({ o, refund: r, amount, network: (noteNet ?? tagNet ?? "Alerta").toUpperCase().replace("ETHOCA", "Ethoca") });
        break;   // um alerta por pedido
      }
    }
    if (!found.length) return { rows: [] as AlertRow[] };

    const orderIds = found.map((f) => f.o.id as string);
    const extIds = found.map((f) => String(f.o.external_id));
    const emails = [...new Set(found.map((f) => String(f.o.email ?? "").toLowerCase()).filter(Boolean))];
    const [{ data: tracking }, { data: followups }, { data: convs }, { data: integs }] = await Promise.all([
      selectAllIn<{ order_id: string; last_event_label: string | null }>(orderIds, (c) =>
        supabaseAdmin.from("shop_order_tracking").select("order_id,last_event_label").in("order_id", c)),
      selectAllIn<any>(extIds, (c) => supabaseAdmin.from("chargeback_alert_followups")
        .select("shop_id,order_external_id,status,recovered_amount,note,updated_at").eq("user_id", ownerId).in("order_external_id", c)),
      emails.length
        ? selectAllIn<{ id: string; customer_email: string; last_message_at: string | null }>(emails, (c) =>
            supabaseAdmin.from("support_conversations").select("id,customer_email,last_message_at").eq("owner_id", ownerId).in("customer_email", c))
        : Promise.resolve({ data: [] as { id: string; customer_email: string; last_message_at: string | null }[] }),
      supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds),
    ]);
    const trackBy = new Map((tracking ?? []).map((t) => [t.order_id, t]));
    const fuBy = new Map((followups ?? []).map((f: any) => [`${f.shop_id}:${f.order_external_id}`, f]));
    const convBy = new Map<string, string>();
    for (const c of [...(convs ?? [])].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))) {
      if (!convBy.has(c.customer_email.toLowerCase())) convBy.set(c.customer_email.toLowerCase(), c.id);
    }
    const templateBy = new Map(((integs ?? []) as any[]).map((i) => [i.shop_id as string, i.tracking_link_template as string | null]));

    const rows: AlertRow[] = found.map(({ o, refund, amount, network }) => {
      const fu: any = fuBy.get(`${o.shop_id}:${o.external_id}`);
      const email = String(o.email ?? "").toLowerCase() || null;
      const delivered = o.delivery_status === "delivered";
      return {
        shopId: o.shop_id, shopName: shopName.get(o.shop_id) ?? "—", orderExternalId: String(o.external_id), orderNumber: o.order_number, orderDate: o.order_date,
        network, refundedAt: refund.created_at ?? null, refundedAmount: Math.round(amount * 100) / 100, note: refund.note ?? null,
        customerName: [o.fn, o.ln].filter(Boolean).join(" ") || null, customerEmail: email,
        product: ((o.items ?? []) as any[]).map((li) => li?.title).filter(Boolean).join(", ") || null,
        deliveryStatus: o.delivery_status, deliveredAt: o.delivered_at, trackingCode: o.tracking_code,
        trackingUrl: (o.tracking_code ? buildTrackingUrl(templateBy.get(o.shop_id), o.tracking_code) : null) ?? o.tracking_url,
        lastEvent: trackBy.get(o.id)?.last_event_label ?? null, conversationId: email ? convBy.get(email) ?? null : null,
        // Sem acompanhamento salvo: entregue = "a contatar"; não entregue = "não recuperável" (sugestão).
        status: (fu?.status as AlertStatus) ?? (delivered ? "a_contatar" : "nao_recuperavel"),
        recoveredAmount: fu?.recovered_amount != null ? Number(fu.recovered_amount) : null, followupNote: fu?.note ?? null, followupAt: fu?.updated_at ?? null,
      };
    }).sort((a, b) => (b.refundedAt ?? "").localeCompare(a.refundedAt ?? ""));
    return { rows };
  });

export const saveAlertFollowup = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    shopId: z.string().uuid(), orderExternalId: z.string().min(1).max(40),
    status: z.enum(ALERT_STATUSES), recoveredAmount: z.number().min(0).max(100_000).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { data: shop } = await supabaseAdmin.from("shops").select("id").eq("id", data.shopId).eq("user_id", context.ownerId).maybeSingle();
    if (!shop) throw new Error("Loja não encontrada");
    const { error } = await supabaseAdmin.from("chargeback_alert_followups").upsert({
      shop_id: data.shopId, order_external_id: data.orderExternalId, user_id: context.ownerId,
      status: data.status, recovered_amount: data.status === "recuperado" ? data.recoveredAmount ?? null : null,
      note: data.note?.trim() || null, updated_at: new Date().toISOString(), updated_by: context.userId,
    }, { onConflict: "shop_id,order_external_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

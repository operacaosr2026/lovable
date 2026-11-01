import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { renderNotice } from "@/lib/order-notices";
import { isoDateUS } from "@/lib/timezone";
import { flowFiltersSchema, flowStepSchema, waitMs, type FlowDelivery, type FlowFilters, type FlowStep } from "@/lib/email-flows";

// Notificações › Fluxos: quem bate no filtro (público) e o motor que anda com
// cada pessoa pela sequência. O cron da fila (a cada minuto) chama runEmailFlows;
// os e-mails entram na fila da aba (order_notices) e saem 1 a cada 3 minutos.

export const fdb = (table: string) => (supabaseAdmin as any).from(table);

// Até quantos e-mails de fluxo esperam na fila ao mesmo tempo por workspace —
// o resto espera a vez no fluxo, pra não travar os avisos manuais atrás de uma
// campanha grande.
const MAX_FLOW_IN_QUEUE = 5;
// Contínuo: procura gente nova no filtro no máximo a cada 10 minutos.
const ENROLL_EVERY_MS = 10 * 60_000;
// Sem filtro de data, olha as compras dos últimos 180 dias.
const DEFAULT_MAX_DAYS = 180;

export type AudienceOrder = {
  id: string; shopId: string; shopName: string; orderNumber: string; orderDate: string;
  email: string; firstName: string; customerName: string; trackingUrl: string | null;
  delivery: FlowDelivery; revenue: number; currency: string | null;
};

// Lojas dos grupos ativos (loja inativa não entra).
export async function activeShops(ownerId: string) {
  const { data, error } = await supabaseAdmin.from("lg_card_shops")
    .select("shop_id,shops!inner(name),lg_cards!inner(user_id,status)")
    .eq("lg_cards.user_id", ownerId).eq("lg_cards.status", "ativo");
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as any[]) map.set(r.shop_id, r.shops?.name ?? "Loja");
  return map;
}

const ORDER_COLS = "id,shop_id,external_id,order_number,order_date,revenue,currency,tracking_code,tracking_url,delivery_status,delivered_at,problem_at,shopify_financial_status,cancelled_at:raw->>cancelled_at,email:raw->>email,cust:raw->customer->>email,first_name:raw->customer->>first_name,last_name:raw->customer->>last_name,ship_first:raw->shipping_address->>first_name,ship_last:raw->shipping_address->>last_name";

const emailOf = (o: any) => String(o.email ?? o.cust ?? "").trim().toLowerCase();

type OrderState = {
  delivery: FlowDelivery; deliveredAt: string | null; cancelled: boolean; financial: string | null;
  dispute: boolean; lastInboundAt: string | null; trackingUrl: string | null;
};

// Envio, disputa e suporte de cada pedido (mesma leitura da aba Avisos de atraso).
async function orderStates(ownerId: string, orders: any[]) {
  const ids = orders.map((o) => o.id);
  const emails = [...new Set(orders.map(emailOf).filter(Boolean))];
  const externalIds = [...new Set(orders.map((o) => String(o.external_id)))];
  const shopIds = [...new Set(orders.map((o) => o.shop_id as string))];
  const [tracking, disputes, convs, integs] = await Promise.all([
    selectAllIn<any>(ids, (c) => supabaseAdmin.from("shop_order_tracking")
      .select("order_id,tracking_status,delivered_at").in("order_id", c)),
    selectAllIn<any>(externalIds, (c) => supabaseAdmin.from("shop_order_disputes")
      .select("shop_id,order_external_id").eq("user_id", ownerId).in("order_external_id", c)),
    selectAllIn<any>(emails, (c) => supabaseAdmin.from("support_conversations")
      .select("customer_email,last_inbound_at").eq("owner_id", ownerId).in("customer_email", c)),
    shopIds.length
      ? supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  for (const r of [tracking, disputes, convs]) if (r.error) throw new Error(r.error.message);
  const trackBy = new Map(tracking.data.map((t) => [t.order_id, t]));
  const disputed = new Set(disputes.data.map((d) => `${d.shop_id}:${d.order_external_id}`));
  const inbound = new Map<string, string>();
  for (const c of convs.data) {
    if (c.last_inbound_at && (inbound.get(c.customer_email) ?? "") < c.last_inbound_at) inbound.set(c.customer_email, c.last_inbound_at);
  }
  const linkTemplate = new Map(((integs as any).data ?? []).map((i: any) => [i.shop_id, i.tracking_link_template]));

  const out = new Map<string, OrderState>();
  for (const o of orders) {
    const t = trackBy.get(o.id);
    const deliveredAt = o.delivered_at ?? t?.delivered_at ?? null;
    const ts = String(t?.tracking_status ?? "");
    const delivery: FlowDelivery = o.delivery_status === "returned" ? "devolvido"
      : deliveredAt || o.delivery_status === "delivered" ? "entregue"
      : o.delivery_status === "waiting_customer" ? "esperando_cliente"
      : !o.tracking_code ? "sem_envio"
      : o.problem_at || o.delivery_status === "problem" ? "problema"
      : /^(pending|info ?received)$/i.test(ts.trim()) ? "sem_envio" : "transito";
    out.set(o.id, {
      delivery, deliveredAt, cancelled: !!o.cancelled_at, financial: o.shopify_financial_status ?? null,
      dispute: disputed.has(`${o.shop_id}:${o.external_id}`),
      lastInboundAt: inbound.get(emailOf(o)) ?? null,
      trackingUrl: buildTrackingUrl(linkTemplate.get(o.shop_id) as string | undefined, o.tracking_code) ?? o.tracking_url ?? null,
    });
  }
  return out;
}

// Pedidos que batem no filtro agora (um por e-mail: o mais recente).
export async function matchAudience(ownerId: string, rawFilters: unknown): Promise<AudienceOrder[]> {
  const f: FlowFilters = flowFiltersSchema.parse(rawFilters ?? {});
  const shops = await activeShops(ownerId);
  const shopIds = f.shopIds.length ? f.shopIds.filter((id) => shops.has(id)) : [...shops.keys()];
  if (!shopIds.length) return [];
  const now = Date.now();
  const day = (offset: number) => isoDateUS(now - offset * 86_400_000);

  let q = supabaseAdmin.from("shop_orders").select(ORDER_COLS + (f.product ? ",items:raw->line_items" : ""))
    .eq("user_id", ownerId).in("shop_id", shopIds).filter("raw->>cancelled_at", "is", null);
  if (f.purchase.kind === "dias") {
    q = q.lte("order_date", day(f.purchase.min ?? 0)).gte("order_date", day(f.purchase.max ?? DEFAULT_MAX_DAYS));
  } else {
    q = q.gte("order_date", f.purchase.from ?? day(DEFAULT_MAX_DAYS));
    if (f.purchase.to) q = q.lte("order_date", f.purchase.to);
  }
  if (f.financial.length) q = q.in("shopify_financial_status", f.financial);
  if (f.minValue != null) q = q.gte("revenue", f.minValue);
  if (f.maxValue != null) q = q.lte("revenue", f.maxValue);
  const { data: orders, error } = await selectAll<any>(q);
  if (error) throw new Error(error.message);

  const term = f.product.toLowerCase();
  const candidates = orders.filter((o) => z.string().email().safeParse(emailOf(o)).success
    && (!term || (Array.isArray(o.items) && o.items.some((i: any) => String(i?.title ?? "").toLowerCase().includes(term)))));
  if (!candidates.length) return [];
  const states = await orderStates(ownerId, candidates);

  const byEmail = new Map<string, AudienceOrder>();
  for (const o of candidates) {
    const s = states.get(o.id)!;
    if (f.delivery.length && !f.delivery.includes(s.delivery)) continue;
    if (s.delivery === "entregue" && s.deliveredAt && (f.deliveredMin != null || f.deliveredMax != null)) {
      const d = (now - Date.parse(s.deliveredAt)) / 86_400_000;
      if (f.deliveredMin != null && d < f.deliveredMin) continue;
      if (f.deliveredMax != null && d > f.deliveredMax + 1) continue;
    }
    if (f.dispute === "com" && !s.dispute) continue;
    if (f.dispute === "sem" && s.dispute) continue;
    if (f.support === "com" && !s.lastInboundAt) continue;
    if (f.support === "sem" && s.lastInboundAt) continue;
    const email = emailOf(o);
    const orderDate = String(o.order_date).slice(0, 10);
    const prev = byEmail.get(email);
    if (prev && prev.orderDate >= orderDate) continue;
    byEmail.set(email, {
      id: o.id, shopId: o.shop_id, shopName: shops.get(o.shop_id) ?? "Loja",
      orderNumber: String(o.order_number ?? o.id.slice(0, 8)), orderDate, email,
      firstName: String(o.first_name || o.ship_first || "").trim().split(/\s+/)[0] ?? "",
      customerName: [o.first_name || o.ship_first, o.last_name || o.ship_last].filter(Boolean).join(" ").trim() || email,
      trackingUrl: s.trackingUrl, delivery: s.delivery, revenue: Number(o.revenue ?? 0), currency: o.currency ?? null,
    });
  }
  return [...byEmail.values()].sort((a, b) => b.orderDate.localeCompare(a.orderDate));
}

// Põe no fluxo quem bate no filtro e ainda não entrou (pedido novo, ou e-mail
// que não está ativo nele).
export async function enrollAudience(ownerId: string, flow: { id: string; filters: unknown }) {
  const audience = await matchAudience(ownerId, flow.filters);
  const { data: existing, error } = await selectAll<any>(fdb("email_flow_enrollments")
    .select("order_id,to_email,status").eq("flow_id", flow.id));
  if (error) throw new Error(error.message);
  const seenOrders = new Set(existing.map((e) => e.order_id));
  const activeEmails = new Set(existing.filter((e) => e.status === "ativo").map((e) => e.to_email));
  const rows = audience.filter((a) => !seenOrders.has(a.id) && !activeEmails.has(a.email)).map((a) => ({
    owner_id: ownerId, flow_id: flow.id, order_id: a.id, shop_id: a.shopId, to_email: a.email,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await fdb("email_flow_enrollments").upsert(rows.slice(i, i + 500), { onConflict: "flow_id,order_id", ignoreDuplicates: true });
    if (insErr) throw new Error(insErr.message);
  }
  await fdb("email_flows").update({ last_enrolled_at: new Date().toISOString() }).eq("id", flow.id);
  return rows.length;
}

// ─── Motor ────────────────────────────────────────────────────────────────────

export async function hasActiveFlows() {
  const { count } = await fdb("email_flows").select("id", { count: "exact", head: true }).eq("status", "ativo");
  return (count ?? 0) > 0;
}

export async function runEmailFlows() {
  const { data: flows, error } = await fdb("email_flows").select("id,owner_id,name,mode,filters,steps,stop_rules,created_by,last_enrolled_at").eq("status", "ativo");
  if (error) throw new Error(error.message);
  const result: Record<string, string> = {};
  const byOwner = new Map<string, any[]>();
  for (const f of flows ?? []) byOwner.set(f.owner_id, [...(byOwner.get(f.owner_id) ?? []), f]);
  for (const [ownerId, list] of byOwner) {
    try { result[ownerId] = await runOwner(ownerId, list); }
    catch (e: any) { result[ownerId] = `erro: ${String(e?.message ?? e)}`; }
  }
  return result;
}

async function runOwner(ownerId: string, flows: any[]) {
  let enrolled = 0;
  for (const f of flows) {
    if (f.mode === "continuo" && (!f.last_enrolled_at || Date.now() - Date.parse(f.last_enrolled_at) > ENROLL_EVERY_MS)) {
      enrolled += await enrollAudience(ownerId, f);
    }
  }

  const flowById = new Map(flows.map((f) => [f.id, { ...f, steps: z.array(flowStepSchema).catch([]).parse(f.steps) as FlowStep[] }]));
  const { data: due, error } = await fdb("email_flow_enrollments")
    .select("id,flow_id,order_id,shop_id,to_email,step_index,emails_sent,enrolled_at")
    .eq("owner_id", ownerId).eq("status", "ativo").lte("next_at", new Date().toISOString())
    .in("flow_id", [...flowById.keys()]).order("next_at").limit(100);
  if (error) throw new Error(error.message);

  const { count: inQueue } = await supabaseAdmin.from("order_notices").select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId).in("status", ["na_fila", "enviando"]).not("flow_enrollment_id" as any, "is", null);
  let room = MAX_FLOW_IN_QUEUE - (inQueue ?? 0);
  let queued = 0, stopped = 0, done = 0;

  if (due?.length) {
    const { data: orders, error: oErr } = await selectAllIn<any>(due.map((e: any) => e.order_id), (c) =>
      supabaseAdmin.from("shop_orders").select(ORDER_COLS).in("id", c));
    if (oErr) throw new Error(oErr.message);
    const orderBy = new Map(orders.map((o) => [o.id, o]));
    const states = await orderStates(ownerId, orders);

    for (const e of due as any[]) {
      const flow = flowById.get(e.flow_id)!;
      const o = orderBy.get(e.order_id);
      const s = o ? states.get(o.id) : undefined;
      const rules: string[] = flow.stop_rules ?? [];
      const why = !o || !s ? "pedido não existe mais"
        : s.cancelled ? "pedido cancelado"
        : rules.includes("respondeu") && s.lastInboundAt && s.lastInboundAt > e.enrolled_at ? "cliente respondeu"
        : rules.includes("entregue") && s.delivery === "entregue" ? "pedido entregue"
        : rules.includes("reembolsado") && ["refunded", "partially_refunded", "voided"].includes(String(s.financial)) ? "pedido reembolsado"
        : rules.includes("chargeback") && s.dispute ? "abriu chargeback"
        : null;
      if (why) {
        await fdb("email_flow_enrollments").update({ status: "parado", stop_reason: why, finished_at: new Date().toISOString() }).eq("id", e.id);
        stopped++;
        continue;
      }

      // Anda pelos passos até um "esperar" (ou o fim). E-mail sem vaga na fila:
      // para aqui e tenta de novo na próxima rodada.
      let idx = e.step_index as number;
      let sent = e.emails_sent as number;
      let nextAt: string | null = null;
      let blocked = false;
      while (idx < flow.steps.length) {
        const step = flow.steps[idx];
        if (step.type === "esperar") {
          nextAt = new Date(Date.now() + waitMs(step)).toISOString();
          idx++;
          break;
        }
        if (room <= 0) { blocked = true; break; }
        const vars = { nome: firstNameOf(o), pedido: String(o.order_number ?? o.id.slice(0, 8)), rastreio: s!.trackingUrl ?? "" };
        const { error: qErr } = await supabaseAdmin.from("order_notices").insert({
          owner_id: ownerId, order_id: o.id, shop_id: o.shop_id, template_id: null,
          template_title: `Fluxo: ${flow.name} · e-mail ${sent + 1}`,
          to_email: e.to_email, subject: renderNotice(step.subject, vars), body: renderNotice(step.body, vars),
          sent_by: flow.created_by, status: "na_fila", sent_at: null, flow_enrollment_id: e.id,
        } as any);
        if (qErr) throw new Error(qErr.message);
        room--; queued++; sent++; idx++;
      }
      const finished = idx >= flow.steps.length && !blocked && !nextAt;
      await fdb("email_flow_enrollments").update({
        step_index: idx, emails_sent: sent,
        ...(nextAt ? { next_at: nextAt } : {}),
        ...(finished ? { status: "concluido", finished_at: new Date().toISOString() } : {}),
      }).eq("id", e.id);
      if (finished) done++;
    }
  }

  // Campanha sem ninguém mais na sequência: concluída.
  for (const f of flows.filter((x) => x.mode === "campanha")) {
    const { count } = await fdb("email_flow_enrollments").select("id", { count: "exact", head: true }).eq("flow_id", f.id).eq("status", "ativo");
    if (!count) await fdb("email_flows").update({ status: "concluido" }).eq("id", f.id).eq("status", "ativo");
  }
  return `entraram ${enrolled} · na fila ${queued} · saíram ${stopped} · concluíram ${done}`;
}

const firstNameOf = (o: any) => String(o.first_name || o.ship_first || "").trim().split(/\s+/)[0] ?? "";

// Antes de mandar um e-mail de fluxo: fluxo pausado/apagado ou pessoa que saiu → não manda.
export async function flowNoticeBlocked(enrollmentId: string): Promise<string | null> {
  const { data } = await fdb("email_flow_enrollments").select("status,stop_reason,email_flows(status)").eq("id", enrollmentId).maybeSingle();
  if (!data) return "fluxo apagado";
  if (data.status === "parado") return `saiu do fluxo (${data.stop_reason ?? "parado"})`;
  if (data.email_flows?.status === "pausado") return "fluxo pausado";
  return null;
}

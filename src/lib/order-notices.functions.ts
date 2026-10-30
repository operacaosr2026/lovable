import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { sanitizeEvents } from "@/lib/tracking-display";
import { getZohoAccount } from "@/lib/zoho-mail.server";
import { renderNotice, NOTICE_MIN_DAYS, NOTICE_MAX_DAYS } from "@/lib/order-notices";
import { isoDateUS } from "@/lib/timezone";
import type { Database } from "@/integrations/supabase/types";

// Aba Notificações: e-mail manual pro cliente de pedido atrasado, antes que ele
// abra chargeback de "produto não recebido" (mediana: 20 dias depois da
// compra, out/2026). Manda pelo Zoho do Atendimento, com a assinatura, numa
// fila de 1 e-mail a cada 3 minutos (order-notices.server.ts).
// Acesso: admin, ou membro com a permissão "avisos_clientes".

type Ctx = { role: "admin" | "member"; ownerId: string; userId: string; permissions: { section: string }[] };
function assertAccess(ctx: Ctx) {
  if (ctx.role !== "admin" && !ctx.permissions.some((p) => p.section === "avisos_clientes")) {
    throw new Error("Sem acesso a Notificações");
  }
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

export type NoticeTemplate = { id: string; title: string; subject: string; body: string; position: number };

// Criadas na 1ª vez que a aba abre (dá pra editar e apagar depois).
const DEFAULT_TEMPLATES: Omit<NoticeTemplate, "id">[] = [
  {
    title: "A caminho (atualização)", subject: "Update on your order 📦", position: 0,
    body: "Hi {nome},\n\nWe wanted to share a quick update about your order {pedido}.\n\nYour package is still on the way and continues to make its way toward you. We know you've been waiting for it, and we truly appreciate your patience.\n\nThe good news is that your order is getting closer and should be arriving soon.\n\nYou can continue to follow the latest updates here:\n\nTracking: {rastreio}\n\nWe'll keep an eye on your shipment until it reaches you.",
  },
  {
    title: "Desculpas pelo atraso", subject: "About your order {pedido} — thank you for your patience", position: 1,
    body: "Hi {nome},\n\nWe're reaching out about your order {pedido}.\n\nWe know it's taking longer than expected to arrive, and we sincerely apologize for the wait. Your package is on its way, and our team is personally monitoring it until it reaches your door.\n\nYou can follow every step of the delivery here:\n\nTracking: {rastreio}\n\nIf you have any questions or concerns, just reply to this email — we're here to help and will get back to you quickly.",
  },
  {
    title: "Última etapa da entrega", subject: "Your order is almost there 🚚", position: 2,
    body: "Hi {nome},\n\nGood news! Your order {pedido} has reached the final stage of its journey and is now with the local delivery carrier.\n\nIt should be arriving in the next few days. You can check the latest status here:\n\nTracking: {rastreio}\n\nThank you so much for your patience — we hope you love your order!",
  },
  {
    title: "Ainda não foi enviado", subject: "An update on your order {pedido}", position: 3,
    body: "Hi {nome},\n\nThank you for your order {pedido}!\n\nDue to high demand, it's taking us a little longer than usual to prepare some orders, including yours. We're sorry for the delay — your order is being prepared and will ship very soon.\n\nAs soon as it ships, you'll receive an email with your tracking link.\n\nIf you have any questions, just reply to this email. We're here to help!",
  },
];

async function loadTemplates(ownerId: string): Promise<NoticeTemplate[]> {
  const { data, error } = await supabaseAdmin.from("order_notice_templates").select("id,title,subject,body,position")
    .eq("owner_id", ownerId).order("position").order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const listNoticeTemplates = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAccess(context);
    const list = await loadTemplates(context.ownerId);
    if (list.length) return list;
    // Só cria as padrão se nunca teve nenhuma (nem foram apagadas todas): a
    // marca é não ter envio nenhum ainda.
    const { count } = await supabaseAdmin.from("order_notices").select("id", { count: "exact", head: true }).eq("owner_id", context.ownerId);
    if (count) return list;
    const { error } = await supabaseAdmin.from("order_notice_templates")
      .insert(DEFAULT_TEMPLATES.map((t) => ({ ...t, owner_id: context.ownerId })));
    if (error) throw new Error(error.message);
    return loadTemplates(context.ownerId);
  });

export const saveNoticeTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const now = new Date().toISOString();
    if (data.id) {
      const { error } = await supabaseAdmin.from("order_notice_templates")
        .update({ title: data.title, subject: data.subject, body: data.body, updated_at: now })
        .eq("id", data.id).eq("owner_id", context.ownerId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: last } = await supabaseAdmin.from("order_notice_templates").select("position")
      .eq("owner_id", context.ownerId).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: row, error } = await supabaseAdmin.from("order_notice_templates")
      .insert({ owner_id: context.ownerId, title: data.title, subject: data.subject, body: data.body, position: (last?.position ?? -1) + 1 })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteNoticeTemplate = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { error } = await supabaseAdmin.from("order_notice_templates").delete().eq("id", data.id).eq("owner_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Pedidos atrasados ────────────────────────────────────────────────────────

export type NoticeOrder = {
  id: string;
  shopId: string;
  shopName: string;
  orderNumber: string;
  orderDate: string;
  days: number;               // dias corridos desde a compra
  customerName: string;
  firstName: string;
  email: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  status: "sem_envio" | "transito" | "problema" | "esperando_cliente";
  trackingStatus: string | null;   // 17track (ex.: "In transit")
  lastEvent: string | null;
  lastEventAt: string | null;
  dispute: { status: string | null; reason: string | null; type: string } | null;
  supportAt: string | null;   // última vez que o cliente escreveu pro suporte
  notices: { at: string; title: string }[];  // enviados, mais recente primeiro
  queued: boolean;            // tem e-mail esperando na fila
  note: string | null;        // nota da equipe (shop_orders.notice_note)
};

const cleanLabel = (label: string | null | undefined) =>
  label ? sanitizeEvents([{ at: null, description: label, location: null }])[0]?.description ?? null : null;

// Lojas dos grupos ativos (loja inativa não entra, mesmo com pedido em aberto).
async function activeShops(ownerId: string) {
  const { data, error } = await supabaseAdmin.from("lg_card_shops")
    .select("shop_id,shops!inner(name),lg_cards!inner(user_id,status)")
    .eq("lg_cards.user_id", ownerId).eq("lg_cards.status", "ativo");
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as any[]) map.set(r.shop_id, r.shops?.name ?? "Loja");
  return map;
}

export const listNoticeOrders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<NoticeOrder[]> => {
    assertAccess(context);
    const ownerId = context.ownerId;
    const shops = await activeShops(ownerId);
    if (!shops.size) return [];
    const now = Date.now();
    // Dia de NY (order_date é dia de NY) — o toISOString dava o dia em UTC.
    const day = (offset: number) => isoDateUS(now - offset * 86_400_000);

    // Em aberto: sem entrega/devolução, sem cancelamento nem reembolso.
    const { data: orders, error } = await selectAll<any>(supabaseAdmin.from("shop_orders")
      .select("id,shop_id,external_id,order_number,order_date,tracking_code,tracking_url,delivery_status,shipped_at,problem_at,notice_note,email:raw->>email,cust:raw->customer->>email,first_name:raw->customer->>first_name,last_name:raw->customer->>last_name,ship_first:raw->shipping_address->>first_name,ship_last:raw->shipping_address->>last_name")
      .eq("user_id", ownerId)
      .in("shop_id", [...shops.keys()])
      .lte("order_date", day(NOTICE_MIN_DAYS))
      .gte("order_date", day(NOTICE_MAX_DAYS))
      .is("delivered_at", null)
      .or("delivery_status.is.null,delivery_status.not.in.(delivered,returned)")
      .or("shopify_financial_status.is.null,shopify_financial_status.not.in.(refunded,partially_refunded,voided)")
      .filter("raw->>cancelled_at", "is", null));
    if (error) throw new Error(error.message);
    if (!orders.length) return [];

    const ids = orders.map((o) => o.id);
    const emailOf = (o: any) => String(o.email ?? o.cust ?? "").trim().toLowerCase() || null;
    const emails = [...new Set(orders.map(emailOf).filter(Boolean))] as string[];
    const externalIds = [...new Set(orders.map((o) => String(o.external_id)))];
    const [tracking, notices, disputes, convs, integs] = await Promise.all([
      selectAllIn<any>(ids, (c) => supabaseAdmin.from("shop_order_tracking")
        .select("order_id,tracking_status,last_event_label,last_event_at,delivered_at").in("order_id", c)),
      selectAllIn<any>(ids, (c) => supabaseAdmin.from("order_notices")
        .select("order_id,template_title,sent_at,status").eq("owner_id", ownerId).in("status", ["enviado", "na_fila", "enviando"]).in("order_id", c)),
      selectAllIn<any>(externalIds, (c) => supabaseAdmin.from("shop_order_disputes")
        .select("shop_id,order_external_id,status,reason,type,initiated_at").eq("user_id", ownerId).in("order_external_id", c)),
      selectAllIn<any>(emails, (c) => supabaseAdmin.from("support_conversations")
        .select("customer_email,last_inbound_at").eq("owner_id", ownerId).in("customer_email", c)),
      supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", [...shops.keys()]),
    ]);
    const trackBy = new Map(tracking.data.map((t) => [t.order_id, t]));
    const noticesBy = new Map<string, { at: string; title: string }[]>();
    const queued = new Set<string>();
    for (const n of notices.data) {
      if (n.status !== "enviado") { queued.add(n.order_id); continue; }
      const list = noticesBy.get(n.order_id) ?? [];
      list.push({ at: n.sent_at, title: n.template_title });
      noticesBy.set(n.order_id, list);
    }
    for (const list of noticesBy.values()) list.sort((a, b) => b.at.localeCompare(a.at));
    // Mais recente por pedido.
    const disputeBy = new Map<string, any>();
    for (const d of disputes.data) {
      const k = `${d.shop_id}:${d.order_external_id}`;
      if (!disputeBy.has(k) || disputeBy.get(k).initiated_at < d.initiated_at) disputeBy.set(k, d);
    }
    const supportBy = new Map<string, string>();
    for (const c of convs.data) {
      if (c.last_inbound_at && (supportBy.get(c.customer_email) ?? "") < c.last_inbound_at) supportBy.set(c.customer_email, c.last_inbound_at);
    }
    const linkTemplate = new Map((integs.data ?? []).map((i) => [i.shop_id, i.tracking_link_template]));

    const out: NoticeOrder[] = [];
    for (const o of orders) {
      const t = trackBy.get(o.id);
      if (t?.delivered_at) continue;   // 17track já viu a entrega
      const email = emailOf(o);
      const first = String(o.first_name || o.ship_first || "").trim().split(/\s+/)[0] ?? "";
      const name = [o.first_name || o.ship_first, o.last_name || o.ship_last].filter(Boolean).join(" ").trim();
      const shipped = !!o.tracking_code && !/^(pending|info ?received)$/i.test(String(t?.tracking_status ?? "").trim());
      const status: NoticeOrder["status"] = o.delivery_status === "waiting_customer" ? "esperando_cliente"
        : !o.tracking_code ? "sem_envio"
        : o.problem_at || o.delivery_status === "problem" ? "problema"
        : shipped ? "transito" : "sem_envio";
      const d = disputeBy.get(`${o.shop_id}:${o.external_id}`);
      out.push({
        id: o.id,
        shopId: o.shop_id,
        shopName: shops.get(o.shop_id) ?? "Loja",
        orderNumber: String(o.order_number ?? o.id.slice(0, 8)),
        orderDate: String(o.order_date).slice(0, 10),
        days: Math.floor((now - Date.parse(`${String(o.order_date).slice(0, 10)}T12:00:00Z`)) / 86_400_000),
        customerName: name || email || "—",
        firstName: first,
        email,
        trackingCode: o.tracking_code ?? null,
        trackingUrl: buildTrackingUrl(linkTemplate.get(o.shop_id), o.tracking_code) ?? o.tracking_url ?? null,
        status,
        trackingStatus: t?.tracking_status ?? null,
        lastEvent: cleanLabel(t?.last_event_label),
        lastEventAt: t?.last_event_at ?? null,
        dispute: d ? { status: d.status, reason: d.reason, type: d.type } : null,
        supportAt: email ? supportBy.get(email) ?? null : null,
        notices: noticesBy.get(o.id) ?? [],
        queued: queued.has(o.id),
        note: o.notice_note ?? null,
      });
    }
    return out.sort((a, b) => b.days - a.days);
  });

// Nota da equipe no pedido (vazia apaga). Só pedido de loja do workspace.
export const saveNoticeNote = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ orderId: z.string().uuid(), note: z.string().max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const { data: row, error } = await supabaseAdmin.from("shop_orders")
      .update({ notice_note: data.note.trim() || null })
      .eq("id", data.orderId).eq("user_id", context.ownerId).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Pedido não encontrado");
    return { ok: true };
  });

// ─── Envio (fila) ─────────────────────────────────────────────────────────────

// Põe os e-mails na fila; o cron manda 1 a cada 3 minutos (order-notices.server.ts).
// O texto vai pronto: editar a mensagem depois não muda o que já está na fila.
export const queueOrderNotices = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    templateId: z.string().uuid(),
    orderIds: z.array(z.string().uuid()).min(1).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    const ownerId = context.ownerId;
    const acc = await getZohoAccount(ownerId);
    if (!acc?.refresh_token || !acc.account_id) throw new Error("Zoho Mail não conectado (Atendimento → Configurações)");
    const { data: tpl } = await supabaseAdmin.from("order_notice_templates").select("id,title,subject,body")
      .eq("id", data.templateId).eq("owner_id", ownerId).maybeSingle();
    if (!tpl) throw new Error("Mensagem não encontrada");
    const [{ data: orders, error }, inQueue] = await Promise.all([
      selectAllIn<any>(data.orderIds, (c) => supabaseAdmin.from("shop_orders")
        .select("id,shop_id,order_number,tracking_code,tracking_url,email:raw->>email,cust:raw->customer->>email,first_name:raw->customer->>first_name,ship_first:raw->shipping_address->>first_name,cancelled_at:raw->>cancelled_at")
        .eq("user_id", ownerId).in("id", c)),
      selectAllIn<any>(data.orderIds, (c) => supabaseAdmin.from("order_notices").select("order_id")
        .eq("owner_id", ownerId).in("status", ["na_fila", "enviando"]).in("order_id", c)),
    ]);
    if (error) throw new Error(error.message);
    const queuedAlready = new Set(inQueue.data.map((n) => n.order_id));
    const shopIds = [...new Set(orders.map((o) => o.shop_id))];
    const { data: integs } = await supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds);
    const linkTemplate = new Map((integs ?? []).map((i) => [i.shop_id, i.tracking_link_template]));
    const needsLink = /\{rastreio\}/i.test(tpl.body) || /\{rastreio\}/i.test(tpl.subject);

    // Na ordem em que foram marcados.
    const byId = new Map(orders.map((o) => [o.id, o]));
    const rows: Database["public"]["Tables"]["order_notices"]["Insert"][] = [];
    const skipped: { order: string; motivo: string }[] = [];
    const base = Date.now();
    for (const id of data.orderIds) {
      const o = byId.get(id);
      if (!o) continue;
      const order = String(o.order_number ?? o.id.slice(0, 8));
      const to = String(o.email ?? o.cust ?? "").trim().toLowerCase();
      const link = buildTrackingUrl(linkTemplate.get(o.shop_id), o.tracking_code) ?? o.tracking_url ?? null;
      if (queuedAlready.has(o.id)) { skipped.push({ order, motivo: "já está na fila" }); continue; }
      if (o.cancelled_at) { skipped.push({ order, motivo: "pedido cancelado" }); continue; }
      if (!z.string().email().safeParse(to).success) { skipped.push({ order, motivo: "sem e-mail do cliente" }); continue; }
      if (needsLink && !link) { skipped.push({ order, motivo: "sem link de rastreio" }); continue; }
      const vars = { nome: String(o.first_name || o.ship_first || "").trim().split(/\s+/)[0] ?? "", pedido: order, rastreio: link ?? "" };
      rows.push({
        owner_id: ownerId, order_id: o.id, shop_id: o.shop_id, template_id: tpl.id, template_title: tpl.title,
        to_email: to, subject: renderNotice(tpl.subject, vars), body: renderNotice(tpl.body, vars),
        sent_by: context.userId, status: "na_fila", sent_at: null,
        // 1 ms a mais por item: a fila sai na ordem marcada.
        queued_at: new Date(base + rows.length).toISOString(),
      });
    }
    if (rows.length) {
      const { error: insErr } = await supabaseAdmin.from("order_notices").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    return { queued: rows.length, skipped };
  });

export type NoticeQueue = {
  pending: { id: string; orderNumber: string; email: string; title: string; status: string }[];
  lastSentAt: string | null;
  failed: { id: string; orderNumber: string; email: string; error: string | null; at: string }[];
};

export const getNoticeQueue = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<NoticeQueue> => {
    assertAccess(context);
    const ownerId = context.ownerId;
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const [pending, last, failed] = await Promise.all([
      selectAll<any>(supabaseAdmin.from("order_notices").select("id,to_email,template_title,status,queued_at,shop_orders(order_number)")
        .eq("owner_id", ownerId).in("status", ["na_fila", "enviando"]).order("queued_at")),
      supabaseAdmin.from("order_notices").select("sent_at").eq("owner_id", ownerId).eq("status", "enviado")
        .not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("order_notices").select("id,to_email,error,queued_at,shop_orders(order_number)")
        .eq("owner_id", ownerId).eq("status", "erro").gte("queued_at", since).order("queued_at", { ascending: false }).limit(50),
    ]);
    if (pending.error) throw new Error(pending.error.message);
    // selectAll desempata por id: reordena pela fila, com o que está saindo primeiro.
    const list = pending.data.sort((a, b) =>
      (a.status === "enviando" ? 0 : 1) - (b.status === "enviando" ? 0 : 1) || String(a.queued_at).localeCompare(String(b.queued_at)));
    return {
      pending: list.map((n) => ({ id: n.id, orderNumber: String(n.shop_orders?.order_number ?? ""), email: n.to_email, title: n.template_title, status: n.status })),
      lastSentAt: last.data?.sent_at ?? null,
      failed: (failed.data ?? []).map((n: any) => ({ id: n.id, orderNumber: String(n.shop_orders?.order_number ?? ""), email: n.to_email, error: n.error, at: n.queued_at })),
    };
  });

// Tira da fila (todos, ou só os escolhidos). O que já está saindo não para.
export const cancelNoticeQueue = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAccess(context);
    let q = supabaseAdmin.from("order_notices").update({ status: "cancelado", error: "cancelado na tela" })
      .eq("owner_id", context.ownerId).eq("status", "na_fila");
    if (data.ids) q = q.in("id", data.ids);
    const { data: rows, error } = await q.select("id");
    if (error) throw new Error(error.message);
    return { cancelled: rows?.length ?? 0 };
  });

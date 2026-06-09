import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PRIORITY_TAGS = ["vip", "difficult", "high_attention", "chargeback_risk"] as const;

// =================== Inboxes ===================
export const listInboxes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("support_inboxes")
      .select("id,shop_id,email_address,display_name,provider,imap_host,imap_port,imap_user,imap_ssl,smtp_host,smtp_port,smtp_user,smtp_ssl,connection_status,last_sync_at,last_error,last_poll_at,last_poll_status,last_poll_error,is_active,poll_interval_sec,sla_warning_hours,sla_critical_hours,created_at")
      .eq("user_id", userId)
      .order("created_at");
    if (error) throw new Error(error.message);

    const inboxIds = (data ?? []).map((i: any) => i.id);
    const counters: Record<string, { open: number; unread: number; overdue: number }> = {};
    if (inboxIds.length) {
      const { data: convs } = await supabase
        .from("support_conversations")
        .select("inbox_id,last_message_at,last_message_from,unread_count,status_id,first_response_at")
        .in("inbox_id", inboxIds);
      const { data: statuses } = await supabase
        .from("support_ticket_statuses")
        .select("id,system_key")
        .eq("user_id", userId);
      const resolvedIds = new Set((statuses ?? []).filter((s: any) => s.system_key === "resolved").map((s: any) => s.id));
      const now = Date.now();
      for (const c of convs ?? []) {
        const acc = counters[c.inbox_id] ?? { open: 0, unread: 0, overdue: 0 };
        const isResolved = c.status_id && resolvedIds.has(c.status_id);
        if (!isResolved) acc.open += 1;
        if (c.unread_count > 0) acc.unread += c.unread_count;
        const inbox = (data ?? []).find((i: any) => i.id === c.inbox_id);
        if (!isResolved && c.last_message_from === "customer" && inbox) {
          const ageHours = (now - new Date(c.last_message_at).getTime()) / 36e5;
          if (ageHours >= (inbox.sla_critical_hours ?? 12)) acc.overdue += 1;
        }
        counters[c.inbox_id] = acc;
      }
    }
    return { inboxes: (data ?? []).map((i: any) => ({ ...i, ...counters[i.id] ?? { open: 0, unread: 0, overdue: 0 } })) };
  });

const InboxInput = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  email_address: z.string().email(),
  display_name: z.string().max(120).nullable().optional(),
  imap_host: z.string().max(255).nullable().optional(),
  imap_port: z.number().int().min(1).max(65535).nullable().optional(),
  imap_user: z.string().max(255).nullable().optional(),
  imap_password: z.string().max(500).nullable().optional(),
  imap_ssl: z.boolean().optional(),
  smtp_host: z.string().max(255).nullable().optional(),
  smtp_port: z.number().int().min(1).max(65535).nullable().optional(),
  smtp_user: z.string().max(255).nullable().optional(),
  smtp_password: z.string().max(500).nullable().optional(),
  smtp_ssl: z.boolean().optional(),
  is_active: z.boolean().optional(),
  poll_interval_sec: z.number().int().min(60).max(3600).optional(),
  sla_warning_hours: z.number().int().min(1).max(720).optional(),
  sla_critical_hours: z.number().int().min(1).max(720).optional(),
});

export const upsertInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InboxInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const payload: any = { ...data, user_id: userId };
    if (payload.imap_password === "" || payload.imap_password == null) delete payload.imap_password;
    if (payload.smtp_password === "" || payload.smtp_password == null) delete payload.smtp_password;
    const { error, data: row } = payload.id
      ? await supabaseAdmin.from("support_inboxes").update(payload).eq("id", payload.id).eq("user_id", userId).select().single()
      : await supabaseAdmin.from("support_inboxes").insert(payload).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("support_inboxes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getInboxWebhookInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: row, error } = await supabaseAdmin.from("support_inboxes")
      .select("id,webhook_secret").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Inbox não encontrada");
    const base = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    return {
      inboundUrl: `${base}/api/public/hooks/mail/inbound/${row.id}?secret=${(row as any).webhook_secret}`,
      pollStatusUrl: `${base}/api/public/hooks/mail/poll-status/${row.id}?secret=${(row as any).webhook_secret}`,
      secret: (row as any).webhook_secret,
    };
  });

export const testInboxConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const workerUrl = process.env.MAIL_WORKER_URL;
    const workerSecret = process.env.MAIL_WORKER_SHARED_SECRET;
    if (!workerUrl || !workerSecret) {
      await supabaseAdmin.from("support_inboxes")
        .update({ connection_status: "disconnected", last_error: "Worker de email não configurado (MAIL_WORKER_URL ausente)" })
        .eq("id", data.id).eq("user_id", userId);
      return { ok: false, message: "Worker de email ainda não configurado. Faça o deploy do hardya-mail-worker e configure os secrets MAIL_WORKER_URL e MAIL_WORKER_SHARED_SECRET." };
    }
    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, "")}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-worker-secret": workerSecret },
        body: JSON.stringify({ inbox_id: data.id }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const msg = json.error || `Worker respondeu ${res.status}`;
        await supabaseAdmin.from("support_inboxes")
          .update({ connection_status: "error", last_error: msg }).eq("id", data.id).eq("user_id", userId);
        return { ok: false, message: msg };
      }
      await supabaseAdmin.from("support_inboxes")
        .update({ connection_status: "connected", last_sync_at: new Date().toISOString(), last_error: null })
        .eq("id", data.id).eq("user_id", userId);
      return { ok: true, message: "Conexão IMAP+SMTP validada com sucesso." };
    } catch (e: any) {
      await supabaseAdmin.from("support_inboxes")
        .update({ connection_status: "error", last_error: String(e?.message ?? e) }).eq("id", data.id).eq("user_id", userId);
      return { ok: false, message: String(e?.message ?? e) };
    }
  });

// =================== Statuses ===================
export const listStatuses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("support_ticket_statuses").select("*")
      .eq("user_id", userId).order("position").order("created_at");
    if (error) throw new Error(error.message);
    return { statuses: data ?? [] };
  });

const StatusInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  color: z.string().min(1).max(120),
  position: z.number().int().optional(),
});
export const upsertStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload: any = { ...data, user_id: userId };
    const { error, data: row } = payload.id
      ? await supabase.from("support_ticket_statuses").update(payload).eq("id", payload.id).select().single()
      : await supabase.from("support_ticket_statuses").insert(payload).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("support_ticket_statuses").delete().eq("id", data.id).eq("is_system", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =================== Conversations ===================
const ListConvInput = z.object({
  inboxId: z.string().uuid().nullable().optional(),
  shopId: z.string().uuid().nullable().optional(),
  statusKey: z.string().nullable().optional(),
  unidentifiedOnly: z.boolean().optional(),
  search: z.string().max(200).nullable().optional(),
});
export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListConvInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("support_conversations")
      .select("id,inbox_id,shop_id,customer_id,subject,status_id,linked_order_id,is_unidentified,last_message_at,last_message_from,unread_count,first_response_at,first_customer_message_at,first_response_seconds")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (data.inboxId) q = q.eq("inbox_id", data.inboxId);
    if (data.shopId) q = q.eq("shop_id", data.shopId);
    if (data.unidentifiedOnly) q = q.eq("is_unidentified", true);
    const { data: convs, error } = await q;
    if (error) throw new Error(error.message);

    const custIds = Array.from(new Set((convs ?? []).map((c: any) => c.customer_id)));
    const [{ data: customers }, { data: lastMsgs }] = await Promise.all([
      custIds.length ? supabase.from("support_customers").select("id,email,name,priority_tag").in("id", custIds) : Promise.resolve({ data: [] as any[] }),
      (convs ?? []).length
        ? supabase.from("support_messages").select("conversation_id,body_text,direction,sent_at")
            .in("conversation_id", (convs ?? []).map((c: any) => c.id))
            .order("sent_at", { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const custMap = new Map((customers ?? []).map((c: any) => [c.id, c]));
    const previewMap = new Map<string, any>();
    for (const m of lastMsgs ?? []) {
      if (!previewMap.has(m.conversation_id)) previewMap.set(m.conversation_id, m);
    }

    let statusFilterId: string | null = null;
    if (data.statusKey) {
      const { data: st } = await supabase.from("support_ticket_statuses").select("id").eq("user_id", userId).eq("system_key", data.statusKey).maybeSingle();
      statusFilterId = st?.id ?? null;
    }

    const search = (data.search ?? "").trim().toLowerCase();
    let items = (convs ?? []).map((c: any) => ({
      ...c,
      customer: custMap.get(c.customer_id) ?? null,
      preview: previewMap.get(c.id)?.body_text?.slice(0, 140) ?? "",
    }));
    if (statusFilterId) items = items.filter((c: any) => c.status_id === statusFilterId);
    if (search) items = items.filter((c: any) =>
      (c.customer?.email ?? "").toLowerCase().includes(search) ||
      (c.customer?.name ?? "").toLowerCase().includes(search) ||
      (c.subject ?? "").toLowerCase().includes(search) ||
      (c.preview ?? "").toLowerCase().includes(search)
    );
    return { conversations: items };
  });

export const getConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: conv, error } = await supabase
      .from("support_conversations").select("*").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!conv) throw new Error("Conversa não encontrada");

    const [{ data: messages }, { data: customer }, { data: shop }] = await Promise.all([
      supabase.from("support_messages").select("*").eq("conversation_id", conv.id).order("sent_at"),
      supabase.from("support_customers").select("*").eq("id", conv.customer_id).maybeSingle(),
      supabase.from("shops").select("id,name").eq("id", conv.shop_id).maybeSingle(),
    ]);

    // Customer orders
    const { data: orders } = await supabase
      .from("shop_orders")
      .select("id,order_number,external_id,order_date,revenue,payment_status,shipped_at,delivered_at,problem_at,shop_id")
      .eq("user_id", userId)
      .order("order_date", { ascending: false })
      .limit(20);
    const custEmail = (customer as any)?.email?.toLowerCase();
    // Orders are not strictly tied by email column, so try linked_order_id first
    let linkedOrder: any = null;
    if (conv.linked_order_id) {
      linkedOrder = (orders ?? []).find((o: any) => o.id === conv.linked_order_id) ?? null;
      if (!linkedOrder) {
        const { data: o } = await supabase.from("shop_orders").select("id,order_number,external_id,order_date,revenue,payment_status,shipped_at,delivered_at,problem_at,shop_id").eq("id", conv.linked_order_id).maybeSingle();
        linkedOrder = o ?? null;
      }
    }

    // Mark as read
    await supabase.from("support_conversations").update({ unread_count: 0 }).eq("id", conv.id);

    return {
      conversation: conv,
      messages: messages ?? [],
      customer: customer ?? null,
      shop: shop ?? null,
      linkedOrder,
      customerOrders: orders ?? [],
      _custEmail: custEmail,
    };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    conversationId: z.string().uuid(),
    body: z.string().min(1).max(20000),
    internalNote: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const { data: conv, error: cerr } = await supabase
      .from("support_conversations").select("*").eq("id", data.conversationId).eq("user_id", userId).maybeSingle();
    if (cerr) throw new Error(cerr.message);
    if (!conv) throw new Error("Conversa não encontrada");

    const direction = data.internalNote ? "internal_note" : "outbound";
    const now = new Date().toISOString();
    const fromEmail = (claims as any)?.email ?? null;
    const fromName = (claims as any)?.user_metadata?.full_name ?? null;

    // 1) Insert agent message
    const { data: msg, error: merr } = await supabase.from("support_messages").insert({
      user_id: userId,
      conversation_id: conv.id,
      direction,
      from_email: fromEmail,
      from_name: fromName,
      body_text: data.body,
      sent_at: now,
      is_read: true,
      status: data.internalNote ? "delivered" : "sending",
    }).select("id").single();
    if (merr) throw new Error(merr.message);

    if (data.internalNote) return { ok: true };

    // 2) Bump conversation
    const updates: any = { last_message_at: now, last_message_from: "agent" };
    if (!conv.first_response_at && conv.first_customer_message_at) {
      updates.first_response_at = now;
      updates.first_response_seconds = Math.round((Date.parse(now) - Date.parse(conv.first_customer_message_at)) / 1000);
    }
    await supabase.from("support_conversations").update(updates).eq("id", conv.id);

    // 3) Build outbound: recipient = customer email, threading from last inbound
    const { data: customer } = await supabaseAdmin.from("support_customers")
      .select("email").eq("id", conv.customer_id).maybeSingle();
    const { data: lastInbound } = await supabaseAdmin.from("support_messages")
      .select("external_message_id,references_header,subject")
      .eq("conversation_id", conv.id).eq("direction", "inbound")
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();

    const to = customer?.email ? [customer.email] : [];
    const subject = (conv.subject || lastInbound?.subject || "(sem assunto)").replace(/^(Re:\s*)+/i, "");
    const inReplyTo = lastInbound?.external_message_id ?? null;
    const references = lastInbound
      ? [(lastInbound.references_header ?? ""), lastInbound.external_message_id ?? ""].filter(Boolean).join(" ")
      : null;

    // 4) Enqueue
    const { data: queued } = await supabaseAdmin.from("support_outbound_queue").insert({
      user_id: userId,
      inbox_id: conv.inbox_id,
      conversation_id: conv.id,
      message_id: msg.id,
      to_emails: to,
      subject: `Re: ${subject}`,
      body_text: data.body,
      body_html: `<div style="white-space:pre-wrap">${data.body.replace(/[<&>]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</div>`,
      in_reply_to: inReplyTo,
      references_header: references,
      status: "pending",
    }).select("id").single();

    // 5) Dispatch to worker (fire-and-forget; worker will mark sent via webhook or we'll mark below)
    const workerUrl = process.env.MAIL_WORKER_URL;
    const workerSecret = process.env.MAIL_WORKER_SHARED_SECRET;
    if (workerUrl && workerSecret && queued?.id) {
      try {
        const res = await fetch(`${workerUrl.replace(/\/$/, "")}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-worker-secret": workerSecret },
          body: JSON.stringify({ queue_id: queued.id }),
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          const err = json.error || `Worker ${res.status}`;
          await supabaseAdmin.from("support_outbound_queue").update({ status: "error", last_error: err, attempts: 1 }).eq("id", queued.id);
          await supabaseAdmin.from("support_messages").update({ status: "error", error_message: err }).eq("id", msg.id);
          return { ok: false, error: err };
        }
        await supabaseAdmin.from("support_outbound_queue").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", queued.id);
        await supabaseAdmin.from("support_messages").update({ status: "sent" }).eq("id", msg.id);
      } catch (e: any) {
        await supabaseAdmin.from("support_outbound_queue").update({ status: "error", last_error: String(e?.message ?? e), attempts: 1 }).eq("id", queued.id);
        await supabaseAdmin.from("support_messages").update({ status: "error", error_message: String(e?.message ?? e) }).eq("id", msg.id);
        return { ok: false, error: String(e?.message ?? e) };
      }
    } else {
      // No worker yet — leave as pending; UI will show "aguardando worker"
      await supabaseAdmin.from("support_messages").update({ status: "queued", error_message: "Worker de email não configurado" }).eq("id", msg.id);
    }

    return { ok: true };
  });

export const updateConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    status_id: z.string().uuid().nullable().optional(),
    linked_order_id: z.string().uuid().nullable().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...rest } = data;
    const { error } = await supabase.from("support_conversations").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =================== Customer priority ===================
export const updateCustomerPriority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    priority_tag: z.enum(PRIORITY_TAGS).nullable(),
    notes: z.string().max(2000).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...rest } = data;
    const { error } = await supabase.from("support_customers").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =================== Templates ===================
export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.from("support_reply_templates").select("*")
      .eq("user_id", userId).order("position").order("created_at");
    if (error) throw new Error(error.message);
    return { templates: data ?? [] };
  });

const TemplateInput = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(10000),
  shortcut: z.string().max(40).nullable().optional(),
  position: z.number().int().optional(),
});
export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TemplateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload: any = { ...data, user_id: userId };
    const { error, data: row } = payload.id
      ? await supabase.from("support_reply_templates").update(payload).eq("id", payload.id).select().single()
      : await supabase.from("support_reply_templates").insert(payload).select().single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("support_reply_templates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// =================== Dashboard metrics ===================
export const getSupportMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: convs }, { data: statuses }, { data: inboxes }] = await Promise.all([
      supabase.from("support_conversations").select("id,inbox_id,shop_id,status_id,last_message_at,last_message_from,first_response_seconds,created_at").eq("user_id", userId),
      supabase.from("support_ticket_statuses").select("id,system_key,name").eq("user_id", userId),
      supabase.from("support_inboxes").select("id,sla_critical_hours,sla_warning_hours").eq("user_id", userId),
    ]);
    const resolvedIds = new Set((statuses ?? []).filter((s: any) => s.system_key === "resolved").map((s: any) => s.id));
    const inboxMap = new Map((inboxes ?? []).map((i: any) => [i.id, i]));
    const now = Date.now();
    let open = 0, waiting = 0, overdue = 0, resolvedToday = 0;
    const frSeconds: number[] = [];
    const volumeByShop: Record<string, number> = {};
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const c of convs ?? []) {
      const isResolved = c.status_id && resolvedIds.has(c.status_id);
      if (!isResolved) {
        open += 1;
        if (c.last_message_from === "customer") {
          waiting += 1;
          const inb = inboxMap.get(c.inbox_id);
          const critical = (inb as any)?.sla_critical_hours ?? 12;
          const age = (now - new Date(c.last_message_at).getTime()) / 36e5;
          if (age >= critical) overdue += 1;
        }
      } else if (c.last_message_at?.slice(0, 10) === todayStr) {
        resolvedToday += 1;
      }
      if (c.first_response_seconds) frSeconds.push(c.first_response_seconds);
      volumeByShop[c.shop_id] = (volumeByShop[c.shop_id] ?? 0) + 1;
    }
    const avgFirstResponse = frSeconds.length ? Math.round(frSeconds.reduce((a, b) => a + b, 0) / frSeconds.length) : null;
    return { open, waiting, overdue, resolvedToday, avgFirstResponse, volumeByShop };
  });

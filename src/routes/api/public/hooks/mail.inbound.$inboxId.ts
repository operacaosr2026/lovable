import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { timingSafeEqualString } from "@/lib/cron-auth";

// Worker POSTs each parsed email here.
// Auth: ?secret=<inbox.webhook_secret> OR header x-inbox-secret.

const Payload = z.object({
  message_id: z.string().min(1).max(998),
  in_reply_to: z.string().max(998).nullable().optional(),
  references: z.string().max(8000).nullable().optional(),
  from_email: z.string().email().max(320),
  from_name: z.string().max(255).nullable().optional(),
  to_emails: z.array(z.string().email()).default([]),
  cc_emails: z.array(z.string().email()).default([]),
  subject: z.string().max(998).nullable().optional(),
  body_text: z.string().max(200_000).default(""),
  body_html: z.string().max(500_000).nullable().optional(),
  sent_at: z.string().datetime().optional(),
  uid: z.number().int().nonnegative().optional(),
  attachments: z.array(z.object({
    filename: z.string().max(255),
    content_type: z.string().max(120).optional(),
    size: z.number().int().nonnegative().optional(),
    url: z.string().url().max(2000).optional(),
  })).default([]),
});

export const Route = createFileRoute("/api/public/hooks/mail/inbound/$inboxId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const url = new URL(request.url);
        const provided = url.searchParams.get("secret") || request.headers.get("x-inbox-secret") || "";
        const inboxId = params.inboxId;

        const { data: inbox, error: ierr } = await supabaseAdmin
          .from("support_inboxes")
          .select("id,user_id,shop_id,email_address,webhook_secret")
          .eq("id", inboxId).maybeSingle();
        if (ierr || !inbox) return new Response("Inbox not found", { status: 404 });
        if (!provided || !(inbox as any).webhook_secret || !timingSafeEqualString(provided, (inbox as any).webhook_secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: any;
        try { body = Payload.parse(await request.json()); }
        catch (e: any) {
          console.error("mail.inbound invalid payload", inboxId, e);
          return new Response("Invalid payload", { status: 400 });
        }

        const sentAt = body.sent_at ?? new Date().toISOString();
        const fromEmail = body.from_email.toLowerCase();

        // 1) Customer (find or create per user_id + email)
        let { data: customer } = await supabaseAdmin.from("support_customers")
          .select("id").eq("user_id", inbox.user_id).eq("email", fromEmail).maybeSingle();
        if (!customer) {
          const ins = await supabaseAdmin.from("support_customers").insert({
            user_id: inbox.user_id, email: fromEmail, name: body.from_name ?? null,
          }).select("id").single();
          if (ins.error) {
            console.error("mail.inbound customer insert failed", inboxId, ins.error);
            return new Response("Internal error", { status: 500 });
          }
          customer = ins.data;
        }

        // 2) Threading
        const refIds = (body.references ?? "").split(/\s+/).filter(Boolean).slice(-10);
        const lookupIds = [body.in_reply_to, ...refIds].filter(Boolean) as string[];
        let conv: any = null;
        if (lookupIds.length) {
          const { data: matchMsg } = await supabaseAdmin
            .from("support_messages")
            .select("conversation_id")
            .in("external_message_id", lookupIds).limit(1).maybeSingle();
          if (matchMsg?.conversation_id) {
            const { data: c } = await supabaseAdmin
              .from("support_conversations").select("*").eq("id", matchMsg.conversation_id).maybeSingle();
            conv = c;
          }
        }
        if (!conv) {
          // open status
          const { data: openSt } = await supabaseAdmin.from("support_ticket_statuses")
            .select("id").eq("user_id", inbox.user_id).eq("system_key", "open").maybeSingle();
          const ins = await supabaseAdmin.from("support_conversations").insert({
            user_id: inbox.user_id, inbox_id: inbox.id, shop_id: inbox.shop_id,
            customer_id: customer.id, subject: body.subject ?? null,
            status_id: openSt?.id ?? null,
            is_unidentified: true,
            thread_key: body.message_id,
            last_message_at: sentAt, last_message_from: "customer",
            first_customer_message_at: sentAt,
            unread_count: 1,
          }).select("*").single();
          if (ins.error) {
            console.error("mail.inbound conversation insert failed", inboxId, ins.error);
            return new Response("Internal error", { status: 500 });
          }
          conv = ins.data;
        }

        // 3) Insert message (idempotent via unique conv + external_message_id)
        const { error: merr } = await supabaseAdmin.from("support_messages").insert({
          user_id: inbox.user_id,
          conversation_id: conv.id,
          direction: "inbound",
          from_email: fromEmail,
          from_name: body.from_name ?? null,
          to_emails: body.to_emails,
          cc_emails: body.cc_emails,
          subject: body.subject ?? null,
          body_text: body.body_text,
          body_html: body.body_html ?? null,
          external_message_id: body.message_id,
          in_reply_to: body.in_reply_to ?? null,
          references_header: body.references ?? null,
          attachments: body.attachments,
          sent_at: sentAt,
          is_read: false,
          status: "delivered",
        });
        if (merr && !/duplicate key/i.test(merr.message)) {
          console.error("mail.inbound message insert failed", inboxId, merr);
          return new Response("Internal error", { status: 500 });
        }

        // 4) Bump conversation
        await supabaseAdmin.from("support_conversations").update({
          last_message_at: sentAt,
          last_message_from: "customer",
          unread_count: (conv.unread_count ?? 0) + 1,
          first_customer_message_at: conv.first_customer_message_at ?? sentAt,
        }).eq("id", conv.id);

        // 5) Inbox last_uid / last_poll
        if (typeof body.uid === "number") {
          await supabaseAdmin.from("support_inboxes").update({
            last_uid_seen: body.uid,
            last_sync_at: new Date().toISOString(),
          }).eq("id", inbox.id);
        }

        return Response.json({ ok: true, conversation_id: conv.id });
      },
    },
  },
});

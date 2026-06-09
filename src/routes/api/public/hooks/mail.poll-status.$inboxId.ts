import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Payload = z.object({
  status: z.enum(["ok", "error"]),
  error: z.string().max(2000).nullable().optional(),
  last_uid_seen: z.number().int().nonnegative().nullable().optional(),
  connection_status: z.enum(["connected", "disconnected", "error"]).optional(),
});

export const Route = createFileRoute("/api/public/hooks/mail/poll-status/$inboxId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const url = new URL(request.url);
        const provided = url.searchParams.get("secret") || request.headers.get("x-inbox-secret") || "";
        const { data: inbox } = await supabaseAdmin
          .from("support_inboxes")
          .select("id,webhook_secret").eq("id", params.inboxId).maybeSingle();
        if (!inbox) return new Response("Not found", { status: 404 });
        if (!provided || provided !== (inbox as any).webhook_secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        let body: any;
        try { body = Payload.parse(await request.json()); }
        catch (e: any) { return new Response(`Invalid: ${e.message}`, { status: 400 }); }

        const upd: any = {
          last_poll_at: new Date().toISOString(),
          last_poll_status: body.status,
          last_poll_error: body.status === "error" ? (body.error ?? null) : null,
        };
        if (body.last_uid_seen != null) upd.last_uid_seen = body.last_uid_seen;
        if (body.connection_status) upd.connection_status = body.connection_status;
        if (body.status === "ok") { upd.last_sync_at = new Date().toISOString(); upd.last_error = null; }
        else if (body.error) upd.last_error = body.error;

        await supabaseAdmin.from("support_inboxes").update(upd).eq("id", inbox.id);
        return Response.json({ ok: true });
      },
    },
  },
});

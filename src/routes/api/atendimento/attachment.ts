import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveWorkspaceAccess } from "@/integrations/supabase/workspace-middleware";
import { getZohoAccount, zohoRaw } from "@/lib/zoho-mail.server";

// Download de anexo de e-mail do Atendimento. A tela chama com fetch + o token
// da sessão (Authorization: Bearer) e salva o arquivo; repassa direto do Zoho.
export const Route = createFileRoute("/api/atendimento/attachment")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const { data: u } = token ? await supabaseAdmin.auth.getUser(token) : { data: { user: null } };
        if (!u.user) return new Response("Unauthorized", { status: 401 });
        const { role, ownerId, permissions } = await resolveWorkspaceAccess(supabaseAdmin, u.user.id);
        if (role !== "admin" && !permissions.some((p) => p.section === "atendimento")) return new Response("Forbidden", { status: 403 });

        const q = new URL(request.url).searchParams;
        const id = q.get("message") ?? "";
        const attachmentId = q.get("attachment") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[\w.-]+$/.test(attachmentId)) return new Response("Bad Request", { status: 400 });
        const { data: msg } = await supabaseAdmin.from("support_messages").select("message_id,folder_id")
          .eq("id", id).eq("owner_id", ownerId).maybeSingle();
        const acc = await getZohoAccount(ownerId);
        if (!msg || !acc?.account_id) return new Response("Not Found", { status: 404 });

        const res = await zohoRaw(acc, `/api/accounts/${acc.account_id}/folders/${msg.folder_id}/messages/${msg.message_id}/attachments/${attachmentId}`);
        if (!res.ok) return new Response(`Zoho: HTTP ${res.status}`, { status: 502 });
        return new Response(res.body, {
          headers: {
            "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});

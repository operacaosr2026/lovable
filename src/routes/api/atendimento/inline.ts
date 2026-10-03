import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveWorkspaceAccess } from "@/integrations/supabase/workspace-middleware";
import { getZohoAccount, zohoRaw } from "@/lib/zoho-mail.server";

// Imagem colada no corpo do e-mail (inline). No HTML do Zoho ela vem como
// "/mail/ImageDisplay?...&cid=..." — endereço que só abre logado no Zoho. A tela
// busca aqui (fetch + token da sessão) e mostra; repassa direto do Zoho.
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };

export const Route = createFileRoute("/api/atendimento/inline")({
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
        const cid = q.get("cid") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[\w.@+-]{1,200}$/.test(cid)) return new Response("Bad Request", { status: 400 });
        const { data: msg } = await supabaseAdmin.from("support_messages").select("message_id,folder_id")
          .eq("id", id).eq("owner_id", ownerId).maybeSingle();
        const acc = await getZohoAccount(ownerId);
        if (!msg || !acc?.account_id) return new Response("Not Found", { status: 404 });

        const res = await zohoRaw(acc, `/api/accounts/${acc.account_id}/folders/${msg.folder_id}/messages/${msg.message_id}/inline?contentId=${encodeURIComponent(cid)}`);
        if (!res.ok) return new Response(`Zoho: HTTP ${res.status}`, { status: 502 });
        const ext = (q.get("f") ?? "").split(".").pop()?.toLowerCase() ?? "";
        return new Response(res.body, {
          headers: { "Content-Type": TYPES[ext] ?? "image/png", "Cache-Control": "private, max-age=3600" },
        });
      },
    },
  },
});

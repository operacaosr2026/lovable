import { createServerFn } from "@tanstack/react-start";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";

// Números do menu lateral: tarefas não concluídas e e-mails esperando resposta.
// null = a pessoa não tem acesso àquela aba (não mostra o número).
export const getNavBadges = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const can = (section: string) => context.role === "admin" || context.permissions.some((p) => p.section === section);

    const [tarefas, atendimento] = await Promise.all([
      can("tarefas")
        ? supabaseAdmin.from("tasks").select("id", { count: "exact", head: true })
            .eq("user_id", context.ownerId).neq("status", "concluida")
            .then(({ count }) => count ?? 0)
        : null,
      // Não respondido = conversa em aberto cuja última mensagem é do cliente.
      can("atendimento")
        ? selectAll<{ last_inbound_at: string | null; last_outbound_at: string | null }>(
            supabaseAdmin.from("support_conversations").select("last_inbound_at,last_outbound_at")
              .eq("owner_id", context.ownerId).neq("status", "resolvido").not("last_inbound_at", "is", null),
          ).then(({ data }) => (data ?? []).filter((c) => !c.last_outbound_at || c.last_inbound_at! > c.last_outbound_at).length)
        : null,
    ]);
    return { tarefas, atendimento };
  });

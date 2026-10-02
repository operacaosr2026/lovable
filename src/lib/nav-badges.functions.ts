import { createServerFn } from "@tanstack/react-start";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { companyShopIdsForMonth } from "@/lib/company-goals.server";
import { isoTodayUS } from "@/lib/timezone";

// Números do menu lateral: tarefas não concluídas, e-mails esperando resposta,
// chargebacks aguardando resposta (lojas ativas) e dicas em "Agora" na Inteligência.
// null = a pessoa não tem acesso àquela aba (não mostra o número).
export const getNavBadges = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const can = (section: string) => context.role === "admin" || context.permissions.some((p) => p.section === section);

    const [tarefas, atendimento, chargebacks, inteligencia] = await Promise.all([
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
      // Lojas ativas = grupos ativos (mesma regra da aba Chargebacks).
      can("chargebacks")
        ? companyShopIdsForMonth(context.ownerId, `${isoTodayUS().slice(0, 7)}-01`).then((ids) => ids.length
            ? supabaseAdmin.from("shop_order_disputes").select("id", { count: "exact", head: true })
                .eq("user_id", context.ownerId).in("shop_id", ids).eq("status", "needs_response")
                .then(({ count }) => count ?? 0)
            : 0).catch(() => null)
        : null,
      // Dicas da análise mais recente ainda sem decisão (aba Agora).
      can("consultor")
        ? supabaseAdmin.from("consultant_reports").select("result,tips_status").eq("user_id", context.ownerId)
            .order("created_at", { ascending: false }).limit(1).maybeSingle()
            .then(({ data }) => {
              if (!data) return 0;
              const status = (data.tips_status ?? {}) as Record<string, unknown>;
              return (((data.result as any)?.dicas ?? []) as unknown[]).filter((_, i) => !status[String(i)]).length;
            })
        : null,
    ]);
    return { tarefas, atendimento, chargebacks, inteligencia };
  });

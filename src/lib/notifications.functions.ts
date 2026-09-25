import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshSystemNotifications } from "@/lib/notifications.server";
import { isoTodayUS, US_TIME_ZONE } from "@/lib/timezone";
import { broadcast } from "@/lib/realtime.server";

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId, userId } = context;
    // Nunca deixa o sino quebrar a tela: se a checagem falhar, mostra o que já tem.
    try { await refreshSystemNotifications(ownerId); } catch (e) { console.error("refreshSystemNotifications", e); }
    const { data, error } = await supabaseAdmin.from("app_notifications")
      .select("id,key,level,title,body,link,created_at,updated_at,read_at")
      .eq("user_id", ownerId)
      // Aviso com destinatário só aparece pra essa pessoa.
      .or(`target_user_id.is.null,target_user_id.eq.${userId}`)
      .is("resolved_at", null)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    // Quais já viraram tarefa (aberta) — o sino mostra "Tarefa criada" em vez do botão.
    const keys = (data ?? []).map((n) => n.key);
    const { data: linked } = keys.length
      ? await supabaseAdmin.from("tasks").select("source_key").eq("user_id", ownerId)
          .in("source_key", keys).neq("status", "concluida")
      : { data: [] as { source_key: string | null }[] };
    const withTask = new Set((linked ?? []).map((t) => t.source_key));
    // Aviso de tarefa concluída é só informativo — não oferece "Criar tarefa".
    return (data ?? []).map(({ key, ...n }) => ({ ...n, has_task: withTask.has(key), can_task: !key.startsWith("task_done:") }));
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).max(100) }).parse(d))
  .handler(async ({ context, data }) => {
    if (!data.ids.length) return { ok: true };
    const { error } = await supabaseAdmin.from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", context.ownerId).in("id", data.ids).is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Some da lista até o problema ser resolvido e voltar a acontecer.
export const dismissNotification = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("app_notifications")
      .update({ dismissed_at: now, read_at: now })
      .eq("user_id", context.ownerId).eq("id", data.id);
    if (error) throw new Error(error.message);
    await broadcast(context.ownerId, "notifications");
    return { ok: true };
  });

// "Limpar" do sino: dispensa tudo que está na lista. Cada aviso só volta se o
// problema for resolvido e acontecer de novo. Tarefas já criadas não mudam.
export const dismissAllNotifications = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("app_notifications")
      .update({ dismissed_at: now, read_at: now })
      .eq("user_id", context.ownerId).is("resolved_at", null).is("dismissed_at", null)
      .or(`target_user_id.is.null,target_user_id.eq.${context.userId}`);
    if (error) throw new Error(error.message);
    await broadcast(context.ownerId, "notifications");
    return { ok: true };
  });

// ---------- Notificação → tarefa ----------

// Data (YYYY-MM-DD) no fuso de Nova York, igual ao resto do sistema.
function usDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: US_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));
}

const AREA_BY_PREFIX: [string, string][] = [
  ["dispute:", "atendimento"],
  ["meta_token:", "marketing"],
  ["meta_account:", "marketing"],
  ["shopify_sync:", "lojas"],
  ["shopify_refunds:", "lojas"],
  ["track123:", "pedidos"],
];

// Cria (uma vez só) a tarefa de uma notificação do sino, já preenchida:
// título/descrição do aviso, prioridade pela gravidade, área pelo tipo,
// vencimento pelo prazo real quando existe (disputa, token da Meta), e quem
// clicou como responsável.
export const createTaskFromNotification = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId, userId } = context;
    const { data: n, error } = await supabaseAdmin.from("app_notifications")
      .select("key,level,title,body").eq("user_id", ownerId).eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!n) throw new Error("Notificação não encontrada.");

    // Com a tarefa criada, o aviso sai do sino (a tarefa vira o lembrete). Fica
    // dispensado — não volta sozinho enquanto o problema continuar.
    const dismiss = () => supabaseAdmin.from("app_notifications")
      .update({ dismissed_at: new Date().toISOString(), read_at: new Date().toISOString() }).eq("user_id", ownerId).eq("id", data.id);

    const { data: existing } = await supabaseAdmin.from("tasks").select("id")
      .eq("user_id", ownerId).eq("source_key", n.key).neq("status", "concluida").limit(1).maybeSingle();
    if (existing) {
      await dismiss();
      await broadcast(ownerId, "notifications");
      return { id: existing.id as string, created: false };
    }

    let due = isoTodayUS();
    if (n.key.startsWith("dispute:")) {
      const { data: d } = await supabaseAdmin.from("shop_order_disputes").select("evidence_due_by")
        .eq("user_id", ownerId).eq("shopify_dispute_id", n.key.slice("dispute:".length)).maybeSingle();
      if (d?.evidence_due_by) due = usDate(d.evidence_due_by);
    } else if (n.key.startsWith("meta_token:")) {
      const { data: t } = await supabaseAdmin.from("shop_meta_tokens").select("token_expires_at")
        .eq("user_id", ownerId).eq("shop_id", n.key.slice("meta_token:".length)).maybeSingle();
      if (t?.token_expires_at) due = usDate(t.token_expires_at);
    }

    const area = AREA_BY_PREFIX.find(([p]) => n.key.startsWith(p))?.[1] ?? "gestao";
    const { data: task, error: insErr } = await supabaseAdmin.from("tasks").insert({
      user_id: ownerId,
      created_by: userId,
      assignee_id: userId,
      title: n.title.slice(0, 200),
      description: n.body,
      area,
      priority: n.level === "error" ? "alta" : n.level === "warning" ? "media" : "baixa",
      status: "pendente",
      due_date: due,
      source_key: n.key,
    }).select("id").single();
    if (insErr) throw new Error(insErr.message);
    await dismiss();
    await Promise.all([broadcast(ownerId, "tasks"), broadcast(ownerId, "notifications")]);
    return { id: task.id as string, created: true };
  });

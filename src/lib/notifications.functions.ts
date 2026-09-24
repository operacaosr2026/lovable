import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshSystemNotifications } from "@/lib/notifications.server";

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;
    // Nunca deixa o sino quebrar a tela: se a checagem falhar, mostra o que já tem.
    try { await refreshSystemNotifications(ownerId); } catch (e) { console.error("refreshSystemNotifications", e); }
    const { data, error } = await supabaseAdmin.from("app_notifications")
      .select("id,level,title,body,link,created_at,updated_at,read_at")
      .eq("user_id", ownerId)
      .is("resolved_at", null)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
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
    return { ok: true };
  });

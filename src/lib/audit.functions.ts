import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PAGE_SIZE = 50;

// Configurações > Auditoria (só admin): ações registradas pelo auditMiddleware.
export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    page: z.number().int().min(0).default(0),
    actor_id: z.string().uuid().nullable().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    q: z.string().max(100).nullable().optional(),
  }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    if (context.role !== "admin") throw new Error("Só o administrador vê a auditoria.");
    const { ownerId } = context;

    let q = supabaseAdmin.from("audit_log")
      .select("id,actor_id,actor_email,action,label,data,created_at", { count: "exact" })
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .range(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE - 1);
    if (data.actor_id) q = q.eq("actor_id", data.actor_id);
    if (data.from) q = q.gte("created_at", `${data.from}T00:00:00Z`);
    if (data.to) q = q.lte("created_at", `${data.to}T23:59:59Z`);
    if (data.q?.trim()) {
      const term = data.q.trim().replace(/[%,()]/g, " ");
      q = q.or(`label.ilike.%${term}%,actor_email.ilike.%${term}%,action.ilike.%${term}%`);
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    // Pessoas pro filtro: quem aparece na auditoria do workspace.
    const { data: actors } = await supabaseAdmin.from("audit_log")
      .select("actor_id,actor_email").eq("owner_id", ownerId)
      .order("created_at", { ascending: false }).limit(2000);
    const people = new Map<string, string>();
    for (const a of (actors ?? []) as any[]) if (!people.has(a.actor_id)) people.set(a.actor_id, a.actor_email ?? a.actor_id);

    return {
      rows: rows ?? [],
      total: count ?? 0,
      pageSize: PAGE_SIZE,
      people: [...people.entries()].map(([id, email]) => ({ id, email })),
    };
  });

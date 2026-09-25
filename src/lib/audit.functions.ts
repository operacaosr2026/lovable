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
      // Busca também pelo nome da pessoa (o nome não fica no registro, só no perfil).
      const { data: byName } = await supabaseAdmin.from("profiles").select("id").ilike("full_name", `%${term}%`).limit(50);
      const ids = ((byName ?? []) as any[]).map((p) => p.id as string);
      const orParts = [`label.ilike.%${term}%`, `actor_email.ilike.%${term}%`, `action.ilike.%${term}%`];
      if (ids.length) orParts.push(`actor_id.in.(${ids.join(",")})`);
      q = q.or(orParts.join(","));
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    // Pessoas pro filtro: toda a equipe (dono + membros), mesmo quem ainda não
    // fez nenhuma ação — mais quem já apareceu na auditoria e saiu da equipe.
    const [{ data: links }, { data: actors }] = await Promise.all([
      supabaseAdmin.from("workspace_members").select("member_id").eq("owner_id", ownerId),
      supabaseAdmin.from("audit_log").select("actor_id,actor_email").eq("owner_id", ownerId)
        .order("created_at", { ascending: false }).limit(2000),
    ]);
    const teamIds = [ownerId, ...((links ?? []) as any[]).map((l) => l.member_id as string)];
    const actorIds = ((actors ?? []) as any[]).map((a) => a.actor_id as string);
    const allIds = [...new Set([...teamIds, ...actorIds, ...((rows ?? []) as any[]).map((r) => r.actor_id as string)])];

    // Nome de cada pessoa: perfil (full_name) → nome do cadastro → e-mail.
    const { data: profs } = await supabaseAdmin.from("profiles").select("id,full_name").in("id", allIds);
    const profileName = new Map(((profs ?? []) as any[]).map((p) => [p.id as string, (p.full_name as string | null)?.trim() || null]));
    const nameOf = new Map<string, string>();
    await Promise.all(allIds.map(async (id) => {
      let name = profileName.get(id) ?? null;
      let email: string | null = ((actors ?? []) as any[]).find((a) => a.actor_id === id)?.actor_email ?? null;
      if (!name || !email) {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
        name = name || (u?.user?.user_metadata?.full_name as string | undefined)?.trim() || null;
        email = email || u?.user?.email || null;
      }
      nameOf.set(id, name || email || id);
    }));

    const inTeam = new Set(teamIds);
    const people = new Map<string, string>();
    for (const id of teamIds) people.set(id, nameOf.get(id)!);
    for (const id of actorIds) if (!inTeam.has(id)) people.set(id, nameOf.get(id)!);

    return {
      rows: ((rows ?? []) as any[]).map((r) => ({ ...r, actor_name: nameOf.get(r.actor_id) ?? r.actor_email })),
      total: count ?? 0,
      pageSize: PAGE_SIZE,
      people: [...people.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    };
  });

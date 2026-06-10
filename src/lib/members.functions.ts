import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const SECTIONS = [
  "shops",
  "projects",
  "finance",
  "journal",
  "sops",
  "tasks",
  "whiteboard",
  "habits",
  "calendar",
] as const;
export type Section = (typeof SECTIONS)[number];

const PermissionSchema = z.object({
  section: z.enum(SECTIONS),
  resource_id: z.string().uuid().nullable().optional(),
});

// ---------- Current user's access ----------
export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    const role = (roleRow?.role as "admin" | "member") ?? "admin";

    let ownerId: string | null = null;
    const permissions: { section: string; resource_id: string | null }[] = [];

    if (role === "member") {
      const { data: link } = await supabase
        .from("workspace_members")
        .select("owner_id")
        .eq("member_id", userId)
        .maybeSingle();
      ownerId = link?.owner_id ?? null;

      const { data: perms } = await supabase
        .from("member_permissions")
        .select("section,resource_id")
        .eq("member_id", userId);
      for (const p of (perms ?? []) as any[]) {
        permissions.push({ section: p.section, resource_id: p.resource_id });
      }
    }

    return { role, ownerId, permissions };
  });

// ---------- List members + invitations ----------
export const listWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: links } = await supabase
      .from("workspace_members")
      .select("id,member_id,created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });

    const memberIds = (links ?? []).map((l: any) => l.member_id);
    let profiles: Record<string, { full_name: string | null; avatar_url: string | null }> = {};
    let emails: Record<string, string> = {};
    if (memberIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,full_name,avatar_url")
        .in("id", memberIds);
      for (const p of (profs ?? []) as any[]) {
        profiles[p.id] = { full_name: p.full_name, avatar_url: p.avatar_url };
      }
      // emails via admin client (auth.users not readable via PostgREST)
      const emailResults = await Promise.all(memberIds.map(async (id: string) => {
        try {
          const { data } = await supabaseAdmin.auth.admin.getUserById(id);
          return [id, data?.user?.email ?? null] as const;
        } catch {
          return [id, null] as const;
        }
      }));
      for (const [id, email] of emailResults) {
        if (email) emails[id] = email;
      }
    }

    const { data: perms } = await supabase
      .from("member_permissions")
      .select("member_id,section,resource_id")
      .eq("owner_id", userId);
    const permsByMember: Record<string, { section: string; resource_id: string | null }[]> = {};
    for (const p of (perms ?? []) as any[]) {
      (permsByMember[p.member_id] ||= []).push({ section: p.section, resource_id: p.resource_id });
    }

    const members = (links ?? []).map((l: any) => ({
      id: l.id,
      member_id: l.member_id,
      created_at: l.created_at,
      email: emails[l.member_id] ?? null,
      full_name: profiles[l.member_id]?.full_name ?? null,
      avatar_url: profiles[l.member_id]?.avatar_url ?? null,
      permissions: permsByMember[l.member_id] ?? [],
    }));

    // Use admin client because the `token` column is no longer readable
    // by the authenticated role (column SELECT was revoked). Scope strictly
    // by owner_id = userId so the owner only sees their own invitations.
    const { data: invites } = await supabaseAdmin
      .from("member_invitations")
      .select("id,email,token,status,permissions,expires_at,created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });

    return { members, invitations: invites ?? [] };
  });

// ---------- Lists for pickers ----------
export const listOwnerResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [shops, projects, lists, boards, journalPages, sops] = await Promise.all([
      supabase.from("shops").select("id,name").eq("user_id", userId).eq("archived", false).order("name"),
      supabase.from("projects").select("id,name").eq("user_id", userId).eq("archived", false).order("name"),
      supabase.from("task_lists").select("id,name").eq("user_id", userId).order("name"),
      supabase.from("whiteboard_nodes").select("board_id").eq("user_id", userId).limit(0), // boards aren't a separate table
      supabase.from("journal_pages").select("id,title").eq("user_id", userId).is("parent_id", null).order("title"),
      supabase.from("sop_processes").select("id,name").eq("user_id", userId).order("name"),
    ]);
    return {
      shops: (shops.data ?? []) as { id: string; name: string }[],
      projects: (projects.data ?? []) as { id: string; name: string }[],
      tasks: (lists.data ?? []) as { id: string; name: string }[],
      journal: (journalPages.data ?? []).map((p: any) => ({ id: p.id, name: p.title })),
      sops: (sops.data ?? []) as { id: string; name: string }[],
    };
  });

// ---------- Invite a new member ----------
export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        permissions: z.array(PermissionSchema).max(500),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    // Use admin client so the `token` column can be returned to the owner
    // (column SELECT was revoked from the authenticated role).
    const { data: invite, error } = await supabaseAdmin
      .from("member_invitations")
      .insert({
        owner_id: userId,
        email: data.email.toLowerCase().trim(),
        token,
        permissions: data.permissions,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { invitation: invite };
  });

// ---------- Revoke / delete invitation ----------
export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("member_invitations")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Revoke a member ----------
export const revokeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ member_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("member_permissions")
      .delete()
      .eq("owner_id", userId)
      .eq("member_id", data.member_id);
    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("owner_id", userId)
      .eq("member_id", data.member_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Replace member permissions ----------
export const updateMemberPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        member_id: z.string().uuid(),
        permissions: z.array(PermissionSchema).max(500),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // wipe & rewrite
    await supabase
      .from("member_permissions")
      .delete()
      .eq("owner_id", userId)
      .eq("member_id", data.member_id);
    if (data.permissions.length) {
      const rows = data.permissions.map((p) => ({
        owner_id: userId,
        member_id: data.member_id,
        section: p.section,
        resource_id: p.resource_id ?? null,
      }));
      const { error } = await supabase.from("member_permissions").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------- Inspect invitation (public-ish, by token) ----------
export const getInvitationByToken = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().min(10) }).parse(input))
  .handler(async ({ data }) => {
    const { data: invite, error } = await supabaseAdmin
      .from("member_invitations")
      .select("id,email,status,expires_at,owner_id")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invite) return { invitation: null };

    let ownerName: string | null = null;
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", invite.owner_id)
        .maybeSingle();
      ownerName = prof?.full_name ?? null;
    } catch {}

    return {
      invitation: {
        id: invite.id,
        email: invite.email,
        status: invite.status,
        expires_at: invite.expires_at,
        ownerName,
      },
    };
  });

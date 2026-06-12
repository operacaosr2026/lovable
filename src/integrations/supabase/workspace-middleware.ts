import { createMiddleware } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type WorkspacePermission = { section: string; resource_id: string | null };
export type WorkspaceRole = "admin" | "member";

export async function resolveWorkspaceAccess(supabase: SupabaseClient<Database>, userId: string) {
  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  const role: WorkspaceRole = (roleRow?.role as WorkspaceRole) ?? "admin";

  let ownerId = userId;
  const permissions: WorkspacePermission[] = [];

  if (role === "member") {
    const { data: link } = await supabase
      .from("workspace_members")
      .select("owner_id")
      .eq("member_id", userId)
      .maybeSingle();
    if (link?.owner_id) ownerId = link.owner_id;

    const { data: perms } = await supabase
      .from("member_permissions")
      .select("section,resource_id")
      .eq("member_id", userId);
    for (const p of (perms ?? []) as any[]) {
      permissions.push({ section: p.section, resource_id: p.resource_id });
    }
  }

  return { role, ownerId, permissions };
}

// Resolves the workspace owner's user id (and the caller's role/permissions
// within that workspace) so server functions can scope shared data by
// `ownerId` instead of the logged-in user's own id.
export const requireOwnerContext = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { role, ownerId, permissions } = await resolveWorkspaceAccess(context.supabase, context.userId);
    return next({ context: { ...context, role, ownerId, permissions } });
  });

export type SectionResourceFilter = "all" | "none" | string[];

// "all" = unrestricted access to the section (admin, or member granted the
// whole section); "none" = no access at all; string[] = restricted to these
// resource ids.
export function getSectionResourceFilter(
  context: { role: WorkspaceRole; permissions: WorkspacePermission[] },
  section: string,
): SectionResourceFilter {
  if (context.role === "admin") return "all";
  const entries = context.permissions.filter((p) => p.section === section);
  if (!entries.length) return "none";
  if (entries.some((e) => e.resource_id === null)) return "all";
  return entries.map((e) => e.resource_id as string);
}

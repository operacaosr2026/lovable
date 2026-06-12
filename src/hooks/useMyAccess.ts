import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccess, type Section } from "@/lib/members.functions";
import { useAuth } from "@/lib/auth";

export function useMyAccess() {
  const { user } = useAuth();
  const fetchAccess = useServerFn(getMyAccess);
  const q = useQuery({
    queryKey: ["my-access", user?.id],
    queryFn: () => fetchAccess(),
    enabled: !!user,
    staleTime: 60_000,
  });
  // While the access query is loading, default to "member" with no extra
  // permissions so role-gated nav items don't briefly appear and then
  // disappear/shift once the real role resolves (was causing taps on
  // "Configurações" or "Empresa" links to miss after a layout shift).
  const role = q.data?.role ?? "member";
  const permissions = q.data?.permissions ?? [];

  const sectionsAllowed = new Set(permissions.map((p) => p.section));
  const canAccessSection = (s: Section) => role === "admin" || sectionsAllowed.has(s);

  return {
    role,
    ownerId: q.data?.ownerId ?? null,
    permissions,
    canAccessSection,
    isLoading: q.isLoading,
  };
}

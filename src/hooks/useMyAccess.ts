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
  const role = q.data?.role ?? "admin";
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

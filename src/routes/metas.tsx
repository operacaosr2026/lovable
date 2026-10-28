import { createFileRoute, redirect } from "@tanstack/react-router";

// Metas agora é subaba do Gerencial (components/goals/CompanyGoals.tsx); links
// antigos (notificações de meta) caem lá.
export const Route = createFileRoute("/metas")({
  beforeLoad: () => { throw redirect({ to: "/gerencial", search: { tab: "metas" } }); },
});

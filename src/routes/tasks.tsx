import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/tasks")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Tarefas — SRX Growth" }] }),
  component: () => <Outlet />,
});

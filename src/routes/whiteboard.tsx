import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/whiteboard")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Quadro Branco — Orbit" }] }),
  component: () => <Outlet />,
});

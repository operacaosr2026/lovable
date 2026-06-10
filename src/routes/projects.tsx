import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/projects")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Projetos — SRX Growth" },
      { name: "description", content: "Organize seus projetos pessoais e profissionais." },
    ],
  }),
  component: () => <Outlet />,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/shops/grupos")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Grupos — SRX Growth" },
      { name: "description", content: "Gerencie os grupos de ecommerce." },
    ],
  }),
  component: () => <Outlet />,
});

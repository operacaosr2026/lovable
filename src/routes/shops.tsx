import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/shops")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Ecommerce — SRX Growth" },
      { name: "description", content: "Central operacional de ecommerce: lojas e produtos." },
    ],
  }),
  component: () => <Outlet />,
});

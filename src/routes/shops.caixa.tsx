import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/shops/caixa")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Caixa — SRX Growth" },
      { name: "description", content: "Visão consolidada de caixa de todas as lojas conectadas." },
    ],
  }),
  component: () => <Outlet />,
});

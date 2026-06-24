import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/shops/banco-de-lojas")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Banco de Lojas — SRX Growth" },
      { name: "description", content: "Repositório de lojas para referência e análise." },
    ],
  }),
  component: () => <Outlet />,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/shops/products")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Produtos — Orbit" },
      { name: "description", content: "Central operacional dos seus produtos: imagens, criativos, templates e precificação." },
    ],
  }),
  component: () => <Outlet />,
});

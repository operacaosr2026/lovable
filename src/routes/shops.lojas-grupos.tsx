import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/shops/lojas-grupos")({
  component: () => <Outlet />,
});

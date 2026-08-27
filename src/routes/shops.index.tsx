import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/shops/")({
  beforeLoad: () => {
    throw redirect({ to: "/shops/banco-de-lojas", search: { view: "esteira" } });
  },
});

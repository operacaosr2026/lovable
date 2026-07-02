import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/shops/grupos/")({
  beforeLoad: () => {
    throw redirect({ to: "/shops/banco-de-lojas", search: { tab: "grupos" } });
  },
});

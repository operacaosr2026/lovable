import { createFileRoute, redirect } from "@tanstack/react-router";

// O Consultor virou a Inteligência — endereço antigo (link do sino, favoritos).
export const Route = createFileRoute("/consultor")({
  beforeLoad: () => { throw redirect({ to: "/inteligencia" }); },
});

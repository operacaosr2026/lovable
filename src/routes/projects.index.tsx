import { createFileRoute, redirect } from "@tanstack/react-router";

// Projetos agora é subaba do Gerencial (components/projects/ProjectsBoard.tsx).
export const Route = createFileRoute("/projects/")({
  beforeLoad: () => { throw redirect({ to: "/gerencial", search: { tab: "projetos" } }); },
});

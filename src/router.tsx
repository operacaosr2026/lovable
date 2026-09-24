import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Sem padrão, todo dado era considerado velho na hora (staleTime 0): voltar
  // pra uma aba/tela ou voltar o foco pra janela refazia TODAS as buscas da
  // tela — inclusive as consultas ao vivo na Shopify. Com 60s, navegar de volta
  // mostra o que já foi buscado sem refazer. Não deixa dado velho na tela:
  // salvar/editar invalida as consultas (invalidateQueries ignora staleTime) e
  // o tempo real (useRealtimeSync) invalida pedidos/tarefas/avisos quando mudam.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Baixa o código da tela ao passar o mouse no link (antes só no clique).
    defaultPreload: "intent",
  });

  return router;
};

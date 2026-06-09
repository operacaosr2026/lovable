import { createStart, createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
  serverFns: {
    fetch: async (url, init) => {
      const requestInit = init ?? {};
      const headers = new Headers(requestInit.headers);

      if (typeof window !== "undefined") {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (token && !headers.has("authorization")) {
          headers.set("authorization", `Bearer ${token}`);
        }
      }

      return fetch(url, {
        ...requestInit,
        headers,
      });
    },
  },
}));

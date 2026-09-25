import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { recordAudit, shouldAudit } from "@/lib/audit.server";

// Middleware global (src/start.ts): depois de toda ação POST que deu certo,
// registra na auditoria quem fez, o quê e com quais dados. Falha ao registrar
// nunca derruba a ação.
export const auditMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next, data, method, serverFnMeta }) => {
    const result = await next();
    const name = serverFnMeta?.name;
    if (method === "POST" && name && shouldAudit(name)) {
      try {
        await recordAudit(name, data, getRequest()?.headers.get("authorization") ?? null);
      } catch (e) {
        console.error("audit", name, e);
      }
    }
    return result;
  },
);

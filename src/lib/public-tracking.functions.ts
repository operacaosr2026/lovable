import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { lookupPublicTracking, lookupPublicOrder, allowPublicLookup, clientIp } from "@/lib/public-tracking.server";

export type { PublicTracking } from "@/lib/public-tracking.server";

// Mensagem pro cliente (página em inglês) quando passa do limite de tentativas.
export const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a few minutes and try again.";

// Página /track do sistema (sem login). A lógica fica em public-tracking.server.ts,
// a mesma que a página de rastreio da loja usa via /api/public/track.
export const getPublicTracking = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: z.string().trim().min(5).max(50).regex(/^[A-Za-z0-9-]+$/) }).parse(d))
  .handler(({ data }) => lookupPublicTracking(data.code));

export const findPublicOrder = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({
    orderNumber: z.string().trim().min(2).max(30),
    contact: z.string().trim().min(3).max(120),
  }).parse(d))
  .handler(async ({ data }) => {
    if (!(await allowPublicLookup(clientIp(getRequest().headers)))) throw new Error(TOO_MANY_ATTEMPTS);
    return lookupPublicOrder(data);
  });

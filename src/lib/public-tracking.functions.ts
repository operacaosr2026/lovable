import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { lookupPublicTracking, lookupPublicOrder } from "@/lib/public-tracking.server";

export type { PublicTracking } from "@/lib/public-tracking.server";

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
  .handler(({ data }) => lookupPublicOrder(data));

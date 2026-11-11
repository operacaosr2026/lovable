import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { askAssistant } from "@/lib/assistant.server";

// Assistente (chat flutuante) — ver assistant.server.ts.
export const askAssistantFn = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(4000),
    })).min(1).max(30),
  }).parse(d))
  .handler(async ({ context, data }) => {
    // Últimas 20 mensagens, começando por uma do usuário (a API exige).
    let msgs = data.messages.slice(-20);
    while (msgs.length && msgs[0].role !== "user") msgs = msgs.slice(1);
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new Error("Mensagem inválida");
    return askAssistant(context.ownerId, msgs);
  });

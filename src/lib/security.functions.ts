import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Registra um login no histórico (Configurações > Segurança). Chamado só quando
// a pessoa entra de fato (tela de login / convite) — antes era gravado a cada
// aviso "SIGNED_IN" do Supabase, que também dispara ao recarregar a página ou
// voltar pra aba. IP e navegador vêm do servidor: o navegador não sabe o
// próprio IP (a Vercel manda em x-forwarded-for).
export const recordLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const headers = getRequest()?.headers;
    const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || headers?.get("x-real-ip") || null;
    const userAgent = headers?.get("user-agent") ?? null;
    const { error } = await context.supabase.from("login_history").insert({
      user_id: context.userId,
      ip,
      user_agent: userAgent,
    });
    if (error) console.error("recordLogin", error.message);
    return { ok: !error };
  });

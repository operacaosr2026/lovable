import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CLARITY_DAILY_LIMIT, callsUsedToday, fetchClarityForProduct } from "@/lib/clarity.server";

// Clarity do produto (barra no topo de Inteligência › Campanhas): token, buscas
// restantes no dia e "Buscar agora". O token nunca volta pro navegador.

export type ClarityStatus = {
  connected: boolean; token_hint: string | null; last_fetch_at: string | null;
  last_error: string | null; remaining: number; last_day: string | null;
};

async function assertProduct(ownerId: string, productId: string) {
  const { data } = await supabaseAdmin.from("products").select("id").eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
}

export const getProductClarity = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }): Promise<ClarityStatus> => {
    await assertProduct(context.ownerId, data.product_id);
    const [{ data: c }, used, { data: last }] = await Promise.all([
      supabaseAdmin.from("clarity_connections").select("token,last_fetch_at,last_error").eq("product_id", data.product_id).maybeSingle(),
      callsUsedToday([data.product_id]),
      supabaseAdmin.from("clarity_snapshots").select("day").eq("product_id", data.product_id).order("day", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return {
      connected: !!c, token_hint: c ? `…${c.token.slice(-4)}` : null,
      last_fetch_at: c?.last_fetch_at ?? null, last_error: c?.last_error ?? null,
      remaining: Math.max(0, CLARITY_DAILY_LIMIT - (used.get(data.product_id) ?? 0)), last_day: last?.day ?? null,
    };
  });

export const saveProductClarityToken = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), token: z.string().trim().min(20).max(4000).nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context.ownerId, data.product_id);
    if (!data.token) {
      const { error } = await supabaseAdmin.from("clarity_connections").delete().eq("product_id", data.product_id).eq("user_id", context.ownerId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabaseAdmin.from("clarity_connections").upsert(
      { product_id: data.product_id, user_id: context.ownerId, token: data.token, last_error: null, updated_at: new Date().toISOString() },
      { onConflict: "product_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const fetchProductClarityNow = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertProduct(context.ownerId, data.product_id);
    return fetchClarityForProduct(data.product_id, "manual");
  });

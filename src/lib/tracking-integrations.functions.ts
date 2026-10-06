import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runSeventeenTrackSync } from "@/lib/seventeen-track.server";

// Rastreio por loja (17track): modelo do link de rastreio e status do último
// sync. A tabela ainda se chama track123_integrations (nome antigo).

// supabaseAdmin ignora RLS: sem esse filtro, qualquer usuário logado podia ler,
// sobrescrever o link de rastreio ou disparar sync de uma loja de outro
// workspace só passando o shop_id dela.
async function filterOwnedShopIds(ownerId: string, shopIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(shopIds));
  if (!unique.length) return [];
  const { data, error } = await supabaseAdmin
    .from("shops").select("id").eq("user_id", ownerId).in("id", unique);
  if (error) throw new Error(error.message);
  return (data ?? []).map((s: any) => s.id as string);
}

async function assertShopOwnedBy(ownerId: string, shopId: string) {
  const owned = await filterOwnedShopIds(ownerId, [shopId]);
  if (!owned.length) throw new Error("Loja não encontrada ou não pertence a este workspace.");
}

export const getTrackingIntegrations = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ shop_ids: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ context, data }) => {
    const shopIds = await filterOwnedShopIds(context.ownerId, data.shop_ids);
    if (!shopIds.length) return [];
    const { data: rows, error } = await supabaseAdmin
      .from("track123_integrations")
      .select("shop_id,tracking_link_template,last_sync_at,last_sync_status,last_sync_error")
      .eq("user_id", context.ownerId)
      .in("shop_id", shopIds);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Salva o modelo do link de rastreio da loja (cria a linha da loja se não tem —
// loja nova já entra no 17track).
export const upsertTrackingIntegration = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({
    shop_id: z.string().uuid(),
    tracking_link_template: z.string().trim().max(300).nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await assertShopOwnedBy(context.ownerId, data.shop_id);
    const { error } = await supabaseAdmin.from("track123_integrations").upsert({
      user_id: context.ownerId, shop_id: data.shop_id, provider: "17track",
      tracking_link_template: data.tracking_link_template || "",
    }, { onConflict: "shop_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Botão "Atualizar" da aba Rastreamento: busca rastreio novo no 17track na
// hora (das lojas abertas na tela), em vez de esperar o cron de 30 min.
export const syncTrackingForShops = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ shop_ids: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ context, data }) => {
    const shopIds = await filterOwnedShopIds(context.ownerId, data.shop_ids);
    if (!shopIds.length) return { synced: 0, total: 0, errors: [] as string[] };
    const r = await runSeventeenTrackSync({ shopIds, deadline: Date.now() + 50_000 });
    return { synced: r.shops, total: r.shops, errors: r.outOfQuota ? ["17track sem crédito", ...r.errors] : r.errors };
  });

// "Testar" de uma loja nas integrações: roda o sync do 17track só dela.
export const testTrackingSync = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertShopOwnedBy(context.ownerId, data.shop_id);
    const r = await runSeventeenTrackSync({ shopIds: [data.shop_id] });
    if (!r.shops) throw new Error("Loja inativa ou pausada — o rastreio só sincroniza lojas ativas.");
    return {
      updated: r.updated, total: r.orders, status: r.errors.length && !r.updated ? "error" : "ok",
      errorMsg: `${r.updated}/${r.orders} atualizados, ${r.registered} cadastrados agora no 17track` + (r.outOfQuota ? " · SEM CRÉDITO" : "") + (r.errors.length ? ` · último erro: ${r.errors[r.errors.length - 1]}` : ""),
    };
  });

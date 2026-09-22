import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runTrack123Sync } from "@/lib/track123-sync.server";
import { runTrack123McpSync } from "@/lib/track123-mcp-sync.server";

// A api_key nunca volta pro cliente — só um booleano indicando se já tem uma salva.
// mcp_store_uuid não é segredo por si só (só funciona junto com a api_key), então
// esse volta em texto puro pra facilitar conferir/editar.
export const getTrack123Integrations = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ shop_ids: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ data }: any) => {
    if (!data.shop_ids.length) return [];
    const { data: rows, error } = await supabaseAdmin
      .from("track123_integrations")
      .select("shop_id,enabled,api_key,mcp_store_uuid,tracking_link_template,last_sync_at,last_sync_status,last_sync_error")
      .in("shop_id", data.shop_ids);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      shop_id: r.shop_id,
      enabled: r.enabled,
      has_key: Boolean(r.api_key),
      mcp_store_uuid: r.mcp_store_uuid,
      tracking_link_template: r.tracking_link_template,
      last_sync_at: r.last_sync_at,
      last_sync_status: r.last_sync_status,
      last_sync_error: r.last_sync_error,
    }));
  });

export const upsertTrack123Integration = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) =>
    z.object({
      shop_id: z.string().uuid(),
      api_key: z.string().trim().min(1).optional(),
      mcp_store_uuid: z.string().trim().max(64).optional().nullable(),
      tracking_link_template: z.string().trim().max(300).optional().nullable(),
      enabled: z.boolean().optional(),
    }).parse(d)
  )
  .handler(async ({ context, data }: any) => {
    const patch: Record<string, any> = { user_id: context.ownerId, shop_id: data.shop_id };
    if (data.api_key !== undefined) patch.api_key = data.api_key;
    if (data.mcp_store_uuid !== undefined) patch.mcp_store_uuid = data.mcp_store_uuid || null;
    if (data.tracking_link_template !== undefined) patch.tracking_link_template = data.tracking_link_template || null;
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    const { error } = await supabaseAdmin
      .from("track123_integrations")
      .upsert(patch, { onConflict: "shop_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Roda o sync pra todas as lojas (do filtro/grupo aberto na tela) que têm
// integração Track123 habilitada — usado pelo botão "Atualizar" da aba
// Rastreamento pra forçar uma busca de rastreio na hora, em vez de só reler o
// que já está no banco. Lojas sem integração são ignoradas silenciosamente.
export const syncTrack123ForShops = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ shop_ids: z.array(z.string().uuid()) }).parse(d))
  .handler(async ({ data }: any) => {
    if (!data.shop_ids.length) return { synced: 0, total: 0, errors: [] as string[] };
    const { data: integrations, error } = await supabaseAdmin
      .from("track123_integrations")
      .select("shop_id,api_key,mcp_store_uuid")
      .in("shop_id", data.shop_ids)
      .eq("enabled", true)
      .not("api_key", "is", null);
    if (error) throw new Error(error.message);

    let synced = 0;
    const errors: string[] = [];
    for (const integ of integrations ?? []) {
      try {
        if (integ.mcp_store_uuid) {
          await runTrack123McpSync(integ.shop_id, integ.api_key, integ.mcp_store_uuid, supabaseAdmin);
        } else {
          await runTrack123Sync(integ.shop_id, integ.api_key, supabaseAdmin);
        }
        synced++;
      } catch (e: any) {
        errors.push(String(e?.message ?? e));
      }
    }
    return { synced, total: (integrations ?? []).length, errors };
  });

// Roda o sync pra uma única loja na hora (ignora o filtro de loja/grupo ativo do
// cron — se o usuário pediu explicitamente, testa mesmo assim). Usa MCP quando a
// loja tem Store UUID salvo, senão cai pra Open API clássica.
export const testTrack123Sync = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: unknown) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }: any) => {
    const { data: integ, error } = await supabaseAdmin
      .from("track123_integrations")
      .select("api_key,mcp_store_uuid")
      .eq("shop_id", data.shop_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (integ?.mcp_store_uuid) {
      if (!integ.api_key) throw new Error("Falta a API key (X-Api-Key) junto com o Store UUID.");
      return runTrack123McpSync(data.shop_id, integ.api_key, integ.mcp_store_uuid, supabaseAdmin);
    }
    if (!integ?.api_key) throw new Error("Nenhuma API key salva pra essa loja.");
    return runTrack123Sync(data.shop_id, integ.api_key, supabaseAdmin);
  });

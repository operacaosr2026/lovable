import { createServerFn } from "@tanstack/react-start";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPausedShopifyStoreIds } from "@/lib/sync-pause.server";

// Estado das conexões (Configurações > Integrações): Shopify, Meta Ads e
// Track123 — última sincronização, erro e vencimento do token da Meta. Só
// leitura do que os crons já gravam; nenhuma chamada às APIs externas.

export type IntegrationHealth = "ok" | "atencao" | "erro" | "pausada" | "desligada";

export type IntegrationRow = {
  id: string;
  name: string;
  detail: string | null;
  lastSyncAt: string | null;
  error: string | null;
  health: IntegrationHealth;
  note: string | null;
};

const HOUR = 60 * 60_000;

function healthFor(status: string | null, lastSyncAt: string | null, staleAfterMs: number): IntegrationHealth {
  if (status === "error") return "erro";
  if (!lastSyncAt) return "atencao";
  return Date.now() - new Date(lastSyncAt).getTime() > staleAfterMs ? "atencao" : "ok";
}

export const getIntegrationsStatus = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;
    const [storesRes, accountsRes, tokensRes, trackRes, shopsRes, paused] = await Promise.all([
      supabaseAdmin.from("shopify_stores")
        .select("id,name,shop_domain,last_sync_at,last_sync_status,last_sync_error,access_token")
        .eq("user_id", ownerId).order("name"),
      supabaseAdmin.from("shop_meta_ad_accounts")
        .select("id,shop_id,ad_account_id,account_name,enabled,last_sync_at,last_sync_status,last_sync_error")
        .eq("user_id", ownerId),
      supabaseAdmin.from("shop_meta_tokens").select("shop_id,fb_user_name,token_expires_at").eq("user_id", ownerId),
      supabaseAdmin.from("track123_integrations")
        .select("shop_id,enabled,last_sync_at,last_sync_status,last_sync_error")
        .eq("user_id", ownerId),
      supabaseAdmin.from("shops").select("id,name,shopify_store_id").eq("user_id", ownerId),
      getPausedShopifyStoreIds(ownerId),
    ]);

    const shopName = new Map(((shopsRes.data ?? []) as any[]).map((s) => [s.id as string, s.name as string]));
    const shopStore = new Map(((shopsRes.data ?? []) as any[]).map((s) => [s.id as string, s.shopify_store_id as string | null]));
    const isShopPaused = (shopId: string) => { const st = shopStore.get(shopId); return !!st && paused.has(st); };

    // Shopify: o sync completo roda 2x por dia (08:00 e 20:00 de Brasília).
    const shopify: IntegrationRow[] = ((storesRes.data ?? []) as any[]).map((s) => {
      const isPaused = paused.has(s.id);
      return {
        id: s.id,
        name: s.name ?? s.shop_domain ?? "Loja Shopify",
        detail: s.shop_domain ?? null,
        lastSyncAt: s.last_sync_at,
        error: s.last_sync_status === "error" ? s.last_sync_error : null,
        health: !s.access_token ? "erro" : isPaused ? "pausada" : healthFor(s.last_sync_status, s.last_sync_at, 13 * HOUR),
        note: !s.access_token ? "Sem token de acesso" : isPaused ? "Sincronização pausada no Banco de Lojas" : null,
      };
    });

    // Meta Ads: gasto sincronizado de 10 em 10 min; token com validade.
    const tokenByShop = new Map(((tokensRes.data ?? []) as any[]).map((t) => [t.shop_id as string, t]));
    const meta: IntegrationRow[] = ((accountsRes.data ?? []) as any[]).map((a) => {
      const tok = tokenByShop.get(a.shop_id);
      const expires = tok?.token_expires_at ? new Date(tok.token_expires_at).getTime() : null;
      const daysLeft = expires != null ? (expires - Date.now()) / (24 * HOUR) : null;
      let health: IntegrationHealth = !a.enabled ? "desligada"
        : isShopPaused(a.shop_id) ? "pausada"
        : healthFor(a.last_sync_status, a.last_sync_at, 1 * HOUR);
      let note: string | null = null;
      if (a.enabled && daysLeft != null && daysLeft <= 0) { health = isShopPaused(a.shop_id) ? "pausada" : "erro"; note = "Token vencido — reconectar o Facebook"; }
      else if (a.enabled && daysLeft != null && daysLeft <= 7) { if (health === "ok") health = "atencao"; note = `Token vence em ${Math.ceil(daysLeft)} dia(s)`; }
      else if (!a.enabled) note = "Conta desligada";
      else if (isShopPaused(a.shop_id)) note = "Loja pausada no Banco de Lojas";
      return {
        id: a.id,
        name: a.account_name || a.ad_account_id,
        detail: `${shopName.get(a.shop_id) ?? "Loja"} · ${a.ad_account_id}${tok?.fb_user_name ? ` · ${tok.fb_user_name}` : ""}`,
        lastSyncAt: a.last_sync_at,
        error: a.last_sync_status === "error" ? a.last_sync_error : null,
        health,
        note,
      };
    });

    // Track123: rastreio atualizado de hora em hora.
    const track123: IntegrationRow[] = ((trackRes.data ?? []) as any[]).map((t) => ({
      id: t.shop_id,
      name: shopName.get(t.shop_id) ?? "Loja",
      detail: null,
      lastSyncAt: t.last_sync_at,
      error: t.last_sync_status === "error" ? t.last_sync_error : null,
      health: !t.enabled ? "desligada" : isShopPaused(t.shop_id) ? "pausada" : healthFor(t.last_sync_status, t.last_sync_at, 3 * HOUR),
      note: !t.enabled ? "Integração desligada" : isShopPaused(t.shop_id) ? "Loja pausada no Banco de Lojas" : null,
    }));

    // Ordem alfabética, com números em ordem natural (Loja 1, Loja 2… Loja 10).
    const byName = (a: IntegrationRow, b: IntegrationRow) =>
      a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" });
    return { shopify: shopify.sort(byName), meta: meta.sort(byName), track123: track123.sort(byName) };
  });

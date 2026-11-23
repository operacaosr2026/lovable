import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { fetchWithRetry } from "@/lib/http";
import { META_GRAPH, metaTokenForAccount, syncCardAdSpend } from "@/lib/lg-card-ad-spend.server";

const db = <T extends keyof Database["public"]["Tables"]>(table: T) => supabaseAdmin.from(table);
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cardInput = z.object({ card_id: z.string().uuid() });
const accountInput = cardInput.extend({ ad_account_id: z.string().min(1) });

async function assertCard(ownerId: string, cardId: string) {
  const { data } = await supabaseAdmin.from("lg_cards").select("id").eq("id", cardId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Card não encontrado");
}

// Contas que dá pra usar no card: as de todas as conexões Meta das lojas do dono.
export const getCardMetaSetup = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => cardInput.parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertCard(ownerId, data.card_id);
    const [{ data: tokens }, { data: accounts, error }] = await Promise.all([
      supabaseAdmin.from("shop_meta_tokens").select("ad_accounts, fb_user_name").eq("user_id", ownerId),
      db("lg_card_meta_accounts")
        .select("ad_account_id, account_name, currency, enabled, selected_campaign_ids, last_sync_at, last_sync_status, last_sync_error")
        .eq("user_id", ownerId).eq("card_id", data.card_id).order("created_at", { ascending: true }),
    ]);
    if (error) throw new Error(error.message);
    const available = new Map<string, { id: string; name: string | null; currency: string | null; business_name: string | null }>();
    for (const t of (tokens ?? []) as any[]) {
      for (const a of (t.ad_accounts ?? []) as any[]) {
        const id = String(a.id ?? `act_${a.account_id}`);
        if (!available.has(id)) available.set(id, { id, name: a.name ?? null, currency: a.currency ?? null, business_name: a.business?.name ?? null });
      }
    }
    return {
      hasMetaConnection: (tokens ?? []).length > 0,
      available: [...available.values()].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
      accounts: (accounts ?? []) as {
        ad_account_id: string; account_name: string | null; currency: string | null; enabled: boolean;
        selected_campaign_ids: string[]; last_sync_at: string | null; last_sync_status: string | null; last_sync_error: string | null;
      }[],
    };
  });

export const connectCardMetaAccount = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => accountInput.extend({ account_name: z.string().nullable().optional(), currency: z.string().nullable().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertCard(ownerId, data.card_id);
    const adAccountId = data.ad_account_id.startsWith("act_") ? data.ad_account_id : `act_${data.ad_account_id}`;
    const { error } = await db("lg_card_meta_accounts").upsert({
      user_id: ownerId, card_id: data.card_id, ad_account_id: adAccountId,
      account_name: data.account_name ?? null, currency: data.currency ?? null,
      enabled: true, updated_at: new Date().toISOString(),
    }, { onConflict: "card_id,ad_account_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectCardMetaAccount = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => accountInput.parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const { error } = await db("lg_card_meta_accounts").delete()
      .eq("user_id", ownerId).eq("card_id", data.card_id).eq("ad_account_id", data.ad_account_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCardMetaCampaigns = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => accountInput.parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    await assertCard(ownerId, data.card_id);
    const [token, { data: row }] = await Promise.all([
      metaTokenForAccount(ownerId, data.ad_account_id),
      db("lg_card_meta_accounts").select("selected_campaign_ids")
        .eq("user_id", ownerId).eq("card_id", data.card_id).eq("ad_account_id", data.ad_account_id).maybeSingle(),
    ]);
    if (!token) throw new Error("Meta não conectada em nenhuma loja");
    const campaigns: { id: string; name: string; status: string; effective_status: string }[] = [];
    let url: string | null = `${META_GRAPH}/${data.ad_account_id}/campaigns?fields=id,name,status,effective_status&limit=200&access_token=${encodeURIComponent(token)}`;
    while (url) {
      const r = await fetchWithRetry(url);
      const json: any = await r.json();
      if (!r.ok || json.error) throw new Error(json?.error?.message || `Falha (${r.status})`);
      campaigns.push(...(json.data ?? []));
      url = json.paging?.next ?? null;
    }
    return { campaigns, selected_ids: ((row?.selected_campaign_ids ?? []) as string[]) };
  });

export const saveCardMetaCampaigns = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => accountInput.extend({ campaign_ids: z.array(z.string()) }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const { error } = await db("lg_card_meta_accounts")
      .update({ selected_campaign_ids: data.campaign_ids, updated_at: new Date().toISOString() })
      .eq("user_id", ownerId).eq("card_id", data.card_id).eq("ad_account_id", data.ad_account_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const syncCardMetaSpend = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => cardInput.extend({ from_date: ISO.optional(), to_date: ISO.optional(), since_days: z.number().int().min(1).max(400).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertCard(context.ownerId, data.card_id);
    return syncCardAdSpend(context.ownerId, data.card_id, data);
  });

// A lista de contas de cada conexão Meta era tirada só ao conectar o Facebook —
// conta ou BM criada depois não aparecia. Busca de novo: contas do usuário +
// contas próprias e de clientes de cada BM que ele administra.
async function fetchAllPages(url: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = url;
  while (next) {
    const r = await fetchWithRetry(next);
    const json: any = await r.json();
    if (!r.ok || json.error) throw new Error(json?.error?.message || `Falha (${r.status})`);
    out.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
  }
  return out;
}

export const refreshMetaAdAccounts = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { ownerId } = context;
    const { data: tokens } = await supabaseAdmin.from("shop_meta_tokens").select("shop_id, access_token").eq("user_id", ownerId);
    const FIELDS = "id,name,account_id,account_status,currency,business{id,name}";
    const seen = new Set<string>();
    const errors: string[] = [];
    for (const t of (tokens ?? []) as any[]) {
      if (!t.access_token) continue;
      const tk = encodeURIComponent(t.access_token);
      try {
        const byId = new Map<string, any>();
        for (const a of await fetchAllPages(`${META_GRAPH}/me/adaccounts?fields=${FIELDS}&limit=200&access_token=${tk}`)) byId.set(a.id, a);
        const bms = await fetchAllPages(`${META_GRAPH}/me/businesses?fields=id,name&limit=100&access_token=${tk}`).catch(() => []);
        for (const bm of bms) {
          for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
            const list = await fetchAllPages(`${META_GRAPH}/${bm.id}/${edge}?fields=${FIELDS}&limit=200&access_token=${tk}`).catch(() => []);
            for (const a of list) {
              const cur = byId.get(a.id);
              if (!cur) byId.set(a.id, { ...a, business: a.business ?? { id: bm.id, name: bm.name } });
              else if (!cur.business) cur.business = a.business ?? { id: bm.id, name: bm.name };
            }
          }
        }
        const accounts = [...byId.values()];
        await supabaseAdmin.from("shop_meta_tokens").update({ ad_accounts: accounts }).eq("user_id", ownerId).eq("shop_id", t.shop_id);
        for (const a of accounts) {
          await db("lg_card_meta_accounts").update({ account_name: a.name ?? null, currency: a.currency ?? null })
            .eq("user_id", ownerId).eq("ad_account_id", a.id);
        }
        for (const a of accounts) seen.add(a.id);
      } catch (e: any) {
        errors.push(e.message);
      }
    }
    if (!seen.size && errors.length) throw new Error(errors[0]);
    return { accounts: seen.size };
  });

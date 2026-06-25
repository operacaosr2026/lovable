import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const META_APP_ID    = process.env["META_APP_ID"]!;
const SUPABASE_URL   = process.env["SUPABASE_URL"]!;
const CALLBACK_URI   = `${SUPABASE_URL}/functions/v1/meta-oauth-callback`;

// ===== OAuth flow =====

export const createMetaOAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: stateRow, error } = await supabaseAdmin
      .from("meta_oauth_states")
      .insert({ user_id: ownerId, shop_id: data.shop_id })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    const params = new URLSearchParams({
      client_id:     META_APP_ID,
      redirect_uri:  CALLBACK_URI,
      state:         stateRow.id,
      scope:         "ads_read,ads_management,business_management",
      response_type: "code",
    });

    return { url: `https://www.facebook.com/v19.0/dialog/oauth?${params}` };
  });

export const getMetaToken = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    const { data: row } = await supabaseAdmin
      .from("shop_meta_tokens")
      .select("fb_user_name, fb_user_id, selected_ad_account_id, ad_accounts, token_expires_at, updated_at, selected_campaign_ids")
      .eq("user_id", ownerId)
      .eq("shop_id", data.shop_id)
      .maybeSingle();

    if (!row) return { connected: false };

    return {
      connected:              true,
      fb_user_name:           row.fb_user_name,
      fb_user_id:             row.fb_user_id,
      selected_ad_account_id: row.selected_ad_account_id,
      ad_accounts:            row.ad_accounts ?? [],
      token_expires_at:       row.token_expires_at,
      updated_at:             row.updated_at,
      selected_campaign_ids:  (row.selected_campaign_ids ?? []) as string[],
    };
  });

export const selectMetaAdAccount = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string; ad_account_id: string }) =>
    z.object({ shop_id: z.string().uuid(), ad_account_id: z.string().min(1) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    // Fetch full token row to get access_token for sync functions
    const { data: tokenRow } = await supabaseAdmin
      .from("shop_meta_tokens")
      .select("access_token")
      .eq("user_id", ownerId)
      .eq("shop_id", data.shop_id)
      .maybeSingle();

    if (!tokenRow) throw new Error("Conta Meta não conectada");

    const adAccountId = data.ad_account_id.startsWith("act_")
      ? data.ad_account_id
      : `act_${data.ad_account_id}`;

    // Save selection to OAuth token table
    await supabaseAdmin
      .from("shop_meta_tokens")
      .update({ selected_ad_account_id: adAccountId, updated_at: new Date().toISOString() })
      .eq("user_id", ownerId)
      .eq("shop_id", data.shop_id);

    // Also sync to meta_ads_integrations so existing sync functions work
    const { data: existing } = await supabaseAdmin
      .from("meta_ads_integrations")
      .select("id")
      .eq("user_id", ownerId)
      .eq("shop_id", data.shop_id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("meta_ads_integrations")
        .update({ access_token: tokenRow.access_token, ad_account_id: adAccountId, enabled: true })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin
        .from("meta_ads_integrations")
        .insert({ user_id: ownerId, shop_id: data.shop_id, access_token: tokenRow.access_token, ad_account_id: adAccountId, enabled: true });
    }

    return { ok: true };
  });

export const getMetaCampaigns = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    const { data: row } = await supabaseAdmin
      .from("shop_meta_tokens")
      .select("access_token, selected_ad_account_id, selected_campaign_ids")
      .eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();

    if (!row?.access_token || !row.selected_ad_account_id)
      throw new Error("Conta de anúncios não selecionada");

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${row.selected_ad_account_id}/campaigns` +
      `?fields=id,name,status,objective&limit=100&access_token=${row.access_token}`
    );
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);

    return {
      campaigns: (json.data ?? []) as { id: string; name: string; status: string; objective: string }[],
      selected_ids: (row.selected_campaign_ids ?? []) as string[],
    };
  });

export const saveMetaCampaigns = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string; campaign_ids: string[] }) =>
    z.object({ shop_id: z.string().uuid(), campaign_ids: z.array(z.string()) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;

    const { data: row } = await supabaseAdmin
      .from("shop_meta_tokens")
      .select("access_token")
      .eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!row) throw new Error("Conta Meta não conectada");

    await supabaseAdmin
      .from("shop_meta_tokens")
      .update({ selected_campaign_ids: data.campaign_ids, updated_at: new Date().toISOString() })
      .eq("user_id", ownerId).eq("shop_id", data.shop_id);

    return { ok: true };
  });

export const disconnectMeta = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    await Promise.all([
      supabaseAdmin.from("shop_meta_tokens").delete().eq("user_id", ownerId).eq("shop_id", data.shop_id),
      supabaseAdmin.from("meta_ads_integrations").delete().eq("user_id", ownerId).eq("shop_id", data.shop_id),
    ]);
    return { ok: true };
  });

const META_GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const SPEND_CATEGORY = "Facebook Ads";

function maskKey(s: string | null | undefined): string | null {
  if (!s) return null;
  if (s.length <= 8) return "•".repeat(s.length);
  return s.slice(0, 4) + "•".repeat(Math.max(4, s.length - 8)) + s.slice(-4);
}

function normalizeAdAccountId(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}
function isoDateInTimezone(offsetHours: number): string {
  return new Date(Date.now() + offsetHours * 3600000).toISOString().slice(0, 10);
}

// ===== Integration config =====

export const getMetaAdsIntegration = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    const { data: row } = await supabaseAdmin.from("meta_ads_integrations")
      .select("*").eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();

    if (!row) {
      return {
        configured: false,
        enabled: false,
        ad_account_id: null,
        account_name: null,
        currency: null,
        token_masked: null,
        last_sync_at: null,
        last_sync_status: null,
        last_sync_error: null,
        journal_page_id: null,
      };
    }

    return {
      configured: Boolean(row.access_token && row.ad_account_id),
      enabled: row.enabled,
      ad_account_id: row.ad_account_id,
      account_name: row.account_name,
      currency: row.currency,
      token_masked: maskKey(row.access_token),
      last_sync_at: row.last_sync_at,
      last_sync_status: row.last_sync_status,
      last_sync_error: row.last_sync_error,
      journal_page_id: row.journal_page_id,
    };
  });

export const upsertMetaAdsIntegration = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string; access_token?: string; ad_account_id?: string; enabled?: boolean }) =>
    z.object({
      shop_id: z.string().uuid(),
      access_token: z.string().min(1).max(1000).optional(),
      ad_account_id: z.string().min(1).max(120).optional(),
      enabled: z.boolean().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    const patch: { access_token?: string; ad_account_id?: string; enabled?: boolean } = {};
    if (data.access_token !== undefined) patch.access_token = data.access_token;
    if (data.ad_account_id !== undefined) patch.ad_account_id = normalizeAdAccountId(data.ad_account_id);
    if (data.enabled !== undefined) patch.enabled = data.enabled;

    const { data: existing } = await supabaseAdmin.from("meta_ads_integrations")
      .select("id").eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin.from("meta_ads_integrations")
        .update(patch).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("meta_ads_integrations")
        .insert({ user_id: ownerId, shop_id: data.shop_id, enabled: true, ...patch });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const testMetaAdsConnection = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    const { data: row } = await supabaseAdmin.from("meta_ads_integrations")
      .select("access_token,ad_account_id").eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!row?.access_token || !row.ad_account_id) throw new Error("Token de acesso e ID da conta de anúncios são obrigatórios");

    try {
      const url = `${META_GRAPH_API_BASE}/${row.ad_account_id}?fields=name,currency,account_status&access_token=${encodeURIComponent(row.access_token)}`;
      const r = await fetch(url);
      const json: any = await r.json();
      if (!r.ok || json.error) {
        const msg = json?.error?.message || `Falha (${r.status})`;
        await supabaseAdmin.from("meta_ads_integrations")
          .update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: String(msg).slice(0, 500) })
          .eq("user_id", ownerId).eq("shop_id", data.shop_id);
        throw new Error(msg);
      }
      await supabaseAdmin.from("meta_ads_integrations")
        .update({
          account_name: json.name ?? null,
          currency: json.currency ?? null,
          last_sync_at: new Date().toISOString(),
          last_sync_status: "ok",
          last_sync_error: null,
        })
        .eq("user_id", ownerId).eq("shop_id", data.shop_id);
      return { ok: true, name: json.name, currency: json.currency };
    } catch (e: any) {
      await supabaseAdmin.from("meta_ads_integrations")
        .update({ last_sync_status: "error", last_sync_error: String(e?.message ?? e).slice(0, 500) })
        .eq("user_id", ownerId).eq("shop_id", data.shop_id);
      throw e;
    }
  });

export const syncMetaAdsSpend = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string; since_days?: number }) =>
    z.object({ shop_id: z.string().uuid(), since_days: z.number().int().min(1).max(365).optional() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    const { data: integ } = await supabaseAdmin.from("meta_ads_integrations")
      .select("access_token,ad_account_id").eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!integ?.access_token || !integ.ad_account_id) throw new Error("Integração não configurada");

    const sinceDays = data.since_days ?? 30;

    // Fetch ad account timezone to compute "today" in the account's local time
    let timezoneOffset = 0;
    try {
      const tzRes = await fetch(
        `${META_GRAPH_API_BASE}/${integ.ad_account_id}?fields=timezone_offset_hours_utc&access_token=${encodeURIComponent(integ.access_token)}`
      );
      const tzJson: any = await tzRes.json();
      if (typeof tzJson?.timezone_offset_hours_utc === "number") {
        timezoneOffset = tzJson.timezone_offset_hours_utc;
      }
    } catch {
      // fallback to UTC
    }

    const today = isoDateInTimezone(timezoneOffset);
    const since = addDays(today, -sinceDays);

    // Check if specific campaigns are selected for this shop
    const { data: tokenRow } = await supabaseAdmin
      .from("shop_meta_tokens")
      .select("selected_campaign_ids")
      .eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();
    const campaignIds: string[] = tokenRow?.selected_campaign_ids ?? [];

    try {
      const timeRange = encodeURIComponent(JSON.stringify({ since, until: today }));
      const filtering = campaignIds.length > 0
        ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]))}`
        : "";
      const url = `${META_GRAPH_API_BASE}/${integ.ad_account_id}/insights?level=account&fields=spend&time_increment=1&time_range=${timeRange}${filtering}&access_token=${encodeURIComponent(integ.access_token)}`;
      const r = await fetch(url);
      const json: any = await r.json();
      if (!r.ok || json.error) {
        const msg = json?.error?.message || `Falha (${r.status})`;
        await supabaseAdmin.from("meta_ads_integrations")
          .update({ last_sync_at: new Date().toISOString(), last_sync_status: "error", last_sync_error: String(msg).slice(0, 500) })
          .eq("user_id", ownerId).eq("shop_id", data.shop_id);
        throw new Error(msg);
      }

      const rows = ((json.data ?? []) as any[])
        .map((d) => ({ date: d.date_start as string, spend: Number(d.spend ?? 0) }))
        .filter((d) => d.spend > 0)
        .map((d) => ({
          user_id: ownerId,
          shop_id: data.shop_id,
          kind: "expense",
          amount: d.spend,
          date: d.date,
          category: SPEND_CATEGORY,
          description: "Gasto Meta Ads (sincronizado)",
          source: "auto",
          auto_kind: "meta_ads_spend",
          auto_ref_date: d.date,
        }));

      // Delete existing entries for the period first (partial index prevents ON CONFLICT upsert)
      await supabaseAdmin.from("shop_cash_entries")
        .delete()
        .eq("user_id", ownerId)
        .eq("shop_id", data.shop_id)
        .eq("auto_kind", "meta_ads_spend")
        .gte("auto_ref_date", since)
        .lte("auto_ref_date", today);

      if (rows.length) {
        const { error } = await supabaseAdmin.from("shop_cash_entries").insert(rows);
        if (error) throw new Error(error.message);
      }

      const totalSpend = rows.reduce((s, r) => s + r.amount, 0);

      await supabaseAdmin.from("meta_ads_integrations")
        .update({ last_sync_at: new Date().toISOString(), last_sync_status: "ok", last_sync_error: null })
        .eq("user_id", ownerId).eq("shop_id", data.shop_id);

      return { synced: rows.length, totalSpend };
    } catch (e: any) {
      await supabaseAdmin.from("meta_ads_integrations")
        .update({ last_sync_status: "error", last_sync_error: String(e?.message ?? e).slice(0, 500) })
        .eq("user_id", ownerId).eq("shop_id", data.shop_id);
      throw e;
    }
  });

// ===== Activities (change log) -> Diário =====

const ACTIVITIES_PAGE_TITLE = "Alterações Meta Ads";

function formatActivity(a: any): string {
  const date = new Date((a.event_time ?? 0) * 1000).toLocaleString("pt-BR", {
    dateStyle: "short", timeStyle: "short",
  });
  const label = a.translated_event_type || a.event_type || "Alteração";
  const who = a.actor_name ? ` por ${a.actor_name}` : "";
  const what = a.object_name ? ` · ${a.object_name}` : "";

  let detail = "";
  if (a.extra_data) {
    try {
      const extra = JSON.parse(a.extra_data);
      if (extra && typeof extra === "object" && !Array.isArray(extra)) {
        if (extra.old_value !== undefined || extra.new_value !== undefined) {
          detail = ` (de "${extra.old_value ?? "—"}" para "${extra.new_value ?? "—"}")`;
        } else if (extra.field_name) {
          detail = ` (${extra.field_name})`;
        }
      }
    } catch {
      // ignore unparsable extra_data
    }
  }

  return `${date} — ${label}${what}${who}${detail}`;
}

export const syncMetaAdsActivities = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ownerId } = context;
    const { data: integ } = await supabaseAdmin.from("meta_ads_integrations")
      .select("access_token,ad_account_id,journal_page_id,last_activities_sync_at")
      .eq("user_id", ownerId).eq("shop_id", data.shop_id).maybeSingle();
    if (!integ?.access_token || !integ.ad_account_id) throw new Error("Integração não configurada");

    const since = integ.last_activities_sync_at
      ? Math.floor(new Date(integ.last_activities_sync_at).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

    const url = `${META_GRAPH_API_BASE}/${integ.ad_account_id}/activities?since=${since}&limit=100&fields=event_time,event_type,translated_event_type,extra_data,actor_name,object_name,object_type&access_token=${encodeURIComponent(integ.access_token)}`;
    const r = await fetch(url);
    const json: any = await r.json();
    if (!r.ok || json.error) {
      const msg = json?.error?.message || `Falha (${r.status})`;
      throw new Error(msg);
    }

    const activities = ((json.data ?? []) as any[])
      .slice()
      .sort((a, b) => (b.event_time ?? 0) - (a.event_time ?? 0));

    let pageId = integ.journal_page_id ?? null;
    if (pageId) {
      const { data: page } = await supabaseAdmin.from("journal_pages")
        .select("id").eq("id", pageId).maybeSingle();
      if (!page) pageId = null;
    }

    if (!pageId) {
      const { data: siblings } = await supabaseAdmin.from("journal_pages")
        .select("position").eq("user_id", ownerId).eq("shop_id", data.shop_id)
        .is("parent_id", null).order("position", { ascending: false }).limit(1);
      const nextPos = (siblings?.[0]?.position ?? -1) + 1;
      const { data: newPage, error } = await supabaseAdmin.from("journal_pages").insert({
        user_id: ownerId,
        shop_id: data.shop_id,
        parent_id: null,
        title: ACTIVITIES_PAGE_TITLE,
        icon: "📣",
        content: "[]",
        position: nextPos,
      }).select("id").single();
      if (error) throw new Error(error.message);
      pageId = newPage.id;
    }

    if (activities.length > 0) {
      const { data: page } = await supabaseAdmin.from("journal_pages")
        .select("content").eq("id", pageId).maybeSingle();

      let blocks: any[] = [];
      try {
        const parsed = JSON.parse(page?.content || "[]");
        if (Array.isArray(parsed)) blocks = parsed;
      } catch {
        blocks = [];
      }

      const newBlocks = activities.map((a) => ({
        type: "bulletListItem",
        content: [{ type: "text", text: formatActivity(a), styles: {} }],
      }));

      const { error } = await supabaseAdmin.from("journal_pages")
        .update({ content: JSON.stringify([...newBlocks, ...blocks]) })
        .eq("id", pageId);
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("meta_ads_integrations")
      .update({ journal_page_id: pageId, last_activities_sync_at: new Date().toISOString() })
      .eq("user_id", ownerId).eq("shop_id", data.shop_id);

    return { synced: activities.length, journal_page_id: pageId };
  });

// ===== Metrics =====

export const getMetaAdsMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { shop_id: string }) => z.object({ shop_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const today = isoDate(new Date());
    const since30 = addDays(today, -30);
    const since7 = addDays(today, -7);

    const { data: rows } = await supabase.from("shop_cash_entries")
      .select("amount,date").eq("shop_id", data.shop_id)
      .eq("auto_kind", "meta_ads_spend").gte("date", since30);

    let spend7 = 0, spend30 = 0;
    for (const r of rows ?? []) {
      const amount = Number(r.amount ?? 0);
      spend30 += amount;
      if (r.date >= since7) spend7 += amount;
    }
    return { spend7, spend30 };
  });

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { buildTrackingUrl } from "@/lib/tracking-url";
import { updateFulfillmentTrackingUrl } from "@/lib/shopify-fulfillment-status.server";

// Link de rastreio dos envios na Shopify (o que o cliente vê na página do pedido
// e nos e-mails) diferente do link da loja (Integrações: "URL padrão de
// rastreio") — ex.: walkesty.com/apps/track123?…, do Track123 já desinstalado.
// O sync do 17track troca o link só dos pedidos que ele acompanha (em aberto);
// isto pega qualquer envio das lojas ativas, entregue ou não, sem avisar o
// cliente. Depois de trocar, grava o link novo no pedido do banco (raw e
// tracking_url) pra não tentar de novo na próxima rodada.

const LOOKBACK_DAYS = 180;

type FixResult = { checked: number; wrong: number; fixed: number; failed: number; errors: string[] };

async function activeShopIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from("lg_card_shops").select("shop_id,lg_cards!inner(status)").eq("lg_cards.status", "ativo");
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as any[]).map((r) => r.shop_id as string))];
}

// Loja nova em card ativo já entra no 17track com o link de rastreio do card (o
// mais usado entre as outras lojas dele) — antes era preciso ir em Integrações
// e colar o mesmo link à mão. Loja com link vazio também recebe o padrão; card
// sem nenhum link definido fica como está.
export async function ensureDefaultTrackingLinks(ownerId?: string): Promise<number> {
  let q = supabaseAdmin.from("lg_card_shops").select("card_id,shop_id,lg_cards!inner(status,user_id)").eq("lg_cards.status", "ativo");
  if (ownerId) q = q.eq("lg_cards.user_id", ownerId);
  const { data: links, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (links ?? []) as any[];
  if (!rows.length) return 0;
  const { data: integs } = await supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template")
    .in("shop_id", [...new Set(rows.map((r) => r.shop_id as string))]);
  const templateBy = new Map(((integs ?? []) as any[]).map((i) => [i.shop_id as string, String(i.tracking_link_template ?? "").trim()]));
  const todo: { user_id: string; shop_id: string; provider: string; tracking_link_template: string }[] = [];
  for (const cardId of new Set(rows.map((r) => r.card_id as string))) {
    const shops = rows.filter((r) => r.card_id === cardId);
    const count = new Map<string, number>();
    for (const s of shops) { const t = templateBy.get(s.shop_id); if (t) count.set(t, (count.get(t) ?? 0) + 1); }
    const def = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!def) continue;
    for (const s of shops) {
      if (templateBy.get(s.shop_id) || todo.some((t) => t.shop_id === s.shop_id)) continue;
      todo.push({ user_id: s.lg_cards.user_id, shop_id: s.shop_id, provider: "17track", tracking_link_template: def });
    }
  }
  if (!todo.length) return 0;
  const { error: upErr } = await supabaseAdmin.from("track123_integrations").upsert(todo, { onConflict: "shop_id" });
  if (upErr) throw new Error(upErr.message);
  return todo.length;
}

export async function fixShopifyTrackingLinks(opts: { limit?: number; deadline?: number } = {}): Promise<FixResult> {
  const out: FixResult = { checked: 0, wrong: 0, fixed: 0, failed: 0, errors: [] };
  const shopIds = await activeShopIds();
  if (!shopIds.length) return out;
  const { data: integs } = await supabaseAdmin.from("track123_integrations").select("shop_id,tracking_link_template").in("shop_id", shopIds);
  const templateBy = new Map(((integs ?? []) as any[]).map((i) => [i.shop_id as string, i.tracking_link_template as string | null]));
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: orders, error } = await selectAll<any>(supabaseAdmin.from("shop_orders")
    .select("id,shop_id,order_number,tracking_code,tracking_url,fulfillments:raw->fulfillments")
    .in("shop_id", shopIds).not("tracking_code", "is", null).gte("order_date", since));
  if (error) throw new Error(error.message);

  // Envios com código e link diferente do da loja.
  const todo: { o: any; number: string; url: string }[] = [];
  for (const o of orders ?? []) {
    const template = templateBy.get(o.shop_id);
    if (!template) continue;
    for (const f of (o.fulfillments ?? []) as any[]) {
      if (f?.status && f.status !== "success") continue;
      const number = f?.tracking_number ?? f?.tracking_numbers?.[0];
      if (!number) continue;
      out.checked++;
      const url = buildTrackingUrl(template, number);
      if (!url || f.tracking_url === url || (f.tracking_urls ?? []).includes(url)) continue;
      todo.push({ o, number: String(number), url });
    }
  }
  out.wrong = todo.length;

  for (const t of todo.slice(0, opts.limit ?? todo.length)) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    try {
      const r = await updateFulfillmentTrackingUrl({ shopId: t.o.shop_id, fulfillments: t.o.fulfillments, trackingNumber: t.number, url: t.url });
      if (!r.sent && r.reason !== "link já é esse") {
        out.failed++;
        if (out.errors.length < 10) out.errors.push(`${t.o.order_number}: ${r.reason}`);
        continue;
      }
      out.fixed++;
      // Mesmo link no banco: raw.fulfillments (o que a próxima rodada compara) e tracking_url.
      const { data: row } = await supabaseAdmin.from("shop_orders").select("raw").eq("id", t.o.id).maybeSingle();
      const raw: any = row?.raw;
      if (raw?.fulfillments) {
        raw.fulfillments = (raw.fulfillments as any[]).map((f) =>
          String(f?.tracking_number ?? "").toUpperCase() === t.number.toUpperCase() ? { ...f, tracking_url: t.url, tracking_urls: [t.url] } : f);
        await supabaseAdmin.from("shop_orders").update({
          raw, ...(String(t.o.tracking_code).toUpperCase() === t.number.toUpperCase() ? { tracking_url: t.url } : {}),
        }).eq("id", t.o.id);
      }
    } catch (e: any) {
      out.failed++;
      if (out.errors.length < 10) out.errors.push(`${t.o.order_number}: ${String(e?.message ?? e).slice(0, 150)}`);
    }
  }
  return out;
}

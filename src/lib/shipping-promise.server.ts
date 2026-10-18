import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { selectAll } from "@/lib/select-all";
import { isoTodayUS } from "@/lib/timezone";
import { businessDaysBetween, postingCalendar } from "@/lib/logistics-kpis";
import { raiseNotification, resolveNotification } from "@/lib/notifications.server";

// Prazo prometido na política de frete × prazo real (Inteligência). A política
// de cada loja ativa é lida da Shopify (policies.json): "processed within 1–3
// business days" e "United States: 5–13 business days". O real vem dos pedidos
// entregues dos últimos 90 dias (postagem = 1ª movimentação real; entrega = dia
// da entrega). Menos de 90% dentro do prometido → aviso no sino; a análise
// semanal do consultor também recebe esses números.

const TARGET = 0.9;
const NOTIF_KEY = "intel:prazo_frete";

export type PromiseRange = { min: number; max: number };
export type ShippingPromiseFacts = {
  lojas: { loja: string; postagem: PromiseRange | null; entrega_eua: PromiseRange | null }[];
  pedidos_entregues: number;
  postagem: { prometido_ate: number; dentro_pct: number; dias_uteis_para_90pct: number } | null;
  entrega_apos_envio: { prometido_ate: number; dentro_pct: number; media_dias_uteis: number; dias_uteis_para_90pct: number } | null;
  total: { prometido_ate: number; dentro_pct: number; dias_uteis_para_90pct: number } | null;
};

const range = (text: string, re: RegExp): PromiseRange | null => {
  const m = text.match(re);
  return m ? { min: Number(m[1]), max: Number(m[2]) } : null;
};
// "processed within 1–3 business days" / "United States: 5–13 business days".
export function parseShippingPolicy(text: string) {
  return {
    postagem: range(text, /process\w*\s+within\s+(\d+)\s*(?:–|-|to)\s*(\d+)\s+business days/i),
    entrega_eua: range(text, /United States[^0-9]{0,30}(\d+)\s*(?:–|-|to)\s*(\d+)\s+business days/i),
  };
}

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/\s+/g, " ");

async function shopPolicies(ownerId: string, shopIds: string[]) {
  const [{ data: shops }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("shops").select("id,name").in("id", shopIds),
    supabaseAdmin.from("shop_order_settings").select("shop_id,shopify_store_id").eq("user_id", ownerId).in("shop_id", shopIds),
  ]);
  const storeIds = ((settings ?? []) as any[]).map((s) => s.shopify_store_id).filter(Boolean);
  const { data: stores } = storeIds.length
    ? await supabaseAdmin.from("shopify_stores").select("id,shop_domain,access_token").in("id", storeIds)
    : { data: [] as any[] };
  const storeOf = new Map(((settings ?? []) as any[]).map((s) => [s.shop_id, ((stores ?? []) as any[]).find((x) => x.id === s.shopify_store_id)]));
  return Promise.all(((shops ?? []) as any[]).map(async (sh) => {
    const st = storeOf.get(sh.id);
    let text = "";
    if (st?.shop_domain && st?.access_token) {
      const res = await fetchWithRetry(`https://${st.shop_domain}/admin/api/2024-10/policies.json`, { headers: { "X-Shopify-Access-Token": st.access_token } }).catch(() => null);
      const pol = res?.ok ? await res.json() : null;
      const ship = ((pol?.policies ?? []) as any[]).find((p) => p.handle === "shipping-policy");
      text = ship ? strip(String(ship.body ?? "")) : "";
    }
    return { loja: sh.name as string, ...parseShippingPolicy(text) };
  }));
}

// Menor N (dias úteis) com pelo menos 90% dos pedidos até N.
const p90 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * TARGET) - 1)] ?? 0; };
const pct = (xs: number[], max: number) => Math.round((1000 * xs.filter((x) => x <= max).length) / xs.length) / 10;

export async function shippingPromiseFacts(ownerId: string, shopIds: string[]): Promise<ShippingPromiseFacts | null> {
  if (!shopIds.length) return null;
  const today = isoTodayUS();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const [lojas, { data: orders }, { data: holidays }] = await Promise.all([
    shopPolicies(ownerId, shopIds),
    selectAll<any>(supabaseAdmin.from("shop_orders").select("order_date,shipped_at,delivered_at,kpi_excluded")
      .eq("user_id", ownerId).in("shop_id", shopIds).gte("delivered_at", since).not("shipped_at", "is", null)),
    supabaseAdmin.from("posting_holidays").select("day,kind").eq("user_id", ownerId),
  ]);
  const cal = postingCalendar(holidays as any);
  const rows = ((orders ?? []) as any[]).filter((o) => !o.kpi_excluded && o.order_date && String(o.shipped_at).slice(0, 10) >= String(o.order_date).slice(0, 10)
    && String(o.delivered_at).slice(0, 10) >= String(o.shipped_at).slice(0, 10));
  // Prometido: o mais curto entre as lojas (o cliente de qualquer loja leu esse).
  const maxOf = (k: "postagem" | "entrega_eua") => { const v = lojas.map((l) => l[k]?.max).filter((x): x is number => x != null); return v.length ? Math.min(...v) : null; };
  const promPost = maxOf("postagem"), promShip = maxOf("entrega_eua");
  if (!rows.length) return { lojas, pedidos_entregues: 0, postagem: null, entrega_apos_envio: null, total: null };
  // Postagem: dias úteis sem feriados da China (quem posta é o fornecedor);
  // transporte: dias úteis (seg-sex) nos EUA.
  const post = rows.map((o) => businessDaysBetween(o.order_date, o.shipped_at, cal));
  const ship = rows.map((o) => businessDaysBetween(o.shipped_at, o.delivered_at));
  const tot = rows.map((o) => businessDaysBetween(o.order_date, o.delivered_at));
  return {
    lojas, pedidos_entregues: rows.length,
    postagem: promPost == null ? null : { prometido_ate: promPost, dentro_pct: pct(post, promPost), dias_uteis_para_90pct: p90(post) },
    entrega_apos_envio: promShip == null ? null : {
      prometido_ate: promShip, dentro_pct: pct(ship, promShip),
      media_dias_uteis: Math.round((10 * ship.reduce((a, b) => a + b, 0)) / ship.length) / 10, dias_uteis_para_90pct: p90(ship),
    },
    total: promPost == null || promShip == null ? null : { prometido_ate: promPost + promShip, dentro_pct: pct(tot, promPost + promShip), dias_uteis_para_90pct: p90(tot) },
  };
}

// Aviso no sino quando menos de 90% cumprem o prometido; some sozinho quando volta.
export async function checkShippingPromise(ownerId: string, facts: ShippingPromiseFacts | null) {
  if (!facts || facts.pedidos_entregues < 30) return;
  const fora: string[] = [];
  const e = facts.entrega_apos_envio, p = facts.postagem;
  if (e && e.dentro_pct < TARGET * 100) {
    fora.push(`Entrega após o envio: a política promete até ${e.prometido_ate} dias úteis e só ${e.dentro_pct}% chegam nesse prazo (média ${e.media_dias_uteis}). Pra 90% cumprirem, o prazo teria que ser até ${e.dias_uteis_para_90pct} dias úteis.`);
  }
  if (p && p.dentro_pct < TARGET * 100) {
    fora.push(`Postagem: a política promete até ${p.prometido_ate} dias úteis e só ${p.dentro_pct}% são postados nesse prazo. Pra 90%, até ${p.dias_uteis_para_90pct} dias úteis.`);
  }
  if (!fora.length) { await resolveNotification(ownerId, NOTIF_KEY); return; }
  await raiseNotification(ownerId, NOTIF_KEY, {
    level: "warning",
    title: "Prazo da política de frete não está sendo cumprido",
    body: `${fora.join(" ")} (${facts.pedidos_entregues} pedidos entregues nos últimos 90 dias.)`,
    link: "/inteligencia",
  });
}

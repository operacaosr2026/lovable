import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchWithRetry } from "@/lib/http";
import { addDaysIso, isoTodayUS, nyParts } from "@/lib/timezone";

// Microsoft Clarity (Data Export API): um projeto Clarity por produto. Cada busca é 1
// chamada com as dimensões Campaign + Medium (utm_campaign e utm_medium =
// campanha e conjunto), e a resposta fica crua em clarity_snapshots.

export const CLARITY_DAILY_LIMIT = 10;
const ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1&dimension1=Campaign&dimension2=Medium";

const utcMidnight = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();

// A Clarity não diz quando o limite zera; contamos pelo dia UTC (a API responde em UTC).
export async function callsUsedToday(productIds: string[]) {
  const used = new Map<string, number>();
  if (!productIds.length) return used;
  const { data } = await supabaseAdmin.from("clarity_calls").select("product_id").in("product_id", productIds).gte("called_at", utcMidnight());
  for (const r of data ?? []) used.set(r.product_id, (used.get(r.product_id) ?? 0) + 1);
  return used;
}

export async function fetchClarityForProduct(productId: string, kind: "auto" | "manual") {
  const { data: conn } = await supabaseAdmin.from("clarity_connections").select("user_id,token").eq("product_id", productId).maybeSingle();
  if (!conn) throw new Error("Produto sem Clarity conectado");
  const used = (await callsUsedToday([productId])).get(productId) ?? 0;
  if (used >= CLARITY_DAILY_LIMIT) throw new Error("Limite de 10 buscas do Clarity por dia atingido");

  let raw: unknown = null;
  let error: string | null = null;
  try {
    const res = await fetchWithRetry(ENDPOINT, { headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json" } });
    const body = await res.text();
    if (res.status === 401 || res.status === 403) error = "Token do Clarity inválido ou sem permissão";
    else if (res.status === 429) error = "A Clarity recusou: limite diário atingido";
    else if (!res.ok) error = `Clarity respondeu ${res.status}: ${body.slice(0, 200)}`;
    else raw = JSON.parse(body);
  } catch (e: any) {
    error = String(e?.message ?? e);
  }

  await supabaseAdmin.from("clarity_calls").insert({ user_id: conn.user_id, product_id: productId, kind, ok: !error });
  await supabaseAdmin.from("clarity_connections")
    .update({ last_fetch_at: new Date().toISOString(), last_error: error, updated_at: new Date().toISOString() }).eq("product_id", productId);
  if (error) throw new Error(error);

  // Automática (00:10 de NY) fecha o dia anterior; manual é o dia de hoje, parcial.
  const day = kind === "auto" ? addDaysIso(isoTodayUS(), -1) : isoTodayUS();
  const { error: upErr } = await supabaseAdmin.from("clarity_snapshots").upsert(
    { user_id: conn.user_id, product_id: productId, day, partial: kind === "manual", raw: raw as any, fetched_at: new Date().toISOString() },
    { onConflict: "product_id,day" },
  );
  if (upErr) throw new Error(upErr.message);
  return { day };
}

// Cron em 04:10 e 05:10 UTC; só a que cair na meia-noite de NY busca.
export async function runClarityDaily(force = false) {
  if (!force && nyParts(new Date()).hour !== 0) return { skipped: true };
  const { data } = await supabaseAdmin.from("clarity_connections").select("product_id");
  const results = await Promise.all((data ?? []).map(async ({ product_id }) => {
    try { return { product_id, ...(await fetchClarityForProduct(product_id, "auto")) }; }
    catch (e: any) { return { product_id, error: String(e?.message ?? e) }; }
  }));
  return { skipped: false, results };
}

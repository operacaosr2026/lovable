import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";

// Aba "Teste": compara o rastreio do 17track com o que o Track123 gravou no
// banco. Não escreve nada no nosso banco — só lê shop_order_tracking e chama a
// API do 17track (chave em SEVENTEEN_TRACK_API_KEY).
const API_BASE = "https://api.17track.net/track/v2.4";
// Já registrado no 17track — não cobra de novo, só segue pra consulta.
const ALREADY_REGISTERED = -18019901;

function assertAdmin(ctx: { role: string }) {
  if (ctx.role !== "admin") throw new Error("Só o administrador acessa a aba Teste.");
}

function apiKey() {
  const k = process.env.SEVENTEEN_TRACK_API_KEY;
  if (!k) throw new Error("Falta a chave do 17track (SEVENTEEN_TRACK_API_KEY) no .env / Vercel.");
  return k;
}

async function call17(path: string, body: unknown) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "17token": apiKey(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`17track (${r.status}): ${text.slice(0, 200)}`); }
  if (j?.code !== 0) throw new Error(`17track ${j?.code}: ${j?.data?.errors?.[0]?.message ?? text.slice(0, 200)}`);
  return j.data;
}

export type Event17 = { at: string | null; description: string; location: string | null; stage: string | null };
export type Result17 = {
  number: string;
  ok: boolean;
  error: string | null;
  pending: boolean;          // registrado agora, 17track ainda buscando na transportadora
  carrier: string | null;
  status: string | null;
  subStatus: string | null;
  lastSyncAt: string | null;
  syncStatus: string | null;
  destination: string | null;
  events: Event17[];
};
export type Track123Row = {
  number: string;
  orderNumber: string | null;
  shopName: string | null;
  carrier: string | null;
  status: string | null;
  lastEventAt: string | null;
  lastEventLabel: string | null;
  checkedAt: string | null;
  events: Event17[];
};

const placeOf = (a: any) => [a?.city, a?.state, a?.country].filter(Boolean).join(", ") || null;

function parseTrackInfo(item: any): Omit<Result17, "number" | "ok" | "error" | "pending"> {
  const ti = item?.track_info ?? {};
  const providers: any[] = ti.tracking?.providers ?? [];
  // Todas as transportadoras (origem + última milha) num histórico só, mais novo primeiro.
  const events: Event17[] = providers.flatMap((p) => (p.events ?? []).map((e: any) => ({
    at: e.time_utc ?? e.time_iso ?? null,
    description: String(e.description ?? ""),
    location: e.location || placeOf(e.address),
    stage: e.stage ?? e.sub_status ?? null,
  })));
  events.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return {
    carrier: providers.map((p) => p.provider?.name).filter(Boolean).join(" → ") || null,
    status: ti.latest_status?.status ?? null,
    subStatus: ti.latest_status?.sub_status ?? null,
    lastSyncAt: providers[0]?.latest_sync_time ?? null,
    syncStatus: providers[0]?.latest_sync_status ?? null,
    destination: placeOf(ti.shipping_info?.recipient_address) ?? null,
    events,
  };
}

// Registra (1 crédito por código novo) e consulta no 17track.
export const query17track = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ numbers: z.array(z.string().trim().min(5).max(50)).min(1).max(40) }).parse(d))
  .handler(async ({ context, data }): Promise<{ results: Result17[]; registeredNow: number }> => {
    assertAdmin(context);
    const numbers = [...new Set(data.numbers)];
    const reg = await call17("/register", numbers.map((number) => ({ number })));
    const regError = new Map<string, string>();
    const registeredNow = (reg?.accepted ?? []).length;
    for (const r of reg?.rejected ?? []) {
      if (r.error?.code !== ALREADY_REGISTERED) regError.set(r.number, `${r.error?.code}: ${r.error?.message}`);
    }
    const info = await call17("/gettrackinfo", numbers.map((number) => ({ number })));
    const byNum = new Map<string, any>((info?.accepted ?? []).map((a: any) => [a.number, a]));
    const infoError = new Map<string, string>((info?.rejected ?? []).map((r: any) => [r.number, `${r.error?.code}: ${r.error?.message}`]));

    const results = numbers.map((number): Result17 => {
      const item = byNum.get(number);
      if (item) {
        const parsed = parseTrackInfo(item);
        return { number, ok: true, error: null, pending: !parsed.events.length && !parsed.status, ...parsed };
      }
      const error = regError.get(number) ?? infoError.get(number) ?? "Sem resposta do 17track";
      return { number, ok: false, error, pending: !regError.has(number), carrier: null, status: null, subStatus: null, lastSyncAt: null, syncStatus: null, destination: null, events: [] };
    });
    return { results, registeredNow };
  });

export const get17trackQuota = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAdmin(context);
    if (!process.env.SEVENTEEN_TRACK_API_KEY) return { configured: false as const };
    const q = await call17("/getquota", undefined);
    return { configured: true as const, total: q?.quota_total ?? null, used: q?.quota_used ?? null, remain: q?.quota_remain ?? null };
  });

// O que o Track123 tem hoje no banco pra esses códigos (só leitura).
export const getTrack123Rows = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ numbers: z.array(z.string()).max(40) }).parse(d))
  .handler(async ({ context, data }): Promise<{ rows: Track123Row[] }> => {
    assertAdmin(context);
    if (!data.numbers.length) return { rows: [] };
    const { data: rows, error } = await context.supabase.from("shop_order_tracking")
      .select("tracking_number,carrier,tracking_status,last_event_at,last_event_label,updated_at,timeline,order_id,shop_id")
      .eq("user_id", context.ownerId).in("tracking_number", data.numbers);
    if (error) throw new Error(error.message);
    const orderIds = [...new Set((rows ?? []).map((r: any) => r.order_id))];
    const shopIds = [...new Set((rows ?? []).map((r: any) => r.shop_id))];
    const [{ data: orders }, { data: shops }] = await Promise.all([
      orderIds.length ? context.supabase.from("shop_orders").select("id,order_number").in("id", orderIds) : Promise.resolve({ data: [] as any[] }),
      shopIds.length ? context.supabase.from("shops").select("id,name").in("id", shopIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const orderNum = new Map((orders ?? []).map((o: any) => [o.id, o.order_number]));
    const shopName = new Map((shops ?? []).map((s: any) => [s.id, s.name]));
    return {
      rows: (rows ?? []).map((r: any) => ({
        number: r.tracking_number,
        orderNumber: orderNum.get(r.order_id) ?? null,
        shopName: shopName.get(r.shop_id) ?? null,
        carrier: r.carrier,
        status: r.tracking_status,
        lastEventAt: r.last_event_at,
        lastEventLabel: r.last_event_label,
        checkedAt: r.updated_at,
        events: ((r.timeline ?? []) as any[]).map((e) => ({
          at: e.event_time_utc ? `${String(e.event_time_utc).replace(" ", "T")}Z` : (e.eventTimeZeroUTC ?? null),
          description: String(e.event_detail ?? e.eventDetail ?? ""),
          location: e.event_location || e.address || null,
          stage: null,
        })),
      })),
    };
  });

// Códigos que estão parados no Track123 (só "info recebida" há 3+ dias) — pra
// testar justamente os casos que hoje não atualizam.
export const listStuckTrackings = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertAdmin(context);
    const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data, error } = await context.supabase.from("shop_order_tracking")
      .select("tracking_number")
      .eq("user_id", context.ownerId)
      .ilike("tracking_status", "%info%")
      .lt("last_event_at", cutoff).gte("last_event_at", since)
      .order("last_event_at", { ascending: true }).limit(40);
    if (error) throw new Error(error.message);
    return { numbers: (data ?? []).map((r: any) => r.tracking_number as string).filter(Boolean) };
  });

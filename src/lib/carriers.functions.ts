import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { addDaysIso, isoTodayUS } from "@/lib/timezone";
import { PROBLEM_LATE_DAYS } from "@/lib/tracking-rules.server";

// Gerencial › Transportadoras: prazo e alfândega por transportadora, pelos
// eventos do rastreio (17track) dos pedidos das lojas ativas.
//  - transportadora: pelo prefixo do código (ZS, TRF, JCZ, JXC…, LZ, YTTG);
//  - postagem: 1º evento real (sem o "informação recebida" / etiqueta criada);
//  - chegada nos EUA: 1º evento de chegada no destino (mesmo critério da página
//    de rastreio);
//  - entrega: evento de entregue;
//  - problema na alfândega: ficou mais de CUSTOMS_SLOW_DAYS entre entrar e sair
//    da alfândega, ou entrou há mais que isso e ainda não saiu nem foi entregue.
// Período pela data do pedido. Pedido com código mas sem eventos conta em
// "sem rastreio" (não entra nos prazos).

type Ctx = { ownerId: string; role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "gerencial");

export const CUSTOMS_SLOW_DAYS = 3;
const DAY = 86_400_000;

const CARRIERS: { key: string; label: string; re: RegExp }[] = [
  { key: "ZS", label: "China Post (ZS)", re: /^ZS/i },
  { key: "TRF", label: "Transfly (TRF)", re: /^TRF/i },
  { key: "JCZ", label: "JCEX (JCZ)", re: /^JCZ/i },
  { key: "JXCZ", label: "SHJX (JXCZ)", re: /^JXC/i },
  { key: "LZ", label: "LZ", re: /^LZ/i },
  { key: "YTTG", label: "YTTG", re: /^YTTG/i },
];
const carrierOf = (code: string) => CARRIERS.find((c) => c.re.test(code))?.key ?? "OUTRAS";
const carrierLabel = (key: string) => CARRIERS.find((c) => c.key === key)?.label ?? "Outras";

const INFO_ONLY = /information received|info received|label created|order created|order received|electronic information|pre-shipment|order info|电子信息/i;
const US_ARRIVAL = /arrived at destination airport|shipment arrived at airport|clearance in progress|under clearance|at destination|import released|inbound into customs|抵达【US】|【美国】|目的国|目的地转运/i;
const DELIVERED = /^delivered\b|has been delivered|已妥投|delivered,/i;
const NOT_DELIVERED = /delivered to/i;
const CUSTOMS_ANY = /customs|clearance|清关|海关/i;
const CUSTOMS_IN = /clearance in progress|under clearance|inbound into customs|started the customs|等待清关|arrived at destination airport/i;
const CUSTOMS_OUT = /clearance to release|clearance processing completed|import released|out of customs|清关完成|released/i;

type Ev = { ts: number; d: string };
function parseEvents(timeline: unknown): Ev[] {
  if (!Array.isArray(timeline)) return [];
  const out: Ev[] = [];
  for (const e of timeline as any[]) {
    const raw = String(e?.event_time_utc ?? "");
    if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) continue;
    const ts = Date.parse(`${raw.replace(" ", "T").slice(0, 19)}Z`);
    if (Number.isFinite(ts)) out.push({ ts, d: String(e?.event_detail ?? "") });
  }
  return out;
}
const firstTs = (evs: Ev[], ok: (d: string) => boolean) => {
  let m: number | null = null;
  for (const e of evs) if (ok(e.d) && (m == null || e.ts < m)) m = e.ts;
  return m;
};

type Acc = {
  pedidos: number; comRastreio: number; entregues: number; emTransito: number; atrasados: number;
  eua: number[]; entrega: number[]; alfPassou: number; alfProblema: number;
  porMes: Map<string, number[]>;
};
const newAcc = (): Acc => ({ pedidos: 0, comRastreio: 0, entregues: 0, emTransito: 0, atrasados: 0, eua: [], entrega: [], alfPassou: 0, alfProblema: 0, porMes: new Map() });
const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null);
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

export type CarrierRow = {
  key: string; label: string;
  pedidos: number; comRastreio: number; entregues: number; emTransito: number; atrasados: number;
  postagemEua: number | null; nEua: number;
  postagemEntrega: number | null; medianaEntrega: number | null; nEntrega: number;
  alfPassou: number; alfProblema: number;
  porMes: { month: string; dias: number | null; n: number }[];
};

export const getCarrierStats = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ days: z.number().int().positive().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    if (!canView(ctx)) throw new Error("Sem acesso ao Gerencial");
    const { ownerId } = ctx;
    const today = isoTodayUS();
    const from = data.days ? addDaysIso(today, -data.days + 1) : null;

    const { data: shops, error: shopsErr } = await supabaseAdmin.from("shops").select("id,status,archived").eq("user_id", ownerId);
    if (shopsErr) throw new Error(shopsErr.message);
    const shopIds = (shops ?? []).filter((s: any) => s.status === "ativa" && !s.archived).map((s: any) => s.id as string);
    if (!shopIds.length) return { rows: [] as CarrierRow[], months: [] as string[], from, semCodigo: 0 };

    const { data: orders, error: ordersErr } = await selectAllIn<any>(shopIds, (ids) => {
      let q = supabaseAdmin.from("shop_orders").select("id,order_date,tracking_code").eq("user_id", ownerId).in("shop_id", ids);
      if (from) q = q.gte("order_date", from);
      return q;
    });
    if (ordersErr) throw new Error(ordersErr.message);
    const withCode = orders.filter((o) => String(o.tracking_code ?? "").trim());
    const semCodigo = orders.length - withCode.length;

    const { data: tracks, error: tracksErr } = await selectAllIn<any>(withCode.map((o) => o.id as string), (ids) =>
      supabaseAdmin.from("shop_order_tracking").select("id,order_id,tracking_number,tracking_status,timeline").in("order_id", ids));
    if (tracksErr) throw new Error(tracksErr.message);
    const trackByOrder = new Map<string, any>();
    for (const t of tracks) trackByOrder.set(String(t.order_id), t);

    const now = Date.now();
    const acc = new Map<string, Acc>();
    const monthsSet = new Set<string>();
    for (const o of withCode) {
      const t = trackByOrder.get(String(o.id));
      const code = String(t?.tracking_number || o.tracking_code).trim();
      const key = carrierOf(code);
      const a = acc.get(key) ?? newAcc();
      acc.set(key, a);
      a.pedidos++;
      const evs = parseEvents(t?.timeline);
      if (!evs.length) continue;
      a.comRastreio++;

      const post = firstTs(evs, (d) => !INFO_ONLY.test(d));
      const us = firstTs(evs, (d) => US_ARRIVAL.test(d));
      const deliv = firstTs(evs, (d) => DELIVERED.test(d) && !NOT_DELIVERED.test(d));
      const delivered = deliv != null || /^delivered$/i.test(String(t?.tracking_status ?? ""));
      if (delivered) a.entregues++;
      else {
        a.emTransito++;
        const start = Date.parse(`${String(o.order_date).slice(0, 10)}T12:00:00Z`);
        if (Number.isFinite(start) && now - start >= PROBLEM_LATE_DAYS * DAY) a.atrasados++;
      }
      if (post != null && us != null && us > post) a.eua.push((us - post) / DAY);
      if (post != null && deliv != null && deliv > post) {
        const dias = (deliv - post) / DAY;
        a.entrega.push(dias);
        const m = String(o.order_date).slice(0, 7);
        monthsSet.add(m);
        const list = a.porMes.get(m) ?? [];
        list.push(dias);
        a.porMes.set(m, list);
      }
      if (evs.some((e) => CUSTOMS_ANY.test(e.d))) {
        a.alfPassou++;
        const cin = firstTs(evs, (d) => CUSTOMS_IN.test(d));
        const cout = cin == null ? null : evs.filter((e) => e.ts >= cin && CUSTOMS_OUT.test(e.d)).reduce<number | null>((m, e) => (m == null || e.ts < m ? e.ts : m), null);
        const slow = cin != null && (cout != null ? cout - cin > CUSTOMS_SLOW_DAYS * DAY : !delivered && now - cin > CUSTOMS_SLOW_DAYS * DAY);
        if (slow) a.alfProblema++;
      }
    }

    const months = [...monthsSet].sort().slice(-6);
    const order = [...CARRIERS.map((c) => c.key), "OUTRAS"];
    const rows: CarrierRow[] = [...acc.entries()]
      .map(([key, a]) => ({
        key, label: carrierLabel(key),
        pedidos: a.pedidos, comRastreio: a.comRastreio, entregues: a.entregues, emTransito: a.emTransito, atrasados: a.atrasados,
        postagemEua: avg(a.eua), nEua: a.eua.length,
        postagemEntrega: avg(a.entrega), medianaEntrega: median(a.entrega), nEntrega: a.entrega.length,
        alfPassou: a.alfPassou, alfProblema: a.alfProblema,
        porMes: months.map((m) => { const l = a.porMes.get(m) ?? []; return { month: m, dias: avg(l), n: l.length }; }),
      }))
      .sort((x, y) => order.indexOf(x.key) - order.indexOf(y.key));
    return { rows, months, from, semCodigo };
  });

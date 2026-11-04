import { PROBLEM_LATE_DAYS } from "@/lib/tracking-rules.server";

// Gerencial › Transportadoras: prazo e alfândega por transportadora, pelos
// eventos do rastreio (17track) dos pedidos das lojas da coluna "Ativas" do
// Banco de Lojas.
//  - transportadora: pelo prefixo do código (ZS, TRF, JCZ, JXC…, LZ, YTTG);
//  - postagem: 1º evento físico (pacote recebido/coletado/na triagem). Aviso de
//    informação (pedido/etiqueta/dados eletrônicos/预报) e evento vazio nunca contam;
//  - chegada nos EUA: 1º evento de chegada no aeroporto/hub de destino ou de
//    entrada na alfândega dos EUA. Agência de entrega final (投递局, post office)
//    não conta — já é o fim do caminho;
//  - entrega: evento de entregue;
//  - alfândega (destino): entrada = 1º evento de chegada na alfândega; saída =
//    liberação ou, se a transportadora não manda, o 1º evento de movimento depois
//    da entrada (triagem nos EUA, saiu pra entrega…). Problema = mais de
//    CUSTOMS_SLOW_DAYS lá dentro — continua contando depois que o pacote anda
//    (ficou preso demais); "parado agora" = entrou há mais que isso e não saiu.
// Período pela data do pedido. Pedido com código mas sem eventos conta em
// "sem rastreio" (não entra nos prazos).

export const CUSTOMS_SLOW_DAYS = 5;
const DAY = 86_400_000;

export const CARRIERS: { key: string; label: string; re: RegExp }[] = [
  { key: "ZS", label: "China Post (ZS)", re: /^ZS/i },
  { key: "TRF", label: "Transfly (TRF)", re: /^TRF/i },
  { key: "JCZ", label: "JCEX (JCZ)", re: /^JCZ/i },
  { key: "JXCZ", label: "SHJX (JXCZ)", re: /^JXC/i },
  { key: "LZ", label: "LZ", re: /^LZ/i },
  { key: "YTTG", label: "YTTG", re: /^YTTG/i },
];
const carrierOf = (code: string) => CARRIERS.find((c) => c.re.test(code))?.key ?? "OUTRAS";
export const carrierLabel = (key: string) => CARRIERS.find((c) => c.key === key)?.label ?? "Outras";

// Aviso de informação (não é o pacote andando).
const INFO_ONLY = /information (received|sent|has been)|info received|info sent|order info|order information|order (created|received)|label (created|prepared)|electronic (cargo )?information|cargo information|shipment information|pre-?shipment|preparing shipment|awaiting item|预报|订单信息|电子信息/i;
// Evento sem texto de verdade ("(中文:)", vazio, só pontuação).
const JUNK = (d: string) => !/[a-z一-鿿]/i.test(d.replace(/中文/g, ""));
const US_ARRIVAL = /arrived at destination airport|shipment arrived at airport|international flight has arrived|destination hub|clearance (is )?in progress|under clearance|started the customs clearance|inbound into customs|import released|抵达【US】|到达【美国】海关|目的国|目的地转运|到达寄达地|到达目的地|进口海关/i;
const NOT_US_ARRIVAL = /投递局|post office|delivery station/i;
const DELIVERED = /^delivered\b|has been delivered|已妥投|delivered,/i;
const NOT_DELIVERED = /delivered to/i;
// Alfândega do destino: entrada, liberação e o que ainda é "dentro" dela.
const CUSTOMS_IN = /clearance (is )?in progress|under clearance|inbound into customs|started the customs clearance|等待清关|到达【美国】海关|送交境外进口海关|进口海关/i;
const CUSTOMS_OUT = /clearance (processing )?completed|clearance to release|import released|out of customs|customs released|released by customs(?! at origin)|清关完成|海关放行|已放行/i;
const CUSTOMS_STILL = /customs|clearance|清关|海关|airport|flight|航班|飞机|抵达|arrived at destination/i;

type Ev = { ts: number; d: string };
export function parseEvents(timeline: unknown): Ev[] {
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
  eua: number[]; entrega: number[]; alfPassou: number; alfProblema: number; alfParado: number;
  porMes: Map<string, number[]>;
};
const newAcc = (): Acc => ({ pedidos: 0, comRastreio: 0, entregues: 0, emTransito: 0, atrasados: 0, eua: [], entrega: [], alfPassou: 0, alfProblema: 0, alfParado: 0, porMes: new Map() });
export const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null);
export const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

export type CarrierRow = {
  key: string; label: string;
  pedidos: number; comRastreio: number; entregues: number; emTransito: number; atrasados: number;
  postagemEua: number | null; nEua: number;
  postagemEntrega: number | null; medianaEntrega: number | null; nEntrega: number;
  alfPassou: number; alfProblema: number; alfParado: number;
  porMes: { month: string; dias: number | null; n: number }[];
};
// Soma de todas as transportadoras (cards do topo).
export type CarrierTotals = {
  pedidos: number; entregues: number; emTransito: number;
  postagemEua: number | null; postagemEntrega: number | null;
  alfPassou: number; alfProblema: number;
};

export function aggregate(orders: any[], trackByOrder: Map<string, any>, now: number) {
  const acc = new Map<string, Acc>();
  const monthsSet = new Set<string>();
  for (const o of orders) {
    const t = trackByOrder.get(String(o.id));
    const code = String(t?.tracking_number || o.tracking_code).trim();
    const key = carrierOf(code);
    const a = acc.get(key) ?? newAcc();
    acc.set(key, a);
    a.pedidos++;
    const evs = parseEvents(t?.timeline);
    if (!evs.length) continue;
    a.comRastreio++;

    const post = firstTs(evs, (d) => !INFO_ONLY.test(d) && !JUNK(d));
    const us = firstTs(evs, (d) => US_ARRIVAL.test(d) && !NOT_US_ARRIVAL.test(d));
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
    const cin = firstTs(evs, (d) => CUSTOMS_IN.test(d));
    if (cin != null) {
      a.alfPassou++;
      // Saída: liberação ou o 1º movimento depois da entrada (o que vier antes).
      const after = evs.filter((e) => e.ts > cin);
      const release = firstTs(after, (d) => CUSTOMS_OUT.test(d));
      const moved = firstTs(after, (d) => !CUSTOMS_STILL.test(d) && !INFO_ONLY.test(d) && !JUNK(d));
      const cout = release != null && moved != null ? Math.min(release, moved) : release ?? moved;
      if (cout != null) {
        if (cout - cin > CUSTOMS_SLOW_DAYS * DAY) a.alfProblema++;
      } else if (now - cin > CUSTOMS_SLOW_DAYS * DAY) {
        a.alfProblema++;
        a.alfParado++;
      }
    }
  }
  const all = [...acc.values()];
  const totals: CarrierTotals = {
    pedidos: all.reduce((x, a) => x + a.pedidos, 0),
    entregues: all.reduce((x, a) => x + a.entregues, 0),
    emTransito: all.reduce((x, a) => x + a.emTransito, 0),
    postagemEua: avg(all.flatMap((a) => a.eua)),
    postagemEntrega: avg(all.flatMap((a) => a.entrega)),
    alfPassou: all.reduce((x, a) => x + a.alfPassou, 0),
    alfProblema: all.reduce((x, a) => x + a.alfProblema, 0),
  };
  return { acc, monthsSet, totals };
}


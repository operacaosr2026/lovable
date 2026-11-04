import { PROBLEM_LATE_DAYS } from "@/lib/tracking-rules.server";
import { eventTextKey } from "@/lib/tracking-display";
import { phaseResolver, type Phase } from "@/lib/tracking-phases";

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
// Fase de cada texto: tracking-phases.ts (regras + escolha na mão).
// Período pela data do pedido. Pedido com código mas sem eventos conta em
// "sem rastreio" (não entra nos prazos).

export const CUSTOMS_SLOW_DAYS = 5;
const DAY = 86_400_000;
// Fases que tiram o pacote da alfândega (sem regra conta como movimento).
const LEAVES_CUSTOMS = new Set<Phase | null>(["alfandega_saida", "movimento", "entregue", null]);

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
  eua: number[]; entrega: number[]; alfPassou: number; alfProblema: number; alfParado: number; reenviados: number;
  porMes: Map<string, number[]>;
};
const newAcc = (): Acc => ({ pedidos: 0, comRastreio: 0, entregues: 0, emTransito: 0, atrasados: 0, eua: [], entrega: [], alfPassou: 0, alfProblema: 0, alfParado: 0, reenviados: 0, porMes: new Map() });
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
  alfPassou: number; alfProblema: number; alfParado: number; reenviados: number;
  porMes: { month: string; dias: number | null; n: number }[];
};
// Soma de todas as transportadoras (cards do topo).
export type CarrierTotals = {
  pedidos: number; entregues: number; emTransito: number;
  postagemEua: number | null; postagemEntrega: number | null;
  alfPassou: number; alfProblema: number; reenviados: number;
};

// unknown: textos sem regra (chave → exemplo e quantas vezes apareceu).
export function aggregate(orders: any[], trackByOrder: Map<string, any>, now: number, phaseOf = phaseResolver(),
  unknown = new Map<string, { example: string; count: number }>()) {
  const acc = new Map<string, Acc>();
  const monthsSet = new Set<string>();
  for (const o of orders) {
    const t = trackByOrder.get(String(o.id));
    const code = String(t?.tracking_number || o.tracking_code).trim();
    const key = carrierOf(code);
    const a = acc.get(key) ?? newAcc();
    acc.set(key, a);
    a.pedidos++;
    // Pacotes descartados (código trocado): contam como reenvio contra a
    // transportadora do código antigo.
    const history: { code?: string; until?: string }[] = Array.isArray(o.tracking_code_history) ? o.tracking_code_history : [];
    for (const h of history) {
      const old = String(h?.code ?? "").trim();
      if (!old || old.toUpperCase() === code.toUpperCase()) continue;
      const k = carrierOf(old);
      const b = acc.get(k) ?? newAcc();
      acc.set(k, b);
      b.reenviados++;
      // Reenvio = pacote travado na alfândega (confirmado pela operação em
      // 04/11/2026 pros 32 reenvios até então): conta como problema na
      // alfândega da transportadora do pacote descartado.
      b.alfPassou++;
      b.alfProblema++;
    }
    // Reenviado: o relógio do "atrasado" conta da troca (igual ao resto do sistema).
    const resentAt: string | null = history[history.length - 1]?.until ?? o.tracking_code_manual_at ?? null;
    const evs = parseEvents(t?.timeline);
    if (!evs.length) continue;
    a.comRastreio++;

    const ph = (d: string) => phaseOf(d);
    for (const e of evs) {
      if (ph(e.d) != null) continue;
      const k = eventTextKey(e.d);
      if (!k) continue;
      const u = unknown.get(k);
      if (u) u.count++; else unknown.set(k, { example: e.d, count: 1 });
    }
    const post = firstTs(evs, (d) => ph(d) !== "aviso");
    const us = firstTs(evs, (d) => ph(d) === "chegada_eua" || ph(d) === "alfandega_entrada");
    const deliv = firstTs(evs, (d) => ph(d) === "entregue");
    const delivered = deliv != null || /^delivered$/i.test(String(t?.tracking_status ?? ""));
    if (delivered) a.entregues++;
    else {
      a.emTransito++;
      const start = resentAt ? Date.parse(resentAt) : Date.parse(`${String(o.order_date).slice(0, 10)}T12:00:00Z`);
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
    const cin = firstTs(evs, (d) => ph(d) === "alfandega_entrada");
    if (cin != null) {
      a.alfPassou++;
      // Saída: liberação ou o 1º movimento depois da entrada (o que vier antes).
      // Texto sem regra conta como movimento (igual antes de ter as fases).
      const cout = firstTs(evs.filter((e) => e.ts > cin), (d) => LEAVES_CUSTOMS.has(ph(d)));
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
    reenviados: all.reduce((x, a) => x + a.reenviados, 0),
  };
  return { acc, monthsSet, totals, unknown };
}


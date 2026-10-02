// Inteligência SRX — investigação em camadas, por cima do cruzamento simples
// (patterns.ts). Só cálculo, sem IA:
//  - interações (A + B bem pior que A ou B sozinhos);
//  - casos × controles no mesmo dia da jornada (como estavam, no dia N, os
//    pedidos que viraram chargeback e os que não viraram);
//  - sinais precursores (estado de cada chargeback em T-10, T-5, T-1);
//  - limiares (taxa por faixa de dias — onde o risco muda);
//  - grupos de chargeback (relâmpago, antes da entrega, depois da entrega…);
//  - mistura semanal das linhas de transporte (o que mudou e quando).

import type { AuditedOrder } from "@/lib/intel/supplier-audit";
import type { PatternRow } from "@/lib/intel/patterns";

const DAY = 86_400_000;
const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (a: number, b: number) => (b ? r1((a / b) * 100) : null);

function logFact(n: number) { const t = new Float64Array(n + 2); for (let i = 2; i <= n + 1; i++) t[i] = t[i - 1] + Math.log(i); return t; }
function fisherGreater(a: number, n: number, K: number, N: number, lf: Float64Array) {
  const lc = (x: number, y: number) => lf[x] - lf[y] - lf[x - y];
  const d = lc(N, n); let p = 0;
  for (let k = a; k <= Math.min(n, K); k++) if (n - k <= N - K) p += Math.exp(lc(K, k) + lc(N - K, n - k) - d);
  return Math.min(1, p);
}

// ─── Interações entre características ────────────────────────────────────────
export function interactions(rows: PatternRow[], outcomes: string[], opts: { minGroup?: number; minEvents?: number } = {}) {
  const minGroup = opts.minGroup ?? 15, minEvents = opts.minEvents ?? 3;
  const lf = logFact(rows.length + 2);
  const out: any[] = [];
  for (const o of outcomes) {
    const known = rows.filter((r) => r.outcomes[o] != null);
    const N = known.length, K = known.filter((r) => r.outcomes[o]).length;
    if (K < minEvents) continue;
    const baseRate = K / N;
    // pares (característica=valor) com volume
    const keys = new Map<string, number[]>();
    known.forEach((r, i) => { for (const [f, v] of Object.entries(r.features)) if (v != null) { const k = `${f}=${v}`; keys.set(k, [...(keys.get(k) ?? []), i]); } });
    const singles = [...keys.entries()].filter(([, ix]) => ix.length >= minGroup);
    const rateOf = (ix: number[]) => ix.filter((i) => known[i].outcomes[o]).length / ix.length;
    for (let a = 0; a < singles.length; a++) for (let b = a + 1; b < singles.length; b++) {
      const [ka, ia] = singles[a], [kb, ib] = singles[b];
      if (ka.split("=")[0] === kb.split("=")[0]) continue;
      const setB = new Set(ib);
      const both = ia.filter((i) => setB.has(i));
      if (both.length < minGroup) continue;
      const ev = both.filter((i) => known[i].outcomes[o]).length;
      if (ev < minEvents) continue;
      const rc = ev / both.length, ra = rateOf(ia), rb = rateOf(ib);
      if (rc < Math.max(ra, rb) * 1.5 || rc < baseRate * 2) continue;
      const p = fisherGreater(ev, both.length, K, N, lf);
      if (p > 0.05) continue;
      out.push({
        problema: o, combinacao: `${ka} + ${kb}`, pedidos: both.length, com_problema: ev, taxa_pct: r1(rc * 100),
        taxa_so_a: r1(ra * 100), taxa_so_b: r1(rb * 100), taxa_geral_pct: r1(baseRate * 100), p_valor: Math.round(p * 10000) / 10000,
      });
    }
  }
  return out.sort((x, y) => x.p_valor - y.p_valor).slice(0, 15);
}

// ─── Estado do pedido em um momento da jornada ───────────────────────────────
type State = { situacao: "sem_codigo" | "codigo_sem_movimentacao" | "em_transito" | "parado_3d" | "entregue"; eventos: number; dias_sem_evento: number | null };
function stateAt(e: AuditedOrder, t: number): State {
  const evs = e.steps.filter((s) => s.kind === "evento" && Date.parse(s.at) <= t);
  const real = evs.filter((s) => s.stage !== "info");
  const last = real.at(-1);
  const gap = last ? (t - Date.parse(last.at)) / DAY : null;
  const situacao = e.deliveredAt && Date.parse(e.deliveredAt) <= t ? "entregue"
    : real.length ? (gap != null && gap > 3 ? "parado_3d" : "em_transito")
    : e.codeAt && Date.parse(e.codeAt) <= t ? "codigo_sem_movimentacao" : "sem_codigo";
  return { situacao, eventos: real.length, dias_sem_evento: gap == null ? null : r1(gap) };
}

// Casos × controles no dia N da jornada: só pedidos maduros (25+ dias).
export function caseControlByDay(envios: AuditedOrder[], now: number, days = [5, 7, 9, 12]) {
  const mature = envios.filter((e) => (now - Date.parse(e.createdAt)) / DAY >= 25 || e.chargeback);
  return days.map((d) => {
    const at = (e: AuditedOrder) => Date.parse(e.createdAt) + d * DAY;
    // caso = chargeback aberto DEPOIS do dia d (no dia d ainda dava pra agir)
    const cases = mature.filter((e) => e.chargeback && Date.parse(e.chargeback.initiatedAt) > at(e));
    const controls = mature.filter((e) => !e.chargeback);
    const dist = (xs: AuditedOrder[]) => {
      const m: Record<string, number> = {};
      for (const e of xs) { const s = stateAt(e, at(e)).situacao; m[s] = (m[s] ?? 0) + 1; }
      return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { n: v, pct: pct(v, xs.length) }]));
    };
    const evMean = (xs: AuditedOrder[]) => xs.length ? r1(xs.reduce((s, e) => s + stateAt(e, at(e)).eventos, 0) / xs.length) : null;
    // risco por situação no dia d: entre os pedidos naquela situação, quantos viraram chargeback depois
    const all = [...cases, ...controls];
    const risk: Record<string, { pedidos: number; chargebacks_depois: number; taxa_pct: number | null }> = {};
    for (const e of all) {
      const s = stateAt(e, at(e)).situacao; const g = risk[s] ?? { pedidos: 0, chargebacks_depois: 0, taxa_pct: null };
      g.pedidos++; if (e.chargeback) g.chargebacks_depois++; risk[s] = g;
    }
    for (const g of Object.values(risk)) g.taxa_pct = pct(g.chargebacks_depois, g.pedidos);
    return {
      dia_da_jornada: d, casos: cases.length, controles: controls.length,
      situacao_dos_casos: dist(cases), situacao_dos_controles: dist(controls),
      eventos_medios_casos: evMean(cases), eventos_medios_controles: evMean(controls),
      taxa_de_chargeback_por_situacao_no_dia: risk,
    };
  });
}

// Sinais precursores: estado de cada chargeback em T-10, T-5, T-1 da disputa.
export function precursors(envios: AuditedOrder[]) {
  return envios.filter((e) => e.chargeback).map((e) => {
    const t = Date.parse(e.chargeback!.initiatedAt);
    const s = (d: number) => { const st = stateAt(e, t - d * DAY); return `${st.situacao}${st.dias_sem_evento != null ? ` (${st.dias_sem_evento}d sem evento)` : ""}`; };
    return {
      pedido: e.orderNumber, motivo: e.chargeback!.reason, dia_da_disputa: r1((t - Date.parse(e.createdAt)) / DAY),
      t_menos_10: s(10), t_menos_5: s(5), t_menos_1: s(1), no_dia: s(0),
    };
  });
}

// ─── Limiares: taxa por faixa ────────────────────────────────────────────────
export function thresholds(envios: AuditedOrder[], now: number) {
  const mature = envios.filter((e) => (now - Date.parse(e.createdAt)) / DAY >= 25 || e.chargeback);
  const vars: [string, (e: AuditedOrder) => number | null, [number, number, string][]][] = [
    ["dias_uteis_do_pedido_ate_1a_movimentacao", (e) => e.bdOrderToMove, [[0, 2, "0–2"], [3, 4, "3–4"], [5, 6, "5–6"], [7, 99, "7+"]]],
    ["dias_uteis_do_codigo_ate_1a_movimentacao", (e) => e.bdCodeToMove, [[0, 1, "0–1"], [2, 3, "2–3"], [4, 6, "4–6"], [7, 99, "7+"]]],
    ["maior_parada_sem_evento_dias", (e) => e.maxGapDays, [[0, 2.99, "0–2"], [3, 4.99, "3–4"], [5, 7.99, "5–7"], [8, 99, "8+"]]],
    ["dias_da_1a_movimentacao_ate_entrega", (e) => e.dMoveToDelivery, [[0, 8.99, "até 8"], [9, 11.99, "9–11"], [12, 14.99, "12–14"], [15, 18.99, "15–18"], [19, 99, "19+"]]],
  ];
  return vars.map(([name, get, bins]) => ({
    variavel: name,
    faixas: bins.map(([lo, hi, label]) => {
      const xs = mature.filter((e) => { const v = get(e); return v != null && v >= lo && v <= hi; });
      return { faixa: label, pedidos: xs.length, chargebacks: xs.filter((e) => e.chargeback).length, chargeback_pct: pct(xs.filter((e) => e.chargeback).length, xs.length),
        reembolsos: xs.filter((e) => e.refunded).length, reembolso_pct: pct(xs.filter((e) => e.refunded).length, xs.length) };
    }),
  }));
}

// ─── Grupos de chargeback ────────────────────────────────────────────────────
export function chargebackGroups(envios: AuditedOrder[], contacted: Set<string>) {
  const cbs = envios.filter((e) => e.chargeback);
  const groupOf = (e: AuditedOrder) => {
    const t = Date.parse(e.chargeback!.initiatedAt), dDay = (t - Date.parse(e.createdAt)) / DAY;
    if (dDay <= 3) return "relampago (até 3 dias da compra)";
    if (!e.deliveredAt || Date.parse(e.deliveredAt) > t) return e.firstMoveAt && Date.parse(e.firstMoveAt) <= t ? "antes da entrega, já em trânsito" : "antes da postagem real";
    const after = (t - Date.parse(e.deliveredAt)) / DAY;
    return after <= 1 ? "no dia da entrega" : after <= 3 ? "1–3 dias depois da entrega" : after <= 7 ? "4–7 dias depois da entrega" : "mais de 7 dias depois da entrega";
  };
  const m = new Map<string, AuditedOrder[]>();
  for (const e of cbs) { const g = groupOf(e); m.set(g, [...(m.get(g) ?? []), e]); }
  return [...m.entries()].map(([g, xs]) => ({
    grupo: g, chargebacks: xs.length, valor: r1(xs.reduce((s, e) => s + e.revenue, 0)),
    motivos: [...new Set(xs.map((e) => e.chargeback!.reason))],
    linhas: [...new Set(xs.map((e) => (e.trackingCode ?? "").match(/^[A-Z]+/)?.[0] ?? "sem código"))],
    com_contato_no_atendimento: xs.filter((e) => e.orderNumber && contacted.has(e.orderNumber)).length,
    pedidos: xs.map((e) => e.orderNumber),
  })).sort((a, b) => b.chargebacks - a.chargebacks);
}

// ─── Mistura semanal das linhas de transporte ────────────────────────────────
export function weeklyLineMix(envios: AuditedOrder[], now: number) {
  const weekOf = (iso: string) => { const d = new Date(iso); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const lineOf = (e: AuditedOrder) => (e.trackingCode ?? "").match(/^[A-Z]+/)?.[0]?.replace(/^JXC[A-Z]*$/, "JXC…") ?? "sem código";
  const weeks = new Map<string, AuditedOrder[]>();
  for (const e of envios) { const w = weekOf(e.createdAt); weeks.set(w, [...(weeks.get(w) ?? []), e]); }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([w, es]) => {
    const lines = new Map<string, AuditedOrder[]>();
    for (const e of es) { const l = lineOf(e); lines.set(l, [...(lines.get(l) ?? []), e]); }
    return {
      semana_de: w, pedidos: es.length, semana_recente_incompleta: (now - Date.parse(w)) / DAY < 14,
      linhas: Object.fromEntries([...lines.entries()].map(([l, xs]) => {
        const moved = xs.filter((e) => e.bdCodeToMove != null).map((e) => e.bdCodeToMove!).sort((a, b) => a - b);
        const deliv = xs.filter((e) => e.dMoveToDelivery != null).map((e) => e.dMoveToDelivery!).sort((a, b) => a - b);
        return [l, {
          pedidos: xs.length, participacao_pct: pct(xs.length, es.length),
          mediana_codigo_ate_mov_dias_uteis: moved.length ? moved[Math.floor(moved.length / 2)] : null,
          mediana_mov_ate_entrega_dias: deliv.length ? r1(deliv[Math.floor(deliv.length / 2)]) : null,
          chargebacks: xs.filter((e) => e.chargeback).length, reembolsos: xs.filter((e) => e.refunded).length,
        }];
      })),
    };
  });
}

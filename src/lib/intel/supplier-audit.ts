import { businessDaysBetween, type PostingCalendar } from "@/lib/logistics-kpis";

// Inteligência SRX — entrega 1: linha do tempo do pedido + auditoria do
// fornecedor pelo rastreio. Só cálculo (sem banco, sem IA): recebe os pedidos já
// carregados e devolve tempos, média normal (baseline), envios classificados com
// evidências e o score de confiabilidade logística com os fatores à mostra.
//
// Regra central: CÓDIGO CRIADO NÃO É PEDIDO ENVIADO. A postagem é a 1ª
// movimentação real no rastreio (pulando "informação recebida"/etiqueta).

const DAY = 86_400_000;

// ─── Etapas do rastreio (pelo texto do evento, inglês e chinês) ─────────────
export type Stage =
  | "info" | "origem" | "exportacao" | "voo" | "alfandega_destino" | "transporte_local"
  | "saiu_entrega" | "tentativa" | "entregue" | "problema" | "transito" | "outro";

export const STAGE_LABEL: Record<Stage, string> = {
  info: "Informação/etiqueta (não postado)", origem: "Coleta/processamento na origem", exportacao: "Exportação",
  voo: "Voo / saída do país", alfandega_destino: "Alfândega no destino", transporte_local: "Transportadora local (EUA)",
  saiu_entrega: "Saiu para entrega", tentativa: "Tentativa de entrega / aguardando retirada", entregue: "Entregue", problema: "Problema/exceção", transito: "Em trânsito", outro: "Movimentação",
};

// Ordem importa: o primeiro que casar vence.
const STAGE_RULES: [Stage, RegExp][] = [
  ["entregue", /^(?:[\w ,#.-]*,\s*)?delivered\b(?!\s+to\b)|has been delivered|已妥投|delivered\.\s*position/i],
  ["tentativa", /attempt|notice left|unable to deliver|available for pickup|redelivery|无法投递|未妥投|投递失败/i],
  ["problema", /exception|returned|return to sender|undeliverable|insufficient address|退回|异常|expired|lost|damaged/i],
  ["saiu_entrega", /out for delivery|出门投递|安排投递|preparing for delivery/i],
  ["info", /information received|info received|信息已收到|label created|pre-shipment|electronic information|order created|awaiting item|中文:\s*\)$/i],
  ["transporte_local", /delivered to local carrier|已交承运商|寄达地(?!海关)|投递局|usps|gofo|post office|delivery station|local facility|destination hub|destination facility|目的地转运|regional hub|parcel received by|jfk\d|ord\d|lax\d/i],
  ["exportacao", /export|出口|released by customs at origin/i],
  ["alfandega_destino", /destination.*(clearance|customs)|(clearance|customs).*destination|import released|under clearance|customs clearance|目的国清关|等待清关|海关查验|进口海关|海关允许进口|clearance processing/i],
  ["voo", /airport|airline|airway bill|flight|启运|抵达|航空公司|飞机|departure from the starting port|departed from origin country|shipment arrived at airport/i],
  // Evento com local nos EUA (China Post: "US, 邮件到达处理中心", "【US Oklahoma】") já é a etapa local.
  ["transporte_local", /(^|【|,\s*)US[\s,，】]/],
  ["origem", /sorting center|picked up|收取邮件|取件|consignment received|warehouse|sort facility|完成分拣|处理中心|loaded on vehicle|shipment (arrived at|departed from) facility|in transit to next facility|transit point|邮件离开|邮件到达|正在发往/i],
  ["transito", /facility|hub|in transit|departed|arrived|delay in transit|经转局/i],
];

export function stageOf(detail: string): Stage {
  const t = (detail ?? "").trim();
  if (!t) return "outro";
  for (const [stage, re] of STAGE_RULES) if (re.test(t)) return stage;
  return "outro";
}

// Instante UTC do evento do rastreio: event_time_utc vem "2026-09-23 03:36:37" (sem fuso).
function eventMs(e: any): number | null {
  const m = String(e?.event_time_utc ?? "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  const ms = m ? Date.parse(`${m[1]}T${m[2]}Z`) : Date.parse(e?.eventTimeZeroUTC ?? e?.date ?? "");
  return Number.isFinite(ms) ? ms : null;
}

// ─── Entrada ─────────────────────────────────────────────────────────────────
export type AuditOrderInput = {
  id: string; shopId: string; shopName: string; orderNumber: string | null; revenue: number;
  createdAt: string;               // compra (created_at_shopify)
  paidAt: string | null;           // marcado como pago ao fornecedor (data)
  fulfillments: { created_at?: string; tracking_number?: string | null; tracking_numbers?: string[] | null; status?: string }[];
  trackingStatus: string | null;   // status geral do rastreio (17track)
  timeline: any[] | null;          // eventos do rastreio (17track)
  deliveredAt: string | null;      // shop_orders.delivered_at (fallback sem timeline)
  financialStatus: string | null;
  chargeback: { reason: string | null; initiatedAt: string } | null;
  // Características do pedido pro cruzamento de dados (patterns.ts).
  attrs?: {
    state: string | null; billingZip: string | null; shippingZip: string | null; landing: string | null; userAgent: string | null;
    customerCreatedAt: string | null; email: string | null; phone: string | null; size: string | null; quantity: number | null;
    acceptsMarketing: boolean | null; brand: string | null; risk: string | null;
    // Reembolso automático por alerta (Ethoca/CDRN/RDR): o cliente foi ao banco,
    // o alerta devolveu antes de virar disputa.
    alertRefundAt: string | null;
  };
};

export type TimelineStep = { at: string; kind: string; label: string; detail?: string; stage?: Stage };
export type Severity = "normal" | "atencao" | "suspeito" | "altamente_suspeito";
const SEV_RANK: Record<Severity, number> = { normal: 0, atencao: 1, suspeito: 2, altamente_suspeito: 3 };

export type AuditedOrder = {
  id: string; shopName: string; orderNumber: string | null; revenue: number; trackingCode: string | null;
  createdAt: string; codeAt: string | null; firstMoveAt: string | null; deliveredAt: string | null; lastEventAt: string | null;
  // tempos em dias corridos (decimais)
  dOrderToCode: number | null; dCodeToMove: number | null; dOrderToMove: number | null; dMoveToDelivery: number | null;
  // postagem em dias úteis (mesma regra do TM Postagem)
  bdOrderToMove: number | null; bdCodeToMove: number | null;
  maxGapDays: number | null; daysSinceLastEvent: number | null;
  severity: Severity; flags: { key: string; severity: Severity; text: string }[];
  steps: TimelineStep[]; unclassified: string[];
  refunded: boolean; chargeback: AuditOrderInput["chargeback"];
};

const days = (a: number | null, b: number | null) => (a != null && b != null ? (b - a) / DAY : null);
const fmtD = (ms: number) => new Date(ms).toLocaleDateString("pt-BR", { timeZone: "America/New_York", day: "2-digit", month: "2-digit" });
const n1 = (x: number) => x.toFixed(1).replace(".", ",");

// ─── Linha do tempo + tempos de um pedido ────────────────────────────────────
function buildOrder(o: AuditOrderInput, now: number) {
  const created = Date.parse(o.createdAt);
  const codes = new Set<string>();
  let codeAt: number | null = null;
  for (const f of o.fulfillments ?? []) {
    if (f.status === "cancelled") continue;
    const nums = [...(f.tracking_numbers ?? []), f.tracking_number].filter(Boolean) as string[];
    if (!nums.length) continue;
    nums.forEach((n) => codes.add(n));
    const at = f.created_at ? Date.parse(f.created_at) : NaN;
    if (Number.isFinite(at) && (codeAt == null || at < codeAt)) codeAt = at;
  }
  const events = ((o.timeline ?? []) as any[])
    .map((e) => ({ ms: eventMs(e), detail: String(e?.event_detail ?? e?.eventDetail ?? ""), loc: e?.event_location ?? null }))
    .filter((e): e is { ms: number; detail: string; loc: any } => e.ms != null)
    .sort((a, b) => a.ms - b.ms)
    .map((e) => ({ ...e, stage: stageOf(e.detail) }));
  const real = events.filter((e) => e.stage !== "info");
  const firstMove = real[0]?.ms ?? null;
  const delivEv = real.find((e) => e.stage === "entregue");
  const deliveredMs = delivEv?.ms ?? (o.deliveredAt ? Date.parse(`${o.deliveredAt.slice(0, 10)}T12:00:00Z`) : null);
  const lastEvent = events.at(-1)?.ms ?? null;
  let maxGap: number | null = null;
  for (let i = 1; i < real.length; i++) {
    if (real[i - 1].stage === "entregue") break;
    const g = (real[i].ms - real[i - 1].ms) / DAY;
    if (maxGap == null || g > maxGap) maxGap = g;
  }
  const paid = o.paidAt ? Date.parse(`${o.paidAt.slice(0, 10)}T12:00:00Z`) : null;

  const steps: TimelineStep[] = [{ at: new Date(created).toISOString(), kind: "compra", label: "Compra" }];
  if (paid) steps.push({ at: new Date(paid).toISOString(), kind: "fornecedor", label: "Marcado como pago ao fornecedor" });
  if (codeAt) steps.push({ at: new Date(codeAt).toISOString(), kind: "codigo", label: `Código de rastreio criado${codes.size > 1 ? ` (${codes.size} códigos)` : ""}` });
  for (const e of events) steps.push({ at: new Date(e.ms).toISOString(), kind: "evento", label: STAGE_LABEL[e.stage], detail: e.detail, stage: e.stage });
  if (!delivEv && o.deliveredAt) steps.push({ at: new Date(deliveredMs!).toISOString(), kind: "entrega", label: "Entregue (sem evento no rastreio)" });
  if (o.chargeback) steps.push({ at: o.chargeback.initiatedAt, kind: "chargeback", label: `Chargeback${o.chargeback.reason ? ` — ${o.chargeback.reason}` : ""}` });
  steps.sort((a, b) => a.at.localeCompare(b.at));

  return {
    created, codeAt, firstMove, deliveredMs, lastEvent, maxGap, codes, events, steps,
    hasLocal: real.some((e) => e.stage === "transporte_local" || e.stage === "saiu_entrega"),
    unclassified: events.filter((e) => e.stage === "outro").map((e) => e.detail),
    daysSinceLast: lastEvent != null && !deliveredMs ? (now - lastEvent) / DAY : null,
  };
}

// ─── Baseline: o normal da operação ─────────────────────────────────────────
function quantile(xs: number[], q: number): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const stat = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && x >= 0);
  return { n: v.length, mediana: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9) };
};

// cal: feriados do TM Postagem — postagem conta em dias úteis (sem fim de semana).
export type AuditOptions = { now?: number; baselineDays?: number; recentDays?: number; cal?: PostingCalendar };

export function auditSupplier(orders: AuditOrderInput[], opts: AuditOptions = {}) {
  const now = opts.now ?? Date.now();
  const recentDays = opts.recentDays ?? 7;
  const baselineDays = opts.baselineDays ?? 60;
  const built = orders.map((o) => ({ o, b: buildOrder(o, now) }));
  const age = (x: { b: { created: number } }) => (now - x.b.created) / DAY;

  // Baseline = pedidos de 8 a 67 dias atrás; recentes = últimos 7 dias (só os que já tiveram o evento).
  const base = built.filter((x) => age(x) > recentDays && age(x) <= recentDays + baselineDays);
  const recent = built.filter((x) => age(x) <= recentDays + 7);
  const interval = (xs: typeof built, f: (b: any) => number | null) => stat(xs.map((x) => f(x.b)));
  const intervals = {
    pedido_ate_codigo: { label: "Pedido → código criado", base: interval(base, (b) => days(b.created, b.codeAt)), recentes: interval(recent, (b) => days(b.created, b.codeAt)) },
    codigo_ate_movimentacao: { label: "Código criado → 1ª movimentação real", base: interval(base, (b) => days(b.codeAt, b.firstMove)), recentes: interval(recent, (b) => days(b.codeAt, b.firstMove)) },
    pedido_ate_movimentacao: { label: "Pedido → 1ª movimentação real", base: interval(base, (b) => days(b.created, b.firstMove)), recentes: interval(recent, (b) => days(b.created, b.firstMove)) },
    movimentacao_ate_entrega: { label: "1ª movimentação → entrega", base: interval(base, (b) => days(b.firstMove, b.deliveredMs)), recentes: interval(recent, (b) => days(b.firstMove, b.deliveredMs)) },
    maior_parada: { label: "Maior intervalo sem evento (após postar)", base: interval(base, (b) => b.maxGap), recentes: interval(recent, (b) => b.maxGap) },
  };

  // % sem 1ª movimentação após T horas do pedido — só pedidos com mais de T de idade
  // (senão os recentes pareceriam piores só por ainda não ter dado tempo).
  const noMove = [24, 48, 72, 120, 168].map((h) => {
    const T = h / 24;
    const pct = (xs: typeof built) => {
      const elig = xs.filter((x) => age(x) >= T);
      const late = elig.filter((x) => x.b.firstMove == null || days(x.b.created, x.b.firstMove)! > T);
      return { n: elig.length, sem_movimentacao: late.length, pct: elig.length ? Math.round((late.length / elig.length) * 1000) / 10 : null };
    };
    const recentElig = built.filter((x) => age(x) >= T && age(x) <= T + recentDays);
    const baseElig = built.filter((x) => age(x) > T + recentDays && age(x) <= T + recentDays + baselineDays);
    return { horas: h, recentes: pct(recentElig), base: pct(baseElig) };
  });

  // Limites de cada envio: tirados do normal da operação (p90 da base), com piso.
  const p90 = (k: keyof typeof intervals, floor: number) => Math.max(floor, intervals[k].base.p90 ?? floor);
  const lim = {
    codigoMov: p90("codigo_ate_movimentacao", 3),
    pedidoMov: p90("pedido_ate_movimentacao", 4),
    parada: p90("maior_parada", 4),
  };

  // ─── Classificação de cada envio, com evidências ──────────────────────────
  const audited: AuditedOrder[] = built.map(({ o, b }) => {
    const flags: AuditedOrder["flags"] = [];
    const add = (key: string, severity: Severity, text: string) => flags.push({ key, severity, text });
    const dCodeMove = days(b.codeAt, b.firstMove);
    const dOrderMove = days(b.created, b.firstMove);
    const dMoveDeliv = days(b.firstMove, b.deliveredMs);
    const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
    const bdOrderMove = b.firstMove != null ? businessDaysBetween(iso(b.created)!, iso(b.firstMove)!, opts.cal) : null;
    const bdCodeMove = b.firstMove != null && b.codeAt != null ? businessDaysBetween(iso(b.codeAt)!, iso(b.firstMove)!, opts.cal) : null;

    if (b.codeAt && b.firstMove == null && !b.deliveredMs) {
      const d = (now - b.codeAt) / DAY;
      if (d > lim.codigoMov) add("codigo_sem_movimentacao", d > lim.codigoMov * 2 ? "altamente_suspeito" : "suspeito",
        `Código criado em ${fmtD(b.codeAt)} e nenhuma movimentação real há ${n1(d)} dias (normal: até ${n1(lim.codigoMov)})`);
      else if (d > 2) add("codigo_sem_movimentacao", "atencao", `Código criado há ${n1(d)} dias, ainda sem movimentação real`);
    }
    if (dCodeMove != null && dCodeMove > lim.codigoMov) add("postagem_tardia",
      dCodeMove > lim.codigoMov * 2 ? "suspeito" : "atencao",
      `Código criado em ${fmtD(b.codeAt!)}, 1ª movimentação só em ${fmtD(b.firstMove!)} (${n1(dCodeMove)} dias; normal até ${n1(lim.codigoMov)})`);
    if (!b.codeAt && (now - b.created) / DAY > lim.pedidoMov) add("sem_codigo", "atencao",
      `Pedido de ${fmtD(b.created)} ainda sem código de rastreio (${n1((now - b.created) / DAY)} dias)`);
    if (b.daysSinceLast != null && b.firstMove != null && b.daysSinceLast > lim.parada) add("parado_em_transito",
      b.daysSinceLast > lim.parada * 2 ? "suspeito" : "atencao",
      `Sem atualização há ${n1(b.daysSinceLast)} dias (último evento em ${fmtD(b.lastEvent!)}; normal até ${n1(lim.parada)})`);
    else if (b.maxGap != null && b.maxGap > lim.parada * 1.5 && b.deliveredMs) add("parada_longa", "atencao",
      `Ficou ${n1(b.maxGap)} dias sem nenhum evento durante o trânsito`);
    if (dMoveDeliv != null && dMoveDeliv < 3) add("entrega_rapida_incoerente", "altamente_suspeito",
      `Entregue ${n1(dMoveDeliv)} dias depois da 1ª movimentação — incompatível com envio internacional`);
    if (b.deliveredMs && b.firstMove != null && !b.hasLocal) add("entregue_sem_etapas", "suspeito",
      `Marcado como entregue sem passar por transportadora local nem "saiu para entrega" no rastreio`);
    // Sem lista de eventos guardada não é sinal: é falta de dado.
    if (b.deliveredMs && b.firstMove == null && b.events.length > 0) add("entregue_sem_historico", "altamente_suspeito",
      `Marcado como entregue sem nenhuma movimentação real registrada`);
    if (b.codes.size > 1) add("codigo_substituido", "atencao", `${b.codes.size} códigos de rastreio diferentes no mesmo pedido`);
    if (o.trackingStatus && /no_?record|expired/i.test(o.trackingStatus) && (now - (b.codeAt ?? b.created)) / DAY > 3) add("codigo_sem_registro", "suspeito",
      `O 17track não encontra o código (${o.trackingStatus}) — possível código inválido`);
    if (b.events.some((e) => e.stage === "problema")) add("evento_problema", "atencao", `Rastreio registrou exceção/problema`);
    if (o.chargeback && b.deliveredMs && /not_received/.test(o.chargeback.reason ?? "")) add("entregue_contestado", "altamente_suspeito",
      `Rastreio diz entregue, mas o cliente abriu chargeback de "não recebido"`);

    const severity = flags.reduce<Severity>((s, f) => (SEV_RANK[f.severity] > SEV_RANK[s] ? f.severity : s), "normal");
    return {
      id: o.id, shopName: o.shopName, orderNumber: o.orderNumber, revenue: o.revenue, trackingCode: [...b.codes][0] ?? null,
      createdAt: new Date(b.created).toISOString(), codeAt: b.codeAt ? new Date(b.codeAt).toISOString() : null,
      firstMoveAt: b.firstMove ? new Date(b.firstMove).toISOString() : null,
      deliveredAt: b.deliveredMs ? new Date(b.deliveredMs).toISOString() : null,
      lastEventAt: b.lastEvent ? new Date(b.lastEvent).toISOString() : null,
      dOrderToCode: days(b.created, b.codeAt), dCodeToMove: dCodeMove, dOrderToMove: dOrderMove, dMoveToDelivery: dMoveDeliv,
      bdOrderToMove: bdOrderMove, bdCodeToMove: bdCodeMove,
      maxGapDays: b.maxGap, daysSinceLastEvent: b.daysSinceLast,
      severity, flags, steps: b.steps, unclassified: b.unclassified,
      refunded: o.financialStatus === "refunded" || o.financialStatus === "partially_refunded", chargeback: o.chargeback,
    };
  });

  // Mesmo tipo de problema em outros pedidos (pra evidência "padrão semelhante em N").
  const flagCount = new Map<string, number>();
  for (const a of audited) for (const f of a.flags) flagCount.set(f.key, (flagCount.get(f.key) ?? 0) + 1);

  // ─── Relação de cada sinal com chargeback e reembolso ─────────────────────
  // Só pedidos com 25+ dias (deu tempo de virar disputa).
  const matured = audited.filter((a) => (now - Date.parse(a.createdAt)) / DAY >= 25);
  const rate = (xs: AuditedOrder[]) => ({
    pedidos: xs.length, chargebacks: xs.filter((x) => x.chargeback).length, reembolsos: xs.filter((x) => x.refunded).length,
  });
  const allRate = rate(matured);
  const flagKeys = [...new Set(audited.flatMap((a) => a.flags.map((f) => f.key)))];
  const sinaisVsPerda = flagKeys.map((k) => {
    const withF = matured.filter((a) => a.flags.some((f) => f.key === k));
    const without = matured.filter((a) => !a.flags.some((f) => f.key === k));
    return { sinal: k, com: rate(withF), sem: rate(without) };
  }).filter((x) => x.com.pedidos > 0).sort((a, b) => b.com.chargebacks - a.com.chargebacks);

  // ─── Score de confiabilidade logística (0–100), fatores à mostra ──────────
  // Janela: pedidos de 3 a 33 dias (dá tempo de postar); entrega: 18 a 48 dias.
  const win = audited.filter((a) => { const d = (now - Date.parse(a.createdAt)) / DAY; return d >= 3 && d <= 33; });
  const winDeliv = audited.filter((a) => { const d = (now - Date.parse(a.createdAt)) / DAY; return d >= 18 && d <= 48 && a.firstMoveAt; });
  const pctOf = (xs: AuditedOrder[], ok: (a: AuditedOrder) => boolean) => (xs.length ? (xs.filter(ok).length / xs.length) * 100 : null);
  const factors = [
    { key: "postagem", label: "Postado (1ª movimentação) em até 3 dias úteis do pedido", peso: 30, n: win.length,
      valor: pctOf(win, (a) => a.bdOrderToMove != null && a.bdOrderToMove <= 3) },
    { key: "codigo_real", label: "Código com 1ª movimentação em até 2 dias úteis de criado", peso: 25, n: win.filter((a) => a.codeAt).length,
      valor: pctOf(win.filter((a) => a.codeAt), (a) => a.bdCodeToMove != null && a.bdCodeToMove <= 2) },
    { key: "fluidez", label: "Sem parada de mais de 5 dias no trânsito", peso: 20, n: win.filter((a) => a.firstMoveAt).length,
      valor: pctOf(win.filter((a) => a.firstMoveAt), (a) => (a.maxGapDays ?? 0) <= 5 && (a.daysSinceLastEvent ?? 0) <= 5) },
    { key: "entrega", label: "Entregue em até 15 dias da 1ª movimentação", peso: 15, n: winDeliv.length,
      valor: pctOf(winDeliv, (a) => a.dMoveToDelivery != null && a.dMoveToDelivery <= 15) },
    { key: "coerencia", label: "Sem sinal suspeito no rastreio", peso: 10, n: win.length,
      valor: pctOf(win, (a) => SEV_RANK[a.severity] < SEV_RANK.suspeito) },
  ];
  const usable = factors.filter((f) => f.valor != null && f.n >= 10);
  const pesoTotal = usable.reduce((s, f) => s + f.peso, 0);
  const score = pesoTotal ? Math.round(usable.reduce((s, f) => s + f.valor! * f.peso, 0) / pesoTotal) : null;
  const scoreLabel = score == null ? "sem dados" : score >= 85 ? "confiável" : score >= 70 ? "atenção" : "risco alto";

  const bySev = (s: Severity) => audited.filter((a) => a.severity === s).length;
  return {
    geradoEm: new Date(now).toISOString(),
    janela: { baselineDias: baselineDays, recentesDias: recentDays },
    limites: lim,
    intervalos: intervals,
    semMovimentacao: noMove,
    score: { valor: score, label: scoreLabel, fatores: factors.map((f) => ({ ...f, valor: f.valor == null ? null : Math.round(f.valor * 10) / 10, usado: usable.includes(f) })) },
    contagem: { normal: bySev("normal"), atencao: bySev("atencao"), suspeito: bySev("suspeito"), altamente_suspeito: bySev("altamente_suspeito") },
    sinaisVsPerda, taxaGeral: allRate,
    flagCount: Object.fromEntries(flagCount),
    envios: audited,
    naoClassificados: [...new Set(audited.flatMap((a) => a.unclassified))].slice(0, 30),
  };
}

export type SupplierAudit = ReturnType<typeof auditSupplier>;

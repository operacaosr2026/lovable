// Inteligência SRX — cruzamento de dados. Para cada característica do pedido
// (linha de transporte, região, aparelho, origem do tráfego, conta nova,
// cobrança ≠ entrega, horário, lote de pagamento ao fornecedor…) compara a taxa
// de cada problema (chargeback, reembolso, postagem lenta, código sem pacote,
// parada longa, entrega lenta) com a do resto dos pedidos. Teste exato de Fisher
// (unilateral) separa padrão de acaso. Só cálculo — sem banco, sem IA.
//
// São centenas de comparações por rodada: com corte só no p-valor, dezenas de
// "achados" seriam acaso. Por isso o corte é no q-valor (Benjamini-Hochberg —
// taxa de falsas descobertas) e cada achado é conferido nas duas metades do
// período (mais antiga × mais recente): padrão real aparece nas duas.

export type PatternRow = {
  features: Record<string, string | null>;   // característica → valor (null = sem dado)
  outcomes: Record<string, boolean | null>;  // problema → aconteceu? (null = ainda não dá pra saber)
  at?: string;                               // data da compra (ISO) — pra conferir nas duas metades do período
};

// q-valores de Benjamini-Hochberg na mesma ordem de `ps`. `m` = total de testes
// feitos (os que não entraram em `ps` contam como p = 1).
export function bhQValues(ps: number[], m = ps.length): number[] {
  const idx = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(ps.length);
  let min = 1;
  for (let k = idx.length - 1; k >= 0; k--) {
    min = Math.min(min, (idx[k][0] * m) / (k + 1));
    q[idx[k][1]] = Math.min(1, min);
  }
  return q;
}

// Taxa do grupo × resto em cada metade do período (corte na mediana de `at`).
// estavel: true = mesmo sentido nas duas metades; false = inverte; null = pouco dado.
export function halvesCheck(rows: PatternRow[], inGroup: (r: PatternRow) => boolean, outcome: string, risk: boolean, minN = 5) {
  const known = rows.filter((r) => r.outcomes[outcome] != null && r.at);
  if (known.length < minN * 4) return { estavel: null, metade_antiga: null, metade_recente: null };
  const sorted = [...known].sort((a, b) => a.at!.localeCompare(b.at!));
  const mid = sorted[Math.floor(sorted.length / 2)].at!;
  const half = (rs: PatternRow[]) => {
    const g = rs.filter(inGroup), rest = rs.filter((r) => !inGroup(r));
    if (g.length < minN || rest.length < minN) return null;
    const rate = (xs: PatternRow[]) => Math.round((xs.filter((r) => r.outcomes[outcome]).length / xs.length) * 1000) / 10;
    return { pedidos: g.length, taxa_pct: rate(g), resto_taxa_pct: rate(rest) };
  };
  const a = half(sorted.filter((r) => r.at! < mid)), b = half(sorted.filter((r) => r.at! >= mid));
  const ok = (h: { taxa_pct: number; resto_taxa_pct: number }) => (risk ? h.taxa_pct > h.resto_taxa_pct : h.taxa_pct < h.resto_taxa_pct);
  return { estavel: a && b ? ok(a) && ok(b) : null, metade_antiga: a, metade_recente: b };
}

export const OUTCOME_LABEL: Record<string, string> = {
  chargeback: "chargeback", foi_ao_banco: "foi ao banco (chargeback ou reembolso automático por alerta Ethoca/CDRN/RDR)",
  reembolso: "reembolso pedido pelo cliente ou feito pela loja (sem os de alerta)", postagem_lenta: "postagem lenta (> 3 dias úteis do pedido)",
  codigo_sem_pacote: "código criado sem o pacote andar (> 2 dias úteis)", parada_longa: "parada longa no trânsito (> 5 dias sem evento)",
  entrega_lenta: "entrega lenta (> 15 dias da 1ª movimentação)",
};

// log(n!) para o hipergeométrico.
function logFactTable(n: number) {
  const t = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) t[i] = t[i - 1] + Math.log(i);
  return t;
}
// P(X ≥ a) com X ~ Hipergeométrica(N total, K com o problema, n no grupo).
function fisherGreater(a: number, n: number, K: number, N: number, lf: Float64Array) {
  const lchoose = (x: number, y: number) => lf[x] - lf[y] - lf[x - y];
  const denom = lchoose(N, n);
  let p = 0;
  for (let k = a; k <= Math.min(n, K); k++) {
    if (n - k > N - K) continue;
    p += Math.exp(lchoose(K, k) + lchoose(N - K, n - k) - denom);
  }
  return Math.min(1, p);
}
// P(X ≤ a) — pra fator protetor (grupo com MENOS problema que o resto).
function fisherLess(a: number, n: number, K: number, N: number, lf: Float64Array) {
  const lchoose = (x: number, y: number) => lf[x] - lf[y] - lf[x - y];
  const denom = lchoose(N, n);
  let p = 0;
  for (let k = Math.max(0, n - (N - K)); k <= Math.min(a, K); k++) p += Math.exp(lchoose(K, k) + lchoose(N - K, n - k) - denom);
  return Math.min(1, p);
}

export type PatternFinding = {
  problema: string; caracteristica: string; valor: string;
  direcao: "risco" | "protecao";   // protecao = o grupo tem MENOS o problema que o resto
  pedidos: number; com_problema: number; taxa_pct: number;
  resto_pedidos: number; resto_com_problema: number; resto_taxa_pct: number;
  vezes_mais: number; p_valor: number; q_valor: number; forca: "forte" | "moderado" | "fraco";
  // Conferência nas duas metades do período (ver halvesCheck).
  estavel: boolean | null;
  metade_antiga: { pedidos: number; taxa_pct: number; resto_taxa_pct: number } | null;
  metade_recente: { pedidos: number; taxa_pct: number; resto_taxa_pct: number } | null;
};

export function minePatterns(rows: PatternRow[], opts: { minGroup?: number; minEvents?: number; maxQ?: number } = {}) {
  const minGroup = opts.minGroup ?? 15, minEvents = opts.minEvents ?? 3, maxQ = opts.maxQ ?? 0.1;
  const outcomes = [...new Set(rows.flatMap((r) => Object.keys(r.outcomes)))];
  const features = [...new Set(rows.flatMap((r) => Object.keys(r.features)))];
  const lf = logFactTable(rows.length + 1);
  const tested: (Omit<PatternFinding, "q_valor" | "forca" | "estavel" | "metade_antiga" | "metade_recente"> & { p: number })[] = [];
  const base: Record<string, { pedidos: number; com_problema: number; taxa_pct: number }> = {};

  for (const out of outcomes) {
    const known = rows.filter((r) => r.outcomes[out] != null);
    const N = known.length, K = known.filter((r) => r.outcomes[out]).length;
    base[out] = { pedidos: N, com_problema: K, taxa_pct: N ? Math.round((K / N) * 1000) / 10 : 0 };
    if (K < minEvents || N < minGroup * 2) continue;
    for (const f of features) {
      const groups = new Map<string, { n: number; a: number }>();
      for (const r of known) {
        const v = r.features[f];
        if (v == null) continue;
        const g = groups.get(v) ?? { n: 0, a: 0 };
        g.n++; if (r.outcomes[out]) g.a++;
        groups.set(v, g);
      }
      const withValue = [...groups.values()].reduce((s, g) => ({ n: s.n + g.n, a: s.a + g.a }), { n: 0, a: 0 });
      for (const [v, g] of groups) {
        const restN = withValue.n - g.n, restA = withValue.a - g.a;
        if (g.n < minGroup || restN < minGroup) continue;
        const rate = g.a / g.n, restRate = restA / restN;
        const risk = rate > restRate;
        // Risco: precisa de casos no grupo. Proteção: grupo grande e o resto com casos suficientes.
        if (risk ? g.a < minEvents : restA < minEvents || g.n < minGroup * 2) continue;
        if (rate === restRate) continue;
        const p = risk ? fisherGreater(g.a, g.n, withValue.a, withValue.n, lf) : fisherLess(g.a, g.n, withValue.a, withValue.n, lf);
        tested.push({
          problema: out, caracteristica: f, valor: v, direcao: risk ? "risco" : "protecao",
          pedidos: g.n, com_problema: g.a, taxa_pct: Math.round(rate * 1000) / 10,
          resto_pedidos: restN, resto_com_problema: restA, resto_taxa_pct: Math.round(restRate * 1000) / 10,
          vezes_mais: restRate > 0 ? Math.round((rate / restRate) * 100) / 100 : 99,
          p_valor: Math.round(p * 10000) / 10000, p,
        });
      }
    }
  }
  // Corte pela taxa de falsas descobertas sobre TODOS os testes feitos.
  const qs = bhQValues(tested.map((t) => t.p));
  const findings: PatternFinding[] = [];
  tested.forEach((t, i) => {
    const q = qs[i];
    if (q > maxQ) return;
    const { p: _p, ...rest } = t;
    // "Resto" = pedidos com outro valor da característica (mesma base do teste).
    const check = halvesCheck(rows.filter((r) => r.features[t.caracteristica] != null),
      (r) => r.features[t.caracteristica] === t.valor, t.problema, t.direcao === "risco");
    findings.push({
      ...rest, q_valor: Math.round(q * 10000) / 10000,
      forca: q < 0.01 ? "forte" : q < 0.05 ? "moderado" : "fraco",
      ...check,
    });
  });
  findings.sort((a, b) => a.q_valor - b.q_valor || b.vezes_mais - a.vezes_mais);
  return { base, achados: findings, testes_feitos: tested.length };
}

// ─── Características a partir do pedido ──────────────────────────────────────
const REGION: Record<string, string> = {};
for (const s of ["ME", "NH", "VT", "MA", "RI", "CT", "NY", "NJ", "PA"]) REGION[s] = "Nordeste (EUA)";
for (const s of ["OH", "MI", "IN", "IL", "WI", "MN", "IA", "MO", "ND", "SD", "NE", "KS"]) REGION[s] = "Meio-Oeste";
for (const s of ["DE", "MD", "DC", "VA", "WV", "NC", "SC", "GA", "FL", "KY", "TN", "AL", "MS", "AR", "LA", "OK", "TX"]) REGION[s] = "Sul";
for (const s of ["MT", "ID", "WY", "CO", "NM", "AZ", "UT", "NV", "CA", "OR", "WA", "AK", "HI"]) REGION[s] = "Oeste";

export function nyParts(iso: string) {
  const d = new Date(iso);
  const hour = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })) % 24;
  const wd = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  return { hour, weekday: ({ Sun: "domingo", Mon: "segunda", Tue: "terça", Wed: "quarta", Thu: "quinta", Fri: "sexta", Sat: "sábado" } as Record<string, string>)[wd] ?? wd };
}

export function orderFeatures(a: {
  createdAt: string; revenue: number; trackingCode: string | null; codeAt: string | null; paidAt: string | null;
  state: string | null; billingZip: string | null; shippingZip: string | null; landing: string | null; userAgent: string | null;
  customerCreatedAt: string | null; email: string | null; phone: string | null; size: string | null; quantity: number | null;
  acceptsMarketing: boolean | null; brand: string | null; risk: string | null;
}): Record<string, string | null> {
  const { hour, weekday } = nyParts(a.createdAt);
  const ua = a.userAgent ?? "";
  const lag = a.paidAt ? Math.round((Date.parse(`${a.paidAt.slice(0, 10)}T12:00:00Z`) - Date.parse(a.createdAt)) / 86_400_000) : null;
  const accountAgeH = a.customerCreatedAt ? (Date.parse(a.createdAt) - Date.parse(a.customerCreatedAt)) / 3_600_000 : null;
  const dom = (a.email ?? "").split("@")[1]?.toLowerCase() ?? null;
  return {
    linha_de_transporte: a.trackingCode ? (a.trackingCode.match(/^[A-Z]+/)?.[0] ?? "outro").replace(/^(JXC)[A-Z]+$/, "$1…") : null,
    regiao_destino: a.state ? REGION[a.state] ?? "outra" : null,
    estado_destino: a.state,
    cobranca_diferente_da_entrega: a.billingZip && a.shippingZip ? (a.billingZip.slice(0, 5) !== a.shippingZip.slice(0, 5) ? "sim" : "não") : null,
    // Sem "veio de anúncio do Meta": todo comprador vem do Meta; o _fbc no link só
    // diz se o rastreio do clique sobreviveu (Safari etc.), não a origem.
    aparelho: !ua ? null : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : "computador",
    navegador_dentro_do_app: !ua ? null : /Instagram/.test(ua) ? "Instagram" : /FBAN|FBAV|FB_IAB|FBIOS/.test(ua) ? "Facebook" : "navegador comum",
    conta_criada_na_compra: accountAgeH == null ? null : accountAgeH < 1 ? "sim" : "não (cliente antigo)",
    email: !dom ? null : ["gmail.com", "yahoo.com", "icloud.com", "hotmail.com", "outlook.com", "aol.com"].includes(dom) ? dom : "outro domínio",
    telefone_informado: a.phone ? "sim" : "não",
    tamanho: a.size,
    mais_de_um_item: a.quantity == null ? null : a.quantity > 1 ? "sim" : "não",
    valor_do_pedido: a.revenue <= 110 ? "até $110" : a.revenue <= 200 ? "$110–200" : "acima de $200",
    horario_da_compra_NY: hour < 6 ? "madrugada (0–6h)" : hour < 12 ? "manhã (6–12h)" : hour < 18 ? "tarde (12–18h)" : "noite (18–24h)",
    dia_da_compra: weekday,
    aceita_marketing: a.acceptsMarketing == null ? null : a.acceptsMarketing ? "sim" : "não",
    dias_ate_pagar_fornecedor: lag == null ? "ainda não pago" : lag <= 0 ? "mesmo dia" : lag === 1 ? "1 dia" : lag === 2 ? "2 dias" : "3+ dias",
    dia_em_que_pagou_fornecedor: a.paidAt ? nyParts(`${a.paidAt.slice(0, 10)}T16:00:00Z`).weekday : null,
    dia_em_que_codigo_foi_criado: a.codeAt ? nyParts(a.codeAt).weekday : null,
    bandeira: a.brand,
    risco_shopify: a.risk,
  };
}

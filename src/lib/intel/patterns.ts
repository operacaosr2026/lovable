// Inteligência SRX — cruzamento de dados. Para cada característica do pedido
// (linha de transporte, região, aparelho, origem do tráfego, conta nova,
// cobrança ≠ entrega, horário, lote de pagamento ao fornecedor…) compara a taxa
// de cada problema (chargeback, reembolso, postagem lenta, código sem pacote,
// parada longa, entrega lenta) com a do resto dos pedidos. Teste exato de Fisher
// (unilateral) separa padrão de acaso. Só cálculo — sem banco, sem IA.

export type PatternRow = {
  features: Record<string, string | null>;   // característica → valor (null = sem dado)
  outcomes: Record<string, boolean | null>;  // problema → aconteceu? (null = ainda não dá pra saber)
};

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
  vezes_mais: number; p_valor: number; forca: "forte" | "moderado" | "fraco";
};

export function minePatterns(rows: PatternRow[], opts: { minGroup?: number; minEvents?: number; maxP?: number } = {}) {
  const minGroup = opts.minGroup ?? 15, minEvents = opts.minEvents ?? 3, maxP = opts.maxP ?? 0.1;
  const outcomes = [...new Set(rows.flatMap((r) => Object.keys(r.outcomes)))];
  const features = [...new Set(rows.flatMap((r) => Object.keys(r.features)))];
  const lf = logFactTable(rows.length + 1);
  const findings: PatternFinding[] = [];
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
        if (p > maxP) continue;
        findings.push({
          problema: out, caracteristica: f, valor: v, direcao: risk ? "risco" : "protecao",
          pedidos: g.n, com_problema: g.a, taxa_pct: Math.round(rate * 1000) / 10,
          resto_pedidos: restN, resto_com_problema: restA, resto_taxa_pct: Math.round(restRate * 1000) / 10,
          vezes_mais: restRate > 0 ? Math.round((rate / restRate) * 100) / 100 : 99,
          p_valor: Math.round(p * 10000) / 10000,
          forca: p < 0.01 ? "forte" : p < 0.05 ? "moderado" : "fraco",
        });
      }
    }
  }
  findings.sort((a, b) => a.p_valor - b.p_valor || b.vezes_mais - a.vezes_mais);
  return { base, achados: findings };
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

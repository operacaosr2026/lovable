// Planejamento estratégico "pronto": calendário de datas sazonais dos EUA
// (as lojas vendem pra lá), a janela de preparação de 90 dias e os modelos
// de plano montados com os números do sistema (prazo de entrega, faturamento
// diário, ticket, CPA, produtos que vendem e que dão reembolso).
// Puro (sem servidor) — usado na tela e nos testes.

export type Baseline = {
  today: string;
  // Últimos 30 dias, pedidos válidos (sem reembolso/cancelamento).
  revenue30: number; orders30: number; ticket: number | null; dailyRevenue: number;
  // Pedidos de 90 a 14 dias atrás com reembolso (dá tempo do reembolso acontecer).
  refundRate: number | null;
  // Dias da compra à entrega (últimos 120 dias): mediana e 80% chegam em até.
  deliveryMedian: number | null; deliveryP80: number | null; deliverySample: number;
  // Clientes com 2+ compras / clientes (desde o começo).
  repeatRate: number | null; customers: number;
  chargebacks90: number; orders90: number;
  topProducts: { name: string; sold: number; refundRate: number }[];
  riskyProducts: { name: string; sold: number; refundRate: number }[];
};
// Do Gerencial (mês atual, ou o anterior se o atual ainda tem pouco pedido).
export type Finance = { margem: number | null; cpa: number | null; anuncios: number | null; lucro: number | null } | null;

export type Season = {
  key: string; label: string; date: string; end?: string;
  // Presente: o pedido precisa chegar antes da data (tem dia limite de pedido).
  gift: boolean;
  // Dias de campanha antes da data (vendas concentradas) e quanto a venda diária
  // costuma subir nesse período (referência de mercado; ajuste com o seu histórico).
  windowDays: number; uplift: number;
  tip: string;
};

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
export const addDays = (k: string, n: number) => {
  const d = new Date(`${k}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
// n-ésimo dia da semana do mês (wd: 0 = domingo); n = -1 → o último.
export function nthWeekday(y: number, m: number, wd: number, n: number) {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return iso(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0));
  const back = (lastDay.getUTCDay() - wd + 7) % 7;
  return iso(y, m, lastDay.getUTCDate() - back);
}
export const quarterOf = (k: string) => `${k.slice(0, 4)}-T${Math.floor((Number(k.slice(5, 7)) - 1) / 3) + 1}`;

export function seasonsOf(y: number): Season[] {
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  const bf = addDays(thanksgiving, 1);
  return [
    { key: `valentines-${y}`, label: "Valentine's Day", date: iso(y, 2, 14), gift: true, windowDays: 21, uplift: 1.4,
      tip: "Presente pra casal: joias, acessórios, kits. Oferta de kit e embalagem de presente." },
    { key: `maes-${y}`, label: "Mother's Day", date: nthWeekday(y, 5, 0, 2), gift: true, windowDays: 21, uplift: 1.5,
      tip: "Uma das maiores datas de presente nos EUA. Criativo emocional, kit presente." },
    { key: `memorial-${y}`, label: "Memorial Day", date: nthWeekday(y, 5, 1, -1), gift: false, windowDays: 5, uplift: 1.2,
      tip: "Liquidação de início de verão. Desconto direto funciona melhor que kit." },
    { key: `pais-${y}`, label: "Father's Day", date: nthWeekday(y, 6, 0, 3), gift: true, windowDays: 21, uplift: 1.3,
      tip: "Presente prático pra homem. Prazo de entrega pesa: comunique a data limite." },
    { key: `july4-${y}`, label: "4th of July", date: iso(y, 7, 4), gift: false, windowDays: 7, uplift: 1.2,
      tip: "Liquidação de feriado. Tema patriótico no criativo." },
    { key: `bts-${y}`, label: "Back to School", date: iso(y, 8, 15), gift: false, windowDays: 30, uplift: 1.2,
      tip: "Volta às aulas: compra longa, de meados de julho ao começo de setembro." },
    { key: `labor-${y}`, label: "Labor Day", date: nthWeekday(y, 9, 1, 1), gift: false, windowDays: 5, uplift: 1.15,
      tip: "Liquidação de fim de verão. Bom pra girar o que sobrou." },
    { key: `halloween-${y}`, label: "Halloween", date: iso(y, 10, 31), gift: true, windowDays: 21, uplift: 1.2,
      tip: "Fantasia e decoração precisam chegar antes: a data limite manda." },
    { key: `bfcm-${y}`, label: "Black Friday + Cyber Monday", date: bf, end: addDays(bf, 3), gift: false, windowDays: 7, uplift: 2.5,
      tip: "Maior pico do ano. Anúncio fica mais caro: o público aquecido e a lista de compradores fazem a diferença." },
    { key: `natal-${y}`, label: "Natal", date: iso(y, 12, 25), gift: true, windowDays: 30, uplift: 1.6,
      tip: "Venda de presente vai até a data limite de entrega; depois dela, vale-presente e mensagem de \"chega depois do Natal\"." },
  ];
}

// Próximas datas a partir de hoje (inclui as que estão acontecendo).
export function upcomingSeasons(today: string, count = 8): Season[] {
  const y = Number(today.slice(0, 4));
  return [...seasonsOf(y), ...seasonsOf(y + 1)]
    .filter((s) => (s.end ?? s.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, count);
}

const PREP_DAYS = 90;
// Dias que 80% dos pedidos levam pra chegar (sem dado: 21, o que o sistema mede hoje).
const transit = (b: Baseline | null) => Math.ceil(b?.deliveryP80 ?? 21);

export type SeasonPhase = "planejar" | "preparar" | "campanha" | "ultimos_dias" | "pos";
export function seasonStatus(s: Season, b: Baseline | null, today: string) {
  const prepStart = addDays(s.date, -PREP_DAYS);
  const campaignStart = addDays(s.date, -s.windowDays);
  const cutoff = s.gift ? addDays(s.date, -transit(b)) : null;
  const phase: SeasonPhase =
    today > (s.end ?? s.date) ? "pos"
    : cutoff && today > cutoff ? "ultimos_dias"
    : today >= campaignStart ? "campanha"
    : today >= prepStart ? "preparar"
    : "planejar";
  return { prepStart, campaignStart, cutoff, phase, daysToDate: daysBetween(today, s.date), daysToPrep: daysBetween(today, prepStart) };
}

export const PHASE_LABEL: Record<SeasonPhase, string> = {
  planejar: "Preparo ainda não começou", preparar: "Preparar agora", campanha: "Em campanha", ultimos_dias: "Passou do limite de entrega", pos: "Passou",
};

export type PlanTemplate = {
  plan_key: string; quarter: string; title: string; description: string;
  krs: { title: string; unit: "numero" | "pct" | "usd"; start_value: number; target_value: number; metric?: string; metric_from?: string; metric_to?: string }[];
  initiatives: { title: string; notes: string; due_date: string | null }[];
};

const usd0 = (v: number) => `US$ ${Math.round(v).toLocaleString("pt-BR")}`;
const dm = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : xs[0] ?? "");

// Projeção da data: venda diária dos últimos 30 dias × alta da data × dias de campanha.
export function seasonForecast(s: Season, b: Baseline | null, f: Finance) {
  const days = s.windowDays + (s.end ? daysBetween(s.date, s.end) : 0);
  const revenue = b ? b.dailyRevenue * s.uplift * days : 0;
  const orders = b?.ticket ? revenue / b.ticket : 0;
  const budget = f?.cpa ? orders * f.cpa : null;
  return { days, revenue, orders, budget };
}

export function buildSeasonPlan(s: Season, b: Baseline | null, f: Finance): PlanTemplate {
  const st = seasonStatus(s, b, b?.today ?? s.date);
  const fc = seasonForecast(s, b, f);
  const D = (n: number) => addDays(s.date, n);
  const top = (b?.topProducts ?? []).slice(0, 3).map((p) => p.name);
  const risky = (b?.riskyProducts ?? []).slice(0, 2).map((p) => `${p.name} (${Math.round(p.refundRate * 100)}% de reembolso)`);
  const campaignEnd = s.end ?? (st.cutoff ?? s.date);

  const initiatives: PlanTemplate["initiatives"] = [
    { title: "Escolher os produtos da data", due_date: D(-90),
      notes: [top.length ? `Comece pelos que mais vendem: ${list(top)}.` : "", risky.length ? `Evite ou corrija antes: ${list(risky)}.` : "", s.tip].filter(Boolean).join(" ") },
    { title: "Validar fornecedor pro volume", due_date: D(-75),
      notes: `Estoque pra ~${Math.ceil(fc.orders * 1.2)} pedidos (projeção + 20%), postagem em até 3 dias úteis e custo fechado.` },
    { title: "Produzir criativos e a oferta da data", due_date: D(-60),
      notes: "Vídeos e imagens com o tema, oferta (kit, frete grátis acima de X, desconto progressivo) e página do produto revisada." },
    { title: "Testar criativos e produtos com orçamento baixo", due_date: D(-45),
      notes: "3 a 5 criativos por produto. Fique com os que derem CPA abaixo do atual." },
    { title: "Montar os públicos", due_date: D(-40),
      notes: "Gerencial › Públicos: Compradores e Recompra como base do semelhante; Exclusão (reembolso/chargeback) fora." },
    { title: "Reservar caixa pro orçamento", due_date: D(-30),
      notes: fc.budget ? `Anúncio estimado: ${usd0(fc.budget)} na campanha (CPA atual × pedidos projetados).` : "Separe o orçamento de anúncio da campanha." },
    { title: "Começar a campanha principal", due_date: st.campaignStart,
      notes: `Escalar os vencedores dos testes. Janela de ${fc.days} dias, até ${dm(campaignEnd)}.` },
  ];
  if (st.cutoff) {
    initiatives.push(
      { title: "Avisar a data limite de entrega", due_date: addDays(st.cutoff, -7),
        notes: `No site e nos anúncios: "peça até ${dm(st.cutoff)} pra chegar antes de ${dm(s.date)}".` },
      { title: "Último dia de pedido com entrega a tempo", due_date: st.cutoff,
        notes: `80% dos pedidos chegam em até ${transit(b)} dias. Depois desse dia, troque a mensagem (vale-presente / chega depois da data) e baixe o orçamento.` },
    );
  }
  initiatives.push({ title: "Pós-data: recompra e análise", due_date: addDays(s.end ?? s.date, 3),
    notes: "E-mail pra quem comprou (cupom de recompra) e anotar o que funcionou pro ano que vem." });
  initiatives.sort((a, b2) => (a.due_date ?? "").localeCompare(b2.due_date ?? ""));

  const from = st.campaignStart, to = s.end ?? s.date;
  const krs: PlanTemplate["krs"] = [
    { title: `Faturamento de ${dm(from)} a ${dm(to)}`, unit: "usd", start_value: 0, target_value: Math.round(fc.revenue), metric: "revenue", metric_from: from, metric_to: to },
    { title: `Pedidos de ${dm(from)} a ${dm(to)}`, unit: "numero", start_value: 0, target_value: Math.round(fc.orders), metric: "orders", metric_from: from, metric_to: to },
  ];
  if (b?.refundRate != null) {
    krs.push({ title: "Reembolso dos pedidos da campanha abaixo de", unit: "pct", start_value: r1(b.refundRate * 100), target_value: r1(b.refundRate * 100 * 0.8), metric: "refund_rate", metric_from: from, metric_to: to });
  }
  return {
    plan_key: s.key, quarter: quarterOf(s.date), title: `${s.label} ${s.date.slice(0, 4)}`,
    description: `Data: ${dm(s.date)}${s.end ? ` a ${dm(s.end)}` : ""}. Preparo a partir de ${dm(st.prepStart)}${st.cutoff ? `; último pedido pra chegar a tempo: ${dm(st.cutoff)}` : ""}. Meta = venda diária dos últimos 30 dias × ${s.uplift.toLocaleString("pt-BR")} (alta típica da data) × ${fc.days} dias.`,
    krs, initiatives,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// Diagnóstico: o que os números do sistema dizem e o objetivo sugerido pro trimestre.
export type Diagnosis = {
  key: string; title: string; metric: string; status: "ruim" | "atencao" | "ok"; insight: string; plan: PlanTemplate;
};
export function buildDiagnosis(b: Baseline, f: Finance, quarter: string): Diagnosis[] {
  const qEnd = (() => { const m = Number(quarter.slice(6)) * 3; return new Date(Date.UTC(Number(quarter.slice(0, 4)), m, 0)).toISOString().slice(0, 10); })();
  const qStart = `${quarter.slice(0, 4)}-${String((Number(quarter.slice(6)) - 1) * 3 + 1).padStart(2, "0")}-01`;
  const out: Diagnosis[] = [];
  const due = (n: number) => { const d = addDays(b.today, n); return d > qEnd ? qEnd : d; };

  if (b.refundRate != null) {
    const r = b.refundRate * 100;
    const risky = b.riskyProducts.slice(0, 3);
    out.push({
      key: "reembolso", title: "Reembolso", metric: `${r1(r)}%`, status: r >= 10 ? "ruim" : r >= 6 ? "atencao" : "ok",
      insight: risky.length ? `Puxado por ${list(risky.map((p) => `${p.name} (${Math.round(p.refundRate * 100)}%)`))}.` : "Dos pedidos de 90 a 14 dias atrás.",
      plan: {
        plan_key: `diag:reembolso:${quarter}`, quarter, title: "Reduzir reembolsos",
        description: `Hoje ${r1(r)}% dos pedidos têm reembolso. Cada ponto a menos volta direto pro lucro.`,
        krs: [{ title: "Taxa de reembolso abaixo de", unit: "pct", start_value: r1(r), target_value: r1(r * 0.7), metric: "refund_rate", metric_from: qStart, metric_to: qEnd }],
        initiatives: [
          ...risky.map((p, i) => ({ title: `Corrigir ou trocar: ${p.name}`, due_date: due(14 + i * 7),
            notes: `${Math.round(p.refundRate * 100)}% de reembolso em ${p.sold} vendidos. Ver motivo na Análise de reembolsos: tamanho, qualidade ou prazo.` })),
          { title: "Revisar páginas: tabela de medidas, fotos reais e prazo", due_date: due(21), notes: "Expectativa errada é o motivo mais comum de reembolso." },
          { title: "Cobrar postagem em até 3 dias úteis do fornecedor", due_date: due(10), notes: "Atraso vira pedido de reembolso e chargeback." },
        ],
      },
    });
  }
  if (b.repeatRate != null) {
    const r = b.repeatRate * 100;
    out.push({
      key: "recompra", title: "Recompra", metric: `${r1(r)}%`, status: r < 5 ? "ruim" : r < 10 ? "atencao" : "ok",
      insight: `${b.customers.toLocaleString("pt-BR")} clientes na base. Vender de novo pra quem já comprou é o pedido mais barato.`,
      plan: {
        plan_key: `diag:recompra:${quarter}`, quarter, title: "Fazer o cliente comprar de novo",
        description: `Só ${r1(r)}% dos clientes compraram mais de uma vez.`,
        krs: [{ title: "Clientes com 2+ compras", unit: "pct", start_value: r1(r), target_value: r1(r + 3), metric: "repeat_rate" }],
        initiatives: [
          { title: "Fluxo de e-mail pós-entrega com cupom de recompra", due_date: due(14), notes: "Disparar alguns dias depois da entrega, com produto complementar." },
          { title: "Campanha pra lista de compradores", due_date: due(21), notes: "Gerencial › Públicos › Compradores, sem quem teve reembolso." },
          { title: "Oferta de kit / leve 2", due_date: due(30), notes: "Aumenta o ticket e a chance de voltar." },
        ],
      },
    });
  }
  if (b.deliveryMedian != null) {
    const m = b.deliveryMedian;
    out.push({
      key: "entrega", title: "Prazo de entrega", metric: `${Math.round(m)} dias`, status: m > 20 ? "ruim" : m > 15 ? "atencao" : "ok",
      insight: `80% chega em até ${Math.ceil(b.deliveryP80 ?? m)} dias. Prazo longo encurta as datas de presente.`,
      plan: {
        plan_key: `diag:entrega:${quarter}`, quarter, title: "Entregar mais rápido",
        description: `Mediana de ${Math.round(m)} dias da compra à entrega.`,
        krs: [{ title: "Dias da compra à entrega (mediana)", unit: "numero", start_value: Math.round(m), target_value: Math.max(7, Math.round(m) - 3), metric: "delivery_days", metric_from: qStart, metric_to: qEnd }],
        initiatives: [
          { title: "Comparar transportadoras e ficar com a mais rápida", due_date: due(14), notes: "Gerencial › Transportadoras mostra prazo e alfândega de cada uma." },
          { title: "Combinar postagem em até 3 dias úteis com o fornecedor", due_date: due(7), notes: "O relógio começa no pagamento ao fornecedor." },
          { title: "Avaliar armazém nos EUA pros mais vendidos", due_date: due(45), notes: "Corta o prazo pra poucos dias nas datas de presente." },
        ],
      },
    });
  }
  if (f?.margem != null) {
    const m = f.margem * 100;
    out.push({
      key: "margem", title: "Margem de lucro", metric: `${r1(m)}%`, status: m < 10 ? "ruim" : m < 20 ? "atencao" : "ok",
      insight: f.cpa != null ? `Custo de anúncio por pedido: US$ ${f.cpa.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}.` : "Lucro sobre o faturamento do mês.",
      plan: {
        plan_key: `diag:margem:${quarter}`, quarter, title: "Aumentar a margem",
        description: `Margem do mês em ${r1(m)}%.`,
        krs: [
          { title: "Margem de lucro do mês", unit: "pct", start_value: r1(m), target_value: r1(m + 5) },
          ...(f.cpa != null ? [{ title: "Custo de anúncio por pedido abaixo de", unit: "usd" as const, start_value: f.cpa, target_value: Math.round(f.cpa * 0.85 * 100) / 100 }] : []),
        ],
        initiatives: [
          { title: "Renegociar custo dos 3 mais vendidos", due_date: due(14), notes: b.topProducts.length ? `${list(b.topProducts.slice(0, 3).map((p) => p.name))}.` : "Volume maior = poder de negociação." },
          { title: "Subir o ticket com kit e frete grátis acima de um valor", due_date: due(21), notes: b.ticket ? `Ticket médio hoje: US$ ${b.ticket.toFixed(2)}.` : "" },
          { title: "Cortar conjuntos de anúncio com CPA acima da margem", due_date: due(7), notes: "Revisão semanal." },
        ],
      },
    });
  }
  return out;
}

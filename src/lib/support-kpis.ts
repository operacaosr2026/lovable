import { US_TIME_ZONE } from "@/lib/timezone";

// Atendimento > KPI: números do período a partir das mensagens e conversas.
// Função pura — usada pelo servidor (dados reais) e pelo modo de exemplo.
// Dias, horários e dias da semana no fuso de Nova York (onde estão os clientes).

export type KpiMessage = { conversation_id: string; direction: string; sent_at: string };
export type KpiConversation = {
  id: string; status: string; tags: string[]; resolved_at: string | null;
  last_message_at: string | null; last_inbound_at: string | null; last_outbound_at: string | null; shop_id: string | null;
};
export type KpiShop = { id: string; name: string };

// Metas padrão dos cards (Configurações > Metas pode trocar), em minutos.
export const DEFAULT_GOALS = { firstResponseMin: 30, resolutionMin: 360 };
export type KpiGoals = typeof DEFAULT_GOALS;

type Point = { date: string; value: number | null };
export type SupportKpis = {
  cards: {
    total: { value: number; prev: number; series: Point[]; newConversations: number; replied: number };
    firstResponse: { value: number | null; prev: number | null; series: Point[] };
    resolution: { value: number | null; prev: number | null; series: Point[] };
    rate: { value: number | null; prev: number | null; series: Point[]; resolved: number; pending: number };
    open: { value: number; prev: number; series: Point[]; over24h: number; over72h: number };
  };
  stores: { id: string; name: string; color: number }[];        // color = posição fixa da loja (a cor segue a loja)
  byStoreDaily: ({ date: string } & Record<string, number | string>)[];
  tags: { tag: string; count: number; pct: number }[];
  arrivals: { day: { label: string; count: number }[]; hour: { label: string; count: number }[]; weekday: { label: string; count: number }[] };
  unassigned: number;   // conversas do mês ainda sem loja (definir no painel do cliente)
  storeTable: {
    id: string; name: string; received: number; receivedPrev: number; replied: number; open: number;
    firstResponseMs: number | null; resolutionMs: number | null; ratePct: number | null;
  }[];
};

const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: US_TIME_ZONE });
const hourOf = (t: number) => Number(new Date(t).toLocaleString("en-US", { timeZone: US_TIME_ZONE, hour: "numeric", hour12: false })) % 24;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const weekdayOf = (t: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Date(t).toLocaleDateString("en-US", { timeZone: US_TIME_ZONE, weekday: "short" }));
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

type Conv = KpiConversation & { first: number; firstIn: number | null; firstOut: number | null; msgs: { dir: string; t: number }[] };

function prepare(messages: KpiMessage[], conversations: KpiConversation[]): Conv[] {
  const byConv = new Map<string, { dir: string; t: number }[]>();
  for (const m of messages) {
    (byConv.get(m.conversation_id) ?? byConv.set(m.conversation_id, []).get(m.conversation_id)!)
      .push({ dir: m.direction, t: new Date(m.sent_at).getTime() });
  }
  return conversations.map((c) => {
    const msgs = (byConv.get(c.id) ?? []).sort((a, b) => a.t - b.t);
    const firstIn = msgs.find((m) => m.dir === "in")?.t ?? null;
    const firstOut = firstIn != null ? msgs.find((m) => m.dir === "out" && m.t > firstIn)?.t ?? null : null;
    return { ...c, msgs, first: msgs[0]?.t ?? Infinity, firstIn, firstOut };
  });
}

// Números de um intervalo [from, to] (usado pro período e pro anterior).
function window(convs: Conv[], from: number, to: number) {
  const inR = (t: number | null | undefined) => t != null && t >= from && t <= to;
  const received = convs.reduce((s, c) => s + c.msgs.filter((m) => m.dir === "in" && inR(m.t)).length, 0);
  const replied = convs.reduce((s, c) => s + c.msgs.filter((m) => m.dir === "out" && inR(m.t)).length, 0);
  const created = convs.filter((c) => inR(c.first));
  // 1ª resposta: conversas que começaram no período com mensagem do cliente.
  const firstWaits = created.filter((c) => c.firstIn != null && c.firstOut != null && c.first === c.firstIn).map((c) => c.firstOut! - c.firstIn!);
  const resolvedHere = convs.filter((c) => c.status === "resolvido" && inR(c.resolved_at ? new Date(c.resolved_at).getTime() : null));
  const resolutionTimes = resolvedHere.filter((c) => c.first !== Infinity).map((c) => new Date(c.resolved_at!).getTime() - c.first).filter((x) => x >= 0);
  // Conversas com movimento no período: resolvidas × ainda abertas.
  const active = convs.filter((c) => c.msgs.some((m) => inR(m.t)) || inR(c.resolved_at ? new Date(c.resolved_at).getTime() : null));
  const resolved = active.filter((c) => c.status === "resolvido").length;
  const pending = active.length - resolved;
  // Em aberto no fim do intervalo.
  const openAt = convs.filter((c) => c.first <= to && (!c.resolved_at || new Date(c.resolved_at).getTime() > to) && !(c.status === "resolvido" && !c.resolved_at)).length;
  return {
    received, replied, newConversations: created.length,
    firstResponse: avg(firstWaits), resolution: avg(resolutionTimes),
    rate: active.length ? Math.round((resolved / active.length) * 1000) / 10 : null,
    resolved, pending, openAt,
  };
}

// Período = um mês; comparação com o mês anterior (prevFrom/prevTo).
export function computeSupportKpis(
  messages: KpiMessage[], conversations: KpiConversation[], shops: KpiShop[], fixedTags: string[],
  range: { from: string; to: string; prevFrom: string; prevTo: string },
): SupportKpis {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const pFrom = new Date(range.prevFrom).getTime();
  const pTo = new Date(range.prevTo).getTime();
  const convs = prepare(messages, conversations);
  const cur = window(convs, from, to);
  const prev = window(convs, pFrom, pTo);

  // Dias do período (inclusive os sem movimento).
  const days: { key: string; start: number; end: number }[] = [];
  for (let t = from; t <= to; t += DAY) {
    const key = dayKey(t);
    if (!days.length || days[days.length - 1].key !== key) days.push({ key, start: t, end: Math.min(t + DAY - 1, to) });
  }
  const perDay = days.map((d) => ({ d, w: window(convs, d.start, d.end) }));
  const series = (pick: (w: ReturnType<typeof window>) => number | null): Point[] => perDay.map(({ d, w }) => ({ date: d.key, value: pick(w) }));

  // Aberto há mais de 24h/72h: cliente escreveu por último e ninguém respondeu.
  const now = Math.min(Date.now(), to);
  const openNow = convs.filter((c) => c.status !== "resolvido");
  const waitingSince = (c: Conv) => {
    const li = c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : null;
    const lo = c.last_outbound_at ? new Date(c.last_outbound_at).getTime() : 0;
    return li != null && li > lo ? now - li : 0;
  };

  // Lojas: ordem fixa por nome (a cor acompanha a loja). Conversa ainda sem
  // loja identificada entra nos totais, mas não nos quebrados por loja.
  const shopName = new Map(shops.map((s) => [s.id, s.name]));
  const shopOf = (c: Conv) => (c.shop_id && shopName.has(c.shop_id) ? c.shop_id : null);
  const usedShops = new Set(convs.filter((c) => c.msgs.some((m) => m.t >= from && m.t <= to)).map(shopOf));
  const allShops = [...shops].sort((a, b) => a.name.localeCompare(b.name));
  const stores = allShops.map((s, color) => ({ ...s, color })).filter((s) => usedShops.has(s.id));

  const byStoreDaily = days.map((d) => {
    const row: { date: string } & Record<string, number | string> = { date: d.key };
    for (const s of stores) row[s.id] = 0;
    for (const c of convs) {
      const shop = shopOf(c);
      if (!shop) continue;
      const n = c.msgs.filter((m) => m.dir === "in" && m.t >= d.start && m.t <= d.end).length;
      if (n) row[shop] = (row[shop] as number) + n;
    }
    return row;
  });

  // Tags: só a lista fixa (Configurações > Tags) + "Sem tag".
  const active = convs.filter((c) => c.msgs.some((m) => m.t >= from && m.t <= to));
  const tagCounts = fixedTags.map((tag) => ({ tag, count: active.filter((c) => c.tags.includes(tag)).length }));
  const untagged = active.filter((c) => !c.tags.some((t) => fixedTags.includes(t))).length;
  const tagTotal = active.length || 1;
  const tags = [...tagCounts, { tag: "Sem tag", count: untagged }]
    .map((t) => ({ ...t, pct: Math.round((t.count / tagTotal) * 1000) / 10 }));

  // Chegada de e-mails: por dia, por hora e por dia da semana.
  const inbound = convs.flatMap((c) => c.msgs.filter((m) => m.dir === "in" && m.t >= from && m.t <= to).map((m) => m.t));
  const arrivals = {
    day: days.map((d) => ({ label: d.key, count: inbound.filter((t) => t >= d.start && t <= d.end).length })),
    hour: Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}h`, count: inbound.filter((t) => hourOf(t) === h).length })),
    weekday: WEEKDAYS.map((label, i) => ({ label, count: inbound.filter((t) => weekdayOf(t) === i).length })),
  };

  const storeTable = stores.map((s) => {
    const mine = convs.filter((c) => shopOf(c) === s.id);
    const w = window(mine, from, to);
    const wp = window(mine, pFrom, pTo);
    return {
      id: s.id, name: s.name, received: w.received, receivedPrev: wp.received, replied: w.replied,
      open: mine.filter((c) => c.status !== "resolvido").length,
      firstResponseMs: w.firstResponse, resolutionMs: w.resolution, ratePct: w.rate,
    };
  }).sort((a, b) => b.received - a.received);

  return {
    cards: {
      total: { value: cur.received, prev: prev.received, series: series((w) => w.received), newConversations: cur.newConversations, replied: cur.replied },
      firstResponse: { value: cur.firstResponse, prev: prev.firstResponse, series: series((w) => w.firstResponse) },
      resolution: { value: cur.resolution, prev: prev.resolution, series: series((w) => w.resolution) },
      rate: { value: cur.rate, prev: prev.rate, series: series((w) => w.rate), resolved: cur.resolved, pending: cur.pending },
      open: {
        value: openNow.length, prev: prev.openAt, series: series((w) => w.openAt),
        over24h: openNow.filter((c) => waitingSince(c) > DAY).length,
        over72h: openNow.filter((c) => waitingSince(c) > 3 * DAY).length,
      },
    },
    stores, byStoreDaily, tags, arrivals, storeTable,
    unassigned: active.filter((c) => !shopOf(c)).length,
  };
}

// ─── Mês (filtro da aba) ──────────────────────────────────────────────────────

// Meia-noite de Nova York de um dia → instante UTC.
function nyMidnight(y: number, m: number, d: number) {
  const guess = Date.UTC(y, m - 1, d, 5);   // ~meia-noite em NY (UTC-5)
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: US_TIME_ZONE, hour: "numeric", hour12: false }).formatToParts(new Date(guess));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return guess - h * 3_600_000;
}

// "2026-09" → intervalo do mês (até agora, se for o mês atual) e o mesmo
// trecho do mês anterior, pra comparação justa.
export function monthRange(month: string, now = Date.now()) {
  const [y, m] = month.split("-").map(Number);
  const from = nyMidnight(y, m, 1);
  const end = nyMidnight(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1;
  const to = Math.min(end, now);
  const prevFrom = nyMidnight(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 1);
  const prevTo = Math.min(from - 1, prevFrom + (to - from));
  const iso = (t: number) => new Date(t).toISOString();
  return { from: iso(from), to: iso(to), prevFrom: iso(prevFrom), prevTo: iso(prevTo), partial: to < end };
}

export function currentMonth(now = Date.now()) {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: US_TIME_ZONE }).slice(0, 7);
}

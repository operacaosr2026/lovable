import { US_TIME_ZONE } from "@/lib/timezone";

// Atendimento > KPI: números do período a partir das mensagens e conversas.
// Função pura — usada pelo servidor (dados reais) e pelo modo de exemplo.
// Dias e horários no fuso de Nova York (onde estão os clientes).

export type KpiMessage = { conversation_id: string; direction: string; sent_at: string };
export type KpiConversation = { id: string; status: string; tags: string[]; resolved_at: string | null; last_message_at: string | null };

export type SupportKpis = {
  current: KpiTotals;
  previous: KpiTotals;
  daily: { date: string; received: number; replied: number; avgResponseMin: number | null }[];
  tags: { tag: string; count: number }[];
  hours: { hour: number; count: number }[];
};
export type KpiTotals = {
  received: number; replied: number; newConversations: number; resolved: number;
  avgResponseMs: number | null; within24hPct: number | null; responses: number;
};

const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: US_TIME_ZONE });
const hourOf = (t: number) => Number(new Date(t).toLocaleString("en-US", { timeZone: US_TIME_ZONE, hour: "numeric", hour12: false })) % 24;

// Pares (1ª mensagem do cliente sem resposta → nossa resposta), por conversa.
function responsePairs(messages: KpiMessage[]) {
  const byConv = new Map<string, { dir: string; t: number }[]>();
  for (const m of messages) {
    (byConv.get(m.conversation_id) ?? byConv.set(m.conversation_id, []).get(m.conversation_id)!)
      .push({ dir: m.direction, t: new Date(m.sent_at).getTime() });
  }
  const pairs: { asked: number; answered: number }[] = [];
  for (const list of byConv.values()) {
    list.sort((a, b) => a.t - b.t);
    let pending: number | null = null;
    for (const m of list) {
      if (m.dir === "in") { if (pending == null) pending = m.t; }
      else if (pending != null) { pairs.push({ asked: pending, answered: m.t }); pending = null; }
    }
  }
  return pairs;
}

function totals(messages: KpiMessage[], conversations: KpiConversation[], from: number, to: number): KpiTotals {
  const inRange = (t: number) => t >= from && t <= to;
  const msgs = messages.map((m) => ({ ...m, t: new Date(m.sent_at).getTime() }));
  const pairs = responsePairs(messages).filter((p) => inRange(p.asked));
  const waits = pairs.map((p) => p.answered - p.asked);
  // Conversa nova = a 1ª mensagem dela caiu no período.
  const first = new Map<string, number>();
  for (const m of msgs) first.set(m.conversation_id, Math.min(first.get(m.conversation_id) ?? Infinity, m.t));
  return {
    received: msgs.filter((m) => m.direction === "in" && inRange(m.t)).length,
    replied: msgs.filter((m) => m.direction === "out" && inRange(m.t)).length,
    newConversations: [...first.values()].filter(inRange).length,
    resolved: conversations.filter((c) => c.status === "resolvido" && c.resolved_at && inRange(new Date(c.resolved_at).getTime())).length,
    avgResponseMs: waits.length ? Math.round(waits.reduce((s, x) => s + x, 0) / waits.length) : null,
    within24hPct: waits.length ? Math.round((waits.filter((w) => w <= 86_400_000).length / waits.length) * 100) : null,
    responses: waits.length,
  };
}

// `messages` deve cobrir do início do período anterior até o fim do atual (+ folga
// pra achar respostas que chegaram depois).
export function computeSupportKpis(messages: KpiMessage[], conversations: KpiConversation[], fromIso: string, toIso: string): SupportKpis {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  const span = to - from;
  const current = totals(messages, conversations, from, to);
  const previous = totals(messages, conversations, from - span - 1, from - 1);

  // Por dia (todos os dias do período, mesmo sem movimento).
  const days = new Map<string, { received: number; replied: number; waits: number[] }>();
  for (let t = from; t <= to; t += 86_400_000) days.set(dayKey(t), { received: 0, replied: 0, waits: [] });
  days.set(dayKey(to), days.get(dayKey(to)) ?? { received: 0, replied: 0, waits: [] });
  for (const m of messages) {
    const t = new Date(m.sent_at).getTime();
    if (t < from || t > to) continue;
    const d = days.get(dayKey(t));
    if (!d) continue;
    if (m.direction === "in") d.received++; else d.replied++;
  }
  for (const p of responsePairs(messages)) {
    if (p.asked < from || p.asked > to) continue;
    days.get(dayKey(p.asked))?.waits.push(p.answered - p.asked);
  }
  const daily = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({
    date, received: d.received, replied: d.replied,
    avgResponseMin: d.waits.length ? Math.round(d.waits.reduce((s, x) => s + x, 0) / d.waits.length / 60_000) : null,
  }));

  // Tags das conversas com movimento no período.
  const active = conversations.filter((c) => c.last_message_at && new Date(c.last_message_at).getTime() >= from && new Date(c.last_message_at).getTime() <= to);
  const tagCount = new Map<string, number>();
  for (const c of active) for (const t of c.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = [...tagCount.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const m of messages) {
    const t = new Date(m.sent_at).getTime();
    if (m.direction === "in" && t >= from && t <= to) hours[hourOf(t)].count++;
  }

  return { current, previous, daily, tags, hours };
}

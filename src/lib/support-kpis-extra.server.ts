import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll, selectAllIn } from "@/lib/select-all";
import { isoDateUS } from "@/lib/timezone";

// Atendimento > KPI: o efeito do atendimento no dinheiro (os cards de cima medem
// velocidade e volume).
//  1. Contato → banco: dos clientes que escreveram no mês, quantos depois foram ao
//     banco (chargeback ou reembolso automático por alerta Ethoca/CDRN/RDR) ou
//     tiveram reembolso; e, dos que foram ao banco no mês, quantos escreveram antes.
//  2. Contatos por 100 pedidos (e os de rastreio) — o volume sem o efeito das vendas.
//  3. Recontato: conversas em que o cliente escreveu 2+ vezes no mês.
// Pedidos = lojas ativas. Cliente ↔ pedido pelo e-mail.

const ALERT_RE = /ethoca|cdrn|rdr|verifi|alert/i;
const DAY = 86_400_000;
const r1 = (x: number) => Math.round(x * 10) / 10;

export type SupportExtraKpis = {
  contactRate: { value: number | null; prev: number | null; rastreio: number | null; contacts: number; orders: number };
  recontact: { value: number | null; prev: number | null; conversations: number; recontacted: number };
  contactToBank: {
    contacted: number; wentToBank: number; refunded: number; avgDaysToBank: number | null;
    bankEvents: number; bankWithContactBefore: number;
  };
};

export async function supportExtraKpis(
  ownerId: string, range: { from: string; to: string; prevFrom: string; prevTo: string }, activeShops: string[],
): Promise<SupportExtraKpis> {
  const [{ data: msgs }, { data: convs }] = await Promise.all([
    selectAll<{ conversation_id: string; sent_at: string }>(supabaseAdmin.from("support_messages")
      .select("conversation_id,sent_at").eq("owner_id", ownerId).eq("direction", "in")),
    selectAll<{ id: string; customer_email: string | null; tags: string[] | null; ai_tags: string[] | null }>(
      supabaseAdmin.from("support_conversations").select("id,customer_email,tags,ai_tags").eq("owner_id", ownerId)),
  ]);
  const convBy = new Map((convs ?? []).map((c) => [c.id, c]));
  const inbound = (msgs ?? []).map((m) => ({ conv: m.conversation_id, at: Date.parse(m.sent_at) })).filter((m) => Number.isFinite(m.at));

  const countOrders = async (fromIso: string, toIso: string) => {
    if (!activeShops.length) return 0;
    const { count } = await supabaseAdmin.from("shop_orders").select("id", { count: "exact", head: true })
      .eq("user_id", ownerId).in("shop_id", activeShops)
      .gte("order_date", isoDateUS(Date.parse(fromIso))).lte("order_date", isoDateUS(Date.parse(toIso)))
      .filter("raw->>cancelled_at", "is", null);
    return count ?? 0;
  };
  const isTracking = (id: string) => [...(convBy.get(id)?.tags ?? []), ...(convBy.get(id)?.ai_tags ?? [])].some((t) => /rastreio|tracking/i.test(t));
  const period = async (a: string, b: string) => {
    const A = Date.parse(a), B = Date.parse(b);
    const per = new Map<string, number>();
    for (const m of inbound) if (m.at >= A && m.at <= B) per.set(m.conv, (per.get(m.conv) ?? 0) + 1);
    const orders = await countOrders(a, b);
    const contacts = per.size;
    const recontacted = [...per.values()].filter((n) => n >= 2).length;
    return {
      contacts, orders, recontacted,
      rate: orders ? r1((contacts / orders) * 100) : null,
      rastreio: orders ? r1(([...per.keys()].filter(isTracking).length / orders) * 100) : null,
      recontact: contacts ? r1((recontacted / contacts) * 100) : null,
      firstContact: (() => {   // e-mail → 1º contato no período
        const m = new Map<string, number>();
        for (const msg of inbound) {
          if (msg.at < A || msg.at > B) continue;
          const e = convBy.get(msg.conv)?.customer_email?.toLowerCase();
          if (e && (!m.has(e) || msg.at < m.get(e)!)) m.set(e, msg.at);
        }
        return m;
      })(),
    };
  };
  const [cur, prev] = await Promise.all([period(range.from, range.to), period(range.prevFrom, range.prevTo)]);

  // Pedidos dos clientes que escreveram (pelo e-mail) e o que veio depois do 1º contato.
  const emails = [...cur.firstContact.keys()];
  let wentToBank = 0, refunded = 0;
  const daysToBank: number[] = [];
  if (emails.length && activeShops.length) {
    const { data: orders } = await selectAllIn<any>(emails, (c) => supabaseAdmin.from("shop_orders")
      .select("shop_id,external_id,email:raw->>email,refunds:raw->refunds,tags:raw->>tags")
      .eq("user_id", ownerId).in("shop_id", activeShops).in("raw->>email", c));
    const ext = [...new Set((orders ?? []).map((o: any) => o.external_id))];
    const { data: disputes } = ext.length
      ? await selectAllIn<any>(ext, (c) => supabaseAdmin.from("shop_order_disputes").select("shop_id,order_external_id,initiated_at")
          .eq("user_id", ownerId).eq("type", "chargeback").in("order_external_id", c))
      : { data: [] as any[] };
    const disputeBy = new Map((disputes ?? []).map((d: any) => [`${d.shop_id}:${d.order_external_id}`, Date.parse(d.initiated_at)]));
    const byEmail = new Map<string, { bank: number | null; refund: boolean }>();
    for (const o of (orders ?? []) as any[]) {
      const e = String(o.email ?? "").toLowerCase(), first = cur.firstContact.get(e);
      if (first == null) continue;
      const g = byEmail.get(e) ?? { bank: null, refund: false };
      const dispute = disputeBy.get(`${o.shop_id}:${o.external_id}`);
      const refunds = (o.refunds ?? []) as any[];
      const alert = refunds.find((r) => ALERT_RE.test(String(r?.note ?? "")) || ALERT_RE.test(String(o.tags ?? "")));
      const alertAt = alert ? Date.parse(alert.created_at ?? "") : NaN;
      for (const t of [dispute, alertAt]) if (t != null && Number.isFinite(t) && t > first && (g.bank == null || t < g.bank)) g.bank = t;
      if (refunds.some((r) => r !== alert && Date.parse(r?.created_at ?? "") > first)) g.refund = true;
      byEmail.set(e, g);
    }
    for (const [e, g] of byEmail) {
      if (g.bank != null) { wentToBank++; daysToBank.push((g.bank - cur.firstContact.get(e)!) / DAY); }
      else if (g.refund) refunded++;
    }
  }

  // Quem foi ao banco no mês (disputa aberta no período, lojas ativas): escreveu antes?
  let bankEvents = 0, bankWithContactBefore = 0;
  if (activeShops.length) {
    const { data: ds } = await selectAll<any>(supabaseAdmin.from("shop_order_disputes").select("shop_id,order_external_id,initiated_at")
      .eq("user_id", ownerId).eq("type", "chargeback").in("shop_id", activeShops).gte("initiated_at", range.from).lte("initiated_at", range.to));
    bankEvents = (ds ?? []).length;
    if (bankEvents) {
      const { data: os } = await selectAllIn<any>([...new Set((ds ?? []).map((d: any) => d.order_external_id))], (c) => supabaseAdmin.from("shop_orders")
        .select("shop_id,external_id,email:raw->>email").eq("user_id", ownerId).in("external_id", c));
      const emailBy = new Map((os ?? []).map((o: any) => [`${o.shop_id}:${o.external_id}`, String(o.email ?? "").toLowerCase()]));
      const firstEver = new Map<string, number>();
      for (const m of inbound) { const e = convBy.get(m.conv)?.customer_email?.toLowerCase(); if (e && (!firstEver.has(e) || m.at < firstEver.get(e)!)) firstEver.set(e, m.at); }
      for (const d of ds ?? []) {
        const e = emailBy.get(`${d.shop_id}:${d.order_external_id}`);
        const fc = e ? firstEver.get(e) : undefined;
        if (fc != null && fc < Date.parse(d.initiated_at)) bankWithContactBefore++;
      }
    }
  }

  return {
    contactRate: { value: cur.rate, prev: prev.rate, rastreio: cur.rastreio, contacts: cur.contacts, orders: cur.orders },
    recontact: { value: cur.recontact, prev: prev.recontact, conversations: cur.contacts, recontacted: cur.recontacted },
    contactToBank: {
      contacted: cur.firstContact.size, wentToBank, refunded,
      avgDaysToBank: daysToBank.length ? r1(daysToBank.reduce((s, x) => s + x, 0) / daysToBank.length) : null,
      bankEvents, bankWithContactBefore,
    },
  };
}

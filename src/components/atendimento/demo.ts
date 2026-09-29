import { createContext, useContext } from "react";
import { DEFAULT_BUSINESS_HOURS, DEFAULT_GOALS, businessMs, computeSupportKpis, monthRange, type BusinessHours, type KpiGoals } from "@/lib/support-kpis";
import { useServerFn } from "@tanstack/react-start";
import { translateSupportMessage, translateSupportReply, type SupportConversation, type SupportMessage, type SupportStatus } from "@/lib/atendimento.functions";

// Modo demonstração do Atendimento (/atendimento?demo=1): um "backend" em
// memória com clientes e e-mails fictícios que responde às mesmas chamadas das
// server functions. Nada vai pro banco nem pro Zoho; recarregar a página zera.

export const DemoContext = createContext(false);
export const useIsDemo = () => useContext(DemoContext);

export function isDemoUrl() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";
}

// Troca a server function pela versão em memória quando está em modo demo.
export function useSupportFn<F extends (...args: any[]) => Promise<any>>(fn: F, name: DemoFnName): (...args: any[]) => ReturnType<F> {
  const demo = useIsDemo();
  const real = useServerFn(fn as any);
  return (demo ? demoApi[name] : real) as any;
}

// ─── Dados ────────────────────────────────────────────────────────────────────

const OWN = "suporte@srxstore.com";
const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const H = 60, D = 24 * 60;

type Seed = {
  email: string; name: string; status: SupportStatus; favorite?: boolean; tags?: string[]; ai?: string[]; note?: string; shop?: string;
  msgs: { dir: "in" | "out"; at: number; subject: string; body: string; read?: boolean; attachments?: { name: string; size: number }[] }[];
};

const p = (...lines: string[]) => lines.map((l) => (l ? `<p>${l}</p>` : "")).join("");
const quote = (who: string, body: string) =>
  `<div class="gmail_quote"><div>Em ${who} escreveu:</div><blockquote style="border-left:1px solid #ccc;padding-left:8px;margin-left:4px">${body}</blockquote></div>`;

const SEEDS: Seed[] = [
  {
    email: "jessica.miller@gmail.com", name: "Jessica Miller", status: "em_atendimento", favorite: true,
    tags: ["Rastreio"], ai: ["Rastreio"],
    note: "Cliente VIP — já comprou 5 vezes. Priorizar.",
    msgs: [
      { dir: "in", at: 26 * H, subject: "Order status #4532", body: p("Hi,", "Could you tell me the status of my order #4532? I paid on 9/15 and haven't received any update yet.", "Thanks,<br>Jessica") },
      { dir: "out", at: 25 * H, subject: "Re: Order status #4532", body: p("Hi Jessica!", "I just checked and your order #4532 shipped today and is already in transit.", "Your tracking number is <b>TR123456789US</b>.", "Let me know if you have any other questions! 😊", "Best regards,<br>SRX Support") },
      { dir: "in", at: 18, subject: "Re: Order status #4532", read: false, body: p("Thanks for getting back to me!", "The tracking has been stuck on \"label created\" for 2 days. Is that normal?", "I really need it by Friday 🙏") + quote("Sep 26, 2026, SRX Support &lt;support@srxstore.com&gt;", p("Hi Jessica! I just checked and your order #4532 shipped today...")) },
    ],
  },
  {
    email: "ryan.cooper@gmail.com", name: "Ryan Cooper", status: "novo", tags: ["Troca"], ai: ["Troca"],
    msgs: [{ dir: "in", at: 95, subject: "Exchange question", read: false, body: p("Hello,", "The sneakers I got are too small. I'd like to exchange them for a bigger size — how do I do that?", "Order #4519.", "Thanks,<br>Ryan") }],
  },
  {
    email: "david.thompson@outlook.com", name: "David Thompson", status: "em_atendimento", tags: ["Reembolso"], ai: ["Reembolso"],
    msgs: [
      { dir: "in", at: 6 * D, subject: "Refund", body: p("Hi, I cancelled order #4401 and would like a refund.") },
      { dir: "out", at: 6 * D - 3 * H, subject: "Re: Refund", body: p("Hi David, your refund has been issued and should reach your card within 5–7 business days.", "Best regards,<br>SRX Support") },
      { dir: "in", at: 3 * H + 12, subject: "Re: Refund", read: false, body: p("It's been over a week and I still haven't received my refund. Can you help?") },
    ],
  },
  {
    email: "megan.brooks@yahoo.com", name: "Megan Brooks", status: "em_atendimento", tags: ["Defeito"], ai: ["Defeito"],
    msgs: [
      { dir: "in", at: 5 * H, subject: "Item arrived damaged", body: p("Hi, the bag arrived with the strap coming apart at the seam. Photo attached.", "Order #4498."), attachments: [{ name: "bag-photo.jpg", size: 1_840_000 }] },
      { dir: "out", at: 4 * H, subject: "Re: Item arrived damaged", body: p("Hi Megan, we're so sorry about that! We can send you a replacement or issue a full refund — which would you prefer?", "Best regards,<br>SRX Support") },
    ],
  },
  {
    email: "emily.johnson@gmail.com", name: "Emily Johnson", status: "em_atendimento", tags: ["Rastreio"], ai: ["Rastreio"],
    msgs: [
      { dir: "in", at: D + 4 * H, subject: "Where is my order #1087?", body: p("Hi, I ordered 10 days ago and tracking hasn't updated. Can you check?", "Thanks, Emily") },
      { dir: "out", at: D + 2 * H, subject: "Re: Where is my order #1087?", body: p("Hi Emily! Your package cleared customs yesterday and should arrive in 3–5 business days.", "Best,<br>SRX Support") },
    ],
  },
  {
    email: "sarah.wilson@hotmail.com", name: "Sarah Wilson", status: "novo", favorite: true, tags: ["Troca"], ai: ["Troca"],
    msgs: [{ dir: "in", at: 7 * H, subject: "Wrong size received", read: false, body: p("Hello, I ordered a size M but received an XL. How can I get the right one?", "Order #1102."), attachments: [{ name: "label.png", size: 420_000 }, { name: "invoice.pdf", size: 96_000 }] }],
  },
  {
    email: "ashley.davis@gmail.com", name: "Ashley Davis", status: "novo",
    msgs: [{ dir: "in", at: 9 * H, subject: "Discount code didn't work", body: p("The code FALL10 didn't apply at checkout. Can I still use it on my order?") }],
  },
  {
    email: "kevin.martinez@gmail.com", name: "Kevin Martinez", status: "resolvido", tags: ["Rastreio"],
    msgs: [
      { dir: "in", at: 2 * D, subject: "Wrong address on my order", body: p("I typed the wrong house number on order #4510 — it's 245, not 254.") },
      { dir: "out", at: 2 * D - 40, subject: "Re: Wrong address on my order", body: p("All set, Kevin — the address was updated before shipping!", "Best regards,<br>SRX Support") },
    ],
  },
  {
    email: "michael.brown@icloud.com", name: "Michael Brown", status: "resolvido", tags: ["Reembolso"], ai: ["Reembolso"],
    msgs: [
      { dir: "in", at: 3 * D, subject: "Cancel my order", body: p("Please cancel order #1079, I bought it by mistake.") },
      { dir: "out", at: 3 * D - 2 * H, subject: "Re: Cancel my order", body: p("Done, Michael — order cancelled and refunded.", "Best,<br>SRX Support") },
      { dir: "in", at: 3 * D - 3 * H, subject: "Re: Cancel my order", body: p("Thank you so much!") },
    ],
  },
  {
    email: "brian.walker@aol.com", name: "Brian Walker", status: "resolvido",
    msgs: [
      { dir: "in", at: 4 * D, subject: "Invoice request", body: p("Could you send me the invoice for order #4455?") },
      { dir: "out", at: 4 * D - 5 * H, subject: "Re: Invoice request", body: p("Sure, Brian — it's attached.", "Best regards,<br>SRX Support"), attachments: [{ name: "invoice-4455.pdf", size: 180_000 }] },
    ],
  },
  {
    email: "laura.green@gmail.com", name: "Laura Green", status: "resolvido",
    msgs: [{ dir: "in", at: 5 * D, subject: "Love it! 😊", body: p("Just wanted to say I love the product and shipping was super fast. Great job!") }],
  },
  {
    email: "noreply@shopify.com", name: "Shopify", status: "resolvido",
    msgs: [{ dir: "in", at: 6 * D, subject: "Your payout of $3,482.10 is on its way", body: p("The payout for Walkesty has been sent to your bank account.") }],
  },
];

type Store = { conversations: SupportConversation[]; messages: (SupportMessage & { conversation_id: string })[]; signature: string; signatureEnabled: boolean; tags: string[]; aiTagsEnabled: boolean; goals: KpiGoals };

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

// Histórico fictício (45 dias de conversas já resolvidas) pra aba KPI ter o
// que mostrar. Sorteio com semente fixa: sempre os mesmos dados.
const FIRST = ["Olivia", "Liam", "Emma", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella", "Lucas", "Mia", "Logan", "Amelia", "James", "Harper", "Benjamin", "Evelyn", "Henry", "Abigail", "Jack"];
const LAST = ["Smith", "Johnson", "Williams", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "White", "Harris"];
const TOPICS: { subject: string; body: string; tag: string | null }[] = [
  { subject: "Where is my package?", body: "Hi, my tracking hasn't updated in a few days. Can you check on it?", tag: "Rastreio" },
  { subject: "Tracking number not working", body: "The tracking number you sent says 'not found'. Is it correct?", tag: "Rastreio" },
  { subject: "Refund request", body: "I'd like to return my order and get a refund, please.", tag: "Reembolso" },
  { subject: "Still waiting for my refund", body: "It's been 10 days and my refund hasn't shown up yet.", tag: "Reembolso" },
  { subject: "Item arrived broken", body: "The product arrived damaged. What can you do?", tag: "Defeito" },
  { subject: "Not working", body: "The item stopped working after two days of use.", tag: "Defeito" },
  { subject: "Wrong size", body: "I need a different size. How do I exchange it?", tag: "Troca" },
  { subject: "Exchange for another color", body: "Can I swap this for the black one instead?", tag: "Troca" },
  { subject: "Question about my order", body: "Can I still change the shipping address on my order?", tag: null },
  { subject: "Discount code", body: "Do you have any discount code for a second purchase?", tag: null },
];

// Lojas fictícias (ids fixos).
const DEMO_SHOPS = ["Walkesty", "Voultie Wear", "Voultie Club", "Woovah", "The Voultie"].map((name, i) => ({
  id: `00000000-0000-4000-9000-00000000000${i + 1}`, name,
}));
const shopIdByName = (name?: string) => DEMO_SHOPS.find((s) => s.name === name)?.id ?? null;

function seededRandom(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

function historySeeds(): Seed[] {
  const rand = seededRandom(42);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const out: Seed[] = [];
  for (let i = 0; i < 90; i++) {
    const topic = pick(TOPICS);
    const first = pick(FIRST), last = pick(LAST);
    // Espalhados nos últimos 45 dias, em horários variados.
    const daysAgo = 7 + Math.floor(rand() * 38);
    const at = daysAgo * D + Math.floor(rand() * 12) * H + Math.floor(rand() * 60);
    const wait = 20 + Math.floor(rand() ** 2 * 30 * H);   // maioria responde rápido
    out.push({
      email: `${first}.${last}${i}@gmail.com`.toLowerCase(), name: `${first} ${last}`, status: "resolvido",
      // Walkesty e Voultie Wear recebem mais e-mails que as outras.
      shop: DEMO_SHOPS[Math.min(4, Math.floor(rand() ** 1.6 * 5))].name,
      tags: topic.tag ? [topic.tag] : [], ai: topic.tag && rand() > 0.2 ? [topic.tag] : [],
      msgs: [
        { dir: "in", at, subject: topic.subject, body: p("Hi,", topic.body, `Thanks,<br>${first}`) },
        { dir: "out", at: at - wait, subject: `Re: ${topic.subject}`, body: p(`Hi ${first}, thanks for reaching out — we've taken care of it!`, "Best regards,<br>SRX Support") },
      ],
    });
  }
  return out;
}

function buildStore(): Store {
  const conversations: SupportConversation[] = [];
  const messages: Store["messages"] = [];
  for (const s of [...SEEDS, ...historySeeds()]) {
    const id = uid();
    const msgs = s.msgs.map((m) => ({
      id: uid(), conversation_id: id, message_id: String(1_700_000_000_000 + seq), folder_id: "1",
      direction: m.dir, from_email: m.dir === "in" ? s.email : OWN, from_name: m.dir === "in" ? s.name : null,
      to_emails: m.dir === "in" ? OWN : s.email, subject: m.subject,
      summary: m.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140),
      sent_at: ago(m.at), is_read: m.dir === "out" || m.read !== false, has_attachment: !!m.attachments?.length,
      content_html: m.body, attachments: (m.attachments ?? []).map((a, i) => ({ id: String(i + 1), ...a })),
    }));
    messages.push(...msgs);
    conversations.push({
      id, customer_email: s.email, customer_name: s.name, subject: null, summary: null,
      last_message_at: null, last_inbound_at: null, last_outbound_at: null, message_count: 0, unread_count: 0,
      status: s.status, favorite: !!s.favorite, tags: s.tags ?? [], ai_tags: s.ai ?? [], note: s.note ?? null,
      resolved_at: s.status === "resolvido" ? ago(s.msgs[s.msgs.length - 1].at - 30) : null,
      shop_id: shopIdByName(s.shop ?? ORDERS[s.email]?.store),
    });
  }
  const store = { conversations, messages, signature: "Best regards,\n{nome}\nSRX Customer Support", signatureEnabled: true, tags: ["Reembolso", "Defeito", "Troca", "Rastreio"], aiTagsEnabled: true, goals: { ...DEFAULT_GOALS } };
  store.conversations.forEach((c) => recompute(store, c));
  return store;
}

function recompute(store: Store, c: SupportConversation) {
  const list = store.messages.filter((m) => m.conversation_id === c.id).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const last = list[list.length - 1];
  c.subject = last?.subject ?? null;
  c.summary = last?.summary ?? null;
  c.last_message_at = last?.sent_at ?? null;
  c.last_inbound_at = [...list].reverse().find((m) => m.direction === "in")?.sent_at ?? null;
  c.last_outbound_at = [...list].reverse().find((m) => m.direction === "out")?.sent_at ?? null;
  c.message_count = list.length;
  c.unread_count = list.filter((m) => m.direction === "in" && !m.is_read).length;
}

let store: Store | null = null;
const db = () => (store ??= buildStore());
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// Pedidos fictícios por cliente (painel da direita).
const ORDERS: Record<string, { n: number; currency: string; store: string; values: number[] }> = {
  "jessica.miller@gmail.com": { n: 4532, currency: "USD", store: "Walkesty", values: [59.9, 34.9, 79.9, 44.9, 54.9] },
  "ryan.cooper@gmail.com": { n: 4519, currency: "USD", store: "Walkesty", values: [89.9] },
  "david.thompson@outlook.com": { n: 4401, currency: "USD", store: "Walkesty", values: [39.9, 29.9] },
  "megan.brooks@yahoo.com": { n: 4498, currency: "USD", store: "Walkesty", values: [99.0] },
  "emily.johnson@gmail.com": { n: 1087, currency: "USD", store: "Voultie Wear", values: [89.99, 64.5, 120] },
  "sarah.wilson@hotmail.com": { n: 1102, currency: "USD", store: "Voultie Wear", values: [74.9] },
  "kevin.martinez@gmail.com": { n: 4510, currency: "USD", store: "Walkesty", values: [49.9] },
  "michael.brown@icloud.com": { n: 1079, currency: "USD", store: "Voultie Wear", values: [49.9] },
  "brian.walker@aol.com": { n: 4455, currency: "USD", store: "Walkesty", values: [129.9, 24.9] },
  "laura.green@gmail.com": { n: 4470, currency: "USD", store: "Walkesty", values: [34.9] },
};

// ─── API falsa (mesmos nomes/formatos das server functions) ───────────────────

const demoApi = {
  getZohoStatus: async () => ({
    connected: true, email: OWN, displayName: "Equipe SRX", lastSyncAt: ago(1), lastSyncError: null,
    sendAs: OWN, sendAsOptions: [OWN],
    mailWebBase: "https://mail.zoho.com", redirectUri: `${window.location.origin}/api/public/zoho/callback`, isAdmin: true,
  }),
  syncSupportInbox: async () => { await wait(600); return { skipped: true }; },
  startZohoOAuth: async () => { throw new Error("Modo demonstração — saia do modo demo para conectar"); },
  disconnectZoho: async () => { throw new Error("Modo demonstração — nada foi desconectado"); },
  setZohoSendAs: async () => { throw new Error("Modo demonstração — nada foi alterado"); },

  listSupportConversations: async ({ data }: { data: { from: string; to: string } }) => {
    await wait();
    const s = db();
    // Mesma regra do servidor: em atendimento, última mensagem nossa, 48h sem resposta → resolvido.
    for (const c of s.conversations) {
      const out = c.last_outbound_at ? new Date(c.last_outbound_at).getTime() : 0;
      const inn = c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : 0;
      if (c.status === "em_atendimento" && out > inn && out < Date.now() - 2 * 86_400_000) {
        c.status = "resolvido"; c.resolved_at = new Date().toISOString();
      }
    }
    const conversations = s.conversations.filter((c) => c.last_message_at && c.last_message_at >= data.from && c.last_message_at <= data.to);
    const to = new Date(data.to).getTime();
    const waits: number[] = [];
    for (const c of s.conversations) {
      let pending: number | null = null;
      for (const m of s.messages.filter((x) => x.conversation_id === c.id).sort((a, b) => a.sent_at.localeCompare(b.sent_at))) {
        const t = new Date(m.sent_at).getTime();
        if (t < new Date(data.from).getTime()) continue;
        if (m.direction === "in") { if (pending == null) pending = t; } else if (pending != null) { if (pending <= to) waits.push(businessMs(pending, t, demoHours)); pending = null; }
      }
    }
    return clone({
      conversations: conversations.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")),
      kpis: {
        received: s.messages.filter((m) => m.direction === "in" && m.sent_at >= data.from && m.sent_at <= data.to).length,
        unread: s.conversations.filter((c) => c.unread_count > 0).length,
        inProgress: s.conversations.filter((c) => c.status === "em_atendimento").length,
        resolved: conversations.filter((c) => c.status === "resolvido").length,
        avgResponseMs: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
        responses: waits.length,
        hours: demoHours,
      },
    });
  },

  findEmailsByOrder: async ({ data }: { data: { q: string } }) => {
    const n = Number(data.q.replace("#", ""));
    return Object.entries(ORDERS).filter(([, o]) => o.values.some((_, i) => o.n - i * 7 === n)).map(([e]) => e);
  },

  findOrderCustomers: async ({ data }: { data: { q: string } }) => {
    const n = Number(data.q.replace("#", ""));
    return Object.entries(ORDERS).filter(([, o]) => o.values.some((_, i) => o.n - i * 7 === n)).map(([email]) => ({ order: `#${n}`, email }));
  },

  getSupportConversation: async ({ data }: { data: { id: string } }) => {
    await wait(350);
    const s = db();
    const conversation = s.conversations.find((c) => c.id === data.id);
    if (!conversation) throw new Error("Conversa não encontrada");
    const messages = s.messages.filter((m) => m.conversation_id === data.id).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    return clone({ conversation, messages });
  },

  markConversationRead: async ({ data }: { data: { ids: string[]; read: boolean } }) => {
    const s = db();
    for (const id of data.ids) {
      const inbound = s.messages.filter((m) => m.conversation_id === id && m.direction === "in").sort((a, b) => b.sent_at.localeCompare(a.sent_at));
      if (data.read) inbound.forEach((m) => { m.is_read = true; });
      else if (inbound[0]) inbound[0].is_read = false;
      recompute(s, s.conversations.find((c) => c.id === id)!);
    }
    return { ok: true };
  },

  updateSupportConversations: async ({ data }: { data: { ids: string[]; patch: Partial<SupportConversation> } }) => {
    for (const c of db().conversations.filter((x) => data.ids.includes(x.id))) {
      Object.assign(c, data.patch);
      if (data.patch.tags) c.ai_tags = c.ai_tags.filter((t) => data.patch.tags!.includes(t));
      if (data.patch.status) c.resolved_at = data.patch.status === "resolvido" ? new Date().toISOString() : null;
    }
    return { ok: true };
  },

  uploadSupportAttachment: async ({ data }: { data: { fileName: string } }) => {
    await wait(400);
    return { storeName: "demo", attachmentPath: "/demo", attachmentName: data.fileName };
  },

  sendSupportReply: async ({ data }: { data: { conversationId: string; text: string; status: SupportStatus; signature: boolean; attachments?: { attachmentName: string }[] } }) => {
    await wait(700);
    const s = db();
    const c = s.conversations.find((x) => x.id === data.conversationId)!;
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    let html = `<p>${esc(data.text)}</p>`;
    if (data.signature && s.signatureEnabled && s.signature.trim()) {
      html += `<p style="color:#666">${esc(s.signature.replace(/\{nome\}/gi, "Você"))}</p>`;
    }
    const base = c.subject ?? "";
    s.messages.push({
      id: uid(), conversation_id: c.id, message_id: String(Date.now()), folder_id: "2", direction: "out",
      from_email: OWN, from_name: null, to_emails: c.customer_email, subject: /^re:/i.test(base) ? base : `Re: ${base}`,
      summary: data.text.slice(0, 140), sent_at: new Date().toISOString(), is_read: true,
      has_attachment: !!data.attachments?.length, content_html: html,
      attachments: (data.attachments ?? []).map((a, i) => ({ id: String(i + 1), name: a.attachmentName, size: 0 })),
    });
    c.status = data.status;
    c.resolved_at = data.status === "resolvido" ? new Date().toISOString() : null;
    recompute(s, c);
    return { ok: true };
  },

  sendSupportNewMessage: async ({ data }: { data: { to: string; subject: string; text: string } }) => {
    await wait(700);
    const s = db();
    const email = data.to.toLowerCase();
    let c = s.conversations.find((x) => x.customer_email === email);
    if (!c) {
      c = {
        id: uid(), customer_email: email, customer_name: null, subject: null, summary: null, last_message_at: null,
        last_inbound_at: null, last_outbound_at: null, message_count: 0, unread_count: 0, status: "em_atendimento",
        favorite: false, tags: [], ai_tags: [], note: null, resolved_at: null, shop_id: null,
      };
      s.conversations.push(c);
    }
    s.messages.push({
      id: uid(), conversation_id: c.id, message_id: String(Date.now()), folder_id: "2", direction: "out",
      from_email: OWN, from_name: null, to_emails: email, subject: data.subject, summary: data.text.slice(0, 140),
      sent_at: new Date().toISOString(), is_read: true, has_attachment: false,
      content_html: `<p>${data.text.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`, attachments: [],
    });
    c.status = "em_atendimento";
    recompute(s, c);
    return { conversationId: c.id };
  },

  getSupportCustomer: async ({ data }: { data: { email: string } }) => {
    await wait(300);
    const o = ORDERS[data.email.toLowerCase()];
    const conv = db().conversations.find((c) => c.customer_email === data.email.toLowerCase());
    if (!o) return { name: null, phone: null, firstOrderAt: null, ordersCount: 0, totals: {}, stores: [], orders: [] };
    const orders = o.values.map((v, i) => ({
      id: `${o.n}-${i}`, number: `#${o.n - i * 7}`, date: ago(i * 38 * D + 3 * D), revenue: v, currency: o.currency,
      store: o.store, financial: i === 0 && data.email.startsWith("david") ? "refunded" : "paid",
      delivery: i === 0 ? "Em trânsito" : "Entregue",
      tracking: `TR${String(123456789 - i * 1111).padStart(9, "0")}${o.currency === "BRL" ? "BR" : "US"}`,
      trackingUrl: `https://${o.store.toLowerCase()}.com/apps/track123?nums=TR${String(123456789 - i * 1111).padStart(9, "0")}${o.currency === "BRL" ? "BR" : "US"}`, carrier: o.currency === "BRL" ? "Correios" : "USPS", cancelled: false,
    }));
    return {
      name: conv?.customer_name ?? null,
      phone: o.currency === "BRL" ? "+55 27 99999-1234" : "+1 (555) 201-4478",
      firstOrderAt: orders[orders.length - 1].date,
      ordersCount: orders.length,
      totals: { [o.currency]: o.values.reduce((a, b) => a + b, 0) },
      stores: [o.store],
      orders,
    };
  },

  // Tradução usa a IA de verdade (manda só o texto do e-mail fictício).
  translateSupportMessage: async ({ data }: { data: { id: string } }) => {
    const m = db().messages.find((x) => x.id === data.id);
    if (!m) throw new Error("E-mail não encontrado");
    const text = (m.content_html ?? m.summary ?? "")
      .replace(/<blockquote[\s\S]*?<\/blockquote>|<div class="gmail_quote"[\s\S]*$/gi, " ")
      .replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, " ")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();
    if (m.content_pt) return { text: m.content_pt };
    const r = await translateSupportMessage({ data: { text } });
    m.content_pt = r.text;
    return r;
  },
  translateSupportReply: async ({ data }: { data: { text: string } }) => translateSupportReply({ data }),
  deleteSupportConversations: async ({ data }: { data: { ids: string[] } }) => {
    await wait(400);
    const s = db();
    s.conversations = s.conversations.filter((c) => !data.ids.includes(c.id));
    s.messages = s.messages.filter((m) => !data.ids.includes(m.conversation_id));
    return { deleted: data.ids.length, failed: 0 };
  },
  getSupportKpis: async ({ data }: { data: { month: string } }) => {
    await wait(300);
    const s = db();
    const range = monthRange(data.month);
    return { ...computeSupportKpis(s.messages, s.conversations, DEMO_SHOPS, s.tags, range, demoHours), partial: range.partial, goals: { ...s.goals } };
  },
  listSupportShops: async () => DEMO_SHOPS,
  getSupportSettings: async () => ({ signature: db().signature, signatureEnabled: db().signatureEnabled, tags: [...db().tags], aiTagsEnabled: db().aiTagsEnabled, aiAvailable: true, goals: { ...db().goals }, businessHours: { ...demoHours }, senderName: "Você" }),
  saveSupportSettings: async ({ data }: { data: { signature?: string; signatureEnabled?: boolean; tags?: string[]; aiTagsEnabled?: boolean; goals?: KpiGoals; businessHours?: BusinessHours } }) => {
    if (data.goals) db().goals = { ...data.goals };
    if (data.businessHours) demoHours = { ...data.businessHours };
    await wait();
    if (data.signature !== undefined) db().signature = data.signature;
    if (data.signatureEnabled !== undefined) db().signatureEnabled = data.signatureEnabled;
    if (data.tags) db().tags = [...data.tags];
    if (data.aiTagsEnabled !== undefined) db().aiTagsEnabled = data.aiTagsEnabled;
    return { ok: true };
  },
  changeSupportTag: async ({ data }: { data: { from: string; to: string | null } }) => {
    await wait();
    const replace = (list: string[]) => [...new Set(list.flatMap((t) => (t === data.from ? (data.to ? [data.to] : []) : [t])))];
    db().tags = replace(db().tags);
    const hit = db().conversations.filter((c) => c.tags.includes(data.from));
    hit.forEach((c) => { c.tags = replace(c.tags); c.ai_tags = replace(c.ai_tags); });
    return { conversations: hit.length };
  },

  // Mensagens salvas (em memória).
  listSupportTemplates: async () => {
    await wait();
    return [...demoTemplates].sort((a, b) => a.title.localeCompare(b.title));
  },
  saveSupportTemplate: async ({ data }: { data: { id?: string; title: string; body: string } }) => {
    await wait();
    const t = data.id ? demoTemplates.find((x) => x.id === data.id) : null;
    if (t) { t.title = data.title; t.body = data.body; }
    else demoTemplates.push({ id: crypto.randomUUID(), title: data.title, body: data.body });
    return { ok: true };
  },
  deleteSupportTemplate: async ({ data }: { data: { id: string } }) => {
    await wait();
    const i = demoTemplates.findIndex((x) => x.id === data.id);
    if (i >= 0) demoTemplates.splice(i, 1);
    return { ok: true };
  },
};

let demoHours: BusinessHours = { ...DEFAULT_BUSINESS_HOURS };

const demoTemplates: { id: string; title: string; body: string }[] = [
  { id: "demo-t1", title: "Prazo de entrega", body: "Hi {nome},\n\nYour order is on its way and should arrive within 7–12 business days." },
];

type DemoFnName = keyof typeof demoApi;
